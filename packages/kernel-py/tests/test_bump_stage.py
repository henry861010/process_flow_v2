from __future__ import annotations

import copy
import unittest

from process_flow_kernel import (
    BUMP_STAGES,
    BoxGeometry,
    Bump,
    ProcessGeometryState,
    ProcessStepContext,
    normalize_geometry_structure,
)
from process_flow_steps.bump.bga_bump_formation import execute as execute_bga
from process_flow_steps.bump.c4_bump_formation import execute as execute_c4
from process_flow_steps.bump.uBump_formation import execute as execute_micro


def bump_payload(stage):
    return Bump(BoxGeometry([0, 0, 0], [10, 10, 0], 2), 80, "SnAg", "+z", stage=stage).json()


def bump_geometry_spec():
    return {"type": "box", "bottomLeft": [0, 0, 0], "topRight": [10, 10, 0], "thickness": 2}


def layer_state():
    state = ProcessGeometryState.create()
    state.initialize_box_layer(
        material="Si", bottom_left=[0, 0, 0], top_right=[10, 10, 0], thickness=5,
    )
    return state


class BumpStageTests(unittest.TestCase):
    def test_all_stages_round_trip_at_root_and_nested_scopes(self):
        for stage in BUMP_STAGES:
            with self.subTest(stage=stage):
                payload = {
                    "bumps": [{**bump_payload(stage), "id": "bump:root"}],
                    "children": [{"children": [{"bumps": [bump_payload(stage)]}]}],
                }
                original = copy.deepcopy(payload)
                normalized = normalize_geometry_structure(payload)
                state = ProcessGeometryState.from_structure(normalized)
                self.assertEqual(state.to_geometry_structure(), normalized)
                self.assertEqual(state.clone().to_geometry_structure(), normalized)
                self.assertEqual(normalized["root"]["bumps"][0]["id"], "bump:root")
                self.assertEqual(payload, original)

    def test_normalization_and_hydration_reject_missing_or_invalid_stages_with_paths(self):
        for nested in (False, True):
            for has_id in (False, True):
                for value in (None, "", "placed", "Reflowed", " reflowed", False, 0, [], {}):
                    with self.subTest(nested=nested, has_id=has_id, value=value):
                        feature = {**bump_payload("reflowed"), "stage": value}
                        if has_id:
                            feature["id"] = "bump:known"
                        self.assert_invalid_structure(feature, nested)
                feature = bump_payload("reflowed")
                feature.pop("stage")
                if has_id:
                    feature["id"] = "bump:known"
                with self.subTest(nested=nested, has_id=has_id, missing=True):
                    self.assert_invalid_structure(feature, nested)

    def assert_invalid_structure(self, feature, nested):
        root = {"bumps": [feature]}
        path = r"structure\.root\.bumps\[0\]\.stage"
        if nested:
            root = {"children": [{"children": [root]}]}
            path = r"structure\.root\.children\[0\]\.children\[0\]\.bumps\[0\]\.stage"
        for reader in (normalize_geometry_structure, ProcessGeometryState.from_structure):
            with self.assertRaisesRegex(ValueError, path):
                reader(root)

    def test_constructor_and_creation_apis_require_stage(self):
        args = (BoxGeometry([0, 0, 0], [10, 10, 0], 2), 80, "SnAg", "+z")
        with self.assertRaisesRegex(TypeError, "stage"):
            Bump(*args)
        with self.assertRaises(TypeError):
            Bump(*args, 0, None, "reflowed")
        state = layer_state()
        with self.assertRaisesRegex(TypeError, "stage"):
            state.add_bump(material="SnAg", density=80, direction="+z", geometry=bump_geometry_spec())
        with self.assertRaisesRegex(TypeError, "stage"):
            state.add_bump_above_cursor(material="SnAg", density=80, thickness=2)

    def test_creation_apis_validate_and_serialize_stages(self):
        for stage in BUMP_STAGES:
            with self.subTest(stage=stage):
                state = layer_state()
                state.add_bump(
                    material="SnAg", density=80, direction="+z",
                    geometry=bump_geometry_spec(), stage=stage,
                )
                state.add_bump_above_cursor(material="SnAg", density=80, thickness=2, stage=stage)
                self.assertEqual(
                    [feature["stage"] for feature in state.to_geometry_structure()["root"]["bumps"]],
                    [stage, stage],
                )
        for stage in (None, "", "placed", [], {}):
            with self.subTest(stage=stage):
                state = layer_state()
                with self.assertRaisesRegex(ValueError, r"bump\.stage"):
                    bump_payload(stage)
                with self.assertRaisesRegex(ValueError, r"bump\.stage"):
                    state.add_bump(
                        material="SnAg", density=80, direction="+z",
                        geometry=bump_geometry_spec(), stage=stage,
                    )
                with self.assertRaisesRegex(ValueError, r"bump\.stage"):
                    state.add_bump_above_cursor(material="SnAg", density=80, thickness=2, stage=stage)
                self.assertEqual(state.to_geometry_structure()["root"]["bumps"], [])

    def test_geometry_operations_preserve_stage(self):
        for stage in BUMP_STAGES:
            with self.subTest(stage=stage):
                bump = Bump(
                    BoxGeometry([0, 0, 0], [10, 10, 0], 2), 80, "SnAg", "+z",
                    structure_id="bump:known", stage=stage,
                )
                for copied in (bump.copy(), bump.copy_with_thk(3)):
                    self.assertEqual(copied.stage(), stage)
                    self.assertEqual(copied.json()["stage"], stage)
                    self.assertEqual(copied.json()["id"], "bump:known")
                bump.move(x=1, y=1, z=1)
                bump.resize_xy_by(1, 1)
                self.assertTrue(bump.clip_top_to(2))
                self.assertTrue(bump.clip_xy_to_box({"xMin": 2, "xMax": 8, "yMin": 2, "yMax": 8}))
                bump.flip()
                self.assertEqual(bump.stage(), stage)
                self.assertEqual(bump.json()["stage"], stage)
                self.assertEqual(bump.direction(), "-z")
                self.assertEqual(bump.thk(), 1)

    def test_copy_with_stage_validates_and_does_not_mutate_source(self):
        bump = Bump(BoxGeometry([0,0,0], [10,10,0], 2), 80, "SnAg", "-z", structure_id="bump:known", stage="reflowed")
        original = bump.json()
        copied = bump.copy_with_stage("joined")
        self.assertEqual(copied.json(), {**original, "stage":"joined"})
        self.assertEqual(bump.json(), original)
        with self.assertRaisesRegex(ValueError, "bump.stage"):
            bump.copy_with_stage("invalid")
        self.assertEqual(bump.json(), original)

    def test_all_formation_steps_emit_reflowed_without_a_stage_parameter(self):
        for execute in (execute_micro, execute_c4, execute_bga):
            with self.subTest(module=execute.__module__):
                state = layer_state()
                structure = state.to_geometry_structure()
                values = {"material": "SnAg", "thk": 2, "density": 80, "koz": 1}
                context = ProcessStepContext(
                    state=state, values=values, raw_parameter_values=values,
                    step_ref={}, step_template={}, step_configuration={},
                    geometry_inputs={"main_geometry": structure}, input_geometry=structure,
                    geometry_resolver=lambda port_id: state if port_id == "main_geometry" else None,
                )
                result = execute(context)
                bump = result.to_geometry_structure()["root"]["bumps"][0]
                self.assertEqual(bump["stage"], "reflowed")
                self.assertEqual(bump["direction"], "+z")
                self.assertEqual(bump["geometry"]["bottom_left"][2], 5)
                self.assertEqual(result.cursor_z(), 5)


if __name__ == "__main__":
    unittest.main()
