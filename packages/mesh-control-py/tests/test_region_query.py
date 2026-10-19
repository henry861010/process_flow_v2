"""Region correctness and operation-level query budgets, without time limits."""
from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import (
    MeshControlSetRegistry, append_region_control, resolve_region_control, validate_mesh_control,
)
from process_flow_mesh_control.controls import build_mesh_control
from process_flow_mesh_control.rules import append_die_top_corner_controls

from mesh_control_fixtures import feature, layout, soc
from test_regions import box_control, polygon_control, state_at


class RegionQueryTests(unittest.TestCase):
    def test_mm2_large_layout_uses_two_build_queries_and_one_validation_query(self):
        children = [soc(str(i), i * 100, 0, include_bumps=False) for i in range(75)]
        children.extend({"id": f"other:{i}", "bodies": [feature(f"other-body:{i}", 0, 0, 0, 10)]}
                        for i in range(586))
        state = ProcessGeometryState.from_structure(layout(children))
        self.assertEqual(len(state.find_geometry(kind="container")), 662)
        with patch.object(state, "find_geometry", wraps=state.find_geometry) as query:
            _, result = MeshControlSetRegistry().apply("meshModel2", state)
            self.assertEqual(query.call_count, 2)
            validate_mesh_control(result.mesh_control, state=state)
            self.assertEqual(query.call_count, 3)
        self.assertEqual(sum(c["method"] == "3D_REGION" for c in result.mesh_control["controls"]), 300)
        self.assertEqual(sum(bool(d.get("resolvedRegions")) for d in result.details), 300)

    def test_corner_helper_reuses_one_query_and_skips_empty_targets_lazily(self):
        for children, expected_calls in (([soc(str(i), i * 100, 0) for i in range(20)], 1),
                                         ([{"id": "empty", "key": "soc"}], 0)):
            state = ProcessGeometryState.from_structure(layout(children))
            containers = state.find_geometry(kind="container")
            snapshot = copy.deepcopy(containers)
            controls, details = [], []
            with patch.object(state, "find_geometry", wraps=state.find_geometry) as query:
                append_die_top_corner_controls(controls, details, state, containers, half_extent=25, element_size=5)
                self.assertEqual(query.call_count, expected_calls)
            self.assertEqual(containers, snapshot)

    def test_validation_shares_query_but_checks_every_control_and_error_path(self):
        state = state_at()
        document = build_mesh_control([box_control() for _ in range(300)])
        snapshot = copy.deepcopy(document)
        with patch.object(state, "find_geometry", wraps=state.find_geometry) as query:
            validate_mesh_control(document, state=state)
            self.assertEqual(query.call_count, 1)
        self.assertEqual(document, snapshot)
        for mutate, message in (
            (lambda c: c["reference"].update(kind="body", id="missing"), "Control 300.reference: no matching geometry"),
            (lambda c: c["region"]["max"]["z"].update(offset=-100), "Control 300.region.max.z.*source root"),
            (lambda c: c.update(elementSize=0), "Control 300.elementSize"),
        ):
            invalid = copy.deepcopy(document)
            mutate(invalid["controls"][-1])
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                validate_mesh_control(invalid, state=state)

    def test_absolute_public_helpers_and_validation_never_query_geometry(self):
        state = state_at()
        box, polygon = box_control(relative=False), polygon_control()
        with patch.object(state, "find_geometry", side_effect=AssertionError("unexpected geometry lookup")):
            self.assertEqual(len(resolve_region_control(box, state)), 1)
            controls, details = [], []
            append_region_control(controls, details, state, label="Absolute", element_size=5,
                                  coordinate_mode="absolute", region=polygon["region"])
            validate_mesh_control(build_mesh_control([box, *controls]), state=state)
        self.assertEqual(details[0]["sourceIds"], [])

    def test_separate_operations_observe_mutation_on_the_same_state(self):
        state = state_at()
        control = box_control()
        before = resolve_region_control(control, state)[0]["bounds"]
        state.move(x=25, z=-100)
        after = resolve_region_control(control, state)[0]["bounds"]
        self.assertEqual(after, {**before, "xMin": before["xMin"] + 25,
                                "xMax": before["xMax"] + 25,
                                "zMin": before["zMin"] - 100, "zMax": before["zMax"] - 100})
        document = build_mesh_control([control])
        validate_mesh_control(document, state=state)
        state.move(z=50)
        with patch.object(state, "find_geometry", wraps=state.find_geometry) as query:
            validate_mesh_control(document, state=state)
            self.assertEqual(query.call_count, 1)

    def test_all_feature_kinds_shapes_and_nested_negative_bounds(self):
        shapes = (
            {"type": "BoxGeometry", "bottom_left": [-10, -20, -50], "top_right": [10, 20, -50], "thk": 10},
            {"type": "PolygonGeometry", "polys": [[[-10, -20, -50], [10, -20, -50], [10, 20, -50]]], "thk": 10},
            {"type": "CylinderGeometry", "center": [0, 0, -50], "bottom_radius": 20, "thk": 10},
            {"type": "ConeGeometry", "center": [0, 0, -50], "bottom_radius": 10, "top_radius": 20, "thk": 10},
        )
        kinds = (("bodies", "body", {}), ("vias", "via", {"density": 50, "direction": "+z", "koz": 0}),
                 ("circuits", "circuit", {"density": 50, "koz": 0}),
                 ("bumps", "bump", {"density": 50, "direction": "+z", "koz": 0, "stage": "reflowed"}))
        for geometry in shapes:
            for field, kind, attributes in kinds:
                with self.subTest(shape=geometry["type"], kind=kind):
                    state = ProcessGeometryState.from_structure({"id": "root", "children": [
                        {"id": "empty"}, {"id": "outer", "children": [
                            {"id": "nested", field: [{"id": "physical", "material": "Si",
                                                       "geometry": geometry, **attributes}]},
                            {"id": "nested-empty"},
                        ]},
                    ]})
                    snapshot = state.to_geometry_structure()
                    expected = {k: v for k, v in state.find_geometry(id="physical")[0].items()
                                if k in {"xMin", "xMax", "yMin", "yMax", "zMin", "zMax"}}
                    for reference in ({"kind": "root"}, {"kind": "container", "id": "outer"},
                                      {"kind": "container", "id": "nested"}, {"kind": kind, "id": "physical"}):
                        control = box_control()
                        control["reference"] = reference
                        self.assertEqual(resolve_region_control(control, state)[0]["bounds"], expected)
                    self.assertEqual(state.to_geometry_structure(), snapshot)

    def test_container_key_matches_preserve_dfs_and_intersect_kind_and_id(self):
        state = ProcessGeometryState.from_structure({"id": "root", "children": [
            {"id": "outer", "key": "soc", "children": [soc("nested", -100, 0)]}, soc("last", 100, 0),
        ]})
        control = box_control()
        control["reference"] = {"kind": "container", "key": "soc"}
        resolved = resolve_region_control(control, state)
        self.assertEqual([r["sourceId"] for r in resolved], ["outer", "soc:nested", "soc:last"])
        control["reference"]["id"] = "soc:nested"
        self.assertEqual(resolve_region_control(control, state), [resolved[1]])
        for reference in ({"kind": "container", "id": "si:nested"},
                          {"kind": "container", "id": "soc:nested", "key": "hbm"}):
            control["reference"] = reference
            with self.assertRaisesRegex(ValueError, "no matching geometry"):
                resolve_region_control(control, state)
