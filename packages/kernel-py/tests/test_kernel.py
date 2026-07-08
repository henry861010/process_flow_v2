import copy
import unittest

from process_flow_kernel import (
    Body,
    BoxGeometry,
    Bump,
    Circuit,
    Container,
    ExecuteOptions,
    GeometryKernel,
    InMemoryRepository,
    ProcessStepContext,
    ProcessGeometryState,
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
        second = root.json()

        self.assertEqual(first["schemaVersion"], "1.0.0")
        self.assertEqual(first["unitSystem"], "um")
        self.assertEqual(first, second)
        self.assertIn("id", first["root"])
        self.assertIn("id", first["root"]["bodies"][0])
        self.assertIn("id", first["root"]["children"][0]["bodies"][0])

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
        self.assertEqual(root.json()["root"]["vias"][0]["direction"], "-z")
        self.assertEqual(root.json()["root"]["bumps"][0]["direction"], "+z")
        self.assertEqual(root.json()["root"]["vias"][0]["koz"], 0)
        self.assertEqual(root.json()["root"]["bumps"][0]["koz"], 0)

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
        self.assertEqual(output["root"]["bodies"][0]["geometry"]["bottom_left"], [0, 0, 0])
        self.assertEqual(output["root"]["children"][0]["bodies"][0]["geometry"]["bottom_left"], [2, 2, 5])

    def test_process_geometry_state_density_features_record_koz_without_insetting_geometry(self):
        state = ProcessGeometryState.create()
        state.initialize_box_layer(
            material="base",
            bottom_left=[-50, -50, 0],
            top_right=[50, 50, 0],
            thickness=10,
        )

        state.add_via_above_cursor(material="Cu", density=50, thickness=2, koz=6)
        state.add_circuit_at_cursor(material="Cu", density=60, thickness=1, koz=7)
        state.add_bump_above_cursor(material="SnAg", density=80, thickness=3, koz=8)
        state.add_via(
            material="Cu",
            density=40,
            direction="+z",
            geometry={"type": "box", "bottomLeft": [0, 0, 20], "topRight": [10, 10, 20], "thickness": 2},
            koz=4,
        )
        state.add_circuit(
            material="Cu",
            density=45,
            geometry={"type": "box", "bottomLeft": [0, 0, 22], "topRight": [10, 10, 22], "thickness": 1},
            koz=5,
        )
        state.add_bump(
            material="SnAg",
            density=70,
            direction="+z",
            geometry={"type": "box", "bottomLeft": [0, 0, 23], "topRight": [10, 10, 23], "thickness": 2},
            koz=9,
        )
        output = state.to_geometry_structure()["root"]

        self.assertEqual(output["vias"][0]["geometry"]["bottom_left"], [-50, -50, 10])
        self.assertEqual(output["vias"][0]["geometry"]["top_right"], [50, 50, 10])
        self.assertEqual(output["vias"][0]["koz"], 6)
        self.assertEqual(output["circuits"][0]["geometry"]["bottom_left"], [-50, -50, 10])
        self.assertEqual(output["circuits"][0]["geometry"]["top_right"], [50, 50, 10])
        self.assertEqual(output["circuits"][0]["koz"], 7)
        self.assertEqual(output["bumps"][0]["geometry"]["bottom_left"], [-50, -50, 10])
        self.assertEqual(output["bumps"][0]["geometry"]["top_right"], [50, 50, 10])
        self.assertEqual(output["bumps"][0]["koz"], 8)
        self.assertEqual(output["vias"][1]["koz"], 4)
        self.assertEqual(output["circuits"][1]["koz"], 5)
        self.assertEqual(output["bumps"][1]["koz"], 9)

        with self.assertRaisesRegex(ValueError, "koz must be non-negative"):
            state.add_bump_above_cursor(material="SnAg", density=80, thickness=3, koz=-1)


class FlowValidationTests(unittest.TestCase):
    def test_validate_flow_graph_accepts_strict_geometry_source_contract(self):
        validate_flow_graph(
            flow_template_molding(),
            flow_instance_molding(),
            {"step_tpl_molding_1_0_0": real_molding_step_template()},
        )

    def test_validate_flow_graph_accepts_duplicate_and_empty_step_labels(self):
        template = flow_template_ecl_to_molding()
        template["stepRefs"][0]["stepLabel"] = "RDL"
        template["stepRefs"][1]["stepLabel"] = "RDL"

        validate_flow_graph(
            template,
            flow_instance_ecl_to_molding(),
            {
                "step_tpl_ecl_1_0_0": real_ecl_step_template(),
                "step_tpl_molding_1_0_0": real_molding_step_template(),
            },
        )

        template["stepRefs"][1]["stepLabel"] = ""
        validate_flow_graph(
            template,
            flow_instance_ecl_to_molding(),
            {
                "step_tpl_ecl_1_0_0": real_ecl_step_template(),
                "step_tpl_molding_1_0_0": real_molding_step_template(),
            },
        )

    def test_validate_flow_graph_rejects_non_string_step_label(self):
        template = flow_template_molding()
        template["stepRefs"][0]["stepLabel"] = 123

        with self.assertRaisesRegex(ValueError, "stepLabel must be a string"):
            validate_flow_graph(
                template,
                flow_instance_molding(),
                {"step_tpl_molding_1_0_0": real_molding_step_template()},
            )

    def test_validate_flow_graph_rejects_step_output_value_string(self):
        template = flow_template_ecl_to_molding()
        instance = flow_instance_ecl_to_molding()
        instance["stepValueSets"][1]["fieldValues"][0]["value"] = "geom_kernel_input"

        with self.assertRaisesRegex(ValueError, "must be null for stepOutput source"):
            validate_flow_graph(
                template,
                instance,
                {
                    "step_tpl_ecl_1_0_0": real_ecl_step_template(),
                    "step_tpl_molding_1_0_0": real_molding_step_template(),
                },
            )

    def test_validate_flow_graph_rejects_fan_out(self):
        template = flow_template_ecl_to_molding()
        template["stepRefs"].append(
            {"stepRefId": "molding_2", "processStepTemplateId": "step_tpl_molding_1_0_0"}
        )
        template["flowEdges"].append(
            {
                "edgeId": "edge_ecl_to_molding_2",
                "source": {"sourceType": "stepOutput", "stepRefId": "ecl"},
                "target": {"stepRefId": "molding_2", "targetFieldId": "main_geometry"},
            }
        )
        instance = flow_instance_ecl_to_molding()
        instance["stepValueSets"].append(
            {
                "stepRefId": "molding_2",
                "processStepTemplateId": "step_tpl_molding_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": None},
                    {"fieldId": "material", "value": "EMC-B"},
                    {"fieldId": "thickness", "value": 3},
                ],
            }
        )

        with self.assertRaisesRegex(ValueError, "fan-out"):
            validate_flow_graph(
                template,
                instance,
                {
                    "step_tpl_ecl_1_0_0": real_ecl_step_template(),
                    "step_tpl_molding_1_0_0": real_molding_step_template(),
                },
            )

    def test_validate_flow_graph_rejects_duplicate_target_edge(self):
        template = flow_template_molding()
        template["flowEdges"].append(
            {
                "edgeId": "edge_input_to_molding_duplicate",
                "source": {"sourceType": "geometryRef"},
                "target": {"stepRefId": "molding", "targetFieldId": "main_geometry"},
            }
        )

        with self.assertRaisesRegex(ValueError, "Multiple incoming geometry edges"):
            validate_flow_graph(
                template,
                flow_instance_molding(),
                {"step_tpl_molding_1_0_0": real_molding_step_template()},
            )

    def test_validate_flow_graph_rejects_geometry_ref_null_value(self):
        instance = flow_instance_molding()
        instance["stepValueSets"][0]["fieldValues"][0]["value"] = None

        with self.assertRaisesRegex(ValueError, "geometry entity id string"):
            validate_flow_graph(
                flow_template_molding(),
                instance,
                {"step_tpl_molding_1_0_0": real_molding_step_template()},
            )

    def test_validate_flow_graph_rejects_missing_incoming_geometry_edge(self):
        template = flow_template_molding()
        template["flowEdges"] = []

        with self.assertRaisesRegex(ValueError, "Missing incoming geometry edge"):
            validate_flow_graph(
                template,
                flow_instance_molding(),
                {"step_tpl_molding_1_0_0": real_molding_step_template()},
            )

    def test_validate_flow_graph_rejects_duplicate_step_value_set(self):
        instance = flow_instance_molding()
        instance["stepValueSets"].append(dict(instance["stepValueSets"][0]))

        with self.assertRaisesRegex(ValueError, "Duplicate StepValueSet"):
            validate_flow_graph(
                flow_template_molding(),
                instance,
                {"step_tpl_molding_1_0_0": real_molding_step_template()},
            )

    def test_validate_flow_graph_rejects_step_output_cycle(self):
        template = flow_template_ecl_to_molding()
        template["flowEdges"] = [
            {
                "edgeId": "edge_molding_to_ecl",
                "source": {"sourceType": "stepOutput", "stepRefId": "molding"},
                "target": {"stepRefId": "ecl", "targetFieldId": "main_geometry"},
            },
            {
                "edgeId": "edge_ecl_to_molding",
                "source": {"sourceType": "stepOutput", "stepRefId": "ecl"},
                "target": {"stepRefId": "molding", "targetFieldId": "main_geometry"},
            },
        ]
        instance = flow_instance_ecl_to_molding()
        instance["stepValueSets"][0]["fieldValues"][0]["value"] = None

        with self.assertRaisesRegex(ValueError, "cycle"):
            validate_flow_graph(
                template,
                instance,
                {
                    "step_tpl_ecl_1_0_0": real_ecl_step_template(),
                    "step_tpl_molding_1_0_0": real_molding_step_template(),
                },
            )


