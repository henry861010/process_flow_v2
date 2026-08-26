import copy
import unittest

from process_flow_kernel import (
    Body,
    BoxGeometry,
    Bump,
    Circuit,
    Container,
    CylinderGeometry,
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
    normalize_geometry_structure,
    stable_id,
    validate_flow_graph,
)
from process_flow_steps.tiv.tiv import execute as execute_tiv


class GeometryDomainTests(unittest.TestCase):
    def test_cylinder_xy_clip_returns_exact_supported_geometry(self):
        crop_inside_circle = {"xMin": -3, "xMax": 3, "yMin": -4, "yMax": 4}
        clipped = CylinderGeometry([0, 0, 3], 5, 4).clip_xy_to_box(crop_inside_circle)

        self.assertIsInstance(clipped, BoxGeometry)
        self.assertEqual(
            clipped.json(),
            {
                "type": "BoxGeometry",
                "bottom_left": [-3, -4, 3],
                "top_right": [3, 4, 3],
                "thk": 4,
            },
        )

        cylinder = CylinderGeometry([0, 0, 3], 10, 4)
        retained = cylinder.clip_xy_to_box(
            {"xMin": -10, "xMax": 10, "yMin": -10, "yMax": 10}
        )
        self.assertIs(retained, cylinder)
        self.assertEqual(retained.json()["type"], "CylinderGeometry")

        self.assertIsNone(
            CylinderGeometry([0, 0, 3], 10, 4).clip_xy_to_box(
                {"xMin": 10, "xMax": 12, "yMin": -1, "yMax": 1}
            )
        )

        with self.assertRaisesRegex(ValueError, "partial XY saw clipping"):
            CylinderGeometry([0, 0, 3], 10, 4).clip_xy_to_box(
                {"xMin": 0, "xMax": 12, "yMin": -1, "yMax": 1}
            )

    def test_container_saw_replaces_cylinder_features_and_preserves_metadata(self):
        root = Container(key="carrier.wafer")
        root.add_body(Body(CylinderGeometry([0, 0, 0], 10, 1), "Si", "carrier"))
        root.add_via(Via(CylinderGeometry([0, 0, 1], 10, 1), 0.5, "Cu", "+z", 2))
        root.add_circuit(Circuit(CylinderGeometry([0, 0, 2], 10, 1), 0.4, "Cu", 3))
        root.add_bump(Bump(CylinderGeometry([0, 0, 3], 10, 1), 0.8, "SnAg", "-z", 4))
        child = Container(key="soc")
        child.add_body(Body(CylinderGeometry([0, 0, 4], 10, 1), "Si", "envelope"))
        root.attach_child(child)

        self.assertTrue(
            root.clip_xy_to_box({"xMin": -6, "xMax": 6, "yMin": -6, "yMax": 6})
        )
        output = root.tree_json()

        for collection in ("bodies", "vias", "circuits", "bumps"):
            self.assertEqual(output[collection][0]["geometry"]["type"], "BoxGeometry")
        self.assertEqual(output["bodies"][0]["key"], "carrier")
        self.assertEqual(output["bodies"][0]["material"], "Si")
        self.assertEqual(output["vias"][0]["density"], 0.5)
        self.assertEqual(output["vias"][0]["direction"], "+z")
        self.assertEqual(output["vias"][0]["koz"], 2)
        self.assertEqual(output["circuits"][0]["density"], 0.4)
        self.assertEqual(output["circuits"][0]["koz"], 3)
        self.assertEqual(output["bumps"][0]["density"], 0.8)
        self.assertEqual(output["bumps"][0]["direction"], "-z")
        self.assertEqual(output["bumps"][0]["koz"], 4)
        self.assertEqual(output["children"][0]["key"], "soc")
        self.assertEqual(
            output["children"][0]["bodies"][0]["geometry"],
            {
                "type": "BoxGeometry",
                "bottom_left": [-6, -6, 4],
                "top_right": [6, 6, 4],
                "thk": 1,
            },
        )
        self.assertEqual(output["children"][0]["bodies"][0]["key"], "envelope")

    def test_saw_to_box_converts_cylinder_and_updates_process_footprint(self):
        state = ProcessGeometryState.create()
        state.initialize_cylinder_layer(
            material="Si",
            center=[0, 0, 2],
            radius=10,
            thickness=5,
            key="envelope",
        )

        state.saw_to_box(
            bottom_left_x=-6,
            bottom_left_y=-6,
            top_right_x=6,
            top_right_y=6,
        )

        self.assertEqual(
            state.process_footprint(),
            {
                "type": "box",
                "bottomLeft": [-6.0, -6.0],
                "topRight": [6.0, 6.0],
            },
        )
        self.assertEqual(state.cursor_z(), 7)
        self.assertEqual(
            state.to_geometry_structure()["root"]["bodies"][0]["geometry"],
            {
                "type": "BoxGeometry",
                "bottom_left": [-6.0, -6.0, 2.0],
                "top_right": [6.0, 6.0, 2.0],
                "thk": 5.0,
            },
        )

    def test_container_json_has_schema_unit_and_stable_ids(self):
        root = Container(key="hbm")
        root.add_body_box("mold", [0, 0, 0], [10, 10, 0], 1)
        child = Container(key="dram")
        child.add_body_box("silicon", [2, 2, 0.2], [8, 8, 0.2], 0.2)
        root.attach_child(child)

        first = root.json()
        self.assertEqual(first, root.json())
        self.assertEqual(first["schemaVersion"], "1.0.0")
        self.assertEqual(first["unitSystem"], "um")
        self.assertIn("id", first["root"])
        self.assertIn("id", first["root"]["bodies"][0])

    def test_optional_body_key_round_trips_and_affects_derived_id(self):
        unkeyed_body = {
            "geometry": {
                "type": "BoxGeometry",
                "bottom_left": [0, 0, 0],
                "top_right": [10, 10, 0],
                "thk": 1,
            },
            "material": "mold",
        }
        unkeyed = {
            "key": "hbm",
            "bodies": [unkeyed_body],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        }
        expected_unkeyed_id = stable_id(
            "body",
            ["root", "container:hbm", "body:0"],
            unkeyed_body,
        )

        normalized_unkeyed = normalize_geometry_structure(unkeyed)
        normalized_body = normalized_unkeyed["root"]["bodies"][0]
        self.assertNotIn("key", normalized_body)
        self.assertEqual(normalized_body["id"], expected_unkeyed_id)

        keyed = copy.deepcopy(unkeyed)
        keyed["bodies"][0]["key"] = "molding"
        normalized_keyed = normalize_geometry_structure(keyed)
        self.assertNotEqual(
            normalized_keyed["root"]["bodies"][0]["id"],
            expected_unkeyed_id,
        )

        restored = ProcessGeometryState.from_structure(normalized_keyed)
        restored_body = restored.to_geometry_structure()["root"]["bodies"][0]
        self.assertEqual(restored_body["key"], "molding")

        body = Body(BoxGeometry([0, 0, 0], [1, 1, 0], 1), "Si", "envelope")
        self.assertEqual(body.copy().key(), "envelope")
        self.assertEqual(body.copy_with_thk(0.5).key(), "envelope")
        body.move(z=2)
        body.flip(0)
        self.assertEqual(body.key(), "envelope")

    def test_semantic_keys_are_optional_but_empty_unknown_and_null_are_invalid(self):
        body = Body(BoxGeometry([0, 0, 0], [1, 1, 0], 1), "Si")
        self.assertIsNone(body.key())
        self.assertNotIn("key", body.json())
        self.assertNotIn("key", Container().tree_json())

        with self.assertRaisesRegex(ValueError, "body.key must be omitted"):
            Body(BoxGeometry([0, 0, 0], [1, 1, 0], 1), "Si", "")
        with self.assertRaisesRegex(ValueError, "Unsupported body.key"):
            Body(BoxGeometry([0, 0, 0], [1, 1, 0], 1), "Si", "die")
        with self.assertRaisesRegex(ValueError, "Unsupported container.key"):
            Container(key="root")
        with self.assertRaisesRegex(ValueError, "via.key is not supported"):
            normalize_geometry_structure({"vias": [{"key": "carrier"}]})
        with self.assertRaisesRegex(ValueError, "body.key must be omitted instead of null"):
            normalize_geometry_structure(
                {
                    "bodies": [
                        {
                            "key": None,
                            "geometry": {
                                "type": "BoxGeometry",
                                "bottom_left": [0, 0, 0],
                                "top_right": [1, 1, 0],
                                "thk": 1,
                            },
                            "material": "Si",
                        }
                    ],
                }
            )

    def test_via_and_bump_require_direction_and_flip_with_geometry(self):
        with self.assertRaisesRegex(ValueError, r'Via direction must be "\+z" or "-z"'):
            Via(BoxGeometry([0, 0, 0], [1, 1, 0], 1), 0.5, "Cu", None)
        with self.assertRaisesRegex(ValueError, r'Bump direction must be "\+z" or "-z"'):
            Bump(BoxGeometry([0, 0, 0], [1, 1, 0], 1), 0.5, "SnAg", "z")

        root = Container()
        root.add_via(Via(BoxGeometry([0, 0, 0], [1, 1, 0], 2), 0.5, "Cu", "+z"))
        root.add_bump(Bump(BoxGeometry([0, 0, -1], [1, 1, -1], 1), 0.8, "SnAg", "-z"))
        root.flip(0)
        self.assertEqual(root.vias()[0].direction(), "-z")
        self.assertEqual(root.bumps()[0].direction(), "+z")

    def test_density_features_serialize_koz(self):
        root = Container()
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
        die = ProcessGeometryState.create({"key": "dram"})
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

    def test_find_scopes_supports_explicit_container_key_family_matching(self):
        state = ProcessGeometryState.create({"key": "carrier.panel"})
        carrier = ProcessGeometryState.create({"key": "carrier"})
        dram = ProcessGeometryState.create({"key": "dram"})
        for source in (carrier, dram):
            source.initialize_box_layer(
                material="test",
                bottom_left=[0, 0, 0],
                top_right=[1, 1, 0],
                thickness=1,
                set_footprint=False,
            )
        state.place_geometry_state(carrier, x=0, y=0)
        state.place_geometry_state(dram, x=0, y=0)

        self.assertEqual(
            [
                state.scope_summary(scope)["key"]
                for scope in state.find_scopes(key="carrier")
            ],
            ["carrier"],
        )
        self.assertEqual(
            [
                state.scope_summary(scope)["key"]
                for scope in state.find_scopes(key="carrier", match="family")
            ],
            ["carrier.panel", "carrier"],
        )
        with self.assertRaisesRegex(ValueError, "Unsupported container.key"):
            state.find_scopes(key="carrier-panel", match="family")
        with self.assertRaisesRegex(ValueError, 'match must be "exact" or "family"'):
            state.find_scopes(key="carrier", match="prefix")

    def test_underfill_fills_child_bump_cavities_and_root_gap(self):
        state = ProcessGeometryState.create()
        state.initialize_box_layer(
            material="base",
            bottom_left=[0, 0, 0],
            top_right=[24, 10, 0],
            thickness=4,
        )
        for x in (0, 14):
            die = ProcessGeometryState.create({"key": "dram"})
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
        self.assertNotIn("key", output["root"]["children"][2])
        self.assertNotIn("key", output["root"]["children"][2]["bodies"][0])

    def test_debond_removes_valid_top_carrier_stack_atomically(self):
        state = bonded_state(carrier_body_count=2)
        before = state.to_geometry_structure()
        self.assertEqual(
            [body["key"] for body in before["root"]["bodies"]],
            ["molding", "daf", "carrier", "carrier"],
        )

        result = state.remove_bonded_carrier_stack()

        self.assertEqual(
            result,
            {
                "removedCount": 3,
                "removedDafCount": 1,
                "removedCarrierCount": 2,
            },
        )
        self.assertEqual(
            [body["key"] for body in state.to_geometry_structure()["root"]["bodies"]],
            ["molding"],
        )
        self.assertEqual(state.cursor_z(), 10)

    def test_debond_rejects_missing_or_ambiguous_semantic_bodies_atomically(self):
        cases = {}

        missing_daf = process_state_with_derived_footprint(main_geometry())
        missing_daf.deposit_layer(material="glass", thickness=20, key="carrier")
        cases["exactly one DAF"] = missing_daf

        missing_carrier = process_state_with_derived_footprint(main_geometry())
        missing_carrier.deposit_layer(material="DAF", thickness=3, key="daf")
        cases["at least one carrier"] = missing_carrier

        duplicate_daf = bonded_state()
        duplicate_daf.deposit_geometry(
            material="DAF-duplicate",
            geometry={
                "type": "box",
                "bottomLeft": [-50, -50, 10],
                "topRight": [50, 50, 10],
                "thickness": 1,
            },
            key="daf",
        )
        cases["exactly one DAF duplicate"] = duplicate_daf

        target_in_child = process_state_with_derived_footprint(main_geometry())
        child = ProcessGeometryState.create()
        child.initialize_box_layer(
            material="DAF",
            bottom_left=[0, 0, 0],
            top_right=[1, 1, 0],
            thickness=1,
            key="daf",
        )
        target_in_child.place_geometry_state(child, x=0, y=0, bottom_z=10)
        cases["direct root bodies"] = target_in_child

        for label, invalid_state in cases.items():
            with self.subTest(label=label):
                before = invalid_state.to_geometry_structure()
                cursor_before = invalid_state.cursor_z()
                with self.assertRaisesRegex(ValueError, "Invalid debond process flow"):
                    invalid_state.remove_bonded_carrier_stack()
                self.assertEqual(invalid_state.to_geometry_structure(), before)
                self.assertEqual(invalid_state.cursor_z(), cursor_before)

    def test_debond_rejects_noncontiguous_or_covered_stack_atomically(self):
        noncontiguous = process_state_with_derived_footprint(main_geometry())
        noncontiguous.deposit_layer(material="DAF", thickness=3, key="daf")
        noncontiguous.deposit_geometry(
            material="glass",
            geometry={
                "type": "box",
                "bottomLeft": [-60, -60, 14],
                "topRight": [60, 60, 14],
                "thickness": 20,
            },
            key="carrier",
        )

        covered_by_body = bonded_state()
        covered_by_body.deposit_layer(material="late molding", thickness=2, key="molding")

        covered_by_feature = bonded_state()
        covered_by_feature.add_bump_above_cursor(
            material="SnAg",
            density=50,
            thickness=2,
        )

        covered_by_child = bonded_state()
        child = ProcessGeometryState.create()
        child.initialize_box_layer(
            material="Si",
            bottom_left=[0, 0, 0],
            top_right=[2, 2, 0],
            thickness=2,
        )
        covered_by_child.place_geometry_state(
            child,
            x=0,
            y=0,
            bottom_z=covered_by_child.cursor_z(),
        )

        for label, invalid_state in {
            "noncontiguous": noncontiguous,
            "body above": covered_by_body,
            "feature above": covered_by_feature,
            "child above": covered_by_child,
        }.items():
            with self.subTest(label=label):
                before = invalid_state.to_geometry_structure()
                cursor_before = invalid_state.cursor_z()
                with self.assertRaisesRegex(ValueError, "Invalid debond process flow"):
                    invalid_state.remove_bonded_carrier_stack()
                self.assertEqual(invalid_state.to_geometry_structure(), before)
                self.assertEqual(invalid_state.cursor_z(), cursor_before)


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
        self.assertEqual(plan.external_geometries["incoming_die"]["root"]["key"], "hbm")

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

    def test_compiler_normalizes_coordinate_rectangles_and_rejects_near_duplicates(self):
        configuration = pnp_configuration()
        configuration["stepConfigurations"]["pnp"]["parameterValues"]["coordinates"] = [
            [[0, 0], [10, 12]],
            [[0.0000005, 0], [10, 12]],
        ]

        with self.assertRaisesRegex(ValueError, "duplicate coordinates"):
            compiler().compile(
                pnp_template(),
                configuration,
                {"step_pnp": pnp_step_template()},
            )

    def test_compiler_rejects_coordinate_rectangle_without_positive_area(self):
        configuration = pnp_configuration()
        configuration["stepConfigurations"]["pnp"]["parameterValues"]["coordinates"] = [
            [[0, 0], [0, 12]],
        ]

        with self.assertRaisesRegex(ValueError, "top-right greater than bottom-left"):
            compiler().compile(
                pnp_template(),
                configuration,
                {"step_pnp": pnp_step_template()},
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
        self.assertEqual(module.context.input_geometry["root"]["key"], "carrier.panel")
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
        self.assertEqual(
            [body.get("key") for body in result.geometry()["root"]["bodies"]],
            [None, None, "molding"],
        )
        self.assertEqual(len(ecl_result.geometry()["root"]["bodies"]), 2)

    def test_tiv_accepts_density_boundaries_and_round_trips_via_payload(self):
        for density in (0, 100):
            with self.subTest(density=density):
                state = process_state_with_derived_footprint(main_geometry())
                cursor_before = state.cursor_z()
                footprint_before = state.process_footprint()

                execute_tiv_with_values(
                    state,
                    {"thk": 4, "material": "Cu", "density": density},
                )

                self.assertEqual(state.cursor_z(), cursor_before)
                self.assertEqual(state.process_footprint(), footprint_before)
                via = state.to_geometry_structure()["root"]["vias"][0]
                self.assertEqual(via["geometry"]["bottom_left"], [-50.0, -50.0, 10.0])
                self.assertEqual(via["geometry"]["top_right"], [50.0, 50.0, 10.0])
                self.assertEqual(via["geometry"]["thk"], 4.0)
                self.assertEqual(via["material"], "Cu")
                self.assertEqual(via["density"], density)
                self.assertEqual(via["direction"], "+z")
                self.assertEqual(via["koz"], 0.0)

                restored = ProcessGeometryState.from_structure(
                    state.to_geometry_structure(),
                    {"footprint": {"derive": "largestRootBody"}},
                )
                self.assertEqual(
                    restored.to_geometry_structure()["root"]["vias"][0],
                    via,
                )

    def test_tiv_rejects_invalid_parameters_and_missing_footprint(self):
        invalid_cases = [
            (
                {"thk": 0, "material": "Cu", "density": 50},
                "tiv.thk must be a positive number",
            ),
            (
                {"thk": -1, "material": "Cu", "density": 50},
                "tiv.thk must be a positive number",
            ),
            (
                {"thk": 4, "material": "", "density": 50},
                "tiv.material must be a non-empty string",
            ),
            (
                {"thk": 4, "material": "Cu", "density": -1},
                "tiv.density must be a finite number from 0 to 100",
            ),
            (
                {"thk": 4, "material": "Cu", "density": 101},
                "tiv.density must be a finite number from 0 to 100",
            ),
            (
                {"thk": 4, "material": "Cu", "density": "invalid"},
                "tiv.density must be a finite number",
            ),
        ]

        for values, message in invalid_cases:
            with self.subTest(values=values):
                state = process_state_with_derived_footprint(main_geometry())
                before = state.to_geometry_structure()
                with self.assertRaisesRegex(ValueError, message):
                    execute_tiv_with_values(state, values)
                self.assertEqual(state.to_geometry_structure(), before)

        with self.assertRaisesRegex(ValueError, "process footprint is required"):
            execute_tiv_with_values(
                ProcessGeometryState.create(),
                {"thk": 4, "material": "Cu", "density": 50},
            )

    def test_real_tiv_then_molding_keeps_cursor_at_original_surface(self):
        plan = compiler().compile(
            tiv_molding_template(),
            tiv_molding_configuration(),
            {
                "step_tiv": tiv_step_template(),
                "step_molding": molding_step_template(),
            },
        )

        result = GeometryKernel(
            module_resolver=ProcessStepModuleResolver()
        ).execute(plan)
        root = result.geometry()["root"]
        tiv_output = result.step_output("tiv")["root"]["vias"][0]

        self.assertEqual(tiv_output["geometry"]["bottom_left"][2], 10)
        self.assertEqual(tiv_output["geometry"]["thk"], 4)
        self.assertEqual(tiv_output["material"], "Cu")
        self.assertEqual(tiv_output["density"], 60)
        self.assertEqual(tiv_output["direction"], "+z")
        self.assertEqual(tiv_output["koz"], 0)
        self.assertEqual(root["bodies"][1]["geometry"]["bottom_left"][2], 10)
        self.assertEqual(root["bodies"][1]["geometry"]["thk"], 2)

    def test_real_carrier_bond_adds_daf_before_carrier(self):
        catalog = InMemoryGeometryCatalog(
            [
                geometry_entity("geom_main", main_geometry(material="substrate")),
                geometry_entity("geom_carrier", carrier_geometry()),
            ]
        )
        plan = FlowCompiler(catalog).compile(
            carrier_bond_template(),
            carrier_bond_configuration(),
            {"step_carrier_bond": carrier_bond_step_template()},
        )

        bodies = GeometryKernel().execute(plan).geometry()["root"]["bodies"]

        self.assertEqual(
            [body["material"] for body in bodies],
            ["substrate", "DAF-A", "glass"],
        )
        self.assertEqual([body.get("key") for body in bodies], [None, "daf", "carrier"])
        self.assertEqual(bodies[1]["geometry"]["bottom_left"][2], 10)
        self.assertEqual(bodies[1]["geometry"]["thk"], 3)
        self.assertEqual(bodies[2]["geometry"]["bottom_left"][2], 13)
        self.assertEqual(bodies[2]["geometry"]["thk"], 20)

    def test_real_carrier_bond_then_debond_restores_main_geometry(self):
        catalog = InMemoryGeometryCatalog(
            [
                geometry_entity("geom_main", main_geometry(material="substrate")),
                geometry_entity("geom_carrier", carrier_geometry()),
            ]
        )
        plan = FlowCompiler(catalog).compile(
            carrier_bond_debond_template(),
            carrier_bond_debond_configuration(),
            {
                "step_carrier_bond": carrier_bond_step_template(),
                "step_debond": debond_step_template(),
            },
        )

        result = GeometryKernel().execute(plan)

        self.assertEqual(
            [body.get("key") for body in result.step_output("carrier_bond")["root"]["bodies"]],
            [None, "daf", "carrier"],
        )
        self.assertEqual(
            [body["material"] for body in result.geometry()["root"]["bodies"]],
            ["substrate"],
        )

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
        self.assertEqual(
            [child["bodies"][0]["geometry"]["top_right"] for child in children],
            [[16, 25, 12], [-2, 2.5, 12]],
        )
        self.assertEqual(
            [child["bumps"][0]["geometry"]["bottom_left"] for child in children],
            [[11, 21, 10], [-4, 1, 10]],
        )
        self.assertEqual(
            [child["bumps"][0]["geometry"]["top_right"] for child in children],
            [[15, 24, 10], [-3, 1.5, 10]],
        )
        self.assertEqual(
            [child["bodies"][0].get("key") for child in children],
            [None, None],
        )

    def test_real_pnp_rejects_resize_that_collapses_any_box_without_attaching_child(self):
        state = ProcessGeometryState.from_structure(main_geometry())
        die = ProcessGeometryState.from_structure(die_geometry())
        original_die = die.to_geometry_structure()

        with self.assertRaisesRegex(ValueError, "collapses the footprint"):
            state.place_geometry_state(
                die,
                x=0,
                y=0,
                top_right_x=1,
                top_right_y=1,
                bottom_z=state.cursor_z(),
            )

        self.assertEqual(state.to_geometry_structure()["root"]["children"], [])
        self.assertEqual(die.to_geometry_structure(), original_die)

    def test_real_pnp_rejects_non_box_primitive(self):
        die_payload = die_geometry()
        die_payload["root"]["bodies"][0]["geometry"] = {
            "type": "CylinderGeometry",
            "center": [2, 1.5, 2],
            "bottom_radius": 1,
            "thk": 5,
        }
        state = ProcessGeometryState.from_structure(main_geometry())
        die = ProcessGeometryState.from_structure(die_payload)

        with self.assertRaisesRegex(ValueError, "supports only BoxGeometry"):
            state.place_geometry_state(
                die,
                x=0,
                y=0,
                top_right_x=4,
                top_right_y=3,
                bottom_z=state.cursor_z(),
            )

        self.assertEqual(state.to_geometry_structure()["root"]["children"], [])

    def test_real_rdl_receives_normalized_repeater_values(self):
        plan = compiler().compile(
            rdl_template(),
            rdl_configuration(),
            {"step_rdl": rdl_step_template()},
        )
        geometry = GeometryKernel().execute(plan).geometry()
        self.assertEqual([body["material"] for body in geometry["root"]["bodies"][1:]], ["PI-1", "PI-2"])
        self.assertEqual([body.get("key") for body in geometry["root"]["bodies"][1:]], [None, None])
        self.assertEqual(len(geometry["root"]["vias"]), 1)
        self.assertEqual(len(geometry["root"]["circuits"]), 1)

    def test_real_flip_then_bump_uses_root_direct_sbt_surface(self):
        plan = FlowCompiler(
            InMemoryGeometryCatalog(
                [geometry_entity("geom_dram", dram_geometry())]
            )
        ).compile(
            flip_bump_template(),
            flip_bump_configuration(),
            {
                "step_flip": flip_step_template(),
                "step_bga_bump": bga_bump_step_template(),
            },
        )

        result = GeometryKernel().execute(plan)
        flipped_root = result.step_output("flip")["root"]
        output_root = result.geometry()["root"]

        molding_top = (
            flipped_root["bodies"][0]["geometry"]["bottom_left"][2]
            + flipped_root["bodies"][0]["geometry"]["thk"]
        )
        self.assertEqual(molding_top, 200)
        self.assertEqual(
            max(
                body["geometry"]["bottom_left"][2] + body["geometry"]["thk"]
                for body in flipped_root["bodies"]
            ),
            300,
        )
        self.assertEqual(output_root["bumps"][0]["geometry"]["bottom_left"][2], 300)
        self.assertEqual(output_root["bumps"][0]["geometry"]["thk"], 25)


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


def flip_step_template():
    return {
        "id": "step_flip",
        "program": "flip/flip",
        "inputPorts": [geometry_input()],
        "outputPorts": [output_port()],
        "parameterDefinitions": [],
    }


def carrier_bond_step_template():
    return {
        "id": "step_carrier_bond",
        "program": "carrier/bond",
        "inputPorts": [
            geometry_input(),
            geometry_input("carrier_geometry", role="auxiliary"),
        ],
        "outputPorts": [output_port()],
        "parameterDefinitions": [
            parameter("material", "materialRef"),
            parameter("thk", "float"),
        ],
    }


def debond_step_template():
    return {
        "id": "step_debond",
        "program": "carrier/debond",
        "inputPorts": [geometry_input()],
        "outputPorts": [output_port()],
        "parameterDefinitions": [],
    }


def bga_bump_step_template():
    return {
        "id": "step_bga_bump",
        "program": "bump/bga_bump_formation",
        "inputPorts": [geometry_input()],
        "outputPorts": [output_port()],
        "parameterDefinitions": [
            parameter("material", "materialRef"),
            parameter("thk", "float"),
            parameter("density", "float"),
            parameter("koz", "float"),
        ],
    }


def tiv_step_template():
    return {
        "id": "step_tiv",
        "program": "tiv/tiv",
        "inputPorts": [geometry_input()],
        "outputPorts": [output_port()],
        "parameterDefinitions": [
            parameter("thk", "float"),
            parameter("material", "materialRef"),
            parameter("density", "float"),
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


def tiv_molding_template():
    return {
        "id": "flow_tiv_molding",
        "flowInputs": [flow_input("incoming_main")],
        "stepRefs": [
            {"stepRefId": "tiv", "processStepTemplateId": "step_tiv"},
            {"stepRefId": "molding", "processStepTemplateId": "step_molding"},
        ],
        "flowEdges": [
            edge_from_input("incoming_main", "tiv"),
            edge_from_step("tiv", "molding", "edge_tiv_molding"),
        ],
    }


def tiv_molding_configuration():
    return {
        "inputBindings": {
            "incoming_main": {"kind": "catalog", "geometryId": "geom_main"}
        },
        "stepConfigurations": {
            "tiv": {
                "parameterValues": {"thk": 4, "material": "Cu", "density": 60}
            },
            "molding": {
                "parameterValues": {"material": "EMC-A", "thickness": 2}
            },
        },
        "embeddedGeometries": {},
    }


def execute_tiv_with_values(state, values):
    structure = state.to_geometry_structure()
    context = ProcessStepContext(
        state=state,
        values=values,
        raw_parameter_values=values,
        step_ref={"stepRefId": "tiv", "processStepTemplateId": "step_tiv"},
        step_template=tiv_step_template(),
        step_configuration={"parameterValues": values},
        geometry_inputs={"main_geometry": structure},
        input_geometry=structure,
        geometry_resolver=lambda port_id: (
            state.clone() if port_id == "main_geometry" else None
        ),
    )
    return execute_tiv(context)


def carrier_bond_template():
    return {
        "id": "flow_carrier_bond",
        "flowInputs": [flow_input("incoming_main"), flow_input("incoming_carrier")],
        "stepRefs": [
            {
                "stepRefId": "carrier_bond",
                "processStepTemplateId": "step_carrier_bond",
            }
        ],
        "flowEdges": [
            edge_from_input("incoming_main", "carrier_bond"),
            edge_from_input(
                "incoming_carrier",
                "carrier_bond",
                "carrier_geometry",
            ),
        ],
    }


def carrier_bond_configuration():
    return {
        "inputBindings": {
            "incoming_main": {"kind": "catalog", "geometryId": "geom_main"},
            "incoming_carrier": {
                "kind": "catalog",
                "geometryId": "geom_carrier",
            },
        },
        "stepConfigurations": {
            "carrier_bond": {
                "parameterValues": {"material": "DAF-A", "thk": 3}
            }
        },
        "embeddedGeometries": {},
    }


def carrier_bond_debond_template():
    return {
        "id": "flow_carrier_bond_debond",
        "flowInputs": [flow_input("incoming_main"), flow_input("incoming_carrier")],
        "stepRefs": [
            {
                "stepRefId": "carrier_bond",
                "processStepTemplateId": "step_carrier_bond",
            },
            {
                "stepRefId": "debond",
                "processStepTemplateId": "step_debond",
            },
        ],
        "flowEdges": [
            edge_from_input("incoming_main", "carrier_bond"),
            edge_from_input("incoming_carrier", "carrier_bond", "carrier_geometry"),
            edge_from_step("carrier_bond", "debond", "edge_carrier_bond_debond"),
        ],
    }


def carrier_bond_debond_configuration():
    configuration = carrier_bond_configuration()
    configuration["stepConfigurations"]["debond"] = {"parameterValues": {}}
    return configuration


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
            "pnp": {
                "parameterValues": {
                    "coordinates": [
                        [[10, 20], [16, 25]],
                        [[-5, 0], [-2, 2.5]],
                    ]
                }
            }
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


def flip_bump_template():
    return {
        "id": "flow_flip_bump",
        "flowInputs": [flow_input("incoming_dram")],
        "stepRefs": [
            {"stepRefId": "flip", "processStepTemplateId": "step_flip"},
            {"stepRefId": "bga_bump", "processStepTemplateId": "step_bga_bump"},
        ],
        "flowEdges": [
            edge_from_input("incoming_dram", "flip"),
            edge_from_step("flip", "bga_bump", "edge_flip_bga_bump"),
        ],
    }


def flip_bump_configuration():
    return {
        "inputBindings": {
            "incoming_dram": {"kind": "catalog", "geometryId": "geom_dram"}
        },
        "stepConfigurations": {
            "flip": {"parameterValues": {}},
            "bga_bump": {
                "parameterValues": {
                    "material": "SnAg",
                    "thk": 25,
                    "density": 60,
                    "koz": 0,
                }
            },
        },
        "embeddedGeometries": {},
    }


def bonded_state(carrier_body_count=1):
    state = ProcessGeometryState.create()
    state.initialize_box_layer(
        material="base",
        bottom_left=[-50, -50, 0],
        top_right=[50, 50, 0],
        thickness=10,
        key="molding",
    )
    state.deposit_layer(material="DAF", thickness=3, key="daf")

    carrier = ProcessGeometryState.create({"key": "carrier"})
    carrier.initialize_box_layer(
        material="glass-1",
        bottom_left=[-60, -60, -4],
        top_right=[60, 60, -4],
        thickness=20,
        set_footprint=False,
    )
    for index in range(1, carrier_body_count):
        carrier.deposit_box_layer(
            material=f"glass-{index + 1}",
            bottom_left=[-40 + index, -40 + index, -4],
            top_right=[40 - index, 40 - index, -4],
            thickness=20,
        )
    state.bond_carrier_geometry(carrier, key="carrier")
    return state


def process_state_with_derived_footprint(structure):
    return ProcessGeometryState.from_structure(
        structure,
        {"footprint": {"derive": "largestRootBody"}},
    )


def main_geometry(material="carrier"):
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "carrier.panel",
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
            "key": "hbm",
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
                    "density": 80,
                    "direction": "-z",
                    "koz": 0,
                }
            ],
            "children": [],
        },
    }


def carrier_geometry():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "carrier",
            "bodies": [
                {
                    "key": "carrier",
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-60, -60, -4],
                        "top_right": [60, 60, -4],
                        "thk": 20,
                    },
                    "material": "glass",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def dram_geometry():
    def body(material, bottom_z, thickness):
        return {
            "geometry": {
                "type": "BoxGeometry",
                "bottom_left": [-60, -40, bottom_z],
                "top_right": [60, 40, bottom_z],
                "thk": thickness,
            },
            "material": material,
        }

    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "dram",
            "bodies": [
                body("EMC", 100, 200),
                body("Solder-Mask", 0, 20),
                body("BT-Core", 20, 60),
                body("Solder-Mask", 80, 20),
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [
                {
                    "bodies": [
                        {
                            "geometry": {
                                "type": "BoxGeometry",
                                "bottom_left": [-40, -30, 120],
                                "top_right": [40, 30, 120],
                                "thk": 50,
                            },
                            "material": "Si-DRAM",
                        }
                    ],
                    "vias": [],
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                }
            ],
        },
    }


if __name__ == "__main__":
    unittest.main()
