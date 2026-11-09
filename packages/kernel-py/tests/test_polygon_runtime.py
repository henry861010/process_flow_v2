"""Polygon ownership and boundary contracts replace the old global LRU tests."""
import copy
import gc
import unittest
import weakref
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from process_flow_kernel import GeometryArtifact, PolygonGeometry, ProcessGeometryState
from process_flow_kernel.utils import polygon
from process_flow_kernel.domain.geometry import PolygonSnapshot


def rectangle(x=0, y=0, z=0, size=10):
    return [[x, y, z], [x+size, y, z], [x+size, y+size, z], [x, y+size, z]]


def structure(loops):
    return {"schemaVersion": "1.0.0", "unitSystem": "um", "root": {"bodies": [{"material": "Si", "geometry": {
        "type": "PolygonGeometry", "polys": loops, "thk": 2}}]}}


class PolygonRuntimeTests(unittest.TestCase):
    def test_external_constructor_saves_canonical_independent_coordinates(self):
        for closing in ([0, 0, 0], [0.000001, 0, 0]):
            loops = [rectangle()+[closing]]
            with patch.object(polygon, "validate_polygon_loops", wraps=polygon.validate_polygon_loops) as validate:
                geometry = PolygonGeometry(loops, 2)
                self.assertEqual(validate.call_count, 1)
            self.assertEqual(geometry.polygons(), [rectangle()])
            loops[0][0][0] = 200
            detached = geometry.polygons()
            detached[0][0][0] = 300
            geometry.json()["polys"][0][0][0] = 400
            self.assertEqual(geometry.polygons(), [rectangle()])

    def test_copy_transform_and_classify_do_not_validate(self):
        original = PolygonGeometry([rectangle(), rectangle(2, 2, size=6)], 2)
        regions = polygon.classify_polygon_loops(original.polygon_snapshot())
        with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("runtime revalidation")):
            copied = original.copy()
            self.assertIs(copied.polygon_snapshot(), original.polygon_snapshot())
            copied.move(x=20, y=30, z=5)
            copied.flip(around_z=10)
            thick = copied.copy_with_thk(3)
            self.assertEqual(thick.thk(), 3)
            translated = polygon.classify_polygon_loops(copied.polygon_snapshot())
            self.assertEqual(len(translated[0].holes), 1)
            self.assertEqual(translated[0].outer[0], (20, 30, 13))
        self.assertEqual(regions[0].outer[0], (0, 0, 0))
        self.assertEqual(original.polygons(), [rectangle(), rectangle(2, 2, size=6)])

    def test_classification_is_per_snapshot_and_clip_invalidates_it(self):
        shape = PolygonGeometry([rectangle(), rectangle(2, 2, size=6)], 2)
        data = shape.polygon_snapshot()
        with patch.object(polygon, "_classify_indices", wraps=polygon._classify_indices) as classify:
            polygon.classify_polygon_loops(data)
            polygon.classify_polygon_loops(shape.copy().polygon_snapshot())
            self.assertEqual(classify.call_count, 1)
        with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("clip revalidation")):
            shape.clip_xy_to_box({"xMin": 0, "xMax": 5, "yMin": 0, "yMax": 10})
            regions = polygon.classify_polygon_loops(shape.polygon_snapshot())
        self.assertEqual(len(regions), 1)
        self.assertEqual(len(regions[0].holes), 0)
        polygon.validate_polygon_loops(shape.polygons())
        self.assertEqual(len(polygon.classify_polygon_loops(data)[0].holes), 1)

    def test_external_structure_is_validated_once_before_ids_are_assigned(self):
        raw = structure([rectangle()+[[0, 0, 0]]])
        for build in (ProcessGeometryState.from_structure, GeometryArtifact.from_structure):
            with patch.object(polygon, "validate_polygon_loops", wraps=polygon.validate_polygon_loops) as validate:
                result = build(raw)
                self.assertEqual(validate.call_count, 1)
            output = result.geometry() if isinstance(result, GeometryArtifact) else result.to_geometry_structure()
            expected = GeometryArtifact.from_structure(structure([rectangle()])).geometry()
            self.assertEqual(output, expected)
        self.assertEqual(len(raw["root"]["bodies"][0]["geometry"]["polys"][0]), 5)
        raw["root"]["bodies"][0]["id"] = "explicit-body"
        self.assertEqual(GeometryArtifact.from_structure(raw).geometry()["root"]["bodies"][0]["id"], "explicit-body")

    def test_artifact_fork_snapshot_summary_and_footprint_reuse(self):
        artifact = GeometryArtifact.from_structure(structure([rectangle()]))
        self.assertIsNone(artifact.runtime_snapshot)
        with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("runtime revalidation")):
            state = artifact.fork_state()
            state.deposit_layer(material="PI", thickness=2)
            state.find_geometry()
            cloned = state.clone()
            runtime = GeometryArtifact.from_state(cloned)
            runtime.fork_state().bounds()
        self.assertEqual(len(runtime.polygons), 2)
        self.assertEqual(len(artifact.geometry()["root"]["bodies"]), 1)

    def test_external_footprint_validates_once_then_builds_layers_without_validation(self):
        state = ProcessGeometryState.create()
        with patch.object(polygon, "validate_polygon_loops", wraps=polygon.validate_polygon_loops) as validate:
            state.set_polygon_footprint(polygons=[[point[:2] for point in rectangle()]])
            self.assertEqual(validate.call_count, 1)
        with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("footprint revalidation")):
            state.deposit_layer(material="Si", thickness=2)
            state.add_via_above_cursor(material="Cu", density=50, thickness=1)
            state.add_circuit_at_cursor(material="Cu", density=50, thickness=1)
            state.add_bump_above_cursor(material="Sn", density=50, thickness=1, stage="reflowed")
            cloned = state.clone()
            cloned.deposit_layer(material="PI", thickness=3)
        self.assertEqual(len(cloned.to_geometry_structure()["root"]["bodies"]), 2)
        public = state.process_footprint()
        public["polygons"][0][0][0] = 100
        self.assertEqual(state.process_footprint()["polygons"][0][0][0], 0)

    def test_external_replacements_cannot_inherit_topology_evidence(self):
        artifact = GeometryArtifact.from_structure(structure([rectangle()]))
        raw = artifact.geometry()
        raw["root"]["bodies"][0]["geometry"]["polys"] = [[[0,0,0],[10,10,0],[0,10,0],[10,0,0]]]
        raw["validated"] = True
        with self.assertRaisesRegex(ValueError, "self-intersects"):
            artifact.with_structure(raw)
        with self.assertRaises(TypeError):
            PolygonSnapshot([rectangle()])
        duplicated = structure([rectangle()])
        body = duplicated["root"]["bodies"][0]
        body["id"] = "duplicate"
        duplicated["root"]["bodies"].append(copy.deepcopy(body))
        with self.assertRaisesRegex(ValueError, "Duplicate geometry structure ID"):
            GeometryArtifact.from_structure(duplicated)

    def test_invalid_external_polygons_and_tangency_rules(self):
        cases = [([], "at least one"), ([[[0,0,0],[1,0,0]]], "at least 3"),
                 ([[[0,0,0],[2,2,0],[0,2,0],[2,0,0]]], "self-intersects"),
                 ([[[0,0,0],[1,0,0],[2,0,0]]], "zero area"),
                 ([rectangle(), rectangle(5,0)], "intersect or touch"),
                 ([rectangle(), rectangle(z=1)], "same xy plane"),
                 ([rectangle()+[[10,0,0]]], "duplicate points")]
        for loops, message in cases:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                PolygonGeometry(loops, 2)
        self.assertEqual(len(polygon.classify_polygon_loops([rectangle(),rectangle(10,10)])),2)
        with self.assertRaisesRegex(ValueError, "intersect or touch"):
            PolygonGeometry([rectangle(),rectangle(10,0)],2)

    def test_underfill_generated_tangent_hole_and_consumers_do_not_validate(self):
        state = ProcessGeometryState.create()
        state.initialize_box_layer(material="base", bottom_left=[0,0,0],top_right=[26,26,0],thickness=4)
        for x,y in [(0,0),(0,10),(10,10),(10,20),(20,0),(20,20)]:
            die = ProcessGeometryState.create()
            die.initialize_box_layer(material="Si",bottom_left=[0,0,0],top_right=[6,6,0],thickness=6)
            state.place_geometry_state(die,x=x,y=y,bottom_z=4,anchor="bottomLeft")
        with patch.object(polygon,"validate_polygon_loops",side_effect=AssertionError("UF revalidation")):
            state.apply_under_fill(material="UF",thk=6,gap=14,key="uf")
            artifact = GeometryArtifact.from_state(state)
            state.find_geometry()
            for data in artifact.polygons.values():
                polygon.classify_polygon_loops(data)
        self.assertTrue(artifact.polygons)
        for data in artifact.polygons.values():
            polygon.validate_polygon_loops(data.coordinates())

    def test_shared_classification_is_thread_safe_and_immutable(self):
        data = PolygonGeometry([rectangle(),rectangle(2,2,size=6)],2).polygon_snapshot()
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: polygon.classify_polygon_loops(data),range(64)))
        self.assertTrue(all(result == results[0] for result in results))
        with self.assertRaises(TypeError):
            results[0][0].outer[0][0] = -1
        raw = polygon.classify_polygon_loops(data.coordinates())
        raw[0].outer[0][0] = -1
        self.assertEqual(data.loops[0][0][0],0)

    def test_classification_does_not_outlive_its_geometry(self):
        data = PolygonGeometry([rectangle()],1).polygon_snapshot()
        polygon.classify_polygon_loops(data)
        reference = weakref.ref(data)
        del data
        gc.collect()
        self.assertIsNone(reference())

    def test_joint_overlap_uses_polygon_holes_without_revalidation(self):
        from process_flow_kernel.domain.bump_operations import footprints_overlap
        outer = PolygonGeometry([rectangle(), rectangle(2, 2, size=6)], 2)
        hole = PolygonGeometry([rectangle(3, 3, size=2)], 2)
        contact = PolygonGeometry([rectangle(0, 0, size=1)], 2)
        with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("joint revalidation")):
            self.assertFalse(footprints_overlap(outer, hole))
            self.assertTrue(footprints_overlap(outer, contact))

    def test_material_remap_preserves_polygon_and_external_cursor_semantics(self):
        from process_flow_kernel.application.material_instances import rewrite_geometry_materials
        from process_flow_kernel.domain.provenance import structure_nodes
        artifact = GeometryArtifact.from_structure(structure([rectangle()]))
        rewritten, _ = rewrite_geometry_materials(artifact.structure, {"Si": "Si_dup1"})
        remap = {before["id"]: after["id"] for before, after in
                 zip(structure_nodes(artifact.structure), structure_nodes(rewritten), strict=True)}
        with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("material revalidation")):
            result = artifact._with_material_structure(rewritten, node_id_remap=remap)
            result.fork_state()
        self.assertIsNone(result.runtime_snapshot)
        self.assertIs(next(iter(artifact.polygons.values())), next(iter(result.polygons.values())))

    def test_bounds_and_bump_height_do_not_copy_geometry(self):
        from process_flow_kernel.domain.features import Body, Bump
        state = GeometryArtifact.from_structure(structure([rectangle()])).fork_state()
        with patch.object(Body, "geometry", side_effect=AssertionError("bounds copy")), \
             patch.object(Bump, "geometry", side_effect=AssertionError("height copy")), \
             patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("bounds revalidation")):
            self.assertEqual(state.bounds()["xMax"], 10)
            state.find_geometry()

    def test_clipping_outputs_remain_valid_for_holes_islands_and_empty_intersections(self):
        loops = [rectangle(), rectangle(2, 2, size=6), rectangle(20, 0)]
        for limits in ((-1, 31, -1, 11), (1, 29, 1, 9), (0, 30, 4, 4.0001), (10, 20, 0, 10)):
            shape = PolygonGeometry(loops, 2)
            bounds = dict(zip(("xMin", "xMax", "yMin", "yMax"), limits))
            with patch.object(polygon, "validate_polygon_loops", side_effect=AssertionError("clip revalidation")):
                result = shape.clip_xy_to_box(bounds)
            if result is not None:
                polygon.validate_polygon_loops(result.polygons())
            else:
                self.assertEqual(limits, (10, 20, 0, 10))


if __name__ == '__main__':
    unittest.main()
