from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from process_flow_kernel import (
    ExecutionPlan, GeometryArtifact, GeometryKernel, PlannedGeometryInput,
    PlannedStep, ProcessGeometryState, ProcessStepContext, qualify_provenance,
)
from process_flow_kernel.domain.provenance import structure_nodes
from process_flow_steps.layer.tim1 import execute as tim1
from process_flow_steps.layer.tim2 import execute as tim2
from process_flow_steps.saw.saw import execute as saw


def layer(key=None, *, width=10, height=10, z=0, material="Si"):
    state = ProcessGeometryState.create({"key": key})
    state.initialize_box_layer(material=material, bottom_left=[0, 0, z],
                               top_right=[width, width, z], thickness=height)
    return state


def context(state, values):
    return ProcessStepContext(state, values, values, {}, {}, {}, {}, None, lambda _: None)


def planned(name, program, source, values):
    return PlannedStep(step_ref_id=name, step_label=name,
        step_template={"id": name, "program": program, "parameterDefinitions": [
            {"id": "material", "valueType": "materialRef"},
            {"id": "thickness", "valueType": "float"}]},
        raw_parameter_values=values, parameter_values=values,
        geometry_inputs={"main_geometry": source}, output_port_id="result_geometry")


class TimTests(unittest.TestCase):
    def test_scope_retag_preserves_implicit_ids_and_provenance(self):
        state = layer("carrier")
        state.place_geometry_state(layer("soc"), x=1, y=1, bottom_z=10)
        before = state.to_geometry_structure()
        trace = qualify_provenance(before, kind="flowInput", owner_id="main")
        state.set_provenance(trace)
        cursor, footprint = state.cursor_z(), state.process_footprint()
        state.set_scope_key("cow")
        expected = copy.deepcopy(before)
        expected["root"]["key"] = "cow"
        self.assertEqual(state.to_geometry_structure(), expected)
        self.assertEqual(state.provenance(), trace)
        self.assertEqual((state.cursor_z(), state.process_footprint()), (cursor, footprint))
        state.set_scope_key("lid", state.find_scopes(key="soc")[0])
        self.assertEqual(state.scope_summary(state.find_scopes(key="lid")[0])["key"], "lid")
        with self.assertRaises(ValueError):
            state.set_scope_key("unregistered")

    def test_saw_tags_only_successful_step_and_keeps_descendant_ids(self):
        state = ProcessGeometryState.from_structure(layer("carrier", width=100).to_geometry_structure())
        state.place_geometry_state(layer("soc"), x=1, y=1, bottom_z=10)
        state = state.clone()
        before, cursor = state.to_geometry_structure(), state.cursor_z()
        with self.assertRaises(ValueError):
            saw(context(state, {"bottomLeftX": 20, "bottomLeftY": 0,
                                "topRightX": 0, "topRightY": 20}))
        self.assertEqual(state.to_geometry_structure(), before)
        saw(context(state, {"bottomLeftX": 0, "bottomLeftY": 0,
                            "topRightX": 20, "topRightY": 20}))
        output = state.to_geometry_structure()["root"]
        self.assertEqual(output["key"], "cow")
        self.assertEqual(output["id"], before["root"]["id"])
        self.assertEqual(output["children"], before["root"]["children"])
        self.assertEqual(state.cursor_z(), cursor)
        plain = layer("carrier")
        plain.saw_to_box(bottom_left_x=0, bottom_left_y=0, top_right_x=5, top_right_y=5)
        self.assertEqual(plain.to_geometry_structure()["root"]["key"], "carrier")

    def test_batch_uses_each_target_bounds_and_ignores_cursor_and_outside_geometry(self):
        state = layer(width=100, height=50)
        state.place_geometry_state(layer("cow", height=10), x=10, y=20, bottom_z=50)
        state.place_geometry_state(layer("cow", width=20, height=30), x=40, y=50, bottom_z=70)
        state.place_geometry_state(layer("vrm", height=500), x=80, y=80, bottom_z=50)
        state.set_cursor_z(-100)
        footprint = state.process_footprint()
        # The operation never serializes the structure to find its targets.
        with patch.object(state, "to_geometry_structure", side_effect=AssertionError("serialization")):
            tim1(context(state, {"material": "TIM-A", "thickness": 3}))
        children = state.to_geometry_structure()["root"]["children"]
        for child, lower, upper in zip(children[:2], ([10, 20, 60], [40, 50, 100]),
                                       ([20, 30, 60], [60, 70, 100])):
            body = child["bodies"][-1]
            self.assertEqual(body["key"], "tim")
            self.assertEqual(body["geometry"], {"type": "BoxGeometry", "bottom_left": lower,
                                               "top_right": upper, "thk": 3.0})
        self.assertEqual(len(children[2]["bodies"]), 1)
        self.assertEqual(state.cursor_z(), 103)
        self.assertEqual(state.process_footprint(), footprint)

    def test_root_and_nested_targets_use_pre_mutation_bounds_without_a_footprint(self):
        state = ProcessGeometryState.create({"key": "cow"})
        state.place_geometry_state(layer("cow"), x=0, y=0, bottom_z=10)
        self.assertIsNone(state.process_footprint())
        state.coat_targets(target_key="cow", material="TIM", thickness=2, key="tim")
        root = state.to_geometry_structure()["root"]
        self.assertEqual(root["bodies"][-1]["geometry"]["bottom_left"][2], 20)
        self.assertEqual(root["children"][0]["bodies"][-1]["geometry"]["bottom_left"][2], 20)
        self.assertEqual(state.cursor_z(), 22)

    def test_tim2_selects_lids_instead_of_cows(self):
        state = layer("cow")
        for x in (0, 30):
            state.place_geometry_state(layer("lid", width=20), x=x, y=0, bottom_z=20)
        tim2(context(state, {"material": "TIM-B", "thickness": 4}))
        root = state.to_geometry_structure()["root"]
        self.assertEqual(len(root["bodies"]), 1)
        self.assertEqual([child["bodies"][-1]["key"] for child in root["children"]], ["tim", "tim"])
        self.assertEqual(state.cursor_z(), 34)

    def test_nonrectangular_target_is_coated_with_its_complete_bounding_rectangle(self):
        state = ProcessGeometryState.create({"key": "lid"})
        state.initialize_cylinder_layer(material="Cu", center=[5, 10, 20], radius=5, thickness=10)
        tim2(context(state, {"material": "TIM", "thickness": 2}))
        root = state.to_geometry_structure()["root"]
        self.assertEqual(root["bodies"][-1]["geometry"], {
            "type": "BoxGeometry", "bottom_left": [0, 5, 30], "top_right": [10, 15, 30], "thk": 2})
        self.assertEqual(state.process_footprint()["type"], "cylinder")

    def test_invalid_batch_is_atomic_including_late_empty_target(self):
        cases = [
            ("cow", "", 2, "tim"), ("cow", None, 2, "tim"),
            ("cow", "TIM", 0, "tim"), ("cow", "TIM", -1, "tim"),
            ("cow", "TIM", float("nan"), "tim"), ("cow", "TIM", float("inf"), "tim"),
            ("lid", "TIM", 2, "tim"), ("cow", "TIM", 2, "unknown"),
            (None, "TIM", 2, "tim"), ("unknown", "TIM", 2, "tim"),
        ]
        for target_key, material, thickness, key in cases:
            state = layer("cow")
            before, cursor, footprint = state.to_geometry_structure(), state.cursor_z(), state.process_footprint()
            with self.subTest(values=(target_key, material, thickness, key)), self.assertRaises(ValueError):
                state.coat_targets(target_key=target_key, material=material, thickness=thickness, key=key)
            self.assertEqual(state.to_geometry_structure(), before)
            self.assertEqual((state.cursor_z(), state.process_footprint()), (cursor, footprint))
        state = layer()
        state.place_geometry_state(layer("cow"), x=0, y=0)
        state.place_geometry_state(ProcessGeometryState.create({"key": "cow"}), x=20, y=0)
        before, cursor = state.to_geometry_structure(), state.cursor_z()
        with self.assertRaisesRegex(ValueError, "non-empty"):
            state.coat_targets(target_key="cow", material="TIM", thickness=2, key="tim")
        self.assertEqual(state.to_geometry_structure(), before)
        self.assertEqual(state.cursor_z(), cursor)

    def test_coating_moves_and_round_trips_with_its_owner(self):
        source = layer("cow")
        tim1(context(source, {"material": "TIM", "thickness": 3}))
        original = source.to_geometry_structure()
        clone = source.clone()
        clone.move(z=20)
        clone.flip_around_z()
        clone.grind_to(z=11)
        assembly = layer()
        assembly.place_geometry_state(clone, x=20, y=30, bottom_z=100)
        restored = ProcessGeometryState.from_structure(assembly.to_geometry_structure())
        child = restored.to_geometry_structure()["root"]["children"][0]
        self.assertEqual(child["key"], "cow")
        self.assertEqual(child["bodies"][-1]["key"], "tim")
        self.assertEqual(child["bodies"][-1]["geometry"]["bottom_left"], [20.0, 30.0, 100.0])
        self.assertEqual(source.to_geometry_structure(), original)

    def test_execution_reuses_material_instance_rules_and_attributes_each_body(self):
        source = layer("cow", material="TIM-A")
        original = source.to_geometry_structure()
        result = GeometryKernel().execute(ExecutionPlan(steps=[
            planned("tim", "layer/tim1", PlannedGeometryInput(kind="external", flow_input_id="main"),
                    {"material": "TIM-A", "thickness": 3}),
        ], external_geometries={"main": GeometryArtifact.from_structure(original)}, terminal_step_ref_ids=["tim"]))
        body = result.geometry()["root"]["bodies"][-1]
        self.assertEqual(body["material"], "TIM-A_dup2")
        self.assertEqual(body["key"], "tim")
        self.assertEqual(result.step_provenance("tim")[body["id"]]["createdBy"]["program"], "layer/tim1")
        self.assertEqual({node["id"] for node in structure_nodes(result.geometry())}, set(result.step_provenance("tim")))
        self.assertEqual(source.to_geometry_structure(), original)


if __name__ == "__main__":
    unittest.main()
