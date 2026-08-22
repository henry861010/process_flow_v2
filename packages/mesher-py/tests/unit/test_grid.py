import unittest

import numpy as np

from process_flow_mesher.meshing.grid import build_rectilinear_grid


class RectilinearGridTests(unittest.TestCase):
    def test_builds_expected_quad_grid(self):
        nodes, elements = build_rectilinear_grid(
            1.0,
            [0.0, 2.0],
            [0.0, 1.0],
        )

        np.testing.assert_array_equal(
            nodes,
            np.array(
                [
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [2.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [1.0, 1.0, 0.0],
                    [2.0, 1.0, 0.0],
                ],
                dtype=np.float32,
            ),
        )
        np.testing.assert_array_equal(
            elements,
            np.array([[0, 3, 4, 1], [1, 4, 5, 2]], dtype=np.int32),
        )


if __name__ == "__main__":
    unittest.main()
