from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from mesher.contracts.process_flow_2_5d import validate_mesh_control

from process_flow_api.main import create_app


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

    def test_lists_only_numbered_mesh_model_sets(self):
        listed = self.client.get("/api/mesh-control-sets")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(
            [definition["id"] for definition in listed.json()],
            ["meshModel1", "meshModel2", "meshModel3"],
        )

    def test_unknown_set_and_empty_geometry(self):
        self.assertEqual(
            self.client.post(
                "/api/mesh-control-sets/missing/apply",
                json={"geometryStructure": {}},
            ).status_code,
            404,
        )
        empty = self.client.post(
            "/api/mesh-control-sets/meshModel1/apply",
            json={"geometryStructure": {}},
        )
        self.assertEqual(empty.status_code, 200, empty.text)
        self.assertEqual(empty.json()["meshControl"]["controls"], [])

    def test_applies_all_mesh_models_and_validates_resolved_controls(self):
        structure = {
            "schemaVersion": "1.0.0",
            "unitSystem": "um",
            "root": {
                "id": "container:root",
                "bodies": [
                    {
                        "id": "body:tim",
                        "key": "tim",
                        "material": "Mat_metaltime1",
                        "geometry": {
                            "type": "BoxGeometry",
                            "bottom_left": [0, 0, 0],
                            "top_right": [100, 100, 0],
                            "thk": 10,
                        },
                    },
                    {
                        "id": "body:adh",
                        "key": "adh",
                        "material": "Adhesive",
                        "geometry": {
                            "type": "BoxGeometry",
                            "bottom_left": [0, 0, 10],
                            "top_right": [100, 100, 10],
                            "thk": 10,
                        },
                    },
                ],
                "vias": [],
                "circuits": [],
                "bumps": [],
                "children": [
                    {
                        "id": "container:soc",
                        "key": "soc",
                        "bodies": [
                            {
                                "id": "body:soc",
                                "key": "envelope",
                                "material": "Si",
                                "geometry": {
                                    "type": "BoxGeometry",
                                    "bottom_left": [0, 0, 0],
                                    "top_right": [100, 100, 0],
                                    "thk": 300,
                                },
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

        for set_id in ("meshModel1", "meshModel2", "meshModel3"):
            with self.subTest(set_id=set_id):
                response = self.client.post(
                    f"/api/mesh-control-sets/{set_id}/apply",
                    json={"geometryStructure": structure},
                )

                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertEqual(payload["setId"], set_id)
                self.assertEqual(payload["setVersion"], "1")
                validate_mesh_control(payload["meshControl"])
                self.assertEqual(
                    [item["label"] for item in payload["meshControl"]["controls"]],
                    [
                        "Tim",
                        "adh",
                        "TD_UF, noHBM Zone1 bot",
                        "TD_UF, noHBM Zone2 bot",
                        "TD_UF, noHBM Zone3",
                        "TD_UF, noHBM Zone2 top",
                        "TD_UF, noHBM Zone1 top",
                    ],
                )
                if set_id == "meshModel2":
                    self.assertEqual(
                        [
                            item["elementSize"]
                            for item in payload["meshControl"]["controls"]
                        ],
                        [250, 50, 5, 60, 120, 60, 5],
                    )
                self.assertEqual(
                    [item["label"] for item in payload["details"]],
                    [item["label"] for item in payload["meshControl"]["controls"]],
                )


if __name__ == "__main__":
    unittest.main()
