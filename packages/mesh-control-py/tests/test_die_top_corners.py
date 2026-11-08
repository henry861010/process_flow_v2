from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetRegistry, MeshControlSetResult, validate_mesh_control
from process_flow_mesh_control.controls import build_mesh_control
from process_flow_mesh_control._corner_merge import _junction_candidates
from process_flow_mesh_control.regions import resolve_region_control
from process_flow_mesh_control.rules import append_die_top_corner_controls
from process_flow_mesh_control.sets import mesh_model_2

from mesh_control_fixtures import bump, feature, hbm, layout, soc


class DieTopCornerTests(unittest.TestCase):
    def apply(self, geometry):
        """Exercise the generic helper's unchanged, opt-in merge behavior."""
        state = ProcessGeometryState.from_structure(geometry)
        before = copy.deepcopy(geometry), state.to_geometry_structure(), state.inspect()
        controls, details = [], []
        append_die_top_corner_controls(
            controls, details, state, state.find_geometry(kind="container"),
            half_extent=25, element_size=5,
        )
        result = MeshControlSetResult(mesh_control=build_mesh_control(controls), details=details)
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
                    "method": "3D_REGION", "elementSize": 5,
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
        state = ProcessGeometryState.from_structure(geometry)
        registry = MeshControlSetRegistry()
        _, mm2 = registry.apply("meshModel2", state)
        self.assertEqual(mesh_model_2.TOP_CORNER_SETTINGS,
                         {"half_extent": 25, "element_size": 5, "merge_gap": 4000,
                          "include_intersections": True})
        self.assertEqual(len([c for c in mm2.mesh_control["controls"] if c["method"] == "3D_REGION"]), 2)
        for set_id in ("meshModel1", "meshModel3"):
            _, other = registry.apply(set_id, state)
            self.assertEqual(mm2.mesh_control["controls"][:-2], other.mesh_control["controls"])
            self.assertEqual(mm2.details[:-2], other.details)
        before = {set_id: registry.apply(set_id, state)[1] for set_id in ("meshModel1", "meshModel3")}
        with patch.dict(mesh_model_2.TOP_CORNER_SETTINGS, half_extent=10, element_size=2, merge_gap=0):
            _, changed = registry.apply("meshModel2", state)
            self.assertEqual(changed.mesh_control["controls"][:-8], mm2.mesh_control["controls"][:-2])
            self.assertEqual(len(changed.mesh_control["controls"]), len(mm2.mesh_control["controls"]) + 6)
            self.assertTrue(all(c["elementSize"] == 2 for c in changed.mesh_control["controls"][-8:]))
            self.assertTrue(all(c["coordinateMode"] == "absolute" for c in changed.mesh_control["controls"][-8:]))
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


def die(item_id, key, x, y, *, top=320):
    """A 40 um die without UF keys, for isolated corner-rule checks."""
    return {"id": item_id, "key": key,
            "bodies": [feature(f"body:{item_id}", x, y, 0, top)]}


def loop_area(loop):
    return abs(sum(a["x"] * b["y"] - b["x"] * a["y"]
                   for a, b in zip(loop, [*loop[1:], loop[0]]))) / 2


