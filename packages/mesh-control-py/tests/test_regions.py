from __future__ import annotations

import copy
import unittest

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import (
    MeshControlSetNotApplicable, MeshControlSetRegistry, append_region_control,
    resolve_region_control, validate_region_control,
)


def absolute(value):
    return value


def box_control(*, relative=True):
    return {"method": "3D_REGION", "coordinateMode": "reference" if relative else "absolute", "label": "Focus", "elementSize": 5,
            **({"reference": {"kind": "root"}} if relative else {}),
            "region": {"type": "box", **{
                bound: {a: {"anchor": f"{a}_{bound}", "offset": 0} if relative else absolute(v)
                        for a in "xyz"} for bound, v in (("min", 0), ("max", 10))}}}


def state_at(x=0, width=10):
    def body(item_id, offset):
        return {"id": item_id, "key": "soc.si", "material": "Si", "geometry": {
            "type": "BoxGeometry", "bottom_left": [offset, 20, 30],
            "top_right": [offset + width, 40, 30], "thk": 50}}
    return ProcessGeometryState.from_structure({"root": {"id": "root", "bodies": [body("a", x)],
        "children": [{"id": "child", "bodies": [body("b", x + 100)]}]}, "schemaVersion": "1.0.0", "unitSystem": "um"})


def polygon_control(loops=None):
    loops = loops or [[(0, 0), (10, 0), (10, 10), (0, 10)]]
    return {"method": "3D_REGION", "coordinateMode": "absolute", "label": "Polygon", "elementSize": 5, "region": {
        "type": "polygon", "loops": [[{"x": absolute(x), "y": absolute(y)} for x, y in loop] for loop in loops],
        "startZ": absolute(0), "endZ": absolute(5)}}


