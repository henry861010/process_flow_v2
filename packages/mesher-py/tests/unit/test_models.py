import re
import unittest

import numpy as np

from process_flow_mesher import Mesh3D
from process_flow_mesher.meshing.extrusion import Dragger


class Mesh3DTests(unittest.TestCase):
    def test_normalizes_and_owns_mesh_data(self):
        nodes = np.array([[1, 2, 3, 99]], dtype=np.float32)
        elements = np.zeros((1, 8), dtype=np.int64)
        element_comps = np.array([1], dtype=np.int64)
        comps = {"EMPTY": 0, "body": 1}

        mesh = Mesh3D(
            nodes=nodes,
            elements=elements,
            element_comps=element_comps,
            comps=comps,
        )

        nodes[0, 0] = 100
        elements[0, 0] = 7
        element_comps[0] = 9
        comps["body"] = 8

        self.assertEqual(mesh.nodes.dtype, np.float64)
        self.assertEqual(mesh.elements.dtype, np.int32)
        self.assertEqual(mesh.element_comps.dtype, np.int32)
        self.assertEqual(mesh.nodes.shape, (1, 3))
        self.assertEqual(mesh.nodes[0, 0], 1.0)
        self.assertEqual(mesh.elements[0, 0], 0)
        self.assertEqual(mesh.element_comps[0], 1)
        self.assertEqual(mesh.comps["body"], 1)
        self.assertEqual(mesh.node_count, 1)
        self.assertEqual(mesh.element_count, 1)
        self.assertEqual(mesh.component_count, 2)

    def test_rejects_invalid_mesh_shapes(self):
        cases = (
            {
                "name": "nodes",
                "nodes": np.empty((1, 2)),
                "elements": np.empty((0, 8)),
                "element_comps": np.empty((0,)),
                "message": "nodes must have shape (n, 3+)",
            },
            {
                "name": "elements",
                "nodes": np.empty((0, 3)),
                "elements": np.empty((1, 4)),
                "element_comps": np.empty((1,)),
                "message": "elements must have shape (m, 8)",
            },
            {
                "name": "element component dimensions",
                "nodes": np.empty((0, 3)),
                "elements": np.empty((0, 8)),
                "element_comps": np.empty((0, 1)),
                "message": "element_comps must have shape (m,)",
            },
            {
                "name": "element component length",
                "nodes": np.empty((0, 3)),
                "elements": np.empty((1, 8)),
                "element_comps": np.empty((0,)),
                "message": "element_comps length must match element count",
            },
        )

        for case in cases:
            with self.subTest(case["name"]):
                with self.assertRaisesRegex(ValueError, re.escape(case["message"])):
                    Mesh3D(
                        nodes=case["nodes"],
                        elements=case["elements"],
                        element_comps=case["element_comps"],
                        comps={},
                    )

    def test_dragger_build_returns_only_owned_valid_rows(self):
        dragger = Dragger()
        dragger.node_num = 1
        dragger.nodes = np.array(
            [
                [0.0, 0.0, 0.0],
                [99.0, 99.0, 99.0],
            ],
            dtype=np.float64,
        )

        mesh = dragger.build([], 1.0)
        dragger.nodes[0, 0] = 42.0

        self.assertEqual(mesh.node_count, 1)
        self.assertEqual(mesh.nodes[0, 0], 0.0)
        self.assertFalse(np.any(mesh.nodes == 99.0))


if __name__ == "__main__":
    unittest.main()
