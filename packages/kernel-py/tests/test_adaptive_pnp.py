from __future__ import annotations

import copy
import unittest

from process_flow_kernel import (
    FlowCompiler,
    GeometryArtifact,
    GeometryKernel,
    InMemoryGeometryCatalog,
    ProcessGeometryState,
    ProcessStepContext,
)
from process_flow_steps.pnp.adapters import adapt_geometry, rotate_geometry
from process_flow_steps.pnp.pnp import execute as execute_pnp_step


class AdaptivePnpTests(unittest.TestCase):
    def test_unmarked_box_geometry_uses_box_rescale(self):
        source = geometry_entity("soc", legacy_soc_geometry())
        result = execute_pnp(source, [rectangle_placement(10, 20, 6, 5)])

        placed = result.geometry()["root"]["children"][0]
        body = placed["bodies"][0]["geometry"]
        bump = placed["bumps"][0]["geometry"]
        self.assertEqual(body["bottom_left"], [10, 20, 12])
        self.assertEqual(body["top_right"], [16, 25, 12])
        self.assertEqual(bump["bottom_left"], [11, 21, 10])
        self.assertEqual(bump["top_right"], [15, 24, 10])

    def test_root_box_features_support_mixed_targets_for_default_and_explicit_contracts(self):
        for adaptation in (
            None,
            {"adapterId": "box-rescale", "adapterVersion": 1},
        ):
            with self.subTest(adaptation=adaptation):
                source = geometry_entity(
                    "root-box-features",
                    legacy_soc_geometry(),
                    adaptation=adaptation,
                )
                original = copy.deepcopy(source["structure"])
                result = execute_pnp(
                    source,
                    [
                        rectangle_placement(10, 20, 6, 5),
                        polygon_placement(
                            30,
                            40,
                            [[0, 0], [5, 0], [6, 3], [1, 4]],
                        ),
                        rectangle_placement(50, 60, 8, 7),
                    ],
                )

                first, second, third = result.geometry()["root"]["children"]
                first_body = first["bodies"][0]["geometry"]
                first_bump = first["bumps"][0]["geometry"]
                second_body = second["bodies"][0]["geometry"]
                second_bump_feature = second["bumps"][0]
                second_bump = second_bump_feature["geometry"]
                third_body = third["bodies"][0]["geometry"]
                third_bump = third["bumps"][0]["geometry"]

                self.assertEqual(first_body["type"], "BoxGeometry")
                self.assertEqual(first_body["bottom_left"][:2], [10, 20])
                self.assertEqual(first_body["top_right"][:2], [16, 25])
                self.assertEqual(first_bump["bottom_left"][:2], [11, 21])
                self.assertEqual(first_bump["top_right"][:2], [15, 24])
                self.assertEqual(second_body["type"], "PolygonGeometry")
                self.assertEqual(second_bump["type"], "PolygonGeometry")
                self.assertEqual(
                    [point[:2] for point in second_body["polys"][0]],
                    [[30, 40], [35, 40], [36, 43], [31, 44]],
                )
                self.assertEqual(
                    [point[:2] for point in second_bump["polys"][0]],
                    [[30, 40], [35, 40], [36, 43], [31, 44]],
                )
                self.assertEqual(second_body["polys"][0][0][2], 12)
                self.assertEqual(second_body["thk"], 5)
                self.assertEqual(second_bump["polys"][0][0][2], 10)
                self.assertEqual(second_bump["thk"], 2)
                self.assertEqual(second_bump_feature["density"], 80)
                self.assertEqual(second_bump_feature["direction"], "-z")
                self.assertEqual(second_bump_feature["koz"], 0)
                self.assertEqual(third_body["type"], "BoxGeometry")
                self.assertEqual(third_body["bottom_left"][:2], [50, 60])
                self.assertEqual(third_body["top_right"][:2], [58, 67])
                self.assertEqual(third_bump["bottom_left"][:2], [51, 61])
                self.assertEqual(third_bump["top_right"][:2], [57, 66])
                self.assertEqual(source["structure"], original)

    def test_hbm_placements_vary_envelope_without_resizing_core(self):
        source = geometry_entity(
            "hbm",
            hbm_geometry(),
            generation={"generatorId": "hbm", "schemaVersion": 1, "parameters": {}},
            adaptation={"adapterId": "hbm-package", "adapterVersion": 1},
        )
        result = execute_pnp(
            source,
            [
                rectangle_placement(10, 20, 8, 6),
                rectangle_placement(30, 40, 6, 5),
            ],
        )

        first, second = result.geometry()["root"]["children"]
        first_mold = first["bodies"][0]["geometry"]
        second_mold = second["bodies"][0]["geometry"]
        first_core = first["children"][1]["bodies"][0]["geometry"]
        second_core = second["children"][1]["bodies"][0]["geometry"]
        self.assertEqual(first_mold["bottom_left"][:2], [10, 20])
        self.assertEqual(first_mold["top_right"][:2], [18, 26])
        self.assertEqual(second_mold["bottom_left"][:2], [30, 40])
        self.assertEqual(second_mold["top_right"][:2], [36, 45])
        self.assertEqual(
            [
                first_core["top_right"][0] - first_core["bottom_left"][0],
                first_core["top_right"][1] - first_core["bottom_left"][1],
            ],
            [4, 3],
        )
        self.assertEqual(
            [
                second_core["top_right"][0] - second_core["bottom_left"][0],
                second_core["top_right"][1] - second_core["bottom_left"][1],
            ],
            [4, 3],
        )

    def test_rigid_polygon_can_be_placed_without_deformation(self):
        source = geometry_entity(
            "vrm",
            polygon_geometry(),
            adaptation={"adapterId": "rigid", "adapterVersion": 1},
        )
        original = copy.deepcopy(source["structure"])
        result = execute_pnp(
            source,
            [
                polygon_placement(
                    100,
                    200,
                    [[0, 0], [5, 0], [6, 2], [2, 4], [0, 3]],
                )
            ],
        )

        polygon = result.geometry()["root"]["children"][0]["bodies"][0]["geometry"]
        self.assertEqual(polygon["type"], "PolygonGeometry")
        self.assertEqual(polygon["polys"][0][0][:2], [100, 200])
        self.assertEqual(source["structure"], original)

    def test_unmarked_polygon_uses_exact_polygon_rescale(self):
        source = geometry_entity("vrm", polygon_geometry())
        original = copy.deepcopy(source["structure"])
        target = [[0, 0], [8, 0], [7, 5], [2, 6], [-1, 3]]

        result = execute_pnp(source, [polygon_placement(20, 30, target)])

        polygon = result.geometry()["root"]["children"][0]["bodies"][0]["geometry"]
        self.assertEqual([point[:2] for point in polygon["polys"][0]], [[x + 20, y + 30] for x, y in target])
        self.assertEqual(polygon["thk"], 3)
        self.assertEqual(source["structure"], original)

    def test_polygon_source_supports_mixed_rectangle_and_polygon_targets(self):
        source = geometry_entity("vrm", polygon_geometry())
        original = copy.deepcopy(source["structure"])
        result = execute_pnp(
            source,
            [
                rectangle_placement(10, 20, 8, 6),
                polygon_placement(
                    30,
                    40,
                    [[0, 0], [4, 0], [5, 2], [2, 5], [0, 3]],
                ),
            ],
        )

        first, second = result.geometry()["root"]["children"]
        first_geometry = first["bodies"][0]["geometry"]
        second_geometry = second["bodies"][0]["geometry"]
        self.assertEqual(first_geometry["type"], "PolygonGeometry")
        self.assertEqual(
            [point[:2] for point in first_geometry["polys"][0]],
            [[10, 20], [18, 20], [18, 26], [10, 26]],
        )
        self.assertEqual(second_geometry["type"], "PolygonGeometry")
        self.assertEqual(
            [point[:2] for point in second_geometry["polys"][0]],
            [[30, 40], [34, 40], [35, 42], [32, 45], [30, 43]],
        )
        self.assertEqual(source["structure"], original)

    def test_polygon_rescale_rectangle_target_preserves_polygon_primitive(self):
        artifact = GeometryArtifact.from_entity(geometry_entity("vrm", polygon_geometry()))

        adapted = adapt_geometry(
            artifact,
            {"type": "rectangle", "width": 8, "height": 6},
        )

        geometry = adapted["root"]["bodies"][0]["geometry"]
        self.assertEqual(geometry["type"], "PolygonGeometry")
        self.assertEqual(
            [point[:2] for point in geometry["polys"][0]],
            [[0, 0], [8, 0], [8, 6], [0, 6]],
        )

    def test_box_rescale_polygon_target_preserves_exact_points_and_metadata(self):
        source = geometry_entity(
            "root-box-features",
            root_box_features_geometry(),
            adaptation={"adapterId": "box-rescale", "adapterVersion": 1},
        )
        artifact = GeometryArtifact.from_entity(source)
        original = copy.deepcopy(source["structure"])
        target = [[1, 2], [6, 2], [7, 5], [2, 6]]

        adapted = adapt_geometry(
            artifact,
            {"type": "polygon", "points": target},
        )

        body = adapted["root"]["bodies"][0]
        via = adapted["root"]["vias"][0]
        circuit = adapted["root"]["circuits"][0]
        bump = adapted["root"]["bumps"][0]
        self.assertEqual(body["geometry"]["type"], "PolygonGeometry")
        self.assertEqual(via["geometry"]["type"], "PolygonGeometry")
        self.assertEqual(circuit["geometry"]["type"], "PolygonGeometry")
        self.assertEqual(bump["geometry"]["type"], "PolygonGeometry")
        self.assertEqual(
            body["geometry"]["polys"][0],
            [[1, 2, 2], [6, 2, 2], [7, 5, 2], [2, 6, 2]],
        )
        self.assertEqual(
            bump["geometry"]["polys"][0],
            [[1, 2, 0], [6, 2, 0], [7, 5, 0], [2, 6, 0]],
        )
        self.assertEqual(
            via["geometry"]["polys"][0],
            [[1, 2, 1], [6, 2, 1], [7, 5, 1], [2, 6, 1]],
        )
        self.assertEqual(
            circuit["geometry"]["polys"][0],
            [[1, 2, 3], [6, 2, 3], [7, 5, 3], [2, 6, 3]],
        )
        self.assertEqual(body["geometry"]["thk"], 5)
        self.assertEqual(body["material"], "Si")
        self.assertEqual(via["geometry"]["thk"], 1)
        self.assertEqual(via["material"], "Cu-via")
        self.assertEqual(via["density"], 50)
        self.assertEqual(via["direction"], "+z")
        self.assertEqual(via["koz"], 1)
        self.assertEqual(circuit["geometry"]["thk"], 1)
        self.assertEqual(circuit["material"], "Cu-circuit")
        self.assertEqual(circuit["density"], 40)
        self.assertEqual(circuit["koz"], 2)
        self.assertEqual(bump["geometry"]["thk"], 2)
        self.assertEqual(bump["material"], "SnAg")
        self.assertEqual(bump["density"], 80)
        self.assertEqual(bump["direction"], "-z")
        self.assertEqual(bump["koz"], 0)
        self.assertEqual(source["structure"], original)

    def test_polygon_target_uses_root_anchor_and_rigidly_transforms_children(self):
        source = geometry_entity(
            "root-with-child",
            box_geometry_with_protruding_child(),
        )
        original = copy.deepcopy(source["structure"])
        target = [[0, 0], [4, 0], [4, 2], [0, 2]]

        result = execute_pnp(
            source,
            [
                polygon_placement(30, 40, target),
                polygon_placement(100, 200, target),
            ],
        )

        first, second = result.geometry()["root"]["children"]
        first_body = first["bodies"][0]["geometry"]
        first_bump = first["bumps"][0]["geometry"]
        first_child = first["children"][0]["bodies"][0]["geometry"]
        self.assertEqual(
            [point[:2] for point in first_body["polys"][0]],
            [[30, 40], [34, 40], [34, 42], [30, 42]],
        )
        self.assertEqual(first_bump["type"], "PolygonGeometry")
        self.assertEqual(first_child["type"], "BoxGeometry")
        self.assertEqual(first_child["bottom_left"], [28, 39, 10])
        self.assertEqual(first_child["top_right"], [29, 40, 10])
        self.assertEqual(first_child["thk"], 1)

        second_body = second["bodies"][0]["geometry"]
        second_child = second["children"][0]["bodies"][0]["geometry"]
        self.assertEqual(
            [point[:2] for point in second_body["polys"][0]],
            [[100, 200], [104, 200], [104, 202], [100, 202]],
        )
        self.assertEqual(second_child["type"], "BoxGeometry")
        self.assertEqual(second_child["bottom_left"], [98, 199, 10])
        self.assertEqual(second_child["top_right"], [99, 200, 10])
        self.assertEqual(second_child["thk"], 1)
        self.assertEqual(source["structure"], original)

    def test_rotation_rebases_each_supported_anchor_before_rotating(self):
        artifact = GeometryArtifact.from_entity(geometry_entity("vrm", polygon_geometry()))
        adapted = adapt_geometry(
            artifact,
            {
                "type": "polygon",
                "points": [[1, 1], [3, 1], [3, 2], [1, 2]],
            },
        )

        expected_first_points = {
            "bottomLeft": [0.0, 0.0],
            "center": [0.5, -1.0],
            "origin": [-1.0, 1.0],
        }
        for anchor, expected in expected_first_points.items():
            with self.subTest(anchor=anchor):
                rotated = rotate_geometry(adapted, 90, anchor)
                actual = rotated["root"]["bodies"][0]["geometry"]["polys"][0][0][:2]
                self.assertAlmostEqual(actual[0], expected[0])
                self.assertAlmostEqual(actual[1], expected[1])

    def test_batch_failure_does_not_attach_prepared_placements(self):
        state = ProcessGeometryState.from_structure(main_geometry())
        source = GeometryArtifact.from_entity(geometry_entity("soc", legacy_soc_geometry()))
        context = ProcessStepContext(
            state=state,
            values={
                "placements": [
                    rectangle_placement(10, 20, 6, 5),
                    rectangle_placement(30, 40, 0, 5),
                ]
            },
            raw_parameter_values={},
            step_ref={},
            step_template={},
            step_configuration={},
            geometry_inputs={},
            input_geometry=None,
            geometry_resolver=lambda _port_id: None,
            geometry_artifact_resolver=lambda port_id: source
            if port_id == "die_geometry"
            else None,
        )

        with self.assertRaisesRegex(ValueError, "topRightX must be greater"):
            execute_pnp_step(context)

        self.assertEqual(state.to_geometry_structure()["root"]["children"], [])

    def test_child_only_polygon_target_fails_without_partial_attachment(self):
        state = ProcessGeometryState.from_structure(main_geometry())
        source = GeometryArtifact.from_entity(
            geometry_entity("child-only", child_only_box_geometry())
        )
        context = ProcessStepContext(
            state=state,
            values={
                "placements": [
                    rectangle_placement(10, 20, 6, 5),
                    polygon_placement(
                        30,
                        40,
                        [[0, 0], [5, 0], [6, 3], [1, 4]],
                    ),
                ]
            },
            raw_parameter_values={},
            step_ref={},
            step_template={},
            step_configuration={},
            geometry_inputs={},
            input_geometry=None,
            geometry_resolver=lambda _port_id: None,
            geometry_artifact_resolver=lambda port_id: source
            if port_id == "die_geometry"
            else None,
        )

        with self.assertRaisesRegex(
            ValueError,
            "requires at least one root feature geometry",
        ):
            execute_pnp_step(context)

        self.assertEqual(state.to_geometry_structure()["root"]["children"], [])

    def test_hbm_rejects_target_smaller_than_fixed_core(self):
        artifact = GeometryArtifact.from_entity(
            geometry_entity(
                "hbm",
                hbm_geometry(),
                adaptation={"adapterId": "hbm-package", "adapterVersion": 1},
            )
        )

        with self.assertRaisesRegex(ValueError, "fixed core geometry does not fit"):
            adapt_geometry(
                artifact,
                {"type": "rectangle", "width": 3, "height": 2},
            )

    def test_hbm_rejects_concave_region_that_cuts_through_fixed_core(self):
        artifact = GeometryArtifact.from_entity(
            geometry_entity(
                "hbm",
                hbm_geometry(),
                adaptation={"adapterId": "hbm-package", "adapterVersion": 1},
            )
        )

        with self.assertRaisesRegex(ValueError, "fixed core geometry does not fit"):
            adapt_geometry(
                artifact,
                {
                    "type": "polygon",
                    "points": [
                        [0, 0],
                        [8, 0],
                        [8, 6],
                        [5, 6],
                        [5, 2],
                        [3, 2],
                        [3, 6],
                        [0, 6],
                    ],
                },
            )

    def test_self_intersecting_target_polygon_is_rejected(self):
        artifact = GeometryArtifact.from_entity(
            geometry_entity(
                "vrm",
                polygon_geometry(),
                adaptation={"adapterId": "rigid", "adapterVersion": 1},
            )
        )

        with self.assertRaisesRegex(ValueError, "must not self-intersect"):
            adapt_geometry(
                artifact,
                {
                    "type": "polygon",
                    "points": [[0, 0], [4, 4], [0, 4], [4, 0]],
                },
            )

    def test_unknown_adapter_is_rejected_explicitly(self):
        artifact = GeometryArtifact.from_entity(
            geometry_entity(
                "unknown",
                legacy_soc_geometry(),
                adaptation={"adapterId": "company-private", "adapterVersion": 1},
            )
        )

        with self.assertRaisesRegex(ValueError, "not installed"):
            adapt_geometry(
                artifact,
                {"type": "rectangle", "width": 6, "height": 5},
            )

    def test_missing_contract_is_preserved_for_runtime_primitive_inference(self):
        box = GeometryArtifact.from_entity(geometry_entity("box", legacy_soc_geometry()))
        polygon = GeometryArtifact.from_entity(geometry_entity("polygon", polygon_geometry()))

        self.assertIsNone(box.adaptation_contract)
        self.assertIsNone(polygon.adaptation_contract)
        self.assertEqual(
            adapt_geometry(box, {"type": "rectangle", "width": 6, "height": 5})["root"]["bodies"][0]["geometry"]["type"],
            "BoxGeometry",
        )
        self.assertEqual(
            adapt_geometry(polygon, {"type": "rectangle", "width": 6, "height": 5})["root"]["bodies"][0]["geometry"]["type"],
            "PolygonGeometry",
        )

    def test_polygon_rescale_rejects_multiple_loops(self):
        structure = polygon_geometry()
        structure["root"]["bodies"][0]["geometry"]["polys"].append(
            [[1, 1, 0], [2, 1, 0], [2, 2, 0], [1, 2, 0]]
        )
        artifact = GeometryArtifact.from_entity(
            geometry_entity(
                "vrm-with-hole",
                structure,
                adaptation={"adapterId": "polygon-rescale", "adapterVersion": 1},
            )
        )

        with self.assertRaisesRegex(ValueError, "exactly one polygon loop"):
            adapt_geometry(
                artifact,
                {"type": "rectangle", "width": 6, "height": 5},
            )

    def test_default_adapter_rejects_mixed_primitives(self):
        structure = legacy_soc_geometry()
        structure["root"]["bodies"].append(
            polygon_geometry()["root"]["bodies"][0]
        )
        artifact = GeometryArtifact.from_entity(geometry_entity("mixed", structure))

        with self.assertRaisesRegex(ValueError, "explicit adaptationContract"):
            adapt_geometry(
                artifact,
                {"type": "rectangle", "width": 6, "height": 5},
            )