class KernelExecutionTests(unittest.TestCase):
    def test_kernel_passes_typed_process_step_context(self):
        module = ContextRecordingModule()
        kernel = GeometryKernel(
            geometry_repository=InMemoryRepository([geometry_entity("geom_kernel_input", kernel_input_geometry())]),
            process_flow_instance_repository=InMemoryRepository([flow_instance_molding()]),
            process_flow_template_repository=InMemoryRepository([flow_template_molding()]),
            process_step_repository=InMemoryRepository([real_molding_step_template()]),
            module_resolver=FixedModuleResolver(module),
        )

        geometry = kernel.execute("flow_inst_kernel_test").geometry()

        self.assertIsInstance(module.context, ProcessStepContext)
        self.assertEqual(module.context.get_param("material"), "EMC-A")
        self.assertEqual(module.context.input_geometry["root"]["key"], "kernel-input")
        self.assertEqual(geometry["root"]["bodies"][1]["material"], "EMC-A")

    def test_kernel_execute_options_selects_non_terminal_output(self):
        kernel = create_kernel(
            process_step_templates=[real_ecl_step_template(), real_molding_step_template()],
            flow_template=flow_template_ecl_to_molding(),
            flow_instance=flow_instance_ecl_to_molding(),
        )

        geometry = kernel.execute(
            "flow_inst_kernel_test",
            ExecuteOptions(output_step_ref_id="ecl"),
        ).geometry()

        self.assertEqual(len(geometry["root"]["bodies"]), 2)
        self.assertEqual(geometry["root"]["bodies"][1]["material"], "ECL-A")

    def test_kernel_imports_and_executes_real_ecl_then_molding(self):
        kernel = create_kernel(
            process_step_templates=[real_ecl_step_template(), real_molding_step_template()],
            flow_template=flow_template_ecl_to_molding(),
            flow_instance=flow_instance_ecl_to_molding(),
        )

        geometry = kernel.execute("flow_inst_kernel_test").geometry()

        self.assertEqual(len(geometry["root"]["bodies"]), 3)
        self.assertEqual(geometry["root"]["bodies"][1]["material"], "ECL-A")
        self.assertEqual(geometry["root"]["bodies"][1]["geometry"]["bottom_left"], [-45, -45, 10])
        self.assertEqual(geometry["root"]["bodies"][2]["material"], "EMC-A")
        self.assertEqual(geometry["root"]["bodies"][2]["geometry"]["bottom_left"], [-50, -50, 14])

    def test_kernel_material_instances_seed_external_main_and_keep_raw_values(self):
        module = ContextRecordingModule()
        instance = flow_instance_molding()
        instance["stepValueSets"][0]["fieldValues"][1]["value"] = "abc_dup_layer"
        kernel = GeometryKernel(
            geometry_repository=InMemoryRepository(
                [geometry_entity("geom_kernel_input", kernel_input_geometry_with_material("abc_dup_layer_dup7"))]
            ),
            process_flow_instance_repository=InMemoryRepository([instance]),
            process_flow_template_repository=InMemoryRepository([flow_template_molding()]),
            process_step_repository=InMemoryRepository([real_molding_step_template()]),
            module_resolver=FixedModuleResolver(module),
        )

        geometry = kernel.execute("flow_inst_kernel_test").geometry()

        self.assertEqual(module.context.get_param("material"), "abc_dup_layer_dup2")
        self.assertEqual(module.context.raw_field_values[1]["value"], "abc_dup_layer")
        self.assertEqual(module.context.input_geometry["root"]["bodies"][0]["material"], "abc_dup_layer")
        self.assertEqual(
            [body["material"] for body in geometry["root"]["bodies"]],
            ["abc_dup_layer", "abc_dup_layer_dup2"],
        )

    def test_kernel_material_instances_duplicate_across_sequential_steps(self):
        instance = flow_instance_ecl_to_molding()
        instance["stepValueSets"][0]["fieldValues"][1]["value"] = "Poly"
        instance["stepValueSets"][1]["fieldValues"][1]["value"] = "Poly"
        kernel = create_kernel(
            process_step_templates=[real_ecl_step_template(), real_molding_step_template()],
            flow_template=flow_template_ecl_to_molding(),
            flow_instance=instance,
        )

        geometry = kernel.execute("flow_inst_kernel_test").geometry()

        self.assertEqual(
            [body["material"] for body in geometry["root"]["bodies"]],
            ["carrier", "Poly", "Poly_dup2"],
        )

    def test_kernel_preview_initial_geometry_edge(self):
        kernel = create_kernel(
            process_step_templates=[real_ecl_step_template(), real_molding_step_template()],
            flow_template=flow_template_ecl_to_molding(),
            flow_instance=flow_instance_ecl_to_molding(),
        )

        preview = kernel.execute_preview(
            {
                "processFlowTemplate": flow_template_ecl_to_molding(),
                "processFlowInstance": flow_instance_ecl_to_molding(),
                "target": {"type": "edge", "previewEdgeId": "edge_input_to_ecl"},
            }
        )

        self.assertEqual(preview["sourceKind"], "geometryRef")
        self.assertIsNone(preview["outputStepRefId"])
        self.assertEqual(preview["geometryStructure"]["root"]["key"], "kernel-input")

    def test_kernel_preview_step_output_edge_uses_upstream_closure(self):
        instance = flow_instance_ecl_to_molding()
        instance["stepValueSets"][1]["fieldValues"][1]["value"] = ""
        kernel = create_kernel(
            process_step_templates=[real_ecl_step_template(), real_molding_step_template()],
            flow_template=flow_template_ecl_to_molding(),
            flow_instance=instance,
        )

        preview = kernel.execute_preview(
            {
                "processFlowTemplate": flow_template_ecl_to_molding(),
                "processFlowInstance": instance,
                "target": {"type": "edge", "previewEdgeId": "edge_ecl_to_molding"},
            }
        )

        self.assertEqual(preview["sourceKind"], "stepOutput")
        self.assertEqual(preview["outputStepRefId"], "ecl")
        self.assertEqual(len(preview["geometryStructure"]["root"]["bodies"]), 2)
        self.assertEqual(preview["geometryStructure"]["root"]["bodies"][1]["material"], "ECL-A")

    def test_kernel_preview_terminal_step_output(self):
        kernel = create_kernel(
            process_step_templates=[real_ecl_step_template(), real_molding_step_template()],
            flow_template=flow_template_ecl_to_molding(),
            flow_instance=flow_instance_ecl_to_molding(),
        )

        preview = kernel.execute_preview(
            {
                "processFlowTemplate": flow_template_ecl_to_molding(),
                "processFlowInstance": flow_instance_ecl_to_molding(),
                "target": {"type": "stepOutput", "stepRefId": "molding"},
            }
        )

        self.assertEqual(preview["sourceKind"], "stepOutput")
        self.assertEqual(preview["outputStepRefId"], "molding")
        self.assertEqual(preview["geometryStructure"]["root"]["bodies"][2]["material"], "EMC-A")

    def test_kernel_imports_and_executes_real_rdl_step(self):
        kernel = create_kernel(
            process_step_templates=[real_rdl_step_template()],
            flow_template=flow_template_rdl(),
            flow_instance=flow_instance_rdl(),
        )

        geometry = kernel.execute("flow_inst_kernel_test").geometry()

        self.assertEqual(len(geometry["root"]["bodies"]), 4)
        self.assertEqual([body["material"] for body in geometry["root"]["bodies"][1:]], ["PI-1", "PI-2", "PI-3"])
        self.assertEqual(len(geometry["root"]["circuits"]), 1)
        self.assertEqual(geometry["root"]["circuits"][0]["material"], "Cu")
        self.assertEqual(geometry["root"]["circuits"][0]["density"], 60)
        self.assertEqual(geometry["root"]["circuits"][0]["koz"], 0)
        self.assertEqual(len(geometry["root"]["vias"]), 2)
        self.assertEqual([via["direction"] for via in geometry["root"]["vias"]], ["-z", "-z"])
        self.assertEqual([via["koz"] for via in geometry["root"]["vias"]], [0, 0])

    def test_kernel_material_instances_share_repeated_rdl_materials_in_one_step(self):
        instance = flow_instance_rdl()
        layer_items = instance["stepValueSets"][0]["fieldValues"][1]["value"]["items"]
        for item in layer_items:
            for field_value in item["fieldValues"]:
                if field_value["fieldId"] in ("Dielectric", "Conductivity"):
                    field_value["value"] = "Cu"
        kernel = create_kernel(
            process_step_templates=[real_rdl_step_template()],
            flow_template=flow_template_rdl(),
            flow_instance=instance,
        )

        geometry = kernel.execute("flow_inst_kernel_test").geometry()

        self.assertEqual([body["material"] for body in geometry["root"]["bodies"][1:]], ["Cu", "Cu", "Cu"])
        self.assertEqual(geometry["root"]["circuits"][0]["material"], "Cu")
        self.assertEqual([via["material"] for via in geometry["root"]["vias"]], ["Cu", "Cu"])

    def test_kernel_imports_real_pnp_and_passes_cursor_downstream(self):
        kernel = create_kernel(
            geometry_entities=[
                geometry_entity("geom_kernel_input", kernel_input_geometry()),
                geometry_entity("geom_kernel_die", kernel_die_geometry()),
            ],
            process_step_templates=[real_pnp_step_template(), real_molding_step_template()],
            flow_template=flow_template_pnp_to_molding(),
            flow_instance=flow_instance_pnp_to_molding(),
        )

        result = kernel.execute("flow_inst_kernel_test")
        pnp_output = result.step_output("pnp")
        geometry = result.geometry()

        self.assertEqual(len(pnp_output["root"]["children"]), 2)
        self.assertEqual(
            [child["bodies"][0]["geometry"]["bottom_left"] for child in pnp_output["root"]["children"]],
            [[10, 20, 12], [-5, 0, 12]],
        )
        self.assertEqual(geometry["root"]["bodies"][1]["geometry"]["bottom_left"], [-50, -50, 10])
        self.assertEqual(len(geometry["root"]["children"]), 2)

    def test_kernel_material_instances_rename_sub_geometry_for_current_step(self):
        kernel = create_kernel(
            geometry_entities=[
                geometry_entity("geom_kernel_input", kernel_input_geometry_with_material("Si_dup5")),
                geometry_entity("geom_kernel_die", kernel_die_geometry_with_materials("Si_dup9", "SnAg_dup3")),
            ],
            process_step_templates=[real_pnp_step_template(), real_molding_step_template()],
            flow_template=flow_template_pnp_to_molding(),
            flow_instance=flow_instance_pnp_to_molding(),
        )

        result = kernel.execute("flow_inst_kernel_test")
        pnp_output = result.step_output("pnp")

        self.assertEqual(pnp_output["root"]["bodies"][0]["material"], "Si")
        self.assertEqual(
            [child["bodies"][0]["material"] for child in pnp_output["root"]["children"]],
            ["Si_dup2", "Si_dup2"],
        )
        self.assertEqual(
            [child["bumps"][0]["material"] for child in pnp_output["root"]["children"]],
            ["SnAg", "SnAg"],
        )

    def test_kernel_material_instances_do_not_dup_sub_geometry_against_branch_history(self):
        class MakeDieModule:
            def execute(self, context):
                state = ProcessGeometryState.create()
                state.initialize_box_layer(
                    material=context.get_param("material"),
                    bottom_left=[0, 0, 0],
                    top_right=[4, 3, 0],
                    thickness=5,
                )
                return state

        class BranchModuleResolver:
            def __init__(self):
                self._default_resolver = ProcessStepModuleResolver()

            def resolve(self, step_template):
                if step_template["id"] == "step_tpl_make_die":
                    return MakeDieModule()
                return self._default_resolver.resolve(step_template)

        make_die_step_template = {
            "id": "step_tpl_make_die",
            "program": "test/make_die",
            "fieldDefinitions": [
                geometry_field("main_geometry"),
                material_field("material"),
            ],
        }
        flow_template = {
            "id": "flow_tpl_branch_pnp",
            "stepRefs": [
                {"stepRefId": "make_die", "processStepTemplateId": "step_tpl_make_die"},
                {"stepRefId": "pnp", "processStepTemplateId": "step_tpl_pnp_1_0_0"},
            ],
            "flowEdges": [
                {
                    "edgeId": "edge_seed_to_make_die",
                    "source": {"sourceType": "geometryRef"},
                    "target": {"stepRefId": "make_die", "targetFieldId": "main_geometry"},
                },
                {
                    "edgeId": "edge_panel_to_pnp",
                    "source": {"sourceType": "geometryRef"},
                    "target": {"stepRefId": "pnp", "targetFieldId": "main_geometry"},
                },
                {
                    "edgeId": "edge_make_die_to_pnp",
                    "source": {"sourceType": "stepOutput", "stepRefId": "make_die"},
                    "target": {"stepRefId": "pnp", "targetFieldId": "die_geometry"},
                },
            ],
        }
        flow_instance = {
            "id": "flow_inst_branch_pnp",
            "processFlowTemplateId": "flow_tpl_branch_pnp",
            "stepValueSets": [
                {
                    "stepRefId": "make_die",
                    "processStepTemplateId": "step_tpl_make_die",
                    "fieldValues": [
                        {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                        {"fieldId": "material", "value": "HBM"},
                    ],
                },
                {
                    "stepRefId": "pnp",
                    "processStepTemplateId": "step_tpl_pnp_1_0_0",
                    "fieldValues": [
                        {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                        {"fieldId": "die_geometry", "value": None},
                        {"fieldId": "coordinates", "value": [[10, 20]]},
                    ],
                },
            ],
        }
        kernel = GeometryKernel(
            geometry_repository=InMemoryRepository(
                [geometry_entity("geom_kernel_input", kernel_input_geometry_with_material("carrier"))]
            ),
            process_flow_instance_repository=InMemoryRepository([flow_instance]),
            process_flow_template_repository=InMemoryRepository([flow_template]),
            process_step_repository=InMemoryRepository([make_die_step_template, real_pnp_step_template()]),
            module_resolver=BranchModuleResolver(),
        )

        result = kernel.execute("flow_inst_branch_pnp")
        pnp_output = result.step_output("pnp")

        self.assertEqual(result.step_output("make_die")["root"]["bodies"][0]["material"], "HBM")
        self.assertEqual(pnp_output["root"]["bodies"][0]["material"], "carrier")
        self.assertEqual(pnp_output["root"]["children"][0]["bodies"][0]["material"], "HBM")

    def test_kernel_imports_real_saw_and_passes_cropped_footprint_downstream(self):
        kernel = create_kernel(
            process_step_templates=[real_saw_step_template(), real_molding_step_template()],
            flow_template=flow_template_saw_to_molding(),
            flow_instance=flow_instance_saw_to_molding(),
        )

        result = kernel.execute("flow_inst_kernel_test")
        saw_output = result.step_output("saw")
        geometry = result.geometry()

        self.assertEqual(saw_output["root"]["bodies"][0]["geometry"]["bottom_left"], [-20, -10, 0])
        self.assertEqual(saw_output["root"]["bodies"][0]["geometry"]["top_right"], [20, 10, 0])
        self.assertEqual(geometry["root"]["bodies"][1]["geometry"]["bottom_left"], [-20, -10, 10])
        self.assertEqual(geometry["root"]["bodies"][1]["geometry"]["top_right"], [20, 10, 10])

    def test_kernel_imports_real_grinding_and_preserves_footprint_downstream(self):
        kernel = create_kernel(
            process_step_templates=[real_grinding_step_template(), real_molding_step_template()],
            flow_template=flow_template_grinding_to_molding(),
            flow_instance=flow_instance_grinding_to_molding(),
        )

        result = kernel.execute("flow_inst_kernel_test")
        grinding_output = result.step_output("grinding")
        geometry = result.geometry()

        self.assertEqual(grinding_output["root"]["bodies"][0]["geometry"]["thk"], 6)
        self.assertEqual(geometry["root"]["bodies"][1]["material"], "EMC-A")
        self.assertEqual(geometry["root"]["bodies"][1]["geometry"]["bottom_left"], [-50, -50, 6])
        self.assertEqual(geometry["root"]["bodies"][1]["geometry"]["thk"], 2)

    def test_kernel_imports_real_bump_variants(self):
        variants = [
            ("step_tpl_ubump_formation_1_0_0", "Micro Bump", "bump/uBump_formation"),
            ("step_tpl_bga_bump_formation_1_0_0", "BGA Bump", "bump/bga_bump_formation"),
            ("step_tpl_c4_bump_formation_1_0_0", "C4 Bump", "bump/c4_bump_formation"),
        ]
        for template_id, name, program in variants:
            with self.subTest(name=name):
                kernel = create_kernel(
                    process_step_templates=[real_bump_step_template(template_id, name, program)],
                    flow_template=flow_template_bump(template_id),
                    flow_instance=flow_instance_bump(template_id),
                )

                geometry = kernel.execute("flow_inst_kernel_test").geometry()

                self.assertEqual(len(geometry["root"]["bumps"]), 1)
                self.assertEqual(geometry["root"]["bumps"][0]["material"], "SnAg")
                self.assertEqual(geometry["root"]["bumps"][0]["density"], 75)
                self.assertEqual(geometry["root"]["bumps"][0]["direction"], "+z")
                self.assertEqual(geometry["root"]["bumps"][0]["koz"], 5)
                self.assertEqual(geometry["root"]["bumps"][0]["geometry"]["bottom_left"], [-50, -50, 10])
                self.assertEqual(geometry["root"]["bumps"][0]["geometry"]["top_right"], [50, 50, 10])

    def test_carrier_bond_debond_and_flip_state_semantics(self):
        state = ProcessGeometryState.create({"key": "main"})
        state.initialize_box_layer(
            material="base",
            bottom_left=[-20, -20, 0],
            top_right=[20, 20, 0],
            thickness=5,
        )
        die = ProcessGeometryState.create({"key": "die"})
        die.initialize_box_layer(
            material="Si",
            bottom_left=[0, 0, 0],
            top_right=[4, 4, 0],
            thickness=10,
        )
        state.place_geometry_state(die, x=0, y=0, bottom_z=20, anchor="bottomLeft")

        carrier = ProcessGeometryState.create({"key": "carrier"})
        carrier.initialize_box_layer(
            material="carrier-core",
            bottom_left=[-30, -30, -5],
            top_right=[30, 30, -5],
            thickness=2,
            set_footprint=False,
        )
        carrier.deposit_box_layer(
            material="carrier-cap",
            bottom_left=[-30, -30, -3],
            top_right=[30, 30, -3],
            thickness=3,
        )

        state.bond_carrier_geometry(carrier)
        bonded = state.to_geometry_structure()
        self.assertEqual(state.cursor_z(), 35)
        self.assertEqual(
            [body["material"] for body in bonded["root"]["bodies"]],
            ["base", "carrier-core", "carrier-cap"],
        )
        self.assertEqual(bonded["root"]["bodies"][1]["geometry"]["bottom_left"], [-30, -30, 30])
        self.assertEqual(bonded["root"]["bodies"][2]["geometry"]["bottom_left"], [-30, -30, 32])

        state.remove_top_root_bodies()
        debonded = state.to_geometry_structure()
        self.assertEqual(state.cursor_z(), 32)
        self.assertEqual([body["material"] for body in debonded["root"]["bodies"]], ["base", "carrier-core"])

        state.add_via(
            material="Cu",
            density=0.5,
            direction="+z",
            geometry={"type": "box", "bottomLeft": [-20, -20, 32], "topRight": [20, 20, 32], "thickness": 2},
        )
        state.flip_around_z(z=0, normalize_z_min_to_zero=True, update_cursor=False)
        state.set_cursor_z(state.root_body_z_max())
        flipped = state.to_geometry_structure()
        self.assertEqual(flipped["root"]["vias"][0]["direction"], "-z")
        self.assertEqual(flipped["root"]["vias"][0]["koz"], 0)
        self.assertEqual(state.cursor_z(), state.root_body_z_max())

    def test_underfill_fills_child_bump_cavities_and_root_gap(self):
        state = ProcessGeometryState.create({"key": "underfill-root"})
        state.initialize_box_layer(
            material="carrier",
            bottom_left=[0, 0, 0],
            top_right=[40, 20, 0],
            thickness=10,
        )
        die = ProcessGeometryState.create({"key": "die"})
        die.initialize_box_layer(
            material="Si",
            bottom_left=[0, 0, 2],
            top_right=[10, 10, 2],
            thickness=5,
            set_footprint=False,
        )
        die.add_bump(
            material="SnAg",
            density=80,
            direction="-z",
            geometry={
                "type": "box",
                "bottomLeft": [1, 1, 0],
                "topRight": [9, 9, 0],
                "thickness": 2,
            },
        )
        state.place_geometry_states(
            die,
            [
                {"x": 0, "y": 0, "bottom_z": state.cursor_z(), "anchor": "bottomLeft"},
                {"x": 14, "y": 0, "bottom_z": state.cursor_z(), "anchor": "bottomLeft"},
            ],
        )
        cursor_before = state.cursor_z()

        state.apply_under_fill(material="UF-A", thk=6, gap=4)
        output = state.to_geometry_structure()

        self.assertEqual(state.cursor_z(), cursor_before)
        self.assertEqual(output["root"]["children"][2]["key"], "underfill-gap")
        self.assertEqual(output["root"]["children"][2]["bodies"][0]["geometry"]["polys"], [
            [[10, 10, 10], [14, 10, 10], [14, 0, 10], [10, 0, 10]]
        ])


def create_kernel(
    *,
    geometry_entities=None,
    process_step_templates=None,
    flow_template=None,
    flow_instance=None,
):
    flow_template = flow_template or flow_template_molding()
    flow_instance = flow_instance or flow_instance_molding()
    return GeometryKernel(
        geometry_repository=InMemoryRepository(geometry_entities or [geometry_entity("geom_kernel_input", kernel_input_geometry())]),
        process_flow_instance_repository=InMemoryRepository([flow_instance]),
        process_flow_template_repository=InMemoryRepository([flow_template]),
        process_step_repository=InMemoryRepository(process_step_templates or [real_molding_step_template()]),
        module_resolver=ProcessStepModuleResolver(),
    )


class FixedModuleResolver:
    def __init__(self, module):
        self._module = module

    def resolve(self, step_template):
        _ = step_template
        return self._module


class ContextRecordingModule:
    def __init__(self):
        self.context = None

    def execute(self, context):
        if not isinstance(context, ProcessStepContext):
            raise AssertionError("process step context must be ProcessStepContext")
        self.context = context
        context.state.deposit_layer(
            material=context.get_param("material"),
            thickness=context.get_param("thickness"),
        )
        return None


def geometry_entity(id_, structure):
    return {
        "id": id_,
        "category": "test.geometry",
        "entityType": "test",
        "name": id_,
        "version": "v1",
        "owner": "test",
        "description": "test geometry",
        "structureFormat": "standard",
        "structure": structure,
    }


def flow_template_molding():
    return {
        "id": "flow_tpl_kernel_test",
        "stepRefs": [{"stepRefId": "molding", "processStepTemplateId": "step_tpl_molding_1_0_0"}],
        "flowEdges": [
            {
                "edgeId": "edge_input_to_molding",
                "source": {"sourceType": "geometryRef"},
                "target": {"stepRefId": "molding", "targetFieldId": "main_geometry"},
            }
        ],
    }


def flow_instance_molding():
    return {
        "id": "flow_inst_kernel_test",
        "processFlowTemplateId": "flow_tpl_kernel_test",
        "stepValueSets": [
            {
                "stepRefId": "molding",
                "processStepTemplateId": "step_tpl_molding_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                    {"fieldId": "material", "value": "EMC-A"},
                    {"fieldId": "thickness", "value": 5},
                ],
            }
        ],
    }


def flow_template_ecl_to_molding():
    return {
        "id": "flow_tpl_kernel_test",
        "stepRefs": [
            {"stepRefId": "ecl", "processStepTemplateId": "step_tpl_ecl_1_0_0"},
            {"stepRefId": "molding", "processStepTemplateId": "step_tpl_molding_1_0_0"},
        ],
        "flowEdges": [
            {
                "edgeId": "edge_input_to_ecl",
                "source": {"sourceType": "geometryRef"},
                "target": {"stepRefId": "ecl", "targetFieldId": "main_geometry"},
            },
            {
                "edgeId": "edge_ecl_to_molding",
                "source": {"sourceType": "stepOutput", "stepRefId": "ecl"},
                "target": {"stepRefId": "molding", "targetFieldId": "main_geometry"},
            },
        ],
    }


def flow_instance_ecl_to_molding():
    return {
        "id": "flow_inst_kernel_test",
        "processFlowTemplateId": "flow_tpl_kernel_test",
        "stepValueSets": [
            {
                "stepRefId": "ecl",
                "processStepTemplateId": "step_tpl_ecl_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                    {"fieldId": "material", "value": "ECL-A"},
                    {"fieldId": "thk", "value": 4},
                    {"fieldId": "koz", "value": 5},
                ],
            },
            {
                "stepRefId": "molding",
                "processStepTemplateId": "step_tpl_molding_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": None},
                    {"fieldId": "material", "value": "EMC-A"},
                    {"fieldId": "thickness", "value": 2},
                ],
            },
        ],
    }