class MergedDieTopCornerTests(unittest.TestCase):
    def apply(self, children):
        geometry = layout(children)
        state = ProcessGeometryState.from_structure(geometry)
        before = copy.deepcopy(geometry), state.to_geometry_structure(), state.inspect()
        # Keep the original corner merge geometry checks at their documented
        # 2000 um gap; junction crossings are covered separately below.
        with patch.dict(mesh_model_2.TOP_CORNER_SETTINGS, merge_gap=2000,
                        include_intersections=False):
            _, result = MeshControlSetRegistry().apply("meshModel2", state)
        validate_mesh_control(result.mesh_control, state=state)
        self.assertEqual((geometry, state.to_geometry_structure(), state.inspect()), before)
        controls = [c for c in result.mesh_control["controls"] if c["method"] == "3D_REGION"]
        details = [d for d in result.details if d.get("resolvedRegions")]
        self.assertEqual(len(controls), len(details))
        self.assertEqual(len({c["label"] for c in controls}), len(controls))
        self.assertEqual(result.mesh_control["controls"][-len(controls):], controls)
        self.assertEqual(result.details[-len(details):], details)
        for control, detail in zip(controls, details):
            self.assertEqual(control["coordinateMode"], "absolute")
            self.assertEqual(control["elementSize"], 5)
            self.assertNotIn("reference", control)
            self.assertEqual(detail["label"], control["label"])
            self.assertEqual(detail["status"], "applied")
            self.assertEqual(detail["method"], "3D_REGION")
            self.assertEqual(detail["elementSize"], 5)
            resolved = resolve_region_control(control, state)
            self.assertEqual(len(resolved), 1)
            self.assertEqual(detail["resolvedRegions"], [{"bounds": resolved[0]["bounds"]}])
            self.assertEqual(resolved[0]["geometry"]["thk"], 50)
            self.assertEqual(detail["startZ"], resolved[0]["bounds"]["zMin"])
            self.assertEqual(detail["endZ"], resolved[0]["bounds"]["zMax"])
            self.assertEqual(len(detail["sourceIds"]), len(set(detail["sourceIds"])))
        return controls, details

    def test_overlapping_corners_form_one_unclipped_box(self):
        controls, details = self.apply([die("soc:a", "soc", -10, -20)])
        self.assertEqual(len(controls), 1)
        self.assertEqual(controls[0]["region"], {
            "type": "box", "min": {"x": -35, "y": -45, "z": 295},
            "max": {"x": 55, "y": 45, "z": 345},
        })
        self.assertEqual(details[0]["sourceIds"], ["soc:a"])

    def test_exact_gap_merges_but_larger_gap_stays_separate(self):
        for offset, expected_count in ((2090, 1), (2091, 2)):
            with self.subTest(offset=offset):
                controls, details = self.apply([
                    die("left", "soc", 0, 0), die("right", "soc", offset, 0),
                ])
                self.assertEqual(len(controls), expected_count)
                if expected_count == 1:
                    self.assertEqual(controls[0]["region"], {
                        "type": "box", "min": {"x": -25, "y": -25, "z": 295},
                        "max": {"x": 2155, "y": 65, "z": 345},
                    })
                    self.assertEqual(details[0]["sourceIds"], ["left", "right"])
                else:
                    self.assertEqual([d["sourceIds"] for d in details], [["left"], ["right"]])

    def test_gap_chains_merge_transitively_in_dfs_source_order(self):
        controls, details = self.apply([
            die("middle", "soc", 2090, 0), die("right", "soc", 4180, 0),
            die("left", "soc", 0, 0),
        ])
        self.assertEqual(len(controls), 1)
        self.assertEqual(controls[0]["region"]["min"]["x"], -25)
        self.assertEqual(controls[0]["region"]["max"]["x"], 4245)
        self.assertEqual(details[0]["sourceIds"], ["middle", "right", "left"])

    def test_same_z_soc_and_hbm_merge_and_nested_sources_remain_unique(self):
        controls, details = self.apply([
            {"id": "outer", "key": "soc", "children": [die("inner", "hbm", 0, 0)]},
            die("last", "soc", 2090, 0),
        ])
        self.assertEqual(len(controls), 1)
        self.assertEqual(details[0]["sourceIds"], ["outer", "inner", "last"])

    def test_overlapping_but_different_z_intervals_remain_separate(self):
        controls, details = self.apply([
            die("soc", "soc", 0, 0), die("hbm", "hbm", 0, 0, top=321),
        ])
        self.assertEqual(len(controls), 2)
        self.assertEqual([(d["startZ"], d["endZ"]) for d in details], [(295, 345), (296, 346)])
        self.assertEqual([d["sourceIds"] for d in details], [["soc"], ["hbm"]])

    def test_nested_physical_bounds_ignore_empty_descendants_at_negative_z(self):
        controls, details = self.apply([{"id": "wrapper", "children": [{
            "id": "nested-hbm", "key": "hbm", "children": [
                {"id": "empty"},
                {"id": "die", "bodies": [feature("die-body", -100, -70, -300, 50)]},
                {"id": "bump-container", "bumps": [bump("bump", -120, -90, -240, 10)]},
            ],
        }]}])
        self.assertEqual(len(controls), 1)
        self.assertEqual(controls[0]["region"], {
            "type": "box", "min": {"x": -145, "y": -115, "z": -255},
            "max": {"x": -35, "y": -5, "z": -205},
        })
        self.assertEqual(details[0]["sourceIds"], ["nested-hbm"])

    def test_diagonal_only_neighbours_do_not_merge(self):
        controls, details = self.apply([
            die("first", "soc", 0, 0), die("diagonal", "soc", 1000, 1000),
        ])
        self.assertEqual(len(controls), 2)
        self.assertEqual([d["sourceIds"] for d in details], [["first"], ["diagonal"]])

    def test_l_shaped_merge_preserves_nonrectangular_outline(self):
        controls, details = self.apply([
            die("origin", "soc", 0, 0), die("right", "soc", 1000, 0),
            die("upper", "soc", 0, 1000),
        ])
        self.assertEqual(len(controls), 1)
        region = controls[0]["region"]
        self.assertEqual(region["type"], "polygon")
        self.assertEqual(len(region["loops"]), 1)
        self.assertEqual(loop_area(region["loops"][0]), 1090 * 90 * 2 - 90 * 90)
        self.assertEqual(details[0]["sourceIds"], ["origin", "right", "upper"])

    def test_new_horizontal_bridges_participate_in_recursive_vertical_merge(self):
        controls, details = self.apply([
            die("lower-left", "soc", 0, 0), die("lower-middle", "soc", 1000, 0),
            die("upper-left", "soc", 0, 1000), die("upper-right", "soc", 2000, 1000),
        ])
        self.assertEqual(len(controls), 1)
        region = controls[0]["region"]
        self.assertEqual(region["type"], "polygon")
        self.assertEqual(len(region["loops"]), 1)
        # Filling the upper horizontal gap creates an anchor for the formerly
        # empty vertical strip above lower-middle on a subsequent gap pass.
        self.assertEqual(loop_area(region["loops"][0]), 1090 ** 2 + 1000 * 90)
        self.assertEqual(details[0]["sourceIds"],
                         ["lower-left", "lower-middle", "upper-left", "upper-right"])

    def test_closed_ring_retains_hole_larger_than_merge_gap(self):
        positions = [(x, y) for y in (0, 4000) for x in range(0, 4001, 1000)]
        positions.extend((x, y) for y in (1000, 2000, 3000) for x in (0, 4000))
        children = [die(f"die:{i}", "soc", x, y) for i, (x, y) in enumerate(positions)]
        controls, details = self.apply(children)
        self.assertEqual(len(controls), 1)
        region = controls[0]["region"]
        self.assertEqual(region["type"], "polygon")
        self.assertEqual(len(region["loops"]), 2)
        self.assertEqual(sorted(loop_area(loop) for loop in region["loops"]), [3910 ** 2, 4090 ** 2])
        self.assertEqual(details[0]["sourceIds"], [child["id"] for child in children])

    def test_merge_helper_preserves_input_summaries_and_existing_output(self):
        state = ProcessGeometryState.from_structure(layout([
            die("left", "soc", 0, 0), die("right", "hbm", 2090, 0),
        ]))
        containers = state.find_geometry(kind="container")
        before = copy.deepcopy(containers), state.to_geometry_structure(), state.inspect()
        controls, details = [{"sentinel": "control"}], [{"sentinel": "detail"}]
        append_die_top_corner_controls(
            controls, details, state, containers, half_extent=25, element_size=5, merge_gap=2000,
        )
        self.assertEqual((containers, state.to_geometry_structure(), state.inspect()), before)
        self.assertEqual(controls[0], {"sentinel": "control"})
        self.assertEqual(details[0], {"sentinel": "detail"})
        self.assertEqual(len(controls), 2)
        self.assertEqual(len(details), 2)
        self.assertEqual(details[1]["sourceIds"], ["left", "right"])

    def test_invalid_merge_gap_rejected_without_partial_output(self):
        state = ProcessGeometryState.from_structure(layout([die("die", "soc", 0, 0)]))
        containers = state.find_geometry(kind="container")
        for gap in (-1, True, float("inf"), float("nan"), 10 ** 400):
            with self.subTest(gap=gap):
                controls, details = [], []
                with self.assertRaises(ValueError):
                    append_die_top_corner_controls(
                        controls, details, state, containers,
                        half_extent=25, element_size=5, merge_gap=gap,
                    )
                self.assertEqual((controls, details), ([], []))


