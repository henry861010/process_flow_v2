from __future__ import annotations

import json
import math
import struct
import unittest
from unittest import mock

from process_flow_cad import (
    CadExportError,
    PreparedSectionGeometry,
    convert_cad_bodies,
    export_cad_bytes,
    prepare_section_geometry,
    section_geometry,
)
from process_flow_cad.exporter import CadQueryConverter


class CadExporterTests(unittest.TestCase):
    def test_glb_export_returns_binary_glb(self):
        glb = export_cad_bytes(box_structure(), format="glb")

        self.assertGreater(len(glb), 20)
        self.assertEqual(glb[:4], b"glTF")

    def test_glb_export_preserves_z_up_coordinates(self):
        glb = export_cad_bytes(z_stack_structure(), format="glb")
        bounds = glb_position_bounds(glb)

        self.assertEqual(bounds["zMin"], 0)
        self.assertEqual(bounds["zMax"], 200)
        self.assertEqual(bounds["yMin"], 0)
        self.assertEqual(bounds["yMax"], 10)

    def test_step_export_returns_ap242_step(self):
        step = export_cad_bytes(box_structure(), format="step").decode("utf-8", errors="replace")

        self.assertIn("ISO-10303-21", step)
        self.assertRegex(step, r"AP242|242")

    def test_all_supported_primitives_export(self):
        step = export_cad_bytes(all_primitive_structure(), format="step").decode(
            "utf-8",
            errors="replace",
        )

        self.assertIn("ISO-10303-21", step)

    def test_polygon_holes_export_through_odd_even_classifier(self):
        step = export_cad_bytes(polygon_with_hole_structure(), format="step").decode(
            "utf-8",
            errors="replace",
        )

        self.assertIn("ISO-10303-21", step)

    def test_cross_material_sibling_overlap_raises(self):
        with self.assertRaisesRegex(CadExportError, "Overlapping sibling bodies"):
            convert_cad_bodies(cross_material_overlap_structure())

    def test_glb_excludes_features_and_step_includes_features(self):
        glb_bodies = convert_cad_bodies(feature_structure(), include_feature_bodies=False)
        step_bodies = convert_cad_bodies(feature_structure(), include_feature_bodies=True)

        self.assertEqual([body.body_kind for body in glb_bodies], ["body"])
        self.assertIn("feature", [body.body_kind for body in step_bodies])

    def test_section_box_returns_closed_exact_material_region(self):
        result = section_geometry(box_structure(), axis="x", position=5)

        self.assertEqual(result["unitSystem"], "um")
        self.assertEqual(result["axis"], "x")
        self.assertEqual(result["position"], 5)
        self.assertEqual(len(result["regions"]), 1)
        region = result["regions"][0]
        self.assertEqual(region["material"], "mold")
        self.assertEqual(region["bodyKind"], "body")
        self.assertIsNone(region["featureType"])
        self.assertEqual(region["approximationKind"], "exact")
        self.assertEqual(region["area"], 50)
        self.assertEqual(
            region["outer"],
            [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]],
        )
        self.assertEqual(region["holes"], [])
        self.assertEqual(region["outer"][0], region["outer"][-1])

    def test_prepared_section_resolves_once_for_multiple_positions(self):
        original_convert_bodies = CadQueryConverter.convert_bodies
        with mock.patch.object(
            CadQueryConverter,
            "convert_bodies",
            autospec=True,
            side_effect=original_convert_bodies,
        ) as convert_bodies:
            prepared = prepare_section_geometry(box_structure())
            center = prepared.section(axis="x", position=5)
            edge = prepared.section(axis="y", position=0)
            outside = prepared.section(axis="x", position=20)

        self.assertIsInstance(prepared, PreparedSectionGeometry)
        self.assertEqual(prepared.unit_system, "um")
        self.assertEqual(convert_bodies.call_count, 1)
        self.assertEqual(center["regions"][0]["area"], 50)
        self.assertEqual(edge["regions"][0]["area"], 50)
        self.assertEqual(outside["regions"], [])

    def test_section_returns_multiple_material_regions(self):
        result = section_geometry(z_stack_structure(), axis="x", position=5)

        self.assertEqual(
            [(region["material"], region["area"]) for region in result["regions"]],
            [("base", 1000), ("cap", 1000)],
        )
        self.assertEqual(result["regions"][0]["outer"][0], [0, 0])
        self.assertEqual(result["regions"][1]["outer"][0], [0, 100])

    def test_section_y_axis_projects_xz_coordinates(self):
        result = section_geometry(all_primitive_structure(), axis="y", position=5)
        mold = next(region for region in result["regions"] if region["material"] == "mold")

        self.assertEqual(mold["area"], 20)
        self.assertEqual(
            mold["outer"],
            [[0, 0], [10, 0], [10, 2], [0, 2], [0, 0]],
        )

    def test_section_preserves_holes_from_resolved_parent_body(self):
        result = section_geometry(nested_material_structure(), axis="x", position=5)
        regions_by_material = {region["material"]: region for region in result["regions"]}

        self.assertEqual(set(regions_by_material), {"mold", "silicon"})
        mold = regions_by_material["mold"]
        self.assertEqual(mold["area"], 84)
        self.assertEqual(len(mold["holes"]), 1)
        self.assertEqual(mold["holes"][0][0], mold["holes"][0][-1])
        self.assertGreater(signed_area_2d(mold["outer"]), 0)
        self.assertLess(signed_area_2d(mold["holes"][0]), 0)
        self.assertEqual(regions_by_material["silicon"]["area"], 16)

    def test_section_coplanar_child_wall_has_exclusive_material_ownership(self):
        # The plane is exactly on the nested silicon body's y-min wall. OCC
        # exposes both the silicon wall and the coincident wall of the cavity
        # cut into the parent mold unless section ownership is resolved.
        boundary = section_geometry(
            nested_material_structure(),
            axis="y",
            position=3,
        )
        just_inside = section_geometry(
            nested_material_structure(),
            axis="y",
            position=3.001,
        )

        self.assertEqual(boundary["regions"], just_inside["regions"])
        self.assertEqual(
            [(region["material"], region["area"]) for region in boundary["regions"]],
            [("silicon", 8), ("mold", 92)],
        )
        self.assertEqual(sum(region["area"] for region in boundary["regions"]), 100)

        silicon = next(
            region for region in boundary["regions"] if region["material"] == "silicon"
        )
        self.assertEqual(
            silicon["outer"],
            [[4, 3], [6, 3], [6, 7], [4, 7], [4, 3]],
        )
        self.assertFalse(
            any(
                region["material"] == "mold"
                and region["outer"] == silicon["outer"]
                for region in boundary["regions"]
            )
        )

    def test_section_coplanar_siblings_use_stable_body_identity_priority(self):
        first = section_geometry(
            coplanar_sibling_material_structure(),
            axis="y",
            position=0,
        )
        repeated = section_geometry(
            coplanar_sibling_material_structure(),
            axis="y",
            position=0,
        )

        self.assertEqual(first, repeated)
        self.assertEqual(len(first["regions"]), 1)
        self.assertEqual(first["regions"][0]["bodyId"], "body-a")
        self.assertEqual(first["regions"][0]["material"], "silicon")
        self.assertEqual(first["regions"][0]["area"], 50)

    def test_section_emits_one_region_per_disconnected_face(self):
        result = section_geometry(polygon_with_hole_structure(), axis="x", position=10)

        self.assertEqual(len(result["regions"]), 2)
        self.assertEqual([region["area"] for region in result["regions"]], [10, 10])
        self.assertEqual(
            {region["bodyId"] for region in result["regions"]},
            {result["regions"][0]["bodyId"]},
        )
        self.assertEqual(result["regions"][0]["outer"][0], [0, 0])
        self.assertEqual(result["regions"][1]["outer"][0], [15, 0])

    def test_section_outside_geometry_is_empty(self):
        result = section_geometry(box_structure(), axis="y", position=100)

        self.assertEqual(result["regions"], [])

    def test_section_does_not_materialize_density_features(self):
        result = section_geometry(feature_structure(), axis="x", position=5)

        self.assertEqual([region["bodyKind"] for region in result["regions"]], ["body"])
        self.assertEqual([region["material"] for region in result["regions"]], ["mold"])

    def test_section_rejects_invalid_parameters(self):
        invalid_calls = [
            {"axis": "z", "position": 1},
            {"axis": "X", "position": 1},
            {"axis": "x", "position": math.nan},
            {"axis": "x", "position": math.inf},
            {"axis": "x", "position": True},
            {"axis": "x", "position": 1, "tolerance": 0},
            {"axis": "x", "position": 1, "tolerance": -0.1},
            {"axis": "x", "position": 1, "tolerance": math.inf},
        ]
        for kwargs in invalid_calls:
            with self.subTest(kwargs=kwargs), self.assertRaises(CadExportError):
                section_geometry(box_structure(), **kwargs)


