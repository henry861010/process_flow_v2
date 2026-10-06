import copy
import unittest
from unittest import mock

from process_flow_kernel import (
    FlowCompiler, GeometryKernel, InMemoryGeometryCatalog, ProcessGeometryState,
    ProcessStepContext,
)
from process_flow_steps.pnp.pnp import execute
from test_adaptive_pnp import (
    geometry_entity, main_geometry, pnp_step_template, rectangle_placement,
)
from test_kernel import molding_step_template


def input_edge(name, source, target, port="main_geometry"):
    return {"edgeId": name, "source": {"kind": "flowInput", "flowInputId": source},
            "target": {"stepRefId": target, "inputPortId": port}}


def output_edge(name, source, target, port="main_geometry"):
    return {"edgeId": name, "source": {"kind": "stepOutput", "stepRefId": source,
            "outputPortId": "result_geometry"},
            "target": {"stepRefId": target, "inputPortId": port}}


class ZeroPlacementDependenciesTests(unittest.TestCase):
    def setUp(self):
        self.steps = [pnp_step_template(), molding_step_template()]
        self.flow = {
            "id": "zero-placement-flow",
            "flowInputs": [{"flowInputId": name, "dataType": "geometry", "required": True}
                           for name in ("main", "die")],
            "stepRefs": [
                {"stepRefId": "prepare1", "processStepTemplateId": "step_molding"},
                {"stepRefId": "prepare2", "processStepTemplateId": "step_molding"},
                {"stepRefId": "pnp", "processStepTemplateId": "adaptive-pnp-step"},
            ],
            "flowEdges": [input_edge("main", "main", "pnp"),
                          input_edge("die", "die", "prepare1"),
                          output_edge("prepare", "prepare1", "prepare2"),
                          output_edge("place", "prepare2", "pnp", "die_geometry")],
        }
        self.configuration = {
            "inputBindings": {"main": {"kind": "catalog", "geometryId": "main"}},
            "stepConfigurations": {"pnp": {"parameterValues": {"placements": []}}},
        }
        self.compiler = FlowCompiler(InMemoryGeometryCatalog([geometry_entity("main", main_geometry())]))

    def compile(self, **kwargs):
        return self.compiler.compile(self.flow, self.configuration, self.steps, **kwargs)

    def test_zero_prunes_multistep_branch_and_executes_main_only(self):
        plan = self.compile()
        self.assertEqual([step.step_ref_id for step in plan.steps], ["pnp"])
        self.assertEqual(set(plan.step("pnp").geometry_inputs), {"main_geometry"})
        self.assertEqual(set(plan.external_geometries), {"main"})
        result = GeometryKernel().execute(plan)
        self.assertEqual(set(result.step_outputs()), {"pnp"})
        self.assertEqual(result.geometry(), plan.external_geometries["main"].structure)
        self.compiler.validate_configuration(self.flow, self.configuration, self.steps,
                                             require_complete=False)

    def test_direct_die_input_is_also_pruned(self):
        self.flow["stepRefs"] = self.flow["stepRefs"][-1:]
        self.flow["flowEdges"] = [input_edge("main", "main", "pnp"),
                                  input_edge("die", "die", "pnp", "die_geometry")]
        self.assertEqual(set(self.compile().external_geometries), {"main"})

    def test_main_binding_remains_required(self):
        self.configuration["inputBindings"] = {}
        with self.assertRaisesRegex(ValueError, "Missing input binding: main"):
            self.compile()

    def test_nonzero_reactivation_and_missing_or_malformed_values_fail(self):
        for value in ([rectangle_placement(0, 0, 5, 5)], None, "", {}, 0):
            with self.subTest(value=value):
                self.configuration["stepConfigurations"]["pnp"]["parameterValues"]["placements"] = value
                with self.assertRaises(ValueError):
                    self.compile()
        self.configuration["stepConfigurations"]["pnp"]["parameterValues"] = {}
        with self.assertRaises(ValueError):
            self.compile()
        self.configuration["stepConfigurations"]["pnp"]["parameterValues"]["placements"] = []
        self.assertEqual(len(self.compile().steps), 1)

    def test_direct_branch_preview_requires_its_configuration(self):
        with self.assertRaises(ValueError):
            self.compile(output_step_ref_id="prepare2")
        self.configuration["inputBindings"]["die"] = {"kind": "catalog", "geometryId": "main"}
        for step in ("prepare1", "prepare2"):
            self.configuration["stepConfigurations"][step] = {"parameterValues": {"material": "EMC", "thickness": 2}}
        plan = self.compile(output_step_ref_id="prepare2")
        self.assertEqual([step.step_ref_id for step in plan.steps], ["prepare1", "prepare2"])
        self.assertEqual(set(plan.external_geometries), {"die"})
        GeometryKernel().execute(plan)

    def test_nested_zero_pnp_retains_its_main_and_prunes_its_die(self):
        self.flow["stepRefs"] = [
            {"stepRefId": "inner", "processStepTemplateId": "adaptive-pnp-step"},
            self.flow["stepRefs"][-1],
        ]
        self.flow["flowInputs"].append({"flowInputId": "unused", "dataType": "geometry", "required": True})
        self.flow["flowEdges"] = [input_edge("main", "main", "pnp"),
                                  input_edge("inner-main", "die", "inner"),
                                  input_edge("inner-die", "unused", "inner", "die_geometry"),
                                  output_edge("outer-die", "inner", "pnp", "die_geometry")]
        self.configuration["stepConfigurations"]["pnp"]["parameterValues"]["placements"] = [rectangle_placement(0, 0, 5, 5)]
        self.configuration["stepConfigurations"]["inner"] = {"parameterValues": {"placements": []}}
        self.configuration["inputBindings"]["die"] = {"kind": "catalog", "geometryId": "main"}
        plan = self.compile()
        self.assertEqual([step.step_ref_id for step in plan.steps], ["inner", "pnp"])
        self.assertEqual(set(plan.external_geometries), {"main", "die"})
        self.assertNotIn("die_geometry", plan.step("inner").geometry_inputs)

    def test_shared_optional_input_still_requires_active_consumer_binding(self):
        self.flow["flowInputs"] = [{"flowInputId": "die", "dataType": "geometry", "required": False}]
        self.flow["flowEdges"][0]["source"]["flowInputId"] = "die"
        self.configuration["inputBindings"] = {}
        with self.assertRaisesRegex(ValueError, "Missing input binding: die"):
            self.compile()

    def test_inactive_catalog_and_generator_resources_are_never_resolved(self):
        for binding in ({"kind": "catalog", "geometryId": "missing"},
                        {"kind": "generator", "generatorId": "unknown", "generatorVersion": 1, "parameters": {}}):
            with self.subTest(binding=binding):
                self.configuration["inputBindings"]["die"] = binding
                original = copy.deepcopy(self.configuration)
                resolver = mock.Mock()
                self.compiler._geometry_generator_resolver = resolver
                self.assertEqual(set(self.compile().external_geometries), {"main"})
                resolver.generate.assert_not_called()
                self.assertEqual(self.configuration, original)

    def test_topology_and_inactive_configuration_shapes_are_still_validated(self):
        original = copy.deepcopy(self.flow)
        self.flow["flowEdges"] = self.flow["flowEdges"][:-1]
        with self.assertRaisesRegex(ValueError, "Missing incoming edge"):
            self.compile()
        self.flow = original
        self.configuration["stepConfigurations"]["prepare1"] = {"parameterValues": []}
        with self.assertRaisesRegex(ValueError, "parameterValues must be an object"):
            self.compile()
        self.configuration["stepConfigurations"].pop("prepare1")
        self.configuration["stepConfigurations"]["unknown"] = {"parameterValues": {}}
        with self.assertRaisesRegex(ValueError, "Unknown step configuration"):
            self.compile()

    def test_only_pnp_program_has_conditional_die_dependency(self):
        self.steps[0]["program"] = "custom/pnp"
        with self.assertRaises(ValueError):
            self.compile()

    def test_zero_pnp_returns_identical_state_without_resolver_or_adaptation(self):
        state = ProcessGeometryState.from_structure(main_geometry())
        before = copy.deepcopy(state.to_geometry_structure())
        cursor, footprint = state.cursor_z(), state.process_footprint()
        resolver = mock.Mock(side_effect=AssertionError("Unexpected geometry resolution"))
        context = ProcessStepContext(state=state, values={"placements": []}, raw_parameter_values={},
                                     step_ref={}, step_template={}, step_configuration={}, geometry_inputs={},
                                     input_geometry=None, geometry_resolver=resolver,
                                     geometry_artifact_resolver=resolver)
        with mock.patch("process_flow_steps.pnp.pnp.adapt_geometry_for_placement") as adapt:
            self.assertIs(execute(context), state)
            adapt.assert_not_called()
        resolver.assert_not_called()
        self.assertEqual(state.to_geometry_structure(), before)
        self.assertEqual(state.cursor_z(), cursor)
        self.assertEqual(state.process_footprint(), footprint)