def execute_pnp(source, placements):
    catalog = InMemoryGeometryCatalog(
        [geometry_entity("main", main_geometry()), source]
    )
    plan = FlowCompiler(catalog).compile(
        {
            "id": "adaptive-pnp-flow",
            "flowInputs": [flow_input("incoming_main"), flow_input("incoming_die")],
            "stepRefs": [
                {
                    "stepRefId": "pnp",
                    "processStepTemplateId": "adaptive-pnp-step",
                }
            ],
            "flowEdges": [
                edge("main-edge", "incoming_main", "main_geometry"),
                edge("die-edge", "incoming_die", "die_geometry"),
            ],
        },
        {
            "inputBindings": {
                "incoming_main": {"kind": "catalog", "geometryId": "main"},
                "incoming_die": {"kind": "catalog", "geometryId": source["id"]},
            },
            "stepConfigurations": {
                "pnp": {"parameterValues": {"placements": placements}}
            },
            "embeddedGeometries": {},
        },
        [pnp_step_template()],
    )
    return GeometryKernel().execute(plan)


def pnp_step_template():
    return {
        "schemaVersion": 2,
        "id": "adaptive-pnp-step",
        "version": "V0.0.0",
        "name": "PnP",
        "category": "PnP",
        "program": "pnp/pnp",
        "owner": "test",
        "inputPorts": [
            {
                "portId": "main_geometry",
                "name": "main",
                "dataType": "geometry",
                "role": "primary",
                "required": True,
            },
            {
                "portId": "die_geometry",
                "name": "die",
                "dataType": "geometry",
                "role": "auxiliary",
                "required": True,
            },
        ],
        "outputPorts": [
            {
                "portId": "result_geometry",
                "name": "result",
                "dataType": "geometry",
            }
        ],
        "parameterDefinitions": [
            {
                "id": "placements",
                "name": "placements",
                "valueType": "placements",
                "controlType": "placementList",
                "required": True,
            }
        ],
    }