def flow_template_rdl():
    return {
        "id": "flow_tpl_kernel_test",
        "stepRefs": [{"stepRefId": "rdl", "processStepTemplateId": "step_tpl_rdl_1_0_0"}],
        "flowEdges": [
            {
                "edgeId": "edge_input_to_rdl",
                "source": {"sourceType": "geometryRef"},
                "target": {"stepRefId": "rdl", "targetFieldId": "main_geometry"},
            }
        ],
    }


def flow_instance_rdl():
    return {
        "id": "flow_inst_kernel_test",
        "processFlowTemplateId": "flow_tpl_kernel_test",
        "stepValueSets": [
            {
                "stepRefId": "rdl",
                "processStepTemplateId": "step_tpl_rdl_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                    {
                        "fieldId": "layers",
                        "value": {
                            "items": [
                                {"fieldValues": [
                                    {"fieldId": "Dielectric", "value": "PI-1"},
                                    {"fieldId": "Conductivity", "value": "Cu"},
                                    {"fieldId": "thk", "value": 2},
                                    {"fieldId": "density", "value": 45},
                                ]},
                                {"fieldValues": [
                                    {"fieldId": "Dielectric", "value": "PI-2"},
                                    {"fieldId": "Conductivity", "value": "Cu"},
                                    {"fieldId": "thk", "value": 3},
                                    {"fieldId": "density", "value": 60},
                                ]},
                                {"fieldValues": [
                                    {"fieldId": "Dielectric", "value": "PI-3"},
                                    {"fieldId": "Conductivity", "value": "Cu-Ni"},
                                    {"fieldId": "thk", "value": 4},
                                    {"fieldId": "density", "value": 75},
                                ]},
                            ]
                        },
                    },
                ],
            }
        ],
    }


