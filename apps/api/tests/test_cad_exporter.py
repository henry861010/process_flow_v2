from __future__ import annotations

import json
import struct
import unittest

from process_flow_cad import CadExportError, convert_cad_bodies, export_cad_bytes


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
            "density": 0.5,
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