def flow_input(id_):
    return {
        "flowInputId": id_,
        "name": id_,
        "dataType": "geometry",
        "required": True,
    }


def edge(id_, flow_input_id, port_id):
    return {
        "edgeId": id_,
        "source": {"kind": "flowInput", "flowInputId": flow_input_id},
        "target": {"stepRefId": "pnp", "inputPortId": port_id},
    }


def rectangle_placement(x, y, width, height):
    return {
        "targetRegion": {
            "type": "rectangle",
            "bottomLeftX": x,
            "bottomLeftY": y,
            "topRightX": x + width,
            "topRightY": y + height,
        },
        "pose": {"x": 0, "y": 0, "rotationZ": 0},
        "anchor": "center",
    }


def polygon_placement(x, y, points):
    return {
        "targetRegion": {
            "type": "polygon",
            "points": [[point[0] + x, point[1] + y] for point in points],
        },
        "pose": {"x": 0, "y": 0, "rotationZ": 0},
        "anchor": "center",
    }


def geometry_entity(
    id_,
    structure,
    *,
    generation=None,
    adaptation=None,
    category="die.test",
):
    payload = {
        "id": id_,
        "name": id_,
        "entityType": "die",
        "category": category,
        "dim": "",
        "structureFormat": "standard",
        "structure": structure,
    }
    if generation is not None:
        payload["generation"] = generation
    if adaptation is not None:
        payload["adaptationContract"] = adaptation
    return payload


