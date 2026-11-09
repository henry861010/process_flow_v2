"""External ingress validates once; in-process consumers retain polygon ownership."""
import copy
import asyncio
from dataclasses import replace
import unittest
from unittest.mock import patch

from process_flow_api.geometry_validation import validate_catalog_structure
from process_flow_api.schematic_builder import build_schematic
from process_flow_cad import convert_cad_bodies, prepare_section_geometry
from process_flow_kernel import GeometryArtifact, ProcessGeometryState
from process_flow_kernel.utils import polygon
from test_cad_exporter import polygon_with_hole_structure
from test_schematic_planning import context, placement
from process_flow_api.services import materialize_preview_snapshots, prepare_preview_execution
from process_flow_api.services import PreviewSnapshotGeometry
from process_flow_api.preview_sessions import PreviewSessionManager
from process_flow_api.schematic_planning import plan_flow_schematic


class PolygonConsumerTests(unittest.TestCase):
    def test_preview_polygon_data_is_private_and_reused_by_lazy_cad_section(self):
        artifact = GeometryArtifact.from_structure(polygon_with_hole_structure())
        source = PreviewSnapshotGeometry("flowInput", None, "Polygon", 0,
                                         {"type": "flowInput", "flowInputId": "die"},
                                         artifact.geometry(), polygons=artifact.polygons)

        async def prepare():
            manager = PreviewSessionManager()
            try:
                record = manager._snapshot_record("session", "request", source)
                self.assertNotIn("polygons", record.payload())
                self.assertIs(record.polygons, artifact.polygons)
                detached = record.payload()
                detached["geometryEntityJson"]["structure"]["root"]["bodies"].clear()
                self.assertEqual(len(record.geometry_structure["root"]["bodies"]), 1)
                with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("section revalidation")):
                    first = await manager._prepared_section(record)
                    second = await manager._prepared_section(record)
                self.assertIs(first, second)
            finally:
                await manager.shutdown()

        asyncio.run(prepare())

    def test_flow_input_and_pnp_preview_validate_each_external_polygon_once(self):
        raw = polygon_with_hole_structure()
        raw["root"]["bodies"][0]["geometry"]["polys"].pop()
        source = {"id": "die", "structure": raw}
        for flow_input in (True, False):
            ctx = context(source=source, placements=[placement(), placement(20)])
            if flow_input:
                ctx = replace(ctx, target={"type": "flowInput", "flowInputId": "die"})
            with self.subTest(flow_input=flow_input), \
                 patch.object(polygon, "validate_polygon_loops", wraps=polygon.validate_polygon_loops) as validate:
                prepared = prepare_preview_execution(ctx, None)
                snapshots = asyncio.run(materialize_preview_snapshots(prepared))
                resolved = ({"die": prepared.flow_input_artifact} if flow_input else
                            prepared.execution_plan.external_geometries)
                plan_flow_schematic(ctx, None, resolved_inputs=resolved)
                for snapshot in snapshots:
                    build_schematic(snapshot.geometry_structure, polygon_lookup=snapshot.polygons.get)
                    self.assertTrue(snapshot.polygons)
                self.assertEqual(validate.call_count, 1)

    def test_catalog_boundary_canonicalizes_and_validates_once(self):
        raw = polygon_with_hole_structure()
        loops = raw["root"]["bodies"][0]["geometry"]["polys"]
        loops[0].append([0.000001, 0, 0])
        before = copy.deepcopy(raw)
        with patch.object(polygon, "validate_polygon_loops", wraps=polygon.validate_polygon_loops) as validate:
            normalized = validate_catalog_structure({"structureFormat": "standard", "structure": raw})
        self.assertEqual(validate.call_count, 1)
        self.assertEqual(len(normalized["root"]["bodies"][0]["geometry"]["polys"][0]), 4)
        self.assertEqual(raw, before)

    def test_cad_artifact_preserves_volume_bounds_and_hole_without_revalidation(self):
        raw = polygon_with_hole_structure()
        with patch.object(polygon, "validate_polygon_loops", wraps=polygon.validate_polygon_loops) as validate:
            external, = convert_cad_bodies(raw)
        self.assertEqual(validate.call_count, 1)
        artifact = GeometryArtifact.from_structure(raw)
        with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("CAD revalidation")):
            runtime, = convert_cad_bodies(artifact)
            prepared = prepare_section_geometry(artifact)
        self.assertIsNotNone(prepared)
        self.assertTrue(runtime.shape.isValid())
        self.assertAlmostEqual(runtime.shape.Volume(), 600)
        self.assertAlmostEqual(runtime.shape.Volume(), external.shape.Volume())
        for shape in (runtime.shape, external.shape):
            bounds = shape.BoundingBox()
            self.assertEqual((bounds.xmin, bounds.xmax, bounds.ymin, bounds.ymax, bounds.zmin, bounds.zmax),
                             (0, 20, 0, 20, 0, 2))
            self.assertFalse(shape.isInside((10, 10, 1)))
            self.assertTrue(shape.isInside((2, 2, 1)))

    def test_standalone_uf_schematic_never_parses_polygon_topology(self):
        state = ProcessGeometryState.create()
        state.initialize_box_layer(material="base", bottom_left=[0, 0, 0], top_right=[24, 10, 0], thickness=2)
        for x, role in ((0, "soc"), (14, "hbm")):
            die = ProcessGeometryState.create({"key": role})
            die.initialize_box_layer(material="Si", bottom_left=[0, 0, 0], top_right=[10, 10, 0], thickness=6)
            state.place_geometry_state(die, x=x, y=0, bottom_z=2, anchor="bottomLeft")
        state.apply_under_fill(material="UF", thk=6, gap=5, key="uf")
        artifact = GeometryArtifact.from_state(state)
        self.assertTrue(artifact.polygons)
        with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("schematic revalidation")):
            trusted = build_schematic(artifact.structure, polygon_lookup=artifact.polygons.get)
        with patch.object(polygon, "validate_polygon_loops", wraps=polygon.validate_polygon_loops) as validate:
            raw = build_schematic(artifact.geometry())
        self.assertEqual(validate.call_count, 0)
        self.assertEqual(trusted, raw)
        self.assertEqual(trusted["warnings"], [])


if __name__ == "__main__":
    unittest.main()