class RegionTests(unittest.TestCase):
    def test_relative_tracks_motion_resize_and_descendants_without_mutation(self):
        control = box_control()
        original = copy.deepcopy(control)
        for x, width in ((0, 10), (-25, 15)):
            state = state_at(x, width)
            before = state.to_geometry_structure()
            result = resolve_region_control(control, state)[0]
            self.assertEqual(result["bounds"], {"xMin": x, "xMax": x + 100 + width, "yMin": 20, "yMax": 40, "zMin": 30, "zMax": 80})
            self.assertEqual(result["geometry"]["thk"], 50)
            self.assertEqual(state.to_geometry_structure(), before)
        self.assertEqual(control, original)

    def test_empty_descendants_do_not_expand_z_bounds_to_zero(self):
        structure = state_at().to_geometry_structure()
        structure["root"]["children"].append({"id": "empty"})
        state = ProcessGeometryState.from_structure(structure)
        resolved = resolve_region_control(box_control(), state)[0]
        self.assertEqual(resolved["bounds"]["zMin"], 30)
        _, demo = MeshControlSetRegistry().apply("meshControl3dTest", state)
        self.assertEqual(demo.mesh_control["controls"][1]["region"]["startZ"], absolute(30))

    def test_any_invalid_match_rejects_the_whole_control(self):
        structure = state_at().to_geometry_structure()
        structure["root"]["children"][0]["bodies"][0]["geometry"]["top_right"][0] = 105
        control = box_control()
        control["reference"] = {"kind": "body", "key": "soc.si"}
        control["region"]["min"]["x"]["offset"] = 6
        with self.assertRaisesRegex(ValueError, "source b"):
            resolve_region_control(control, ProcessGeometryState.from_structure(structure))

    def test_each_key_match_and_id_key_intersection(self):
        control = box_control()
        control["reference"] = {"kind": "body", "key": "soc.si"}
        result = resolve_region_control(control, state_at())
        self.assertEqual([r["sourceId"] for r in result], ["a", "b"])
        self.assertEqual([r["bounds"]["xMin"] for r in result], [0, 100])
        control["reference"]["id"] = "b"
        self.assertEqual(len(resolve_region_control(control, state_at())), 1)
        control["reference"]["key"] = "wrong"
        with self.assertRaisesRegex(ValueError, "no matching geometry"):
            resolve_region_control(control, state_at())

    def test_unclipped_reference_region_and_rejected_mixed_coordinates(self):
        control = box_control()
        control["region"]["min"]["x"]["offset"] = -100
        control["region"]["max"]["z"]["offset"] = 10
        result = resolve_region_control(control, state_at())[0]
        self.assertEqual(result["bounds"]["xMin"], -100)
        self.assertEqual(result["bounds"]["zMax"], 90)
        control["region"]["min"]["x"] = -100
        with self.assertRaisesRegex(ValueError, "min.x"):
            resolve_region_control(control, state_at())

    def test_absolute_resolves_once_and_forbids_reference(self):
        control = box_control(relative=False)
        result = resolve_region_control(control)
        self.assertEqual(len(result), 1)
        self.assertNotIn("sourceId", result[0])
        control["reference"] = {"kind": "body", "id": "missing"}
        with self.assertRaisesRegex(ValueError, "not allowed"):
            resolve_region_control(control)

    def test_polygon_holes_and_nested_island(self):
        control = polygon_control([[(0, 0), (10, 0), (10, 10), (0, 10)],
            [(2, 2), (8, 2), (8, 8), (2, 8)], [(3, 3), (4, 3), (4, 4), (3, 4)]])
        result = resolve_region_control(control)[0]
        self.assertEqual(len(result["geometry"]["polys"]), 3)
        self.assertEqual(result["bounds"]["zMax"], 5)

    def test_relative_polygon_each_match(self):
        control = polygon_control()
        control["coordinateMode"] = "reference"
        control["reference"] = {"kind": "body", "key": "soc.si"}
        control["region"]["startZ"] = {"anchor": "z_min", "offset": 0}
        control["region"]["endZ"] = {"anchor": "z_max", "offset": 0}
        control["region"]["loops"] = [[
            {"x": {"anchor": f"x_{x}", "offset": 0},
             "y": {"anchor": f"y_{y}", "offset": 0}}
            for x, y in (("min", "min"), ("max", "min"), ("min", "max"))]]
        result = resolve_region_control(control, state_at())
        self.assertEqual(result[1]["geometry"]["polys"][0][0], [100, 20, 30])

    def test_rejects_degenerate_self_intersecting_crossing_touching_loops(self):
        for loops in (
            [[(0, 0), (1, 1), (2, 2)]],
            [[(0, 0), (10, 10), (10, 0), (0, 10)]],
            [[(0, 0), (10, 0), (10, 10), (0, 10)], [(5, -1), (6, 5), (5, 11)]],
            [[(0, 0), (10, 0), (10, 10), (0, 10)], [(0, 2), (2, 2), (2, 4), (0, 4)]],
        ):
            with self.subTest(loops=loops), self.assertRaisesRegex(ValueError, "region"):
                resolve_region_control(polygon_control(loops))

    def test_invalid_shapes_fields_numbers_and_axis_anchors(self):
        for change in (
            lambda c: c.update(elementSize=0), lambda c: c.update(elementSize=True),
            lambda c: c.update(label=" "), lambda c: c.update(extra=1),
            lambda c: c["region"].update(type="cone"),
            lambda c: c["region"]["min"]["x"].update(anchor="y_min"),
            lambda c: c["region"]["min"]["x"].update(offset=float("nan")),
            lambda c: c.pop("reference"),
        ):
            control = box_control()
            change(control)
            with self.subTest(control=control), self.assertRaises(ValueError):
                validate_region_control(control)

    def test_invalid_resolved_bounds_include_control_and_source(self):
        control = box_control()
        control["region"]["max"]["z"]["offset"] = -100
        with self.assertRaisesRegex(ValueError, r"Control 2.region.max.z.*source root"):
            resolve_region_control(control, state_at(), path="Control 2")
        control = polygon_control()
        control["region"]["endZ"] = absolute(0)
        with self.assertRaisesRegex(ValueError, "endZ"):
            resolve_region_control(control)

    def test_empty_reference_and_test_set(self):
        state = ProcessGeometryState.from_structure({})
        with self.assertRaisesRegex(ValueError, "empty"):
            resolve_region_control(box_control(), state)
        with self.assertRaisesRegex(MeshControlSetNotApplicable, "valid volume"):
            MeshControlSetRegistry().apply("meshControl3dTest", state)

    def test_demo_and_detached_builder(self):
        state = state_at()
        before = state.to_geometry_structure()
        definition, result = MeshControlSetRegistry().apply("meshControl3dTest", state)
        self.assertEqual(definition["version"], "1.0.0")
        self.assertEqual(result.mesh_control["globalElementSize"], 500)
        self.assertEqual([c["region"]["type"] for c in result.mesh_control["controls"]], ["box", "polygon"])
        self.assertEqual([c["elementSize"] for c in result.mesh_control["controls"]], [5, 5])
        self.assertEqual(result.details[0]["resolvedRegions"][0]["sourceId"], "root")
        controls, details = [], []
        region = box_control()["region"]
        append_region_control(controls, details, state, label="Test", element_size=5, coordinate_mode="reference", region=region, reference={"kind": "root"})
        region["type"] = "changed"
        self.assertEqual(controls[0]["region"]["type"], "box")
        self.assertEqual(state.to_geometry_structure(), before)
