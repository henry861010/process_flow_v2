import unittest

from process_flow_mesher.translation.standard_v1 import StandardV1Translator


class StandardV1TranslatorTests(unittest.TestCase):
    def test_translates_box_geometry_to_face_and_layers(self):
        container = {
            "key": "root",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0.0, 0.0, 0.0],
                        "top_right": [2.0, 1.0, 0.0],
                        "thk": 1.0,
                    },
                    "material": "Si",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        }

        translator = StandardV1Translator()
        base_face, faces = translator.get_2D_pattern(container)
        layers = translator.get_3D_pattern(container)

        self.assertEqual(base_face, {"type": "BOX", "dim": [0.0, 0.0, 2.0, 1.0]})
        self.assertEqual(faces, [])
        self.assertEqual([layer["z"] for layer in layers], [0.0, 1.0])

    def test_accepts_multiple_circles_when_another_shape_is_the_base_face(self):
        container = {
            "key": "root",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-10.0, -10.0, 0.0],
                        "top_right": [10.0, 10.0, 0.0],
                        "thk": 1.0,
                    },
                    "material": "Si",
                },
                {
                    "geometry": {
                        "type": "CylinderGeometry",
                        "center": [-4.0, 0.0, 1.0],
                        "bottom_radius": 2.0,
                        "thk": 1.0,
                    },
                    "material": "Cu",
                },
                {
                    "geometry": {
                        "type": "CylinderGeometry",
                        "center": [4.0, 0.0, 1.0],
                        "bottom_radius": 3.0,
                        "thk": 1.0,
                    },
                    "material": "Cu",
                },
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        }

        base_face, faces = StandardV1Translator().get_2D_pattern(container)

        self.assertEqual(base_face, {"type": "BOX", "dim": [-10.0, -10.0, 10.0, 10.0]})
        self.assertEqual(
            faces,
            [
                {"type": "CIRCLE", "dim": [-4.0, 0.0, 2.0]},
                {"type": "CIRCLE", "dim": [4.0, 0.0, 3.0]},
            ],
        )


if __name__ == "__main__":
    unittest.main()
