import tempfile
import unittest
from pathlib import Path

import numpy as np

from mesher.dragger import Dragger


class DraggerWriteTests(unittest.TestCase):
    def test_write_exports_only_valid_mesh_rows(self):
        dragger = Dragger()
        dragger.comps = {"EMPTY": 0, "body": 1}
        dragger.node_num = 2
        dragger.nodes = np.array(
            [
                [0.0, 0.0, 0.0],
                [1.25, 0.0, 1.0],
                [99.0, 99.0, 99.0],
            ],
            dtype=np.float64,
        )
        dragger.element_num = 1
        dragger.elements = np.array(
            [
                [0, 1, 1, 0, 0, 1, 1, 0],
                [99, 99, 99, 99, 99, 99, 99, 99],
            ],
            dtype=np.int32,
        )
        dragger.element_comps = np.array([1, 99], dtype=np.int32)

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "mesh.cdb"
            metadata = dragger.write(output_path)
            content = output_path.read_text(encoding="utf-8")

        self.assertEqual(metadata["nodeCount"], 2)
        self.assertEqual(metadata["elementCount"], 1)
        self.assertEqual(metadata["componentCount"], 2)
        self.assertIn("node_count=2", content)
        self.assertIn("element_count=1", content)
        self.assertIn("1.25", content)
        self.assertIn("0,0,1,1,0,0,1,1,0", content)
        self.assertNotIn("99", content)


if __name__ == "__main__":
    unittest.main()