def flow_template_pnp_to_molding():
    return {
        "id": "flow_tpl_kernel_test",
        "stepRefs": [
            {"stepRefId": "pnp", "processStepTemplateId": "step_tpl_pnp_1_0_0"},
            {"stepRefId": "molding", "processStepTemplateId": "step_tpl_molding_1_0_0"},
        ],
        "flowEdges": [
            {"edgeId": "edge_input_to_pnp", "source": {"sourceType": "geometryRef"}, "target": {"stepRefId": "pnp", "targetFieldId": "main_geometry"}},
            {"edgeId": "edge_die_to_pnp", "source": {"sourceType": "geometryRef"}, "target": {"stepRefId": "pnp", "targetFieldId": "die_geometry"}},
            {"edgeId": "edge_pnp_to_molding", "source": {"sourceType": "stepOutput", "stepRefId": "pnp"}, "target": {"stepRefId": "molding", "targetFieldId": "main_geometry"}},
        ],
    }


def flow_instance_pnp_to_molding():
    return {
        "id": "flow_inst_kernel_test",
        "processFlowTemplateId": "flow_tpl_kernel_test",
        "stepValueSets": [
            {
                "stepRefId": "pnp",
                "processStepTemplateId": "step_tpl_pnp_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                    {"fieldId": "die_geometry", "value": "geom_kernel_die"},
                    {"fieldId": "coordinates", "value": [[10, 20], [-5, 0]]},
                ],
            },
            {
                "stepRefId": "molding",
                "processStepTemplateId": "step_tpl_molding_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": None},
                    {"fieldId": "material", "value": "EMC-A"},
                    {"fieldId": "thickness", "value": 5},
                ],
            },
        ],
    }