def box_structure():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "box-root",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, 0, 0],
                        "top_right": [10, 10, 0],
                        "thk": 5,
                    },
                    "material": "mold",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def all_primitive_structure():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "all-primitives",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, 0, 0],
                        "top_right": [10, 10, 0],
                        "thk": 2,
                    },
                    "material": "mold",
                },
                {
                    "geometry": {
                        "type": "CylinderGeometry",
                        "center": [20, 5, 0],
                        "bottom_radius": 4,
                        "thk": 3,
                    },
                    "material": "copper",
                },
                {
                    "geometry": {
                        "type": "ConeGeometry",
                        "center": [35, 5, 0],
                        "bottom_radius": 4,
                        "top_radius": 2,
                        "thk": 4,
                    },
                    "material": "solder",
                },
                {
                    "geometry": {
                        "type": "PolygonGeometry",
                        "polys": [
                            [[45, 0, 0], [55, 0, 0], [55, 10, 0], [45, 10, 0]]
                        ],
                        "thk": 2,
                    },
                    "material": "silicon",
                },
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def polygon_with_hole_structure():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "polygon-hole",
            "bodies": [
                {
                    "geometry": {
                        "type": "PolygonGeometry",
                        "polys": [
                            [[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0]],
                            [[5, 5, 0], [15, 5, 0], [15, 15, 0], [5, 15, 0]],
                        ],
                        "thk": 2,
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


def cross_material_overlap_structure():
    structure = box_structure()
    structure["root"]["bodies"].append(
        {
            "geometry": {
                "type": "BoxGeometry",
                "bottom_left": [5, 5, 0],
                "top_right": [15, 15, 0],
                "thk": 5,
            },
            "material": "silicon",
        }
    )
    return structure


def feature_structure():
    structure = box_structure()
    structure["root"]["vias"].append(
        {
            "geometry": {
                "type": "CylinderGeometry",
                "center": [5, 5, 0],
                "bottom_radius": 2,
                "thk": 5,
            },
            "material": "copper",
            "density": 50,
            "direction": "+z",
            "koz": 0,
        }
    )
    return structure


def z_stack_structure():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "z-stack",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, 0, 0],
                        "top_right": [10, 10, 0],
                        "thk": 100,
                    },
                    "material": "base",
                },
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, 0, 100],
                        "top_right": [10, 10, 100],
                        "thk": 100,
                    },
                    "material": "cap",
                },
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def nested_material_structure():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "outer",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, 0, 0],
                        "top_right": [10, 10, 0],
                        "thk": 10,
                    },
                    "material": "mold",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [
                {
                    "key": "inner",
                    "bodies": [
                        {
                            "geometry": {
                                "type": "BoxGeometry",
                                "bottom_left": [4, 3, 3],
                                "top_right": [6, 7, 3],
                                "thk": 4,
                            },
                            "material": "silicon",
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


def coplanar_sibling_material_structure():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "coplanar-siblings",
            "bodies": [
                {
                    "id": "body-a",
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, -5, 0],
                        "top_right": [10, 0, 0],
                        "thk": 5,
                    },
                    "material": "silicon",
                },
                {
                    "id": "body-b",
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, 0, 0],
                        "top_right": [10, 5, 0],
                        "thk": 5,
                    },
                    "material": "mold",
                },
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def signed_area_2d(loop):
    return 0.5 * sum(
        left[0] * right[1] - right[0] * left[1]
        for left, right in zip(loop, loop[1:])
    )


def glb_position_bounds(glb: bytes):
    if glb[:4] != b"glTF":
        raise AssertionError("not a GLB file")
    offset = 12
    gltf = None
    while offset < len(glb):
        chunk_length, chunk_type = struct.unpack_from("<I4s", glb, offset)
        offset += 8
        chunk = glb[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == b"JSON":
            gltf = json.loads(chunk.decode("utf-8"))
            break
    if gltf is None:
        raise AssertionError("GLB JSON chunk missing")

    mins = [float("inf"), float("inf"), float("inf")]
    maxes = [float("-inf"), float("-inf"), float("-inf")]
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            accessor_index = primitive.get("attributes", {}).get("POSITION")
            if accessor_index is None:
                continue
            accessor = gltf["accessors"][accessor_index]
            for axis in range(3):
                mins[axis] = min(mins[axis], accessor["min"][axis])
                maxes[axis] = max(maxes[axis], accessor["max"][axis])
    return {
        "xMin": mins[0],
        "xMax": maxes[0],
        "yMin": mins[1],
        "yMax": maxes[1],
        "zMin": mins[2],
        "zMax": maxes[2],
    }


if __name__ == "__main__":
    unittest.main()
