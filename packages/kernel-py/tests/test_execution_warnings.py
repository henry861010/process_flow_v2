from __future__ import annotations

import unittest
from types import SimpleNamespace

from process_flow_kernel import (
    GeometryArtifact, GeometryKernel, ProcessGeometryState, ProcessStepContext,
)
from process_flow_kernel.application.execution_plan import ExecutionPlan, PlannedGeometryInput, PlannedStep
from process_flow_kernel.application.execution_result import GeometryKernelExecutionResult
from process_flow_steps.joint.mr_joint import execute as mr_joint
from process_flow_steps.joint.tcb_joint import execute as tcb_joint


def state_with_placed_die(*, fill=True):
    main = ProcessGeometryState.create()
    main.initialize_box_layer(material="PI", bottom_left=[0, 0, 350],
                              top_right=[100, 100, 350], thickness=30)
    main.add_bump_above_cursor(material="SnAg", density=40, thickness=28, stage="reflowed")
    die = ProcessGeometryState.create()
    die.initialize_box_layer(material="Si", bottom_left=[0, 0, 28],
                             top_right=[10, 10, 28], thickness=100)
    die.add_bump(material="SnAg", density=40, direction="-z", stage="reflowed",
                 geometry={"type": "box", "bottomLeft": [0, 0, 0],
                           "topRight": [10, 10, 0], "thickness": 28})
    main.place_geometry_state(die, x=0, y=0, bottom_z=408)
    if fill:
        main.apply_under_fill(material="Any support", thk=200, gap=14, key="uf")
    return main


def joint_context(state, height, warnings):
    geometry = state.to_geometry_structure()
    return ProcessStepContext(
        state=state, values={"bump_joined_height": height}, raw_parameter_values={},
        step_ref={"stepRefId": "joint", "stepLabel": "Attach dies"},
        step_template={}, step_configuration={}, geometry_inputs={"main_geometry": geometry},
        input_geometry=geometry, geometry_resolver=lambda _: state,
        warning_collector=warnings.append,
    )


class JointProcessWarningTests(unittest.TestCase):
    def test_both_joint_steps_report_requested_and_preserved_soh(self):
        for execute in (mr_joint, tcb_joint):
            with self.subTest(execute=execute.__module__):
                state, warnings = state_with_placed_die(), []
                before = state.to_geometry_structure()["root"]
                self.assertIs(execute(joint_context(state, 10, warnings)), state)
                after = state.to_geometry_structure()["root"]
                self.assertEqual(after["children"][0]["bodies"], before["children"][0]["bodies"])
                self.assertEqual(after["children"][0]["bumps"][0]["stage"], "joined")
                self.assertEqual(after["children"][0]["bumps"][0]["geometry"]["thk"], 56)
                self.assertEqual(len(warnings), 1)
                warning = warnings[0]
                self.assertEqual(warning["code"], "joint_soh_preserved")
                self.assertEqual((warning["stepRefId"], warning["stepLabel"]), ("joint", "Attach dies"))
                self.assertEqual(warning["details"], {
                    "childId": after["children"][0]["id"], "requestedSoh": 10,
                    "actualSoh": 56, "unit": "um", "supportMaterials": ["Any support"],
                })
                for text in ("10 µm", "56 µm", "Any support", "fill/support", "position is unchanged"):
                    self.assertIn(text, warning["message"])
                execute(joint_context(state, 10, warnings))
                self.assertEqual(len(warnings), 1)

    def test_equal_soh_or_absent_support_does_not_warn(self):
        for execute in (mr_joint, tcb_joint):
            for fill, height in ((True, 56), (True, 56 + 1e-6), (False, 10)):
                with self.subTest(execute=execute.__module__, fill=fill, height=height):
                    state, warnings = state_with_placed_die(fill=fill), []
                    execute(joint_context(state, height, warnings))
                    self.assertEqual(warnings, [])


