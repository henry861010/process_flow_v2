"""Cross-session reuse keeps session identity, validation, and exports intact."""
import copy
from dataclasses import replace
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from process_flow_api.models import GeometryPreviewRequest
from process_flow_api.preview_sessions import PreviewSessionManager
from process_flow_api.services import prepare_preview_execution, materialize_preview_snapshots
from process_flow_kernel import FlowCompiler, GeometryKernel
from process_flow_kernel.application.step_cache import CacheInvalidatedError
from process_flow_kernel.infrastructure.step_cache import MemoryStepExecutionCache
from test_schematic_planning import context, add_step, inp, out, placement, recipe


class PreviewStepCacheTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.context = context()
        add_step(self.context, "later", "pnp/pnp", out("first"), {"placements": [placement(20)]}, inp("die"))
        self.store = SimpleNamespace(
            get_process_step_template=lambda id_: next(copy.deepcopy(t) for t in self.context.step_templates if t["id"] == id_),
            get_geometry=lambda id_: copy.deepcopy(self.context.referenced_catalog_geometries[id_]),
        )
        self.manager = PreviewSessionManager()
        self.addAsyncCleanup(self.manager.shutdown)

    def request(self, target="later", label=None):
        return GeometryPreviewRequest.model_validate({
            "flow": {"definition": self.context.definition, "configuration": self.context.configuration},
            "target": {"type": "stepOutput", "stepRefId": target, "outputPortId": "result_geometry"},
            "sourceLabel": label,
        })

    async def test_targets_labels_and_downstream_edits_reuse_but_recompile(self):
        statistics = []
        original = GeometryKernel.execute
        def execute(kernel, *args, **kwargs):
            result = original(kernel, *args, **kwargs)
            statistics.append(result.execution_statistics())
            return result
        compile_original = FlowCompiler.compile
        with patch.object(GeometryKernel, "execute", execute), patch.object(
            FlowCompiler, "compile", autospec=True, side_effect=compile_original,
        ) as compile_flow:
            later = await self.manager.create_session(self.store, self.request())
            first = await self.manager.create_session(self.store, self.request("first"))
            renamed = await self.manager.create_session(self.store, self.request("first", "New preview title"))
            self.context.configuration["stepConfigurations"]["later"] = recipe({"placements": [placement(40)]})
            edited = await self.manager.create_session(self.store, self.request())
        self.assertEqual(compile_flow.call_count, 4)
        self.assertEqual([s["executedSteps"] for s in statistics], [2, 0, 0, 1])
        self.assertEqual(len({p["sessionId"] for p in (later, first, renamed, edited)}), 4)
        self.assertEqual(first["snapshots"][0]["geometryHash"], renamed["snapshots"][0]["geometryHash"])
        self.assertEqual(renamed["snapshots"][0]["label"], "New preview title")
        uncached = PreviewSessionManager(step_cache_enabled=False)
        self.addAsyncCleanup(uncached.shutdown)
        self.assertEqual(edited, await uncached.create_session(self.store, self.request()))

    async def test_response_mutation_and_reset(self):
        before = await self.manager.create_session(self.store, self.request())
        mutated = await self.manager.create_session(self.store, self.request())
        mutated["snapshots"][0]["geometryEntityJson"]["structure"]["root"]["bodies"].clear()
        mutated["snapshots"][-1]["schematic"].clear()
        self.assertEqual(before, await self.manager.create_session(self.store, self.request()))

        info = self.manager.step_cache_info()
        self.assertEqual(info["entries"], 2)
        await self.manager.clear()
        self.assertEqual(self.manager.step_cache_info()["entries"], 0)
        self.assertEqual(self.manager.step_cache_info()["generation"], info["generation"] + 1)
        self.assertEqual(before, await self.manager.create_session(self.store, self.request()))

    async def test_only_target_is_assembled_retained_and_returned(self):
        with patch.object(self.manager, "_snapshot_record", wraps=self.manager._snapshot_record) as assemble:
            response = await self.manager.create_session(self.store, self.request())
            self.assertEqual(assemble.call_count, 1)
            self.assertEqual([s["stepRefId"] for s in response["snapshots"]], ["later"])
            self.assertEqual(response["initialSnapshotId"], response["snapshots"][0]["snapshotId"])
            record = self.manager._sessions.get(response["sessionId"])
            self.assertEqual(len(record.snapshots), 1)
            repeated = await self.manager.create_session(self.store, self.request())
            self.assertEqual(repeated, response)
            self.assertEqual(assemble.call_count, 1)
            upstream = await self.manager.create_session(self.store, self.request("first"))
            self.assertEqual([s["stepRefId"] for s in upstream["snapshots"]], ["first"])
            self.assertEqual(assemble.call_count, 2)

        prepared = prepare_preview_execution(replace(self.context, target={
            "type": "stepOutput", "stepRefId": "later", "outputPortId": "result_geometry"}), None)
        internal = await materialize_preview_snapshots(prepared)
        self.assertEqual(len(internal), 2)
        selected = response["snapshots"][0]
        self.assertEqual(selected["geometryEntityJson"]["structure"], internal[-1].geometry_structure)
        self.assertEqual(selected["executionWarnings"], list(internal[-1].execution_warnings))

    async def test_cache_hit_does_not_bypass_validation(self):
        await self.manager.create_session(self.store, self.request())
        self.context.configuration["stepConfigurations"]["first"] = recipe({"placements": "invalid"})
        with self.assertRaises(ValueError) as cached:
            await self.manager.create_session(self.store, self.request())
        manager = PreviewSessionManager(step_cache_enabled=False)
        self.addAsyncCleanup(manager.shutdown)
        with self.assertRaises(ValueError) as uncached:
            await manager.create_session(self.store, self.request())
        self.assertEqual(str(cached.exception), str(uncached.exception))

    async def test_generation_is_captured_before_worker_can_start(self):
        prepared = prepare_preview_execution(self.context, None)
        cache = MemoryStepExecutionCache()
        generation = cache.generation
        cache.clear()
        with self.assertRaises(CacheInvalidatedError):
            await materialize_preview_snapshots(prepared, step_cache=cache, cache_generation=generation)
        self.assertEqual(cache.info()["entries"], 0)

    async def test_empty_placements_cache_and_uncached_outputs_match(self):
        self.context.configuration["stepConfigurations"]["first"] = recipe({"placements": []})
        request = self.request()
        cold = await self.manager.create_session(self.store, request)
        manager = PreviewSessionManager(step_cache_enabled=False)
        self.addAsyncCleanup(manager.shutdown)
        self.assertEqual(cold, await manager.create_session(self.store, request))
        upstream = await self.manager.create_session(self.store, self.request("first"))
        self.assertEqual(upstream, await manager.create_session(self.store, self.request("first")))

    async def test_environment_controls(self):
        with patch.dict(os.environ, {"PREVIEW_STEP_CACHE_ENABLED": "false"}):
            disabled = PreviewSessionManager.from_environment()
            self.assertIsNone(disabled.step_cache_info())
            await disabled.shutdown()
        with patch.dict(os.environ, {"PREVIEW_STEP_CACHE_ENABLED": "true", "PREVIEW_STEP_CACHE_ENTRIES": "1", "PREVIEW_STEP_CACHE_BYTES": "128"}):
            tiny = PreviewSessionManager.from_environment()
            self.addAsyncCleanup(tiny.shutdown)
            await tiny.create_session(self.store, self.request())
            self.assertEqual(tiny.step_cache_info()["entries"], 0)
            self.assertLessEqual(tiny.step_cache_info()["bytes"], 128)
        with patch.dict(os.environ, {"PREVIEW_STEP_CACHE_ENABLED": "maybe"}):
            with self.assertRaisesRegex(ValueError, "PREVIEW_STEP_CACHE_ENABLED"):
                PreviewSessionManager.from_environment()