def flow_template_saw_to_molding():
    return {
        "id": "flow_tpl_kernel_test",
        "stepRefs": [
            {"stepRefId": "saw", "processStepTemplateId": "step_tpl_saw_1_0_0"},
            {"stepRefId": "molding", "processStepTemplateId": "step_tpl_molding_1_0_0"},
        ],
        "flowEdges": [
            {"edgeId": "edge_input_to_saw", "source": {"sourceType": "geometryRef"}, "target": {"stepRefId": "saw", "targetFieldId": "main_geometry"}},
            {"edgeId": "edge_saw_to_molding", "source": {"sourceType": "stepOutput", "stepRefId": "saw"}, "target": {"stepRefId": "molding", "targetFieldId": "main_geometry"}},
        ],
    }


def flow_instance_saw_to_molding():
    return {
        "id": "flow_inst_kernel_test",
        "processFlowTemplateId": "flow_tpl_kernel_test",
        "stepValueSets": [
            {
                "stepRefId": "saw",
                "processStepTemplateId": "step_tpl_saw_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                    {"fieldId": "bottomLeftX", "value": -20},
                    {"fieldId": "bottomLeftY", "value": -10},
                    {"fieldId": "topRightX", "value": 20},
                    {"fieldId": "topRightY", "value": 10},
                ],
            },
            {
                "stepRefId": "molding",
                "processStepTemplateId": "step_tpl_molding_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": None},
                    {"fieldId": "material", "value": "EMC-A"},
                    {"fieldId": "thickness", "value": 5},
                ],
            },
        ],
    }


