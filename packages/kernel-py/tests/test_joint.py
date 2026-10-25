from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from unittest import mock

from process_flow_kernel import (
    FlowCompiler, GeometryArtifact, GeometryKernel, InMemoryGeometryCatalog,
    ProcessGeometryState, ProcessStepContext, normalize_geometry_structure,
)
from process_flow_kernel.domain.bump_operations import footprints_overlap
from process_flow_kernel.domain.geometry import BoxGeometry, ConeGeometry, CylinderGeometry, PolygonGeometry
from process_flow_steps.joint.mr_joint import execute as execute_joint
from process_flow_steps.joint.tcb_joint import execute as execute_tcb_joint
from process_flow_steps.pnp.pnp import execute as execute_pnp


def main_state(stage="reflowed", thickness=20):
    state = ProcessGeometryState.create()
    state.initialize_box_layer(material="Si", bottom_left=[0, 0, 0], top_right=[100, 100, 0], thickness=100)
    if stage:
        state.add_bump_above_cursor(material="SnAg", density=40, thickness=thickness, stage=stage)
    return state


def die_state(stage="reflowed", thickness=15):
    state = ProcessGeometryState.create()
    z = thickness if stage else 0
    state.initialize_box_layer(material="Si", bottom_left=[0, 0, z], top_right=[10, 10, z], thickness=50)
    if stage:
        state.add_bump(material="SnAg_dup2", density=80, direction="-z", koz=1, stage=stage,
                       geometry={"type": "box", "bottomLeft": [0, 0, 0], "topRight": [10, 10, 0], "thickness": thickness})
    return state


def place(main, die, x=0, y=0):
    bottom = main.bump_placement_bottom_z(die, x=x, y=y, anchor="bottomLeft")
    return main.place_geometry_state(die, x=x, y=y, anchor="bottomLeft", bottom_z=bottom)


def placement(x=0, y=0):
    return {"targetRegion": {"type": "rectangle", "bottomLeftX": x, "bottomLeftY": y,
                             "topRightX": x + 10, "topRightY": y + 10},
            "pose": {"x": 0, "y": 0, "rotationZ": 0}, "anchor": "center"}


def context(state, values, main_artifact=None, source=None):
    structure = state.to_geometry_structure()
    artifacts = {"main_geometry": main_artifact, "die_geometry": source}
    return ProcessStepContext(state=state, values=values, raw_parameter_values=values,
        step_ref={}, step_template={}, step_configuration={}, geometry_inputs={"main_geometry": structure},
        input_geometry=structure, geometry_resolver=lambda port: state if port == "main_geometry" else None,
        geometry_artifact_resolver=artifacts.get)


