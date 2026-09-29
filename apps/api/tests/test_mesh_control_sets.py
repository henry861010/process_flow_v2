from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from mesher.contracts.process_flow_2_5d import validate_mesh_control

from process_flow_api.geometry_generation.hbm import DEFAULT_PARAMETERS, build_geometry, derive_dimensions
from process_flow_api.main import create_app
from process_flow_api.preview_sessions import content_hash


class MeshControlSetApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.tmp.name) / "test.sqlite3")
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.app.state.store.close()
        self.tmp.cleanup()

    def test_lists_and_applies_hbm_example_without_changing_geometry(self):
        listed = self.client.get("/api/mesh-control-sets")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()[0]["id"], "hbm-example")
        structure = build_geometry(DEFAULT_PARAMETERS, derive_dimensions(DEFAULT_PARAMETERS))
        result = self.client.post(
            "/api/mesh-control-sets/hbm-example/apply",
            json={"geometryStructure": structure},
        )
        self.assertEqual(result.status_code, 200, result.text)
        payload = result.json()
        self.assertEqual(payload["geometryHash"], content_hash(structure))
        self.assertEqual(payload["setVersion"], "1")
        self.assertEqual(payload["details"][-1]["label"], "Top molding")
        validate_mesh_control(payload["meshControl"])
        self.assertEqual(structure["root"]["children"][0]["id"], "container:hbm-base-die")

    def test_unknown_or_inapplicable_set(self):
        structure = build_geometry(DEFAULT_PARAMETERS, derive_dimensions(DEFAULT_PARAMETERS))
        self.assertEqual(
            self.client.post("/api/mesh-control-sets/missing/apply", json={"geometryStructure": structure}).status_code,
            404,
        )
        structure["root"]["key"] = "dram"
        result = self.client.post("/api/mesh-control-sets/hbm-example/apply", json={"geometryStructure": structure})
        self.assertEqual(result.status_code, 422)
        self.assertIn("single root HBM", result.json()["detail"])
        malformed = self.client.post(
            "/api/mesh-control-sets/hbm-example/apply",
            json={"geometryStructure": {}},
        )
        self.assertEqual(malformed.status_code, 422)


if __name__ == "__main__":
    unittest.main()