def flow_template_grinding_to_molding():
    return {
        "id": "flow_tpl_kernel_test",
        "stepRefs": [
            {"stepRefId": "grinding", "processStepTemplateId": "step_tpl_grinding_1_0_0"},
            {"stepRefId": "molding", "processStepTemplateId": "step_tpl_molding_1_0_0"},
        ],
        "flowEdges": [
            {"edgeId": "edge_input_to_grinding", "source": {"sourceType": "geometryRef"}, "target": {"stepRefId": "grinding", "targetFieldId": "main_geometry"}},
            {"edgeId": "edge_grinding_to_molding", "source": {"sourceType": "stepOutput", "stepRefId": "grinding"}, "target": {"stepRefId": "molding", "targetFieldId": "main_geometry"}},
        ],
    }


def flow_instance_grinding_to_molding():
    return {
        "id": "flow_inst_kernel_test",
        "processFlowTemplateId": "flow_tpl_kernel_test",
        "stepValueSets": [
            {
                "stepRefId": "grinding",
                "processStepTemplateId": "step_tpl_grinding_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                    {"fieldId": "thk", "value": 4},
                ],
            },
            {
                "stepRefId": "molding",
                "processStepTemplateId": "step_tpl_molding_1_0_0",
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": None},
                    {"fieldId": "material", "value": "EMC-A"},
                    {"fieldId": "thickness", "value": 2},
                ],
            },
        ],
    }