class JointTests(unittest.TestCase):
    def test_numeric_case_preserves_lower_metadata_identity_and_source(self):
        main, die = main_state(), die_state()
        source = die.to_geometry_structure()
        footprint = main.process_footprint()
        before_query = main.to_geometry_structure()
        self.assertEqual(main.bump_placement_bottom_z(die, x=0, y=0, anchor="bottomLeft"), 120)
        self.assertEqual(main.to_geometry_structure(), before_query)
        place(main, die)
        before = main.to_geometry_structure()["root"]
        self.assertEqual(before["children"][0]["bodies"][0]["geometry"]["bottom_left"][2], 135)
        main.join_bumps(joined_height=25)
        after = main.to_geometry_structure()["root"]
        upper = after["children"][0]["bumps"][0]
        original = before["children"][0]["bumps"][0]
        self.assertEqual(upper["geometry"]["bottom_left"][2], 100)
        self.assertEqual(upper["geometry"]["thk"], 25)
        self.assertEqual(upper["stage"], "joined")
        self.assertEqual(after["children"][0]["bodies"][0]["geometry"]["bottom_left"][2], 125)
        for key in ("id", "material", "density", "direction", "koz"):
            self.assertEqual(upper[key], original[key])
        self.assertEqual(after["bumps"], before["bumps"])
        self.assertEqual(die.to_geometry_structure(), source)
        self.assertEqual(main.cursor_z(), 100)
        self.assertEqual(main.process_footprint(), footprint)
        self.assertEqual(main.clone().to_geometry_structure(), main.to_geometry_structure())

    def test_pnp_stage_matrix_and_single_sided_height(self):
        for upper_stage in (None, "deposited", "reflowed", "joined"):
            for lower_stage in (None, "deposited", "reflowed", "joined"):
                with self.subTest(upper=upper_stage, lower=lower_stage):
                    main, die = main_state(lower_stage), die_state(upper_stage)
                    bottom = main.bump_placement_bottom_z(die, x=0, y=0, anchor="bottomLeft")
                    active = upper_stage in ("deposited", "reflowed") and lower_stage in ("deposited", "reflowed")
                    self.assertEqual(bottom, 120 if active else 100)
                    place(main, die)
                    child = main.to_geometry_structure()["root"]["children"][0]
                    self.assertEqual(child["bodies"][0]["geometry"]["bottom_left"][2], bottom + (15 if upper_stage else 0))
                    if upper_stage:
                        self.assertEqual(child["bumps"][0]["stage"], upper_stage)

    def test_different_die_thicknesses_converge_and_unpaired_children_stay(self):
        main = main_state()
        for x, thickness in ((0, 15), (20, 10)):
            place(main, die_state(thickness=thickness), x=x)
        place(main, die_state("deposited"), x=40)
        place(main, die_state(None), x=60)
        before = main.to_geometry_structure()["root"]["children"]
        main.join_bumps(joined_height=25)
        after = main.to_geometry_structure()["root"]["children"]
        self.assertEqual([child["bodies"][0]["geometry"]["bottom_left"][2] for child in after[:2]], [125, 125])
        self.assertEqual(after[2:], before[2:])

    def test_entire_subtree_moves_without_joining_internal_children(self):
        main, die = main_state(), die_state()
        die.place_geometry_state(die_state(), x=1, y=1, bottom_z=65)
        place(main, die)
        before = main.to_geometry_structure()["root"]["children"][0]["children"][0]
        main.join_bumps(joined_height=25)
        nested = main.to_geometry_structure()["root"]["children"][0]["children"][0]
        self.assertEqual(nested["bumps"][0]["stage"], "reflowed")
        self.assertEqual(nested["bumps"][0]["geometry"]["thk"], 15)
        self.assertEqual(nested["bumps"][0]["geometry"]["bottom_left"][2], before["bumps"][0]["geometry"]["bottom_left"][2] - 10)

    def test_any_positive_joined_height_including_below_lower_thickness(self):
        for height in (5, 60):
            main = main_state()
            place(main, die_state())
            main.join_bumps(joined_height=height)
            self.assertEqual(main.to_geometry_structure()["root"]["children"][0]["bodies"][0]["geometry"]["bottom_left"][2], 100 + height)

    def assert_atomic_failure(self, state, pattern, height=25):
        before, cursor, footprint = state.to_geometry_structure(), state.cursor_z(), state.process_footprint()
        with self.assertRaisesRegex(ValueError, pattern):
            state.join_bumps(joined_height=height)
        self.assertEqual(state.to_geometry_structure(), before)
        self.assertEqual(state.cursor_z(), cursor)
        self.assertEqual(state.process_footprint(), footprint)

    def assert_joint_noop(self, state):
        before, cursor, footprint = state.to_geometry_structure(), state.cursor_z(), state.process_footprint()
        with mock.patch.object(state, "to_geometry_structure", side_effect=AssertionError("Unexpected serialization")):
            self.assertIs(state.join_bumps(joined_height=25), state)
        self.assertEqual(state.to_geometry_structure(), before)
        self.assertEqual(state.cursor_z(), cursor)
        self.assertEqual(state.process_footprint(), footprint)

    def test_invalid_heights_are_atomic_with_or_without_pairs(self):
        for paired in (False, True):
            for height in (0, -1, float("nan"), float("inf")):
                with self.subTest(paired=paired, height=height):
                    state = main_state()
                    if paired:
                        place(state, die_state())
                    self.assert_atomic_failure(state, "positive|finite", height)

    def test_no_pairs_and_repeated_joint_preserve_state(self):
        self.assert_joint_noop(ProcessGeometryState.create())
        self.assert_joint_noop(main_state())
        for lower in (None, "deposited", "reflowed", "joined"):
            for upper in (None, "deposited", "reflowed", "joined"):
                if lower == upper == "reflowed":
                    continue
                with self.subTest(lower=lower, upper=upper):
                    state = main_state(lower)
                    place(state, die_state(upper))
                    self.assert_joint_noop(state)
        state = main_state()
        place(state, die_state())
        state.join_bumps(joined_height=25)
        self.assert_joint_noop(state)

    def test_cross_layer_and_ambiguous_pairs_are_atomic(self):
        state = main_state()
        place(state, die_state())
        state.add_bump(material="Sn", density=10, direction="+z", stage="reflowed", geometry={"type":"box", "bottomLeft":[20,0,105], "topRight":[30,10,105], "thickness":25})
        state.place_geometry_state(die_state(), x=20, y=0, bottom_z=130)
        self.assert_atomic_failure(state, "same layer")
        state = main_state()
        place(state, die_state())
        state.add_bump_above_cursor(material="Sn", density=10, thickness=20, stage="reflowed")
        self.assert_atomic_failure(state, "multiple lower")

    def test_noncontacting_pair_and_xy_disjoint_are_skipped(self):
        state = main_state()
        state.place_geometry_state(die_state(), x=0, y=0, bottom_z=121)
        self.assert_joint_noop(state)
        state = main_state()
        place(state, die_state(), x=200)
        self.assert_joint_noop(state)

    def test_partial_and_inconsistent_child_bumps_fail_without_moving_valid_children(self):
        state = main_state()
        place(state, die_state())
        die = die_state()
        die.add_bump(material="Sn", density=10, direction="-z", stage="reflowed", geometry={"type":"box", "bottomLeft":[200,0,0], "topRight":[210,10,0], "thickness":15})
        state.place_geometry_state(die, x=0, y=20, bottom_z=120)
        self.assert_atomic_failure(state, "partially paired")
        state = main_state()
        place(state, die_state())
        die = die_state()
        die.add_bump(material="Sn", density=10, direction="-z", stage="reflowed", geometry={"type":"box", "bottomLeft":[0,0,0], "topRight":[10,10,0], "thickness":10})
        state.place_geometry_state(die, x=20, y=0, bottom_z=120)
        self.assert_atomic_failure(state, "inconsistent joint heights")

    def test_same_layer_tolerance(self):
        state = main_state(None)
        state.add_bump(material="Sn", density=40, direction="+z", stage="reflowed", geometry={"type":"box", "bottomLeft":[0,0,100], "topRight":[10,10,100], "thickness":20})
        place(state, die_state())
        state.add_bump(material="Sn", density=10, direction="+z", stage="reflowed", geometry={"type":"box", "bottomLeft":[20,0,100+5e-6], "topRight":[30,10,100+5e-6], "thickness":20})
        state.place_geometry_state(die_state(), x=20, y=0, bottom_z=120+5e-6)
        state.join_bumps(joined_height=25)
        self.assertEqual([child["bumps"][0]["stage"] for child in state.to_geometry_structure()["root"]["children"]], ["joined","joined"])

    def test_real_circle_and_polygon_hole_overlap(self):
        state = ProcessGeometryState.create()
        state.initialize_cylinder_layer(material="Si", center=[0,0,0], radius=50, thickness=100)
        state.add_bump_above_cursor(material="Sn", density=40, thickness=20, stage="reflowed")
        self.assertEqual(state.bump_placement_bottom_z(die_state(), x=0, y=0, anchor="bottomLeft"), 120)
        # Rectangle lies in the circle's bounding box but outside the circle.
        self.assertEqual(state.bump_placement_bottom_z(die_state(), x=40, y=40, anchor="bottomLeft"), 100)
        state = main_state(None)
        state.add_bump(material="Sn", density=40, direction="+z", stage="reflowed", geometry={"type":"polygon", "polygons":[[[0,0,100],[100,0,100],[100,100,100],[0,100,100]],[[20,20,100],[20,40,100],[40,40,100],[40,20,100]]],"thickness":20})
        self.assertEqual(state.bump_placement_bottom_z(die_state(), x=25, y=25, anchor="bottomLeft"), 100)
        self.assertEqual(state.bump_placement_bottom_z(die_state(), x=0, y=0, anchor="bottomLeft"), 120)
        self.assertEqual(state.bump_placement_bottom_z(die_state(), x=15, y=25, anchor="bottomLeft"), 120)

    def test_pnp_and_both_joints_accept_wafer_edge_overhang(self):
        for execute in (execute_joint, execute_tcb_joint):
            for x in (45, 50 - 1e-6):
                for polygon in (False, True):
                    for catalog in (False, True):
                        with self.subTest(execute=execute.__module__, x=x, polygon=polygon, catalog=catalog):
                            state = ProcessGeometryState.create()
                            state.initialize_cylinder_layer(material="Si", center=[0,0,0], radius=50, thickness=100)
                            state.add_bump_above_cursor(material="Sn", density=40, thickness=20, stage="reflowed")
                            initial = state.to_geometry_structure()
                            die = die_state()
                            source = die.to_geometry_structure()
                            target = placement(x, -5)
                            if polygon:
                                target["targetRegion"] = {"type":"polygon", "points":[[x,-5],[x+10,-5],[x+10,5],[x,5]]}
                            main_artifact = GeometryArtifact.from_structure(initial)
                            if catalog:
                                state = ProcessGeometryState.from_structure(initial)
                            else:
                                main_artifact = main_artifact.with_runtime_state(state)
                            footprint = state.process_footprint()
                            execute_pnp(context(state, {"placements":[target]}, main_artifact,
                                                GeometryArtifact.from_structure(source)))
                            before = state.to_geometry_structure()["root"]
                            child = before["children"][0]
                            self.assertEqual(child["bodies"][0]["geometry"]["bottom_left"][2]
                                             if not polygon else child["bodies"][0]["geometry"]["polys"][0][0][2], 135)
                            execute(context(state, {"bump_joined_height":25}))
                            after = state.to_geometry_structure()["root"]
                            expected = copy.deepcopy(child)
                            geometry = expected["bumps"][0]["geometry"]
                            geometry["thk"] = 25
                            expected["bumps"][0]["stage"] = "joined"
                            if polygon:
                                for loop in geometry["polys"]:
                                    for point in loop:
                                        point[2] = 100
                                for loop in expected["bodies"][0]["geometry"]["polys"]:
                                    for point in loop:
                                        point[2] = 125
                            else:
                                geometry["bottom_left"][2] = geometry["top_right"][2] = 100
                                expected["bodies"][0]["geometry"]["bottom_left"][2] = 125
                                expected["bodies"][0]["geometry"]["top_right"][2] = 125
                            actual = copy.deepcopy(after["children"][0])
                            # Body IDs derived from payload change when its Z changes.
                            actual["bodies"][0].pop("id")
                            expected["bodies"][0].pop("id")
                            self.assertEqual(actual, expected)
                            self.assertEqual(after["bumps"], initial["root"]["bumps"])
                            self.assertEqual(die.to_geometry_structure(), source)
                            self.assertEqual(state.cursor_z(), 100)
                            self.assertEqual(state.process_footprint(), footprint)
                            self.assertEqual(state.clone().to_geometry_structure(), state.to_geometry_structure())
                            self.assert_joint_noop(state)

    def test_touching_or_disjoint_footprints_do_not_place_above_or_join(self):
        for circular, x, y in ((True,50,-5), (True,50+1e-6,-5), (True,40,40),
                                (False,100,0), (False,100,100), (False,100+1e-6,0)):
            with self.subTest(circular=circular, x=x, y=y):
                state = main_state()
                if circular:
                    state = ProcessGeometryState.create()
                    state.initialize_cylinder_layer(material="Si", center=[0,0,0], radius=50, thickness=100)
                    state.add_bump_above_cursor(material="Sn", density=40, thickness=20, stage="reflowed")
                self.assertEqual(state.bump_placement_bottom_z(die_state(), x=x, y=y, anchor="bottomLeft"), 100)
                # Force Z contact to verify Joint independently rejects the XY match.
                state.place_geometry_state(die_state(), x=x, y=y, bottom_z=120)
                self.assert_joint_noop(state)

    def test_partial_overlap_still_requires_z_contact_and_unique_lower_match(self):
        state = main_state()
        state.place_geometry_state(die_state(), x=95, y=0, bottom_z=121)
        self.assert_joint_noop(state)
        state = main_state()
        place(state, die_state())
        state.place_geometry_state(die_state(), x=95, y=0, bottom_z=120)
        state.add_bump(material="Sn", density=10, direction="+z", stage="reflowed",
                       geometry={"type":"box", "bottomLeft":[102,0,100], "topRight":[110,10,100], "thickness":20})
        self.assert_atomic_failure(state, "multiple lower")

    def test_catalog_restores_main_surface_and_runtime_cursor_is_preserved(self):
        original = main_state()
        serialized = original.to_geometry_structure()
        catalog_state = ProcessGeometryState.from_structure(serialized)
        self.assertEqual(catalog_state.cursor_z(), 120)
        source = GeometryArtifact.from_structure(die_state().to_geometry_structure())
        execute_pnp(context(catalog_state, {"placements":[placement()]}, GeometryArtifact.from_structure(serialized), source))
        self.assertEqual(catalog_state.cursor_z(), 100)
        self.assertEqual(catalog_state.to_geometry_structure()["root"]["children"][0]["bodies"][0]["geometry"]["bottom_left"][2], 135)
        runtime = main_state(None)
        runtime.set_cursor_z(110)
        execute_pnp(context(runtime, {"placements":[placement()]}, GeometryArtifact.from_structure(runtime.to_geometry_structure()).with_runtime_state(runtime), source))
        self.assertEqual(runtime.cursor_z(), 110)
        self.assertEqual(runtime.to_geometry_structure()["root"]["children"][0]["bodies"][0]["geometry"]["bottom_left"][2], 125)

    def test_pnp_entire_batch_is_atomic_when_later_placement_is_ambiguous(self):
        state = main_state()
        state.add_bump(material="Sn", density=10, direction="+z", stage="reflowed", geometry={"type":"box", "bottomLeft":[28,0,100], "topRight":[38,10,100], "thickness":20})
        before = state.to_geometry_structure()
        source = GeometryArtifact.from_structure(die_state().to_geometry_structure())
        with self.assertRaisesRegex(ValueError, "multiple overlapping"):
            execute_pnp(context(state, {"placements":[placement(),placement(20)]}, source=source))
        self.assertEqual(state.to_geometry_structure(), before)

    def test_joint_module_requires_positive_finite_height_without_pairs(self):
        for values in ({}, {"bump_joined_height": None}, {"bump_joined_height": 0},
                       {"bump_joined_height": -1}, {"bump_joined_height": float("nan")},
                       {"bump_joined_height": float("inf")}):
            with self.subTest(values=values):
                state = main_state()
                before = state.to_geometry_structure()
                with self.assertRaisesRegex(ValueError, "bump_joined_height"):
                    execute_joint(context(state, values))
                self.assertEqual(state.to_geometry_structure(), before)
        state = main_state()
        before = state.to_geometry_structure()
        self.assertIs(execute_joint(context(state, {"bump_joined_height": 25})), state)
        self.assertEqual(state.to_geometry_structure(), before)

    def test_polygon_adaptation_pairs_and_joins_without_mutating_source(self):
        state = main_state()
        die = die_state()
        before = die.to_geometry_structure()
        target = placement()
        target["targetRegion"] = {"type":"polygon", "points":[[0,0],[10,0],[8,10],[0,10]]}
        execute_pnp(context(state, {"placements":[target]}, source=GeometryArtifact.from_structure(before)))
        state.join_bumps(joined_height=25)
        bump = state.to_geometry_structure()["root"]["children"][0]["bumps"][0]
        self.assertEqual(bump["geometry"]["type"], "PolygonGeometry")
        self.assertEqual(bump["geometry"]["polys"][0][0][2], 100)
        self.assertEqual(bump["stage"], "joined")
        self.assertEqual(die.to_geometry_structure(), before)

    def test_zero_placement_flow_runs_joint_without_die_binding_or_configuration(self):
        fixtures = Path(__file__).resolve().parents[3] / "apps/api/src/process_flow_api/fixtures"
        read = lambda name: json.loads((fixtures / name).read_text())
        steps, flows, geometries = map(read, ("process-step-templates.json", "process-flows.json", "geometries.json"))
        flow = next(item for item in flows if item["id"] == "flow_inst_dual_bump_demo")["definition"]
        configuration = next(item for item in flows if item["id"] == "flow_inst_dual_bump_demo")["configuration"]
        configuration["stepConfigurations"]["pnp"]["recipeCandidates"][0]["parameterValues"]["placements"] = []
        configuration["inputBindings"].pop("incoming_die")
        for step in ("die_bump", "die_flip"):
            configuration["stepConfigurations"].pop(step)
        compiler = FlowCompiler(InMemoryGeometryCatalog(geometries))
        plan = compiler.compile(flow, configuration, steps)
        self.assertEqual([step.step_ref_id for step in plan.steps], ["main_bump", "pnp", "joint"])
        self.assertEqual(set(plan.external_geometries), {"incoming_main"})
        self.assertEqual(set(plan.step("pnp").geometry_inputs), {"main_geometry"})
        result = GeometryKernel().execute(plan)
        self.assertEqual(set(result.step_outputs()), {"main_bump", "pnp", "joint"})
        self.assertEqual(result.step_output("joint"), result.step_output("pnp"))
        self.assertEqual(result.geometry(), result.step_output("pnp"))
        self.assertEqual(result.geometry()["root"]["children"], [])
        self.assertEqual(result.geometry()["root"]["bumps"][0]["stage"], "reflowed")

    def test_seed_dual_branch_flow_executes_with_rectangle_and_polygon_children(self):
        fixtures = Path(__file__).resolve().parents[3] / "apps/api/src/process_flow_api/fixtures"
        read = lambda name: json.loads((fixtures / name).read_text())
        steps, flows, geometries = map(read, ("process-step-templates.json", "process-flows.json", "geometries.json"))
        flow = next(item for item in flows if item["id"] == "flow_inst_dual_bump_demo")["definition"]
        configuration = next(item for item in flows if item["id"] == "flow_inst_dual_bump_demo")["configuration"]
        before = copy.deepcopy(geometries)
        result = GeometryKernel().execute(FlowCompiler(InMemoryGeometryCatalog(geometries)).compile(flow, configuration, steps))
        root = result.geometry()["root"]
        base = root["bumps"][0]["geometry"]["center"][2]
        self.assertEqual(root["bumps"][0]["stage"], "reflowed")
        self.assertEqual([child["bumps"][0]["stage"] for child in root["children"]], ["joined","joined"])
        self.assertEqual(root["children"][0]["bodies"][0]["geometry"]["bottom_left"][2], base+25)
        self.assertEqual(root["children"][1]["bodies"][0]["geometry"]["type"], "PolygonGeometry")
        self.assertEqual(result.step_output("pnp")["root"]["children"][0]["bodies"][0]["geometry"]["bottom_left"][2], base+35)
        self.assertEqual(normalize_geometry_structure(result.geometry()), result.geometry())
        self.assertEqual(geometries, before)