def main_geometry():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-50, -50, 0],
                        "top_right": [50, 50, 0],
                        "thk": 10,
                    },
                    "material": "substrate",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def legacy_soc_geometry():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "soc",
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


def box_geometry_with_protruding_child():
    structure = legacy_soc_geometry()
    structure["root"]["children"] = [
        {
            "key": "soic",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-2, -1, 0],
                        "top_right": [-1, 0, 0],
                        "thk": 1,
                    },
                    "material": "child",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        }
    ]
    return structure


def root_box_features_geometry():
    structure = legacy_soc_geometry()
    structure["root"]["vias"] = [
        {
            "geometry": {
                "type": "BoxGeometry",
                "bottom_left": [1, 1, 1],
                "top_right": [2, 2, 1],
                "thk": 1,
            },
            "material": "Cu-via",
            "density": 50,
            "direction": "+z",
            "koz": 1,
        }
    ]
    structure["root"]["circuits"] = [
        {
            "geometry": {
                "type": "BoxGeometry",
                "bottom_left": [1, 1, 3],
                "top_right": [2, 2, 3],
                "thk": 1,
            },
            "material": "Cu-circuit",
            "density": 40,
            "koz": 2,
        }
    ]
    return structure


def child_only_box_geometry():
    structure = box_geometry_with_protruding_child()
    for collection in ("bodies", "vias", "circuits", "bumps"):
        structure["root"][collection] = []
    return structure