def flow_template_bump(template_id):
    return {
        "id": "flow_tpl_kernel_test",
        "stepRefs": [{"stepRefId": "bump", "processStepTemplateId": template_id}],
        "flowEdges": [
            {"edgeId": "edge_input_to_bump", "source": {"sourceType": "geometryRef"}, "target": {"stepRefId": "bump", "targetFieldId": "main_geometry"}}
        ],
    }


def flow_instance_bump(template_id):
    return {
        "id": "flow_inst_kernel_test",
        "processFlowTemplateId": "flow_tpl_kernel_test",
        "stepValueSets": [
            {
                "stepRefId": "bump",
                "processStepTemplateId": template_id,
                "fieldValues": [
                    {"fieldId": "main_geometry", "value": "geom_kernel_input"},
                    {"fieldId": "material", "value": "SnAg"},
                    {"fieldId": "thk", "value": 3},
                    {"fieldId": "density", "value": 75},
                    {"fieldId": "koz", "value": 5},
                ],
            }
        ],
    }


def real_molding_step_template():
    return {
        "id": "step_tpl_molding_1_0_0",
        "program": "layer/molding",
        "fieldDefinitions": [
            geometry_field("main_geometry"),
            material_field("material"),
            float_field("thickness"),
        ],
    }


def real_ecl_step_template():
    return {
        "id": "step_tpl_ecl_1_0_0",
        "program": "layer/ecl",
        "fieldDefinitions": [
            geometry_field("main_geometry"),
            material_field("material"),
            float_field("thk"),
            float_field("koz"),
        ],
    }


