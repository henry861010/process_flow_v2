from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetRegistry, validate_mesh_control
from process_flow_mesh_control.regions import resolve_region_control
from process_flow_mesh_control.rules import append_die_top_corner_controls
from process_flow_mesh_control.sets import mesh_model_2

from mesh_control_fixtures import bump, feature, hbm, layout, soc


class DieTopCornerTests(unittest.TestCase):
    def apply(self, geometry):
        state = ProcessGeometryState.from_structure(geometry)
        before = copy.deepcopy(geometry), state.to_geometry_structure(), state.inspect()
        _, result = MeshControlSetRegistry().apply("meshModel2", state)
        validate_mesh_control(result.mesh_control, state=state)
        self.assertEqual((geometry, state.to_geometry_structure(), state.inspect()), before)
        return state, result

    def assert_corners(self, state, result, expected):
        controls = [c for c in result.mesh_control["controls"] if c["method"] == "3D_REGION"]
        details = [d for d in result.details if d.get("resolvedRegions")]
        self.assertEqual(len(controls), 4 * len(expected))
        self.assertEqual(len(details), len(controls))
        self.assertEqual(result.mesh_control["controls"][-len(controls):], controls)
        self.assertEqual(result.details[-len(details):], details)
        self.assertEqual(len({c["label"] for c in controls}), len(controls))
        for index, (container_id, key, x_min, x_max, y_min, y_max, z_top) in enumerate(expected):
            corners = (("x_min", "y_min", x_min, y_min), ("x_min", "y_max", x_min, y_max),
                       ("x_max", "y_min", x_max, y_min), ("x_max", "y_max", x_max, y_max))
            for offset, (x_anchor, y_anchor, x, y) in enumerate(corners):
                control, detail = controls[index * 4 + offset], details[index * 4 + offset]
                self.assertEqual(control, {
                    "method": "3D_REGION", "coordinateMode": "reference", "elementSize": 5,
                    "label": f"{key} {container_id} top corner {x_anchor}/{y_anchor}",
                    "reference": {"kind": "container", "id": container_id},
                    "region": {"type": "box", **{
                        bound: {axis: {"anchor": anchor, "offset": distance}
                                for axis, anchor in (("x", x_anchor), ("y", y_anchor), ("z", "z_max"))}
                        for bound, distance in (("min", -25), ("max", 25))
                    }},
                })
                bounds = {"xMin": x - 25, "xMax": x + 25, "yMin": y - 25, "yMax": y + 25,
                          "zMin": z_top - 25, "zMax": z_top + 25}
                self.assertEqual(detail, {
                    "label": control["label"], "status": "applied", "startZ": z_top - 25,
                    "endZ": z_top + 25, "sourceIds": [container_id],
                    "resolvedRegions": [{"sourceId": container_id, "bounds": bounds}],
                })
                resolved = resolve_region_control(control, state)
                self.assertEqual(resolved[0]["bounds"], bounds)
                self.assertEqual(resolved[0]["geometry"]["thk"], 50)

    def test_single_soc_and_hbm_and_mixed_dfs_order(self):
        left, right = soc("left", -150, -100), hbm("right", 80, 50)
        expected = [("soc:left", "soc", -150, -110, -100, -60, 320),
                    ("hbm:right", "hbm", 80, 120, 50, 90, 220)]
        for children, selected in (([left], expected[:1]), ([right], expected[1:]),
                                   ([left, right], expected), ([right, left], list(reversed(expected)))):
            with self.subTest(ids=[c["id"] for c in children]):
                self.assert_corners(*self.apply(layout(children)), selected)

    def test_twenty_socs_add_eighty_controls(self):
        children = [soc(str(i), i * 100, -80) for i in range(20)]
        expected = [(f"soc:{i}", "soc", i * 100, i * 100 + 40, -80, -40, 320) for i in range(20)]
        self.assert_corners(*self.apply(layout(children)), expected)

    def test_nested_container_bounds_include_all_physical_features_and_ignore_empty_children(self):
        geometry = layout([{"id": "wrapper", "children": [{
            "id": "nested-hbm", "key": "hbm", "children": [
                {"id": "empty"},
                {"id": "die", "bodies": [feature("die-body", -100, -70, -300, 50)]},
                {"id": "bump-container", "bumps": [bump("bump", -120, -90, -240, 10)]},
            ],
        }]}])
        self.assert_corners(*self.apply(geometry), [("nested-hbm", "hbm", -120, -60, -90, -30, -230)])

    def test_nested_matching_containers_each_receive_four_controls(self):
        geometry = layout([{"id": "outer", "key": "soc", "children": [hbm("inner", 10, 20)]}])
        self.assert_corners(*self.apply(geometry), [
            ("outer", "soc", 10, 50, 20, 60, 220), ("hbm:inner", "hbm", 10, 50, 20, 60, 220),
        ])

    def test_empty_and_nonmatching_containers_are_skipped(self):
        geometry = layout([
            {"id": "empty-soc", "key": "soc"},
            {"id": "empty-hbm", "key": "hbm", "children": [{"id": "empty-child"}]},
            {"id": "other", "key": "soic", "bodies": [feature("other-body", 0, 0, 0, 300)]},
            {"id": "unkeyed", "bodies": [feature("unkeyed-body", 0, 0, 0, 300)]},
        ])
        _, result = self.apply(geometry)
        self.assertEqual(result.mesh_control["controls"], [])
        self.assertEqual(result.details, [])

    def test_overlapping_boxes_are_kept_and_can_extend_outside_die(self):
        geometry = layout([{"id": "small", "key": "hbm", "bodies": [feature("small-body", -10, -20, 0, 20, width=10)]}])
        self.assert_corners(*self.apply(geometry), [("small", "hbm", -10, 0, -20, -10, 20)])

    def test_mm2_appends_after_existing_controls_and_other_models_are_unchanged(self):
        geometry = layout([soc("soc", 0, 0), hbm("hbm", 100, 100), {"id": "support", "bodies": [
            feature("lsi", 0, 0, -100, 50, key="lsi.si"),
            feature("carrier", 0, 0, -150, 50, key="carrier"),
        ]}])
        state, mm2 = self.apply(geometry)
        registry = MeshControlSetRegistry()
        for set_id in ("meshModel1", "meshModel3"):
            _, other = registry.apply(set_id, state)
            self.assertEqual(mm2.mesh_control["controls"][:-8], other.mesh_control["controls"])
            self.assertEqual(mm2.details[:-8], other.details)
        before = {set_id: registry.apply(set_id, state)[1] for set_id in ("meshModel1", "meshModel3")}
        with patch.dict(mesh_model_2.TOP_CORNER_SETTINGS, half_extent=10, element_size=2):
            _, changed = registry.apply("meshModel2", state)
            self.assertEqual(changed.mesh_control["controls"][:-8], mm2.mesh_control["controls"][:-8])
            self.assertTrue(all(c["elementSize"] == 2 for c in changed.mesh_control["controls"][-8:]))
            self.assertEqual(changed.details[-1]["resolvedRegions"][0]["bounds"]["zMax"], 230)
            for set_id, result in before.items():
                self.assertEqual(registry.apply(set_id, state)[1], result)

    def test_helper_preserves_summaries_and_rejects_invalid_region_parameters(self):
        state = ProcessGeometryState.from_structure(layout([hbm("hbm", 0, 0)]))
        containers = state.find_geometry(kind="container")
        before = copy.deepcopy(containers)
        for settings in ({"half_extent": 0, "element_size": 5}, {"half_extent": 25, "element_size": 0}):
            controls, details = [], []
            with self.assertRaises(ValueError):
                append_die_top_corner_controls(controls, details, state, containers, **settings)
            self.assertEqual((controls, details), ([], []))
        append_die_top_corner_controls([], [], state, containers, half_extent=25, element_size=5)
        self.assertEqual(containers, before)
