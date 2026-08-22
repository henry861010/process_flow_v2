import unittest

import numpy as np

from process_flow_mesher import Mesh3D, build_mesh_from_structure


def _box_structure():
    return {
        "root": {
            "key": "root",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0.0, 0.0, 0.0],
                        "top_right": [2.0, 2.0, 0.0],
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
    }


def _multi_circle_structure():
    return {
        "root": {
            "key": "root",
            "bodies": [
                {
                    "geometry": {
                        "type": "CylinderGeometry",
                        "center": [-3.0, 0.0, 0.0],
                        "bottom_radius": 2.0,
                        "thk": 1.0,
                    },
                    "material": "Si",
                },
                {
                    "geometry": {
                        "type": "CylinderGeometry",
                        "center": [3.0, 0.0, 0.0],
                        "bottom_radius": 2.0,
                        "thk": 1.0,
                    },
                    "material": "Si",
                },
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        }
    }


class BuilderIntegrationTests(unittest.TestCase):
    def test_public_builder_matches_known_mesh_contract(self):
        mesh = build_mesh_from_structure(_box_structure(), element_size=1.0)

        self.assertIsInstance(mesh, Mesh3D)
        self.assertEqual(mesh.node_count, 18)
        self.assertEqual(mesh.element_count, 4)
        self.assertEqual(mesh.component_count, 2)
        self.assertEqual(mesh.comps, {"EMPTY": 0, "Si": 1})
        np.testing.assert_array_equal(mesh.element_comps, [1, 1, 1, 1])
        np.testing.assert_array_equal(
            mesh.elements[0],
            [0, 3, 4, 1, 9, 12, 13, 10],
        )
        np.testing.assert_array_equal(mesh.nodes[-1], [2.0, 2.0, 1.0])

    def test_builds_disjoint_cylinders_in_one_mesh(self):
        mesh = build_mesh_from_structure(_multi_circle_structure(), element_size=1.0)

        self.assertEqual(mesh.element_count, 8)
        self.assertEqual(mesh.comps, {"EMPTY": 0, "Si": 1})
        element_centers = mesh.nodes[mesh.elements].mean(axis=1)
        self.assertTrue(np.any(element_centers[:, 0] < 0.0))
        self.assertTrue(np.any(element_centers[:, 0] > 0.0))
        for x, y, _ in element_centers:
            distance_to_nearest_center = min(
                (x + 3.0) ** 2 + y**2,
                (x - 3.0) ** 2 + y**2,
            )
            self.assertLess(distance_to_nearest_center, 2.0**2)


if __name__ == "__main__":
    unittest.main()