def real_rdl_step_template():
    return {
        "id": "step_tpl_rdl_1_0_0",
        "program": "layer/rdl",
        "fieldDefinitions": [
            geometry_field("main_geometry"),
            {
                "id": "layers",
                "valueType": "fieldGroupArray",
                "repeatDefinition": {
                    "itemFieldDefinitions": [
                        material_field("Dielectric"),
                        material_field("Conductivity"),
                        float_field("thk"),
                        float_field("density"),
                    ]
                },
            },
        ],
    }


def real_pnp_step_template():
    return {
        "id": "step_tpl_pnp_1_0_0",
        "program": "pnp/pnp",
        "fieldDefinitions": [
            geometry_field("main_geometry"),
            geometry_field("die_geometry"),
            {"id": "coordinates", "valueType": "coordinates"},
        ],
    }


def real_saw_step_template():
    return {
        "id": "step_tpl_saw_1_0_0",
        "program": "saw/saw",
        "fieldDefinitions": [
            geometry_field("main_geometry"),
            float_field("bottomLeftX"),
            float_field("bottomLeftY"),
            float_field("topRightX"),
            float_field("topRightY"),
        ],
    }


def real_grinding_step_template():
    return {
        "id": "step_tpl_grinding_1_0_0",
        "program": "grinding/grinding",
        "fieldDefinitions": [
            geometry_field("main_geometry"),
            float_field("thk"),
        ],
    }


def real_bump_step_template(template_id, name, program):
    _ = name
    return {
        "id": template_id,
        "program": program,
        "fieldDefinitions": [
            geometry_field("main_geometry"),
            material_field("material"),
            float_field("thk"),
            float_field("density"),
            float_field("koz"),
        ],
    }


def geometry_field(id_):
    return {"id": id_, "valueType": "geometryRef"}


def material_field(id_):
    return {"id": id_, "valueType": "materialRef"}


def float_field(id_):
    return {"id": id_, "valueType": "float"}


def kernel_input_geometry():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "kernel-input",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-50, -50, 0],
                        "top_right": [50, 50, 0],
                        "thk": 10,
                    },
                    "material": "carrier",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def kernel_input_geometry_with_material(material):
    geometry = copy.deepcopy(kernel_input_geometry())
    geometry["root"]["bodies"][0]["material"] = material
    return geometry


def kernel_die_geometry():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "kernel-die",
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


def kernel_die_geometry_with_materials(body_material, bump_material):
    geometry = copy.deepcopy(kernel_die_geometry())
    geometry["root"]["bodies"][0]["material"] = body_material
    geometry["root"]["bumps"][0]["material"] = bump_material
    return geometry


if __name__ == "__main__":
    unittest.main()
