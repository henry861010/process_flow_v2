from __future__ import annotations

import copy
import unittest

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetRegistry, MeshControlSetResult
from process_flow_mesh_control.controls import (
    append_absolute_section,
    append_full_feature_control,
    append_relative_z_point,
    build_mesh_control,
)
from process_flow_mesh_control.geometry import select_upper_right
from process_flow_mesh_control.rules import (
    append_adhesive_controls,
    append_bottom_carrier_points,
    append_hbm_uf_controls,
    append_soc_uf_controls,
    append_tim_controls,
)

from mesh_control_fixtures import feature, hbm, layout, soc


class CustomSet:
    def definition(self):
        return {"id": "custom", "version": "1", "label": "Custom", "description": "Custom Si controls."}

    def build(self, state):
        controls, details = [], []
        selected = select_upper_right(state.find_geometry(kind="body", key="soc.si"))
        if selected is not None:
            append_soc_uf_controls(
                controls, details, selected, set_id="custom", surface_thickness=20,
                transition_thickness=30, surface_element_size=2,
                transition_element_size=10, middle_element_size=40,
            )
            append_relative_z_point(controls, details, selected, label="Top -3", anchor="z_max", offset=-3)
        return MeshControlSetResult(build_mesh_control(controls, global_element_size=250), details)


class SharedHelperTests(unittest.TestCase):
    def test_custom_set_can_register_and_compose_public_rules_with_overrides(self):
        state = ProcessGeometryState.from_structure(layout([soc("left", -150, -150), soc("right", 50, 50)]))
        before = state.to_geometry_structure(), state.inspect()
        definition, result = MeshControlSetRegistry((CustomSet(),)).apply("custom", state)
        self.assertEqual(definition["id"], "custom")
        self.assertEqual(result.mesh_control["globalElementSize"], 250)
        self.assertEqual([item.get("elementSize") for item in result.mesh_control["controls"]], [2, 10, 40, 10, 2, None])
        self.assertEqual([(item["startZ"], item["endZ"]) for item in result.details],
                         [(300, 320), (270, 300), (70, 270), (40, 70), (20, 40), (317, 317)])
        self.assertTrue(all(detail["sourceIds"] == ["si:right"] for detail in result.details))
        self.assertEqual((state.to_geometry_structure(), state.inspect()), before)

    def test_absolute_sections_report_zero_length_without_aliasing_inputs(self):
        controls, details = [], []
        sources = ["body:test"]
        for start, end in ((10, 20), (20, 20)):
            append_absolute_section(controls, details, method="Z_SECTION_AVG", element_size=5,
                                    start_z=start, end_z=end, source_ids=sources, label="Test")
        self.assertEqual(len(controls), 1)
        self.assertEqual([item["status"] for item in details], ["applied", "omitted"])
        self.assertEqual([(item["method"], item["elementSize"]) for item in details],
                         [("Z_SECTION_AVG", 5), ("Z_SECTION_AVG", 5)])
        sources.append("later")
        self.assertNotIn("reference", controls[0])
        self.assertEqual(details[0]["sourceIds"], ["body:test"])
        document = build_mesh_control(controls)
        document["controls"][0]["startZ"] = -100
        self.assertEqual(controls[0]["startZ"], 10)

    def test_full_feature_and_relative_point_preserve_feature_and_reject_unknown_anchor(self):
        controls, details = [], []
        summary = {"kind": "body", "id": "test", "zMin": -10, "zMax": 20}
        before = copy.deepcopy(summary)
        append_full_feature_control(controls, details, summary, label="Body", element_size=4)
        append_relative_z_point(controls, details, summary, label="Point", anchor="z_max", offset=-2)
        self.assertEqual(details[1]["startZ"], 18)
        self.assertEqual([(item["method"], item["elementSize"]) for item in details],
                         [("Z_SECTION_AVG", 4), ("Z_POINT", None)])
        self.assertEqual(controls[0]["endZ"], {"anchor": "z_max", "offset": 0})
        with self.assertRaisesRegex(ValueError, "Unknown Z anchor"):
            append_relative_z_point(controls, details, summary, label="Invalid", anchor="middle", offset=0)
        self.assertEqual(len(controls), 2)
        self.assertEqual(summary, before)

    def test_material_rules_and_carrier_accept_custom_sizes_and_offset(self):
        bodies = [feature("tim", 0, 0, 0, 10, key="tim"),
                  feature("adh", 0, 0, 10, 10, key="adh"),
                  feature("carrier", 0, 0, -100, 100, key="carrier")]
        state = ProcessGeometryState.from_structure(layout([]))
        geometry = state.to_geometry_structure()
        geometry["root"]["bodies"] = bodies
        nodes = ProcessGeometryState.from_structure(geometry).find_geometry()
        before = copy.deepcopy(nodes)
        controls, details = [], []
        metal = append_tim_controls(controls, details, nodes[1:], metal_materials={"Si"}, metal_element_size=12)
        append_adhesive_controls(controls, details, nodes[1:], has_metal_tim=metal, metal_tim_element_size=7)
        append_bottom_carrier_points(controls, details, nodes, offset=15)
        self.assertTrue(metal)
        self.assertEqual([item.get("elementSize") for item in controls], [12, 7, None])
        self.assertEqual(controls[-1]["label"], "Carrier bottom +15")
        self.assertEqual(details[-1]["startZ"], -85)
        self.assertEqual(nodes, before)

    def test_hbm_rule_accepts_all_element_size_overrides(self):
        nodes = ProcessGeometryState.from_structure(layout([hbm("selected", 50, 50)])).find_geometry()
        index = {node["id"]: node for node in nodes if node["kind"] == "container"}
        before = copy.deepcopy(nodes)
        controls, details = [], []
        append_hbm_uf_controls(
            controls, details, nodes, index, index["hbm:selected"],
            base_element_size=2, base_to_core_element_size=3, core_element_size=4,
            core_to_core_element_size=6, top_element_size=8,
        )
        self.assertEqual([item["elementSize"] for item in controls], [2, 3, 4, 6, 4, 6, 8])
        self.assertEqual(nodes, before)