class FootprintOverlapTests(unittest.TestCase):
    def test_positive_area_and_boundary_contact_for_all_primitive_pairs(self):
        square = BoxGeometry([0,0,0], [10,10,0], 1)
        circle = CylinderGeometry([0,0,0], 5, 1)
        # The top radius determines a cone's projected envelope.
        cone = ConeGeometry([0,0,0], 1, 5, 1)
        polygon = PolygonGeometry([[[0,0,0],[10,0,0],[0,10,0]]], 1)
        ring = PolygonGeometry([
            [[0,0,0],[20,0,0],[20,20,0],[0,20,0]],
            [[5,5,0],[5,15,0],[15,15,0],[15,5,0]],
        ], 1)
        cases = [
            (square, square, True),
            (square, BoxGeometry([10-1e-7,0,0], [20,10,0], 1), True),
            (square, BoxGeometry([10,0,0], [20,10,0], 1), False),
            (square, BoxGeometry([10,10,0], [20,20,0], 1), False),
            (square, BoxGeometry([10+1e-7,0,0], [20,10,0], 1), False),
            (polygon, BoxGeometry([4,4,0], [8,8,0], 1), True),
            (polygon, BoxGeometry([5,5,0], [8,8,0], 1), False),
            (polygon, PolygonGeometry([[[4,4,0],[12,4,0],[4,12,0]]], 1), True),
            (ring, BoxGeometry([6,6,0], [14,14,0], 1), False),
            (ring, BoxGeometry([4,6,0], [6,14,0], 1), True),
            (ring, PolygonGeometry([[[6,6,0],[14,6,0],[6,14,0]]], 1), False),
        ]
        for round_shape in (circle, cone):
            cases.extend([
                (round_shape, square, True),
                (round_shape, BoxGeometry([5-1e-7,-1,0], [10,1,0], 1), True),
                (round_shape, BoxGeometry([5,-1,0], [10,1,0], 1), False),
                (round_shape, BoxGeometry([4,4,0], [5,5,0], 1), False),
                (round_shape, polygon, True),
                (round_shape, CylinderGeometry([10-1e-7,0,0], 5, 1), True),
                (round_shape, CylinderGeometry([10,0,0], 5, 1), False),
                (round_shape, CylinderGeometry([10+1e-7,0,0], 5, 1), False),
                (round_shape, CylinderGeometry([4,0,0], 1, 1), True),
                (round_shape, ConeGeometry([9,0,0], 1, 5, 1), True),
            ])
        cases.extend([
            (ring, CylinderGeometry([10,10,0], 4, 1), False),
            (ring, CylinderGeometry([10,10,0], 5, 1), False),
            (ring, CylinderGeometry([10,10,0], 5+1e-7, 1), True),
            (ring, ConeGeometry([10,10,0], 1, 6, 1), True),
        ])
        for left, right, expected in cases:
            with self.subTest(left=left.json(), right=right.json()):
                self.assertEqual(footprints_overlap(left, right), expected)
                self.assertEqual(footprints_overlap(right, left), expected)


