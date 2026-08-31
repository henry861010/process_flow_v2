from __future__ import annotations

import copy
import unittest

from process_flow_kernel import (
    FlowCompiler,
    GeometryArtifact,
    GeometryKernel,
    InMemoryGeometryCatalog,
)
from process_flow_steps.pnp.adapters import adapt_geometry


class AdaptivePnpTests(unittest.TestCase):
    def test_unmarked_geometry_uses_legacy_recursive_box_stretch(self):
        source = geometry_entity("soc", legacy_soc_geometry())
        result = execute_pnp(source, [rectangle_placement(10, 20, 6, 5)])

        placed = result.geometry()["root"]["children"][0]
        body = placed["bodies"][0]["geometry"]
        bump = placed["bumps"][0]["geometry"]
        self.assertEqual(body["bottom_left"], [10, 20, 12])
        self.assertEqual(body["top_right"], [16, 25, 12])
        self.assertEqual(bump["bottom_left"], [11, 21, 10])
        self.assertEqual(bump["top_right"], [15, 24, 10])

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
                {
                    "targetRegion": {
                        "type": "polygon",
                        "points": [[0, 0], [5, 0], [6, 2], [2, 4], [0, 3]],
                    },
                    "pose": {"x": 100, "y": 200, "rotationZ": 90},
                    "anchor": "bottomLeft",
                }
            ],
        )

        polygon = result.geometry()["root"]["children"][0]["bodies"][0]["geometry"]
        self.assertEqual(polygon["type"], "PolygonGeometry")
        self.assertEqual(polygon["polys"][0][0][:2], [104, 200])
        self.assertEqual(source["structure"], original)

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

    def test_category_defaults_are_specialized_without_changing_soc_legacy(self):
        cases = [
            ("die.hbm", "hbm-package"),
            ("die.dram.mobile", "dram-package"),
            ("die.vrm", "rigid"),
            ("die.soc", "legacy-box-stretch"),
            ("die.lsi", "legacy-box-stretch"),
        ]
        for category, expected_adapter in cases:
            with self.subTest(category=category):
                artifact = GeometryArtifact.from_entity(
                    geometry_entity(
                        "category-default",
                        legacy_soc_geometry(),
                        category=category,
                    )
                )
                self.assertEqual(
                    artifact.adaptation_contract["adapterId"],
                    expected_adapter,
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
        "version": "V4.0.0",
        "name": "Adaptive PnP",
        "category": "PnP",
        "program": "pnp/pnp_v2",
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
        "targetRegion": {"type": "rectangle", "width": width, "height": height},
        "pose": {"x": x, "y": y, "rotationZ": 0},
        "anchor": "bottomLeft",
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
