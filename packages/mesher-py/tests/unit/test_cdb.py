import tempfile
import unittest
from pathlib import Path

import numpy as np

from process_flow_mesher import Mesh3D
from process_flow_mesher.exporters.cdb import write_cdb_text


class CdbWriteTests(unittest.TestCase):
    def test_write_exports_mesh_3d(self):
        mesh = Mesh3D(
            comps={"EMPTY": 0, "body": 1},
            nodes=np.array(
                [
                    [0.0, 0.0, 0.0],
                    [1.25, 0.0, 1.0],
                ],
                dtype=np.float64,
            ),
            elements=np.array(
                [[0, 1, 1, 0, 0, 1, 1, 0]],
                dtype=np.int32,
            ),
            element_comps=np.array([1], dtype=np.int32),
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "mesh.cdb"
            metadata = write_cdb_text(output_path, mesh=mesh)
            content = output_path.read_text(encoding="utf-8")

        self.assertEqual(metadata["nodeCount"], 2)
        self.assertEqual(metadata["elementCount"], 1)
        self.assertEqual(metadata["componentCount"], 2)
        self.assertIn("node_count=2", content)
        self.assertIn("element_count=1", content)
        self.assertIn("1.25", content)
        self.assertIn("0,0,1,1,0,0,1,1,0", content)


if __name__ == "__main__":
    unittest.main()
