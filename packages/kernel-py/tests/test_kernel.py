import copy
import unittest

from process_flow_kernel import (
    Body,
    BoxGeometry,
    Bump,
    Circuit,
    Container,
    ExecuteOptions,
    FlowCompiler,
    GeometryKernel,
    InMemoryGeometryCatalog,
    ProcessGeometryState,
    ProcessStepContext,
    ProcessStepModuleResolver,
    Region,
    TYPE_TARGET,
    Via,
    classify_polygon_loops,
    validate_flow_graph,
)


class GeometryDomainTests(unittest.TestCase):
    def test_container_json_has_schema_unit_and_stable_ids(self):
        root = Container(key="package-root")
        root.add_body_box("mold", [0, 0, 0], [10, 10, 0], 1)
        child = Container(key="die")
        child.add_body_box("silicon", [2, 2, 0.2], [8, 8, 0.2], 0.2)
        root.attach_child(child)

        first = root.json()
        self.assertEqual(first, root.json())
        self.assertEqual(first["schemaVersion"], "1.0.0")
        self.assertEqual(first["unitSystem"], "um")
        self.assertIn("id", first["root"])
        self.assertIn("id", first["root"]["bodies"][0])

    def test_via_and_bump_require_direction_and_flip_with_geometry(self):
        with self.assertRaisesRegex(ValueError, r'Via direction must be "\+z" or "-z"'):
            Via(BoxGeometry([0, 0, 0], [1, 1, 0], 1), 0.5, "Cu", None)
        with self.assertRaisesRegex(ValueError, r'Bump direction must be "\+z" or "-z"'):
            Bump(BoxGeometry([0, 0, 0], [1, 1, 0], 1), 0.5, "SnAg", "z")

        root = Container(key="direction-flip")
        root.add_via(Via(BoxGeometry([0, 0, 0], [1, 1, 0], 2), 0.5, "Cu", "+z"))
        root.add_bump(Bump(BoxGeometry([0, 0, -1], [1, 1, -1], 1), 0.8, "SnAg", "-z"))
        root.flip(0)
        self.assertEqual(root.vias()[0].direction(), "-z")
        self.assertEqual(root.bumps()[0].direction(), "+z")

    def test_density_features_serialize_koz(self):
        root = Container(key="density-koz")
        root.add_via(Via(BoxGeometry([0, 0, 0], [10, 10, 0], 2), 0.5, "Cu", "+z", 3))
        root.add_circuit(Circuit(BoxGeometry([0, 0, 2], [10, 10, 2], 1), 0.4, "Cu", 4))
        root.add_bump(Bump(BoxGeometry([0, 0, 3], [10, 10, 3], 2), 0.8, "SnAg", "+z", 5))
        output = root.json()["root"]
        self.assertEqual(output["vias"][0]["koz"], 3)
        self.assertEqual(output["circuits"][0]["koz"], 4)
        self.assertEqual(output["bumps"][0]["koz"], 5)

    def test_polygon_loop_odd_even_classification(self):
        regions = classify_polygon_loops(
            [
                [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
                [[2, 2, 0], [8, 2, 0], [8, 8, 0], [2, 8, 0]],
                [[3, 3, 0], [4, 3, 0], [4, 4, 0], [3, 4, 0]],
            ]
        )
        self.assertEqual(len(regions), 2)
        self.assertEqual([len(region.holes) for region in regions], [1, 0])

    def test_region_set_gap_converts_die_gaps_to_polygon_outlines(self):
        region = Region(
            [
                {"type": "BOX", "dim": [0, 0, 10, 10]},
                {"type": "BOX", "dim": [14, 0, 24, 10]},
            ]
        )
        self.assertTrue(region.set_gap(4, is_recursive=True))
        self.assertEqual(
            region.get_outline(TYPE_TARGET),
            [[[10, 10], [14, 10], [14, 0], [10, 0]]],
        )

    def test_process_geometry_state_deposit_and_placement_track_cursor(self):
        state = ProcessGeometryState.create()
        state.initialize_box_layer(
            material="base",
            bottom_left=[0, 0, 0],
            top_right=[10, 10, 0],
            thickness=5,
        )
        die = ProcessGeometryState.create({"key": "die"})
        die.initialize_box_layer(
            material="silicon",
            bottom_left=[2, 2, 1],
            top_right=[8, 8, 1],
            thickness=2,
            set_footprint=False,
        )
        state.place_geometry_state(die, x=2, y=2, bottom_z=state.cursor_z(), anchor="bottomLeft")
        output = state.to_geometry_structure()
        self.assertEqual(state.cursor_z(), 5)
        self.assertEqual(
            output["root"]["children"][0]["bodies"][0]["geometry"]["bottom_left"],
            [2, 2, 5],
        )

    def test_underfill_fills_child_bump_cavities_and_root_gap(self):
        state = ProcessGeometryState.create()
        state.initialize_box_layer(
            material="base",
            bottom_left=[0, 0, 0],
            top_right=[24, 10, 0],
            thickness=4,
        )
        for x in (0, 14):
            die = ProcessGeometryState.create({"key": f"die-{x}"})
            die.initialize_box_layer(
                material="Si",
                bottom_left=[0, 0, 0],
                top_right=[10, 10, 0],
                thickness=6,
                set_footprint=False,
            )
            state.place_geometry_state(die, x=x, y=0, bottom_z=4, anchor="bottomLeft")
        state.apply_under_fill(material="UF-A", thk=6, gap=4)
        output = state.to_geometry_structure()
        self.assertEqual(output["root"]["children"][2]["key"], "underfill-gap")


class FlowCompilerTests(unittest.TestCase):
    def test_compiler_resolves_catalog_and_embedded_inputs(self):
        template = pnp_template()
        steps = {item["id"]: item for item in [pnp_step_template()]}
        configuration = pnp_configuration()
        configuration["inputBindings"]["incoming_die"] = {
            "kind": "embedded",
            "localId": "draft_die",
        }
        configuration["embeddedGeometries"] = {
            "draft_die": geometry_entity("draft_die", die_geometry(), include_id=False)
        }

        plan = compiler().compile(template, configuration, steps)

        self.assertEqual(set(plan.external_geometries), {"incoming_main", "incoming_die"})
        self.assertEqual(plan.steps[0].geometry_inputs["die_geometry"].kind, "external")
        self.assertEqual(plan.external_geometries["incoming_die"]["root"]["key"], "die")

    def test_compiler_allows_unbound_optional_flow_input_for_optional_port(self):
        template = pnp_template()
        template["flowInputs"][1]["required"] = False
        step_template = pnp_step_template()
        step_template["inputPorts"][1]["required"] = False
        configuration = pnp_configuration()
        del configuration["inputBindings"]["incoming_die"]

        plan = compiler().compile(
            template,
            configuration,
            {"step_pnp": step_template},
        )

        self.assertEqual(set(plan.external_geometries), {"incoming_main"})
        self.assertNotIn("die_geometry", plan.steps[0].geometry_inputs)

    def test_required_port_makes_optional_flow_input_binding_required(self):
        template = single_step_template()
        template["flowInputs"][0]["required"] = False
        configuration = single_step_configuration()
        del configuration["inputBindings"]["incoming_main"]

        with self.assertRaisesRegex(ValueError, "Missing input binding"):
            compiler().compile(
                template,
                configuration,
                {"step_molding": molding_step_template()},
            )

    def test_validate_flow_graph_rejects_duplicate_target(self):
        template = single_step_template()
        template["flowEdges"].append(copy.deepcopy(template["flowEdges"][0]))
        template["flowEdges"][1]["edgeId"] = "duplicate"
        with self.assertRaisesRegex(ValueError, "Multiple incoming edges"):
            validate_flow_graph(template, {"step_molding": molding_step_template()})

    def test_validate_flow_graph_rejects_duplicate_edge_id(self):
        template = pnp_template()
        template["flowEdges"][1]["edgeId"] = template["flowEdges"][0]["edgeId"]
        with self.assertRaisesRegex(ValueError, "Duplicate flow edge id"):
            validate_flow_graph(template, {"step_pnp": pnp_step_template()})

    def test_validate_flow_graph_rejects_unused_flow_input(self):
        template = single_step_template()
        template["flowInputs"].append(flow_input("unused"))
        with self.assertRaisesRegex(ValueError, "not connected"):
            validate_flow_graph(template, {"step_molding": molding_step_template()})

    def test_validate_flow_graph_rejects_missing_required_port(self):
        template = single_step_template()
        template["flowEdges"] = []
        with self.assertRaisesRegex(ValueError, "Missing incoming edge"):
            validate_flow_graph(template, {"step_molding": molding_step_template()})

    def test_validate_flow_graph_rejects_cycle(self):
        template = ecl_molding_template()
        template["flowEdges"] = [
            edge_from_step("molding", "ecl", "cycle-a"),
            edge_from_step("ecl", "molding", "cycle-b"),
        ]
        with self.assertRaisesRegex(ValueError, "cycle"):
            validate_flow_graph(
                template,
                {
                    "step_ecl": ecl_step_template(),
                    "step_molding": molding_step_template(),
                },
            )

    def test_validate_flow_graph_rejects_output_fanout(self):
        template = ecl_molding_template()
        template["stepRefs"].append(
            {"stepRefId": "molding_2", "processStepTemplateId": "step_molding"}
        )
        template["flowEdges"].append(edge_from_step("ecl", "molding_2", "fanout"))
        with self.assertRaisesRegex(ValueError, "fan-out"):
            validate_flow_graph(
                template,
                {
                    "step_ecl": ecl_step_template(),
                    "step_molding": molding_step_template(),
                },
            )

    def test_validate_flow_graph_rejects_invalid_parameter_regex(self):
        step_template = molding_step_template()
        step_template["parameterDefinitions"][0]["validation"] = {"regex": "["}
        with self.assertRaisesRegex(ValueError, "invalid regex"):
            validate_flow_graph(single_step_template(), {"step_molding": step_template})

    def test_compiler_rejects_unknown_parameter(self):
        configuration = single_step_configuration()
        configuration["stepConfigurations"]["molding"]["parameterValues"]["unknown"] = 1
        with self.assertRaisesRegex(ValueError, "Unknown parameter"):
            compiler().compile(
                single_step_template(),
                configuration,
                {"step_molding": molding_step_template()},
            )

    def test_compiler_rejects_non_finite_numeric_parameter(self):
        configuration = single_step_configuration()
        configuration["stepConfigurations"]["molding"]["parameterValues"][
            "thickness"
        ] = float("nan")
        with self.assertRaisesRegex(ValueError, "must be a number"):
            compiler().compile(
                single_step_template(),
                configuration,
                {"step_molding": molding_step_template()},
            )

    def test_draft_validation_allows_incomplete_repeater_items(self):
        configuration = {
            "inputBindings": {},
            "stepConfigurations": {
                "rdl": {
                    "parameterValues": {
                        "layers": {
                            "items": [
                                {
                                    "itemId": "draft-layer",
                                    "index": 1,
                                    "values": {
                                        "Dielectric": "",
                                        "Conductivity": "",
                                        "thk": "",
                                        "density": "",
                                    },
                                }
                            ]
                        }
                    }
                }
            },
            "embeddedGeometries": {},
        }

        compiler().validate_configuration(
            rdl_template(),
            configuration,
            {"step_rdl": rdl_step_template()},
            require_complete=False,
        )

        with self.assertRaisesRegex(ValueError, "Missing required parameter"):
            compiler().validate_configuration(
                rdl_template(),
                configuration,
                {"step_rdl": rdl_step_template()},
                require_complete=True,
            )

    def test_compiler_limits_preview_plan_to_upstream_steps(self):
        plan = compiler().compile(
            ecl_molding_template(),
            ecl_molding_configuration(),
            {"step_ecl": ecl_step_template(), "step_molding": molding_step_template()},
            output_step_ref_id="ecl",
        )
        self.assertEqual([step.step_ref_id for step in plan.steps], ["ecl"])
        self.assertEqual(plan.terminal_step_ref_ids, ("ecl",))


class KernelExecutionTests(unittest.TestCase):
    def test_kernel_passes_typed_context_without_repository_state(self):
        module = ContextRecordingModule()
        plan = compiler().compile(
            single_step_template(),
            single_step_configuration(),
            {"step_molding": molding_step_template()},
        )
        result = GeometryKernel(module_resolver=FixedModuleResolver(module)).execute(plan)

        self.assertIsInstance(module.context, ProcessStepContext)
        self.assertEqual(module.context.get_param("material"), "EMC-A")
        self.assertEqual(module.context.raw_parameter_values["material"], "EMC-A")
        self.assertEqual(module.context.input_geometry["root"]["key"], "main")
        self.assertEqual(result.geometry()["root"]["bodies"][1]["material"], "EMC-A")

    def test_real_ecl_then_molding_and_non_terminal_selection(self):
        plan = compiler().compile(
            ecl_molding_template(),
            ecl_molding_configuration(),
            {"step_ecl": ecl_step_template(), "step_molding": molding_step_template()},
        )
        kernel = GeometryKernel(module_resolver=ProcessStepModuleResolver())
        result = kernel.execute(plan)
        ecl_result = kernel.execute(plan, ExecuteOptions(output_step_ref_id="ecl"))

        self.assertEqual(
            [body["material"] for body in result.geometry()["root"]["bodies"]],
            ["carrier", "ECL-A", "EMC-A"],
        )
        self.assertEqual(len(ecl_result.geometry()["root"]["bodies"]), 2)

    def test_material_instances_strip_external_suffix_and_allocate_next_name(self):
        configuration = single_step_configuration()
        configuration["stepConfigurations"]["molding"]["parameterValues"]["material"] = "Poly"
        catalog = InMemoryGeometryCatalog(
            [geometry_entity("geom_main", main_geometry(material="Poly_dup7"))]
        )
        plan = FlowCompiler(catalog).compile(
            single_step_template(),
            configuration,
            {"step_molding": molding_step_template()},
        )
        result = GeometryKernel().execute(plan)
        self.assertEqual(
            [body["material"] for body in result.geometry()["root"]["bodies"]],
            ["Poly", "Poly_dup2"],
        )

    def test_real_pnp_receives_auxiliary_geometry_port(self):
        plan = compiler().compile(
            pnp_template(),
            pnp_configuration(),
            {"step_pnp": pnp_step_template()},
        )
        result = GeometryKernel().execute(plan)
        children = result.geometry()["root"]["children"]
        self.assertEqual(len(children), 2)
        self.assertEqual(
            [child["bodies"][0]["geometry"]["bottom_left"] for child in children],
            [[10, 20, 12], [-5, 0, 12]],
        )

    def test_real_rdl_receives_normalized_repeater_values(self):
        plan = compiler().compile(
            rdl_template(),
            rdl_configuration(),
            {"step_rdl": rdl_step_template()},
        )
        geometry = GeometryKernel().execute(plan).geometry()
        self.assertEqual([body["material"] for body in geometry["root"]["bodies"][1:]], ["PI-1", "PI-2"])
        self.assertEqual(len(geometry["root"]["vias"]), 1)
        self.assertEqual(len(geometry["root"]["circuits"]), 1)


class FixedModuleResolver:
    def __init__(self, module):
        self._module = module

    def resolve(self, step_template):
        return self._module


class ContextRecordingModule:
    def __init__(self):
        self.context = None

    def execute(self, context):
        self.context = context
        context.state.deposit_layer(
            material=context.get_param("material"),
            thickness=context.get_param("thickness"),
        )


def compiler():
    return FlowCompiler(
        InMemoryGeometryCatalog(
            [
                geometry_entity("geom_main", main_geometry()),
                geometry_entity("geom_die", die_geometry()),
            ]
        )
    )


def geometry_entity(id_, structure, *, include_id=True):
    result = {
        "category": "test.geometry",
        "entityType": "test",
        "name": id_,
        "version": "v1",
        "owner": "test",
        "description": "test geometry",
        "structureFormat": "standard",
        "structure": structure,
    }
    if include_id:
        result["id"] = id_
    return result


def geometry_input(port_id="main_geometry", *, role="primary"):
    return {
        "portId": port_id,
        "name": port_id,
        "dataType": "geometry",
        "role": role,
        "required": True,
    }


def output_port():
    return {"portId": "result_geometry", "name": "Result geometry", "dataType": "geometry"}


def parameter(id_, value_type):
    return {"id": id_, "name": id_, "valueType": value_type, "required": True}


def molding_step_template():
    return {
        "id": "step_molding",
        "program": "layer/molding",
        "inputPorts": [geometry_input()],
        "outputPorts": [output_port()],
        "parameterDefinitions": [parameter("material", "materialRef"), parameter("thickness", "float")],
    }


def ecl_step_template():
    return {
        "id": "step_ecl",
        "program": "layer/ecl",
        "inputPorts": [geometry_input()],
        "outputPorts": [output_port()],
        "parameterDefinitions": [
            parameter("material", "materialRef"),
            parameter("thk", "float"),
            parameter("koz", "float"),
        ],
    }


def pnp_step_template():
    return {
        "id": "step_pnp",
        "program": "pnp/pnp",
        "inputPorts": [geometry_input(), geometry_input("die_geometry", role="auxiliary")],
        "outputPorts": [output_port()],
        "parameterDefinitions": [parameter("coordinates", "coordinates")],
    }


def rdl_step_template():
    return {
        "id": "step_rdl",
        "program": "layer/rdl",
        "inputPorts": [geometry_input()],
        "outputPorts": [output_port()],
        "parameterDefinitions": [
            {
                "id": "layers",
                "name": "layers",
                "valueType": "fieldGroupArray",
                "required": True,
                "repeatDefinition": {
                    "itemNameTemplate": "Layer {{index}}",
                    "indexBase": 1,
                    "minItems": 1,
                    "itemParameterDefinitions": [
                        parameter("Dielectric", "materialRef"),
                        parameter("Conductivity", "materialRef"),
                        parameter("thk", "float"),
                        parameter("density", "float"),
                    ],
                },
            }
        ],
    }


def flow_input(flow_input_id):
    return {
        "flowInputId": flow_input_id,
        "name": flow_input_id,
        "dataType": "geometry",
        "required": True,
    }


def edge_from_input(flow_input_id, target_step_ref_id, input_port_id="main_geometry", edge_id=None):
    return {
        "edgeId": edge_id or f"edge_{flow_input_id}_{target_step_ref_id}_{input_port_id}",
        "source": {"kind": "flowInput", "flowInputId": flow_input_id},
        "target": {"stepRefId": target_step_ref_id, "inputPortId": input_port_id},
    }


def edge_from_step(source_step_ref_id, target_step_ref_id, edge_id):
    return {
        "edgeId": edge_id,
        "source": {
            "kind": "stepOutput",
            "stepRefId": source_step_ref_id,
            "outputPortId": "result_geometry",
        },
        "target": {"stepRefId": target_step_ref_id, "inputPortId": "main_geometry"},
    }


def single_step_template():
    return {
        "id": "flow_single",
        "flowInputs": [flow_input("incoming_main")],
        "stepRefs": [{"stepRefId": "molding", "processStepTemplateId": "step_molding"}],
        "flowEdges": [edge_from_input("incoming_main", "molding")],
    }


def single_step_configuration():
    return {
        "inputBindings": {"incoming_main": {"kind": "catalog", "geometryId": "geom_main"}},
        "stepConfigurations": {
            "molding": {"parameterValues": {"material": "EMC-A", "thickness": 5}}
        },
        "embeddedGeometries": {},
    }


def ecl_molding_template():
    return {
        "id": "flow_ecl_molding",
        "flowInputs": [flow_input("incoming_main")],
        "stepRefs": [
            {"stepRefId": "ecl", "processStepTemplateId": "step_ecl"},
            {"stepRefId": "molding", "processStepTemplateId": "step_molding"},
        ],
        "flowEdges": [
            edge_from_input("incoming_main", "ecl"),
            edge_from_step("ecl", "molding", "edge_ecl_molding"),
        ],
    }


def ecl_molding_configuration():
    return {
        "inputBindings": {"incoming_main": {"kind": "catalog", "geometryId": "geom_main"}},
        "stepConfigurations": {
            "ecl": {"parameterValues": {"material": "ECL-A", "thk": 4, "koz": 5}},
            "molding": {"parameterValues": {"material": "EMC-A", "thickness": 2}},
        },
        "embeddedGeometries": {},
    }


def pnp_template():
    return {
        "id": "flow_pnp",
        "flowInputs": [flow_input("incoming_main"), flow_input("incoming_die")],
        "stepRefs": [{"stepRefId": "pnp", "processStepTemplateId": "step_pnp"}],
        "flowEdges": [
            edge_from_input("incoming_main", "pnp"),
            edge_from_input("incoming_die", "pnp", "die_geometry"),
        ],
    }


def pnp_configuration():
    return {
        "inputBindings": {
            "incoming_main": {"kind": "catalog", "geometryId": "geom_main"},
            "incoming_die": {"kind": "catalog", "geometryId": "geom_die"},
        },
        "stepConfigurations": {
            "pnp": {"parameterValues": {"coordinates": [[10, 20], [-5, 0]]}}
        },
        "embeddedGeometries": {},
    }


def rdl_template():
    return {
        "id": "flow_rdl",
        "flowInputs": [flow_input("incoming_main")],
        "stepRefs": [{"stepRefId": "rdl", "processStepTemplateId": "step_rdl"}],
        "flowEdges": [edge_from_input("incoming_main", "rdl")],
    }


def rdl_configuration():
    return {
        "inputBindings": {"incoming_main": {"kind": "catalog", "geometryId": "geom_main"}},
        "stepConfigurations": {
            "rdl": {
                "parameterValues": {
                    "layers": {
                        "items": [
                            {
                                "itemId": "layer-1",
                                "index": 1,
                                "values": {
                                    "Dielectric": "PI-1",
                                    "Conductivity": "Cu",
                                    "thk": 2,
                                    "density": 45,
                                },
                            },
                            {
                                "itemId": "layer-2",
                                "index": 2,
                                "values": {
                                    "Dielectric": "PI-2",
                                    "Conductivity": "Cu",
                                    "thk": 3,
                                    "density": 60,
                                },
                            },
                        ]
                    }
                }
            }
        },
        "embeddedGeometries": {},
    }


def main_geometry(material="carrier"):
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "main",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-50, -50, 0],
                        "top_right": [50, 50, 0],
                        "thk": 10,
                    },
                    "material": material,
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def die_geometry():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "die",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, 0, 2],
                        "top_right": [4, 3, 2],
                        "thk": 5,
                    },
                    "material": "Si",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [1, 1, 0],
                        "top_right": [3, 2, 0],
                        "thk": 2,
                    },
                    "material": "SnAg",
                    "density": 0.8,
                    "direction": "-z",
                    "koz": 0,
                }
            ],
            "children": [],
        },
    }


if __name__ == "__main__":
    unittest.main()
