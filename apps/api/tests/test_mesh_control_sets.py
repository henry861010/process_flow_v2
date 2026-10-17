from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from mesher.contracts.process_flow_2_5d import validate_mesh_control as validate_legacy_mesh_control
from process_flow_mesh_control import validate_mesh_control
from process_flow_kernel import normalize_geometry_structure

from process_flow_api.main import create_app


def spatial_structure(*, with_hbm):
    def body(body_id, x, y, z, thickness, *, key=None, width=40):
        result = {
            "id": body_id, "material": "Si",
            "geometry": {"type": "BoxGeometry", "bottom_left": [x, y, z],
                         "top_right": [x + width, y + width, z], "thk": thickness},
        }
        if key is not None:
            result["key"] = key
        return result

    children = []
    for name, x, y in (("lower-left", -150, -150), ("upper-left", -150, 50),
                       ("lower-right", 50, -150), ("upper-right", 50, 50)):
        bump = {**body(f"bump:{name}", x, y, 10, 10, width=10), "material": "Sn",
                "density": 50, "direction": "+z", "koz": 0, "stage": "reflowed"}
        if with_hbm:
            children.append({
                "id": f"hbm:{name}", "key": "hbm", "bumps": [bump],
                "children": [
                    {"id": f"base:{name}", "bodies": [body(
                        f"die:base:{name}", x, y, 20, 40, key="hbm.base_die",
                    )]},
                    {"id": f"top:{name}", "bodies": [body(
                        f"die:top:{name}", x, y, 80, 40, key="hbm.top_die",
                    )]},
                ],
            })
        else:
            children.append({
                "id": f"soc:{name}", "key": "soc", "bumps": [bump],
                "bodies": [body(f"si:{name}", x, y, 20, 300, key="soc.si")],
            })
    return normalize_geometry_structure({
        "id": "root", "bodies": [body("base", -200, -200, 0, 10, width=400)],
        "children": children,
    })


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

    def test_lists_builtin_mesh_control_sets(self):
        listed = self.client.get("/api/mesh-control-sets")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(
            [definition["id"] for definition in listed.json()],
            ["meshModel1", "meshModel2", "meshModel3", "meshControl3dTest"],
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
                                "key": "soc.si",
                                "material": "Si",
                                "geometry": {
                                    "type": "BoxGeometry",
                                    "bottom_left": [0, 0, 0],
                                    "top_right": [100, 100, 0],
                                    "thk": 300,
                                },
                            },
                            {
                                "id": "body:pass2",
                                "key": "soc.pass2",
                                "material": "Passivation",
                                "geometry": {
                                    "type": "BoxGeometry",
                                    "bottom_left": [0, 0, -20],
                                    "top_right": [100, 100, -20],
                                    "thk": 20,
                                },
                            },
                            {
                                "id": "body:usg",
                                "key": "soc.usg",
                                "material": "USG",
                                "geometry": {
                                    "type": "BoxGeometry",
                                    "bottom_left": [0, 0, 300],
                                    "top_right": [100, 100, 300],
                                    "thk": 20,
                                },
                            },
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
                uf_controls = payload["meshControl"]["controls"][2:]
                self.assertEqual(
                    [(item["startZ"], item["endZ"]) for item in uf_controls],
                    [(250, 300), (190, 250), (110, 190), (50, 110), (0, 50)],
                )
                for item in uf_controls:
                    self.assertNotIn("reference", item)
                    self.assertEqual(item["coordinateMode"], "absolute")
                self.assertEqual(
                    [item["sourceIds"] for item in payload["details"][2:]],
                    [["body:soc"]] * 5,
                )
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

    def test_all_models_return_valid_bottom_carrier_point(self):
        structure = {
            "schemaVersion": "1.0.0",
            "unitSystem": "um",
            "root": {
                "id": "container:root",
                "bodies": [
                    {
                        "id": "body:carrier",
                        "key": "carrier",
                        "material": "Glass",
                        "geometry": {
                            "type": "BoxGeometry",
                            "bottom_left": [0, 0, -100],
                            "top_right": [100, 100, -100],
                            "thk": 100,
                        },
                    }
                ],
                "vias": [],
                "circuits": [],
                "bumps": [],
                "children": [],
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
                validate_mesh_control(payload["meshControl"])
                self.assertEqual(
                    payload["meshControl"]["controls"],
                    [
                        {
                            "method": "Z_POINT",
                            "coordinateMode": "reference",
                            "label": "Carrier bottom +10",
                            "reference": {"kind": "body", "id": "body:carrier"},
                            "z": {"anchor": "z_min", "offset": 10},
                        }
                    ],
                )
                self.assertEqual(payload["details"][0]["startZ"], -90)
                self.assertEqual(payload["details"][0]["endZ"], -90)

    def test_all_models_preserve_selected_sources_and_uniform_modes_for_each_symmetry(self):
        for with_hbm in (True, False):
            structure = spatial_structure(with_hbm=with_hbm)
            snapshot = copy.deepcopy(structure)
            for set_id in ("meshModel1", "meshModel2", "meshModel3"):
                response = self.client.post(
                    f"/api/mesh-control-sets/{set_id}/apply", json={"geometryStructure": structure},
                )
                self.assertEqual(response.status_code, 200, response.text)
                payload = response.json()
                self.assertTrue(all(source.endswith(":upper-right")
                                    for detail in payload["details"] for source in detail["sourceIds"]))
                for symmetry in ("full", "upper_half", "right_half", "upper_right_quarter"):
                    with self.subTest(set_id=set_id, with_hbm=with_hbm, symmetry=symmetry):
                        document = copy.deepcopy(payload["meshControl"])
                        document["symmetry"] = symmetry
                        validate_mesh_control(document)
                        self.assertEqual(document["controls"][0]["coordinateMode"], "reference")
                        self.assertTrue(all(c["coordinateMode"] == "absolute" and "reference" not in c for c in document["controls"][1:]))
                        # The new contract is deliberately sent unchanged; mesher support comes later.
                        with self.assertRaisesRegex(ValueError, "coordinateMode"):
                            validate_legacy_mesh_control(document)
                        self.assertEqual(structure, snapshot)


if __name__ == "__main__":
    unittest.main()
