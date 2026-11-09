"""Execution reuse is content based, isolated, bounded, and generation scoped."""
from __future__ import annotations

import copy
import gc
import sys
import time
import unittest
import weakref
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from threading import Barrier, Event, Lock
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from process_flow_kernel import (
    ExecutionPlan, GeometryArtifact, GeometryKernel, PlannedGeometryInput,
    PlannedStep, ProcessGeometryState,
)
from process_flow_kernel.application.step_cache import (
    CacheInvalidatedError, StepExecutionRecord, artifact_fingerprint, content_fingerprint,
)
from process_flow_kernel.infrastructure.module_resolver import ProcessStepModuleResolver
from process_flow_kernel.infrastructure.step_cache import MemoryStepExecutionCache, retained_size
from process_flow_kernel.domain.geometry import PolygonSnapshot


def artifact():
    state = ProcessGeometryState.create()
    state.initialize_box_layer(material="Si", bottom_left=[0, 0, 0],
                               top_right=[10, 10, 0], thickness=10)
    return GeometryArtifact.from_state(state)


def source(name=None, *, port="result_geometry"):
    return (PlannedGeometryInput(kind="external", flow_input_id="main") if name is None else
            PlannedGeometryInput(kind="stepOutput", step_ref_id=name, output_port_id=port))


def step(name, parent=None, **changes):
    return replace(PlannedStep(name, name, {"id": name, "program": "cache_test"},
                               {"thk": 1}, {"thk": 1}, {"main_geometry": source(parent)},
                               "result_geometry"), **changes)


def plan(steps=None):
    steps = steps or [step("a"), step("b", "a"), step("c", "b")]
    return ExecutionPlan(steps, {"main": artifact()}, [steps[-1].step_ref_id])


def wait_for(predicate):
    deadline = time.monotonic() + 5
    while not predicate():
        if time.monotonic() >= deadline:
            raise AssertionError("Timed out waiting for worker state")
        Event().wait(.001)


class KernelCacheTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.module = ModuleType("process_flow_steps.cache_test")
        self.module.EXECUTION_CACHE_VERSION = 1
        self.module.execute = self.execute
        self.modules = patch.dict(sys.modules, {self.module.__name__: self.module})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.cache = MemoryStepExecutionCache()
        self.kernel = GeometryKernel(step_cache=self.cache)
        self.plan = plan()

    def execute(self, context):
        name = context.step_ref["stepRefId"]
        self.calls.append(name)
        context.state.deposit_layer(material="PI", thickness=context.values["thk"],
                                    key="rdl", advance_cursor=True)
        context.warn("test", name, details={"items": [1]})
        return context.state

    def assert_equal_outputs(self, actual, expected):
        self.assertEqual(actual.geometry(), expected.geometry())
        self.assertEqual(actual.step_outputs(), expected.step_outputs())
        self.assertEqual(actual.execution_warnings(), expected.execution_warnings())
        self.assertEqual(actual.terminal_step_ref_ids(), expected.terminal_step_ref_ids())
        for name in actual.step_outputs():
            self.assertEqual(actual.step_provenance(name), expected.step_provenance(name))
            self.assertEqual(actual.step_execution_warnings(name), expected.step_execution_warnings(name))

    def test_prefix_reuse_and_hits_do_not_restore_or_prepare_materials(self):
        prefix = replace(self.plan, steps=self.plan.steps[:2], terminal_step_ref_ids=["b"])
        self.kernel.execute(prefix)
        result = self.kernel.execute(self.plan)
        self.assertEqual(self.calls, ["a", "b", "c"])
        self.calls.clear()
        with patch.object(GeometryArtifact, "fork_state", side_effect=AssertionError("hydration on hit")), patch(
            "process_flow_kernel.application.geometry_kernel.prepare_step_material_instances",
            side_effect=AssertionError("material preparation on hit")), patch.object(
            ProcessGeometryState, "snapshot", side_effect=AssertionError("snapshot on hit")):
            repeated = self.kernel.execute(self.plan)
            upstream = self.kernel.execute(prefix)
        self.assertEqual(self.calls, [])
        self.assertEqual(repeated.execution_statistics()["reusedSteps"], 3)
        self.assertEqual(upstream.execution_statistics()["executedSteps"], 0)
        self.assert_equal_outputs(repeated, result)
        self.assert_equal_outputs(result, GeometryKernel().execute(self.plan))

    def test_only_changed_step_and_descendants_invalidate(self):
        self.kernel.execute(self.plan)
        changes = [
            {"parameter_values": {"thk": 2}}, {"raw_parameter_values": {"thk": 1.0}},
            {"step_label": "renamed"}, {"step_template": {"id": "b", "program": "cache_test", "extra": True}},
            {"output_port_id": "another"},
            {"geometry_inputs": {"main_geometry": source("a", port="another")}},
            {"geometry_inputs": {"alternative": source("a")}},
        ]
        for change in changes:
            with self.subTest(change=change):
                self.calls.clear()
                changed = replace(self.plan, steps=[self.plan.steps[0], replace(self.plan.steps[1], **change), self.plan.steps[2]])
                actual = self.kernel.execute(changed)
                self.assertEqual(self.calls, ["b", "c"])
                self.assert_equal_outputs(actual, GeometryKernel().execute(changed))

    def test_unrelated_branch_and_ordered_input_identity(self):
        branch = step("side", "a")
        original = replace(self.plan, steps=[*self.plan.steps, branch], terminal_step_ref_ids=["c", "side"])
        self.kernel.execute(original)
        self.calls.clear()
        changed = replace(original, steps=[*self.plan.steps, replace(branch, parameter_values={"thk": 5})])
        self.kernel.execute(changed)
        self.assertEqual(self.calls, ["side"])
        merge = step("merge", geometry_inputs={"main_geometry": source("c"), "side": source("side")})
        merged = replace(original, steps=[*original.steps, merge], terminal_step_ref_ids=["merge"])
        first = self.kernel.execute(merged)
        self.calls.clear()
        reordered = replace(merged, steps=[*original.steps, replace(merge, geometry_inputs=dict(reversed(list(merge.geometry_inputs.items()))))])
        self.kernel.execute(reordered)
        self.assertEqual(self.calls, ["merge"])
        self.assert_equal_outputs(first, GeometryKernel().execute(merged))
        self.assertEqual([w["message"] for w in first.step_execution_warnings("merge")], ["a", "b", "c", "side", "merge"])

    def test_return_modes_and_mutation_cannot_change_cached_results(self):
        for mode in ("state", "none", "independent", "artifact", "structure"):
            with self.subTest(mode=mode):
                self.cache.clear()
                def execute(context):
                    result = self.execute(context)
                    return {"state": lambda: result, "none": lambda: None,
                            "independent": result.clone, "artifact": lambda: GeometryArtifact.from_state(result),
                            "structure": result.to_geometry_structure}[mode]()
                self.module.execute = execute
                cold = self.kernel.execute(self.plan)
                expected = cold.step_outputs()
                cold.geometry()["root"]["bodies"][0]["material"] = "changed"
                cold.step_outputs()["a"]["root"]["bodies"].clear()
                cold.step_provenance("a").clear()
                cold.execution_warnings()[0]["details"]["items"].append(2)
                self.assertEqual(self.kernel.execute(self.plan).step_outputs(), expected)
                self.assert_equal_outputs(self.kernel.execute(self.plan), GeometryKernel().execute(self.plan))

    def test_external_semantics_and_module_version_invalidate(self):
        base = self.plan.external_geometries["main"]
        self.kernel.execute(self.plan)
        changes = [replace(base, generation={"version": 2}), replace(base, source_geometry_id="other"),
                   replace(base, adaptation_contract={"adapterId": "test", "adapterVersion": 1}),
                   replace(base, runtime_snapshot=replace(base.runtime_snapshot, cursor_z=123)),
                   replace(base, runtime_snapshot=replace(base.runtime_snapshot, footprint={"kind": "custom"})),
                   base.with_provenance({base.structure["root"]["id"]: {"sources": [], "createdBy": None}})]
        moved = base.fork_state()
        moved.move(x=1)
        changes.append(GeometryArtifact.from_state(moved))
        for changed in changes:
            with self.subTest(fingerprint=artifact_fingerprint(changed)):
                self.calls.clear()
                self.kernel.execute(replace(self.plan, external_geometries={"main": changed}))
                self.assertEqual(self.calls, ["a", "b", "c"])
        self.calls.clear()
        self.module.EXECUTION_CACHE_VERSION = 2
        self.kernel.execute(self.plan)
        self.assertEqual(self.calls, ["a", "b", "c"])

    def test_non_opted_in_step_disables_descendant_reuse(self):
        unversioned = ModuleType("process_flow_steps.unversioned_test")
        unversioned.execute = self.execute
        changed = replace(self.plan, steps=[self.plan.steps[0], replace(self.plan.steps[1],
                          step_template={"id": "b", "program": "unversioned_test"}), self.plan.steps[2]])
        with patch.dict(sys.modules, {unversioned.__name__: unversioned}):
            self.kernel.execute(changed)
            self.calls.clear()
            self.kernel.execute(changed)
        self.assertEqual(self.calls, ["b", "c"])
        self.assertEqual(self.cache.info()["entries"], 1)

    def test_custom_resolvers_bypass_cache(self):
        for resolver in (SimpleNamespace(resolve=lambda _: self.module),
                         ProcessStepModuleResolver(import_module=lambda _: self.module)):
            self.calls.clear()
            kernel = GeometryKernel(step_cache=self.cache, module_resolver=resolver)
            kernel.execute(self.plan)
            kernel.execute(self.plan)
            self.assertEqual(self.calls, ["a", "b", "c"] * 2)
        self.assertEqual(self.cache.info()["entries"], 0)

    def test_failure_preserves_successful_ancestors_and_retries(self):
        def fail(context):
            if context.step_ref["stepRefId"] == "b":
                raise ValueError("failed b")
            return self.execute(context)
        self.module.execute = fail
        with self.assertRaisesRegex(ValueError, "failed b"):
            self.kernel.execute(self.plan)
        self.assertEqual(self.cache.info()["entries"], 1)
        self.module.execute = self.execute
        self.calls.clear()
        self.kernel.execute(self.plan)
        self.assertEqual(self.calls, ["b", "c"])

    def test_warm_warning_lineage_follows_current_branch_order(self):
        branches = [step("a"), step("left", "a"), step("right", "a")]
        merge = step("merge", geometry_inputs={"main_geometry": source("left"), "other": source("right")})
        original = replace(self.plan, steps=[*branches, merge], terminal_step_ref_ids=["merge"])
        self.kernel.execute(original)
        reordered = replace(original, steps=[branches[0], branches[2], branches[1], merge])
        self.calls.clear()
        result = self.kernel.execute(reordered)
        self.assertEqual(self.calls, [])
        self.assertEqual([w["message"] for w in result.step_execution_warnings("merge")],
                         ["a", "right", "left", "merge"])
        self.assert_equal_outputs(result, GeometryKernel().execute(reordered))

    def test_missing_inputs_keep_original_exception_and_external_owner_is_keyed(self):
        missing = replace(self.plan, external_geometries={})
        errors = []
        for kernel in (GeometryKernel(), self.kernel):
            with self.assertRaises(ValueError) as error:
                kernel.execute(missing)
            errors.append(str(error.exception))
        self.assertEqual(errors[0], errors[1])
        self.kernel.execute(self.plan)
        self.calls.clear()
        renamed = replace(self.plan, external_geometries={"renamed": self.plan.external_geometries["main"]},
                          steps=[replace(self.plan.steps[0], geometry_inputs={"main_geometry":
                                 PlannedGeometryInput(kind="external", flow_input_id="renamed")}),
                                 *self.plan.steps[1:]])
        self.kernel.execute(renamed)
        self.assertEqual(self.calls, ["a", "b", "c"])

    def test_repeated_edits_release_evicted_artifacts(self):
        cache = MemoryStepExecutionCache(max_entries=4, max_bytes=1_000_000)
        kernel = GeometryKernel(step_cache=cache)
        references = []
        for thickness in range(1, 31):
            edited = replace(self.plan, steps=[self.plan.steps[0],
                             replace(self.plan.steps[1], parameter_values={"thk": thickness}), self.plan.steps[2]])
            result = kernel.execute(edited)
            references.extend(weakref.ref(result.step_artifact(name)) for name in ("b", "c"))
            self.assertLessEqual(cache.info()["entries"], 4)
            self.assertLessEqual(cache.info()["bytes"], 1_000_000)
        del result
        gc.collect()
        self.assertLessEqual(sum(reference() is not None for reference in references), 4)
        cache.clear()
        gc.collect()
        self.assertFalse(any(reference() is not None for reference in references))


class CacheLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.record = StepExecutionRecord(artifact(), ({"message": "test", "details": [1]},))

    def test_singleflight_and_unrelated_keys_execute_outside_lock(self):
        cache = MemoryStepExecutionCache(max_inflight=1)
        barrier, release = Barrier(8), Event()
        count, lock = [], Lock()
        def factory():
            with lock:
                count.append(1)
            if not release.wait(5):
                raise TimeoutError()
            return self.record
        def work():
            barrier.wait(5)
            return cache.get_or_compute("shared", factory, generation=0)
        with ThreadPoolExecutor(max_workers=9) as pool:
            requests = [pool.submit(work) for _ in range(8)]
            try:
                wait_for(lambda: cache.info()["waits"] == 7)
                other = pool.submit(cache.get_or_compute, "other", lambda: self.record, generation=0)
                self.assertFalse(other.result(timeout=2)[1])
                self.assertEqual(cache.info()["bypasses"], 1)
            finally:
                release.set()
            results = [f.result(timeout=5) for f in requests]
        self.assertEqual(len(count), 1)
        self.assertEqual(sum(reused for _, reused in results), 7)
        self.assertEqual(cache.info()["entries"], 1)

    def test_failure_shared_by_waiters_then_retry(self):
        cache, started, release = MemoryStepExecutionCache(), Event(), Event()
        def fail():
            started.set()
            release.wait(5)
            raise ValueError("original failure")
        with ThreadPoolExecutor(max_workers=2) as pool:
            owner = pool.submit(cache.get_or_compute, "key", fail, generation=0)
            self.assertTrue(started.wait(5))
            waiter = pool.submit(cache.get_or_compute, "key", lambda: self.record, generation=0)
            try:
                wait_for(lambda: cache.info()["waits"] == 1)
            finally:
                release.set()
            for future in (owner, waiter):
                with self.assertRaisesRegex(ValueError, "original failure"):
                    future.result(5)
        self.assertEqual(cache.info()["entries"], 0)
        self.assertFalse(cache.get_or_compute("key", lambda: self.record, generation=0)[1])

    def test_clear_prevents_old_producer_from_overwriting_new_generation(self):
        cache, started, release = MemoryStepExecutionCache(), Event(), Event()
        def old():
            started.set()
            release.wait(5)
            return self.record
        with ThreadPoolExecutor(max_workers=2) as pool:
            owner = pool.submit(cache.get_or_compute, "key", old, generation=0)
            self.assertTrue(started.wait(5))
            waiter = pool.submit(cache.get_or_compute, "key", old, generation=0)
            wait_for(lambda: cache.info()["waits"] == 1)
            cache.clear()
            replacement = replace(self.record, warnings=())
            cache.get_or_compute("key", lambda: replacement, generation=1)
            release.set()
            for future in (owner, waiter):
                with self.assertRaises(CacheInvalidatedError):
                    future.result(5)
        self.assertIs(cache.get_or_compute("key", lambda: self.record, generation=1)[0], replacement)
        self.assertEqual(cache.info()["inflight"], 0)

    def test_lru_byte_limit_oversized_entry_and_release(self):
        cache = MemoryStepExecutionCache(max_entries=2)
        for key in ("a", "b", "a", "c"):
            cache.get_or_compute(key, lambda: self.record, generation=0)
        self.assertTrue(cache.get_or_compute("a", lambda: self.record, generation=0)[1])
        self.assertFalse(cache.get_or_compute("b", lambda: self.record, generation=0)[1])
        weight = cache.info()["bytes"] // 2
        bounded = MemoryStepExecutionCache(max_bytes=weight + 1)
        for i in range(20):
            bounded.get_or_compute(str(i), lambda: self.record, generation=0)
            self.assertLessEqual(bounded.info()["bytes"], weight + 1)
            self.assertLessEqual(bounded.info()["entries"], 1)
        oversized = MemoryStepExecutionCache(max_bytes=1)
        oversized.get_or_compute("huge", lambda: self.record, generation=0)
        self.assertEqual(oversized.info()["entries"], 0)
        self.assertGreater(retained_size(self.record), retained_size(self.record.artifact.structure))
        # GeometryArtifact is both a dataclass and a Mapping; its Mapping view
        # omits runtime/provenance and must never determine its retained weight.
        inflated = replace(self.record.artifact, generation={"large": "x" * 100_000})
        self.assertGreater(retained_size(inflated), retained_size(self.record.artifact) + 99_000)
        without_runtime = replace(self.record.artifact, runtime_snapshot=None, provenance={})
        self.assertGreater(retained_size(self.record.artifact), retained_size(without_runtime))
        without_trace = replace(self.record.artifact, runtime_snapshot=None, provenance={"large": "x" * 100_000})
        self.assertGreater(retained_size(without_trace), retained_size(without_runtime) + 99_000)
        transient = StepExecutionRecord(artifact())
        reference = weakref.ref(transient.artifact)
        tiny = MemoryStepExecutionCache(max_entries=1)
        tiny.get_or_compute("old", lambda: transient, generation=0)
        del transient
        tiny.get_or_compute("new", lambda: self.record, generation=0)
        gc.collect()
        self.assertIsNone(reference())

    def test_deep_immutability_and_typed_fingerprints(self):
        value = self.record.artifact
        for mapping in (value.structure, value.structure["root"], value.runtime_snapshot.root,
                        value.runtime_snapshot.polygons, value.provenance):
            with self.assertRaises(TypeError):
                mapping["bad"] = True
        with self.assertRaises(TypeError):
            value.structure["root"]["bodies"][0]["geometry"]["bottom_left"][0] = 123
        detached = value.geometry()
        detached["root"]["bodies"].clear()
        self.assertTrue(value.geometry()["root"]["bodies"])
        self.assertIs(copy.deepcopy(value.structure), value.structure)
        self.assertEqual(len({content_fingerprint(x) for x in (None, False, 0, 0.0, "0")}), 5)
        self.assertEqual(content_fingerprint({"b": 2, "a": 1}), content_fingerprint({"a": 1, "b": 2}))
        self.assertNotEqual(content_fingerprint([1, 2]), content_fingerprint([2, 1]))
        self.assertNotEqual(content_fingerprint([1, 2]), content_fingerprint((1, 2)))

    def test_external_hydration_validates_and_runtime_snapshot_reuses_polygon(self):
        from process_flow_kernel.utils import polygon as geometry_module
        from process_flow_kernel.serialization.geometry_hydration import geometry_structure_to_process_geometry_state
        loops = [[[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]]
        raw = {"schemaVersion": "1.0.0", "unitSystem": "um", "root": {"bodies": [{"material": "Si", "geometry": {
            "type": "PolygonGeometry", "polys": loops, "thk": 1}}]}}
        state = geometry_structure_to_process_geometry_state(raw)
        snapshot = state.snapshot()
        with patch.object(geometry_module, "validate_polygon_loops", wraps=geometry_module.validate_polygon_loops) as validate:
            restored = snapshot.restore()
            self.assertEqual(validate.call_count, 0)
            geometry_structure_to_process_geometry_state(raw)
            self.assertGreaterEqual(validate.call_count, 1)
        self.assertEqual(restored.to_geometry_structure(), state.to_geometry_structure())
        with self.assertRaises(TypeError):
            PolygonSnapshot(loops)
        invalid = copy.deepcopy(raw)
        invalid["root"]["bodies"][0]["geometry"]["polys"] = [[[0, 0, 0], [1, 1, 0]]]
        with self.assertRaises(ValueError):
            geometry_structure_to_process_geometry_state(invalid)


if __name__ == "__main__":
    unittest.main()