def hbm_geometry():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "id": "container:hbm-root",
            "key": "hbm",
            "bodies": [
                {
                    "id": "body:hbm-molding",
                    "key": "envelope",
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-5, -4, 0],
                        "top_right": [5, 4, 0],
                        "thk": 10,
                    },
                    "material": "EMC",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [
                {
                    "id": "container:hbm-base-die",
                    "bodies": [
                        {
                            "geometry": {
                                "type": "BoxGeometry",
                                "bottom_left": [-5, -4, 0],
                                "top_right": [5, 4, 0],
                                "thk": 2,
                            },
                            "material": "Si",
                        }
                    ],
                    "vias": [],
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                },
                {
                    "id": "container:hbm-core-die-01",
                    "bodies": [
                        {
                            "geometry": {
                                "type": "BoxGeometry",
                                "bottom_left": [-2, -1.5, 2],
                                "top_right": [2, 1.5, 2],
                                "thk": 5,
                            },
                            "material": "Si",
                        }
                    ],
                    "vias": [],
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                },
            ],
        },
    }


def polygon_geometry():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "bodies": [
                {
                    "geometry": {
                        "type": "PolygonGeometry",
                        "polys": [[[0, 0, 0], [5, 0, 0], [6, 2, 0], [2, 4, 0], [0, 3, 0]]],
                        "thk": 3,
                    },
                    "material": "VRM",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


if __name__ == "__main__":
    unittest.main()