class DieJunctionIntersectionTests(unittest.TestCase):
    def test_crossings_are_local_squares_on_the_facing_uf_channel(self):
        state = ProcessGeometryState.from_structure(layout([
            {"id": "wide", "key": "soc", "bodies": [feature("wide-body", 0, 0, 0, 320, width=1000)]},
            die("narrow", "soc", 500, 1400),
        ]))
        containers = [c for c in state.find_geometry(kind="container") if c["key"] == "soc"]
        candidates = _junction_candidates(containers, half_extent=25)
        self.assertEqual(len(candidates), 2)
        self.assertEqual([candidate["resolvedRegions"][0]["bounds"] for candidate in candidates], [
            {"xMin": -25, "xMax": 25, "yMin": 1375, "yMax": 1425, "zMin": 295, "zMax": 345},
            {"xMin": 975, "xMax": 1025, "yMin": 1375, "yMax": 1425, "zMin": 295, "zMax": 345},
        ])
        self.assertEqual([candidate["sourceIds"] for candidate in candidates],
                         [["wide", "narrow"], ["wide", "narrow"]])

        with patch.dict(mesh_model_2.TOP_CORNER_SETTINGS, merge_gap=500):
            _, result = MeshControlSetRegistry().apply("meshModel2", state)
        validate_mesh_control(result.mesh_control, state=state)
        controls = [control for control in result.mesh_control["controls"]
                    if control["method"] == "3D_REGION"]
        details = [detail for detail in result.details if detail.get("resolvedRegions")]
        self.assertEqual(len(controls), 3)
        joined = next(detail for detail in details if detail["sourceIds"] == ["wide", "narrow"])
        self.assertEqual(joined["resolvedRegions"][0]["bounds"], {
            "xMin": -25.0, "xMax": 1025.0, "yMin": 975.0,
            "yMax": 1465.0, "zMin": 295, "zMax": 345,
        })

    def test_diagonal_crossings_are_found_even_beyond_merge_gap(self):
        for distance in (1000, 10000):
            with self.subTest(distance=distance):
                state = ProcessGeometryState.from_structure(layout([
                    die("first", "soc", 0, 0),
                    die("diagonal", "soc", distance, distance),
                ]))
                containers = [c for c in state.find_geometry(kind="container") if c["key"] == "soc"]
                candidates = _junction_candidates(containers, half_extent=25)
                centers = [
                    ((bounds["xMin"] + bounds["xMax"]) / 2,
                     (bounds["yMin"] + bounds["yMax"]) / 2)
                    for candidate in candidates
                    for bounds in [candidate["resolvedRegions"][0]["bounds"]]
                ]
                self.assertEqual(centers, [(40, distance), (distance, 40)])
                self.assertTrue(all(candidate["sourceIds"] == ["first", "diagonal"]
                                    for candidate in candidates))
                if distance == 1000:
                    with patch.dict(mesh_model_2.TOP_CORNER_SETTINGS, merge_gap=500):
                        _, result = MeshControlSetRegistry().apply("meshModel2", state)
                    regions = [control["region"] for control in result.mesh_control["controls"]
                               if control["method"] == "3D_REGION"]
                    self.assertEqual(len(regions), 4)
                    self.assertEqual(sum(
                        region["type"] == "box"
                        and region["max"]["x"] - region["min"]["x"] == 50
                        and region["max"]["y"] - region["min"]["y"] == 50
                        for region in regions
                    ), 2)

    def test_different_die_tops_do_not_cross_or_merge(self):
        state = ProcessGeometryState.from_structure(layout([
            die("lower", "soc", 0, 0, top=320),
            die("upper", "soc", 20, 100, top=321),
        ]))
        containers = [c for c in state.find_geometry(kind="container") if c["key"] == "soc"]
        self.assertEqual(_junction_candidates(containers, half_extent=25), [])

    def test_intermediate_die_stops_a_guide_before_its_crossing(self):
        state = ProcessGeometryState.from_structure(layout([
            {"id": "wide", "key": "soc", "bodies": [feature("wide-body", 0, 0, 0, 320, width=1000)]},
            die("blocker", "soc", -10, 1200),
            die("narrow", "soc", 500, 1400),
        ]))
        containers = [c for c in state.find_geometry(kind="container") if c["key"] == "soc"]
        candidates = _junction_candidates(containers, half_extent=25)
        self.assertFalse(any(
            candidate["resolvedRegions"][0]["bounds"]["xMin"] == -25
            and candidate["resolvedRegions"][0]["bounds"]["yMin"] == 1375
            for candidate in candidates
        ))