class JointEntryPointTests(unittest.TestCase):
    def test_both_entry_points_have_identical_join_noop_and_repeat_results(self):
        for height in (5, 25, 60):
            for paired in (False, True):
                main = main_state()
                if paired:
                    place(main, die_state())
                results = []
                for execute in (execute_joint, execute_tcb_joint):
                    with self.subTest(height=height, paired=paired, execute=execute.__module__):
                        state = main.clone()
                        self.assertIs(execute(context(state, {"bump_joined_height": height})), state)
                        first = state.to_geometry_structure()
                        self.assertIs(execute(context(state, {"bump_joined_height": height})), state)
                        self.assertEqual(state.to_geometry_structure(), first)
                        results.append(first)
                self.assertEqual(results[0], results[1])

    def test_both_entry_points_reject_invalid_height_without_mutation(self):
        for execute in (execute_joint, execute_tcb_joint):
            for paired in (False, True):
                for height in (None, 0, -1, float("nan"), float("inf")):
                    with self.subTest(execute=execute.__module__, paired=paired, height=height):
                        state = main_state()
                        if paired:
                            place(state, die_state())
                        before = state.to_geometry_structure()
                        with self.assertRaisesRegex(ValueError, "bump_joined_height"):
                            execute(context(state, {"bump_joined_height": height}))
                        self.assertEqual(state.to_geometry_structure(), before)

    def test_both_entry_points_reject_ambiguous_pair_without_mutation(self):
        for execute in (execute_joint, execute_tcb_joint):
            state = main_state()
            place(state, die_state())
            state.add_bump_above_cursor(material="Sn", density=10, thickness=20, stage="reflowed")
            before = state.to_geometry_structure()
            with self.assertRaisesRegex(ValueError, "multiple lower"):
                execute(context(state, {"bump_joined_height": 25}))
            self.assertEqual(state.to_geometry_structure(), before)

    def test_tcb_template_runs_same_dual_branch_flow(self):
        fixtures = Path(__file__).resolve().parents[3] / "apps/api/src/process_flow_api/fixtures"
        read = lambda name: json.loads((fixtures / name).read_text())
        steps, flows, geometries = map(read, ("process-step-templates.json", "process-flows.json", "geometries.json"))
        flow = next(item for item in flows if item["id"] == "flow_inst_dual_bump_demo")["definition"]
        configuration = next(item for item in flows if item["id"] == "flow_inst_dual_bump_demo")["configuration"]
        compiler = FlowCompiler(InMemoryGeometryCatalog(geometries))
        expected = GeometryKernel().execute(compiler.compile(flow, configuration, steps)).geometry()
        next(ref for ref in flow["stepRefs"] if ref["stepRefId"] == "joint")["processStepTemplateId"] = "step_tpl_tcb_joint"
        actual = GeometryKernel().execute(compiler.compile(flow, configuration, steps)).geometry()
        self.assertEqual(actual, expected)

    def test_retired_program_cannot_be_resolved(self):
        from process_flow_kernel import ProcessStepModuleResolver
        with self.assertRaisesRegex(ValueError, "Unable to load"):
            ProcessStepModuleResolver().resolve({"id": "step_tpl_bump_joint", "program": "bump/bump_joint"})


if __name__ == "__main__":
    unittest.main()