class ExecutionWarningTests(unittest.TestCase):
    def test_context_collector_is_optional_and_copies_details(self):
        context = joint_context(state_with_placed_die(), 10, [])
        details = {"materials": ["UF"]}
        collected = []
        context = ProcessStepContext(
            state=context.state, values={}, raw_parameter_values={}, step_ref=context.step_ref,
            step_template={}, step_configuration={}, geometry_inputs={}, input_geometry=None,
            geometry_resolver=lambda _: None, warning_collector=collected.append,
        )
        context.warn("test", "Example", details=details)
        details["materials"].append("Other")
        self.assertEqual(collected[0]["details"], {"materials": ["UF"]})
        without_collector = ProcessStepContext(
            state=context.state, values={}, raw_parameter_values={}, step_ref={},
            step_template={}, step_configuration={}, geometry_inputs={}, input_geometry=None,
            geometry_resolver=lambda _: None,
        )
        without_collector.warn("test", "Example")

    def test_warning_lineage_deduplicates_shared_ancestors_without_branch_leakage(self):
        def step(name, sources, *, warn=False):
            return PlannedStep(
                step_ref_id=name, step_label=name.title(), step_template={},
                raw_parameter_values={}, parameter_values={"warn": warn},
                geometry_inputs=sources, output_port_id="result_geometry",
            )

        external = {"main_geometry": PlannedGeometryInput(kind="external", flow_input_id="main")}

        def upstream(name):
            return PlannedGeometryInput(kind="stepOutput", step_ref_id=name)

        plan = ExecutionPlan(steps=[
            step("ancestor", external, warn=True),
            step("left", {"main_geometry": upstream("ancestor")}),
            step("right", {"main_geometry": upstream("ancestor")}, warn=True),
            step("unrelated", external, warn=True),
            step("merge", {"main_geometry": upstream("left"), "aux": upstream("right")}),
            step("downstream", {"main_geometry": upstream("merge")}, warn=True),
        ], external_geometries={"main": GeometryArtifact.from_structure(
            state_with_placed_die(fill=False).to_geometry_structure())},
            terminal_step_ref_ids=["unrelated", "downstream"])

        def execute(context):
            if context.values["warn"]:
                context.warn("example", context.step_ref["stepRefId"], details={"items": [1]})
            return context.state

        resolver = SimpleNamespace(resolve=lambda _: SimpleNamespace(execute=execute))
        result = GeometryKernel(module_resolver=resolver).execute(plan)
        messages = lambda warnings: [item["message"] for item in warnings]
        self.assertEqual(messages(result.execution_warnings()), ["ancestor", "right", "unrelated", "downstream"])
        self.assertEqual(messages(result.step_execution_warnings("merge")), ["ancestor", "right"])
        self.assertEqual(messages(result.step_execution_warnings("downstream")), ["ancestor", "right", "downstream"])
        self.assertEqual(messages(result.step_execution_warnings("unrelated")), ["unrelated"])
        self.assertEqual(messages(result.step_execution_warnings("left")), ["ancestor"])
        self.assertEqual(result.step_execution_warnings("missing"), [])
        result.execution_warnings()[0]["details"]["items"].append(2)
        result.step_execution_warnings("merge")[0]["details"]["items"].append(3)
        self.assertEqual(result.execution_warnings()[0]["details"], {"items": [1]})
        self.assertEqual(result.step_execution_warnings("merge")[0]["details"], {"items": [1]})

    def test_result_defaults_and_constructor_copy_isolation(self):
        geometry = state_with_placed_die(fill=False).to_geometry_structure()
        empty = GeometryKernelExecutionResult(step_outputs={"joint": GeometryArtifact.from_structure(geometry)}, selected_step_ref_id="joint")
        self.assertEqual(empty.execution_warnings(), [])
        self.assertEqual(empty.step_execution_warnings("joint"), [])
        original = [{"details": {"materials": ["UF"]}}]
        result = GeometryKernelExecutionResult(step_outputs={"joint": GeometryArtifact.from_structure(geometry)}, selected_step_ref_id="joint",
            execution_warnings=original, step_execution_warnings={"joint": original})
        original[0]["details"]["materials"].append("Other")
        self.assertEqual(result.execution_warnings(), [{"details": {"materials": ["UF"]}}])
        self.assertEqual(result.step_execution_warnings("joint"), result.execution_warnings())


if __name__ == "__main__":
    unittest.main()
