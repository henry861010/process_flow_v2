from __future__ import annotations

import copy
import unittest

from fastapi.testclient import TestClient
from flow_requests import instance_create_payload
from process_flow_api.geometry_validation import validate_catalog_structure
from process_flow_api.main import create_app
from process_flow_api.seed import load_seed_fixtures


def box():
    return {"type": "BoxGeometry", "bottom_left": [0, 0, 0], "top_right": [20, 20, 0], "thk": 5}


def entity(root=None):
    return {"name": "Custom geometry", "entityType": "die", "owner": "engineering", "dim": "",
            "structureFormat": "standard", "structure": {"schemaVersion": "1.0.0", "unitSystem": "um",
            "root": root if root is not None else {"bodies": [{"geometry": box(), "material": "Si"}]}}}


class GeometryCreationTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(db_path=":memory:", analytics_db_path=":memory:")
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.app.state.store.close()

    def test_create_normalizes_and_is_available_in_catalog_bootstrap_and_search(self):
        payload = entity({"id": "custom-root", "bodies": [{"id": "custom-body", "geometry": box(), "material": "Si"}],
                          "children": [{"bodies": [{"geometry": box(), "material": "Cu"}]}]})
        payload.update(category="new.custom", vendor="Custom vendor", type1="memory", type2="stack", icon="die.stack", iconScale=0.5)
        response = self.client.post("/api/geometries", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        saved = response.json()
        self.assertTrue(saved["id"])
        root = saved["structure"]["root"]
        self.assertEqual(root["id"], "custom-root")
        self.assertEqual(root["bodies"][0]["id"], "custom-body")
        for collection in ("vias", "circuits", "bumps"):
            self.assertEqual(root[collection], [])
        child = root["children"][0]
        self.assertTrue(child["id"])
        self.assertTrue(child["bodies"][0]["id"])
        self.assertEqual(child["children"], [])
        self.assertEqual(self.client.get(f"/api/geometries/{saved['id']}").json(), saved)
        self.assertIn(saved, self.client.get("/api/bootstrap").json()["geometries"])
        self.assertIn(saved, self.client.get("/api/geometries", params={"search": "Custom vendor", "entityType": "die", "category": "new.custom"}).json())

    def test_accepts_all_primitives_and_feature_kinds(self):
        primitives = [box(),
                      {"type": "CylinderGeometry", "center": [0, 0, 0], "bottom_radius": 5, "thk": 5},
                      {"type": "ConeGeometry", "center": [0, 0, 0], "bottom_radius": 5, "top_radius": 3, "thk": 5},
                      {"type": "PolygonGeometry", "polys": [[[0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0], [0, 0, 0]]], "thk": 5}]
        root = {"bodies": [{"material": "Si", "geometry": primitive} for primitive in primitives]}
        for kind in ("vias", "circuits", "bumps"):
            feature = {"geometry": primitives[1], "material": "Cu", "density": 100, "koz": 0}
            if kind != "circuits":
                feature["direction"] = "+z"
            root[kind] = [feature]
        response = self.client.post("/api/geometries", json=entity(root))
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(len(response.json()["structure"]["root"]["bodies"][3]["geometry"]["polys"][0]), 4)

    def test_empty_structure_and_optional_owner_are_valid_at_api_boundary(self):
        payload = entity({})
        payload.pop("owner")
        response = self.client.post("/api/geometries", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["structure"]["root"]["bodies"], [])

    def test_manual_geometry_can_bind_to_a_process_flow_instance(self):
        payload = entity()
        payload["category"] = "die.hbm.custom"
        response = self.client.post("/api/geometries", json=payload)
        self.assertEqual(response.status_code, 201, response.text)
        saved = response.json()
        bootstrap = self.client.get("/api/bootstrap").json()
        source = copy.deepcopy(bootstrap["processFlowInstances"][0])
        source["name"] = "Manual JSON flow binding"
        source["inputBindings"]["incoming_hbm"] = {"kind": "catalog", "geometryId": saved["id"]}
        response = self.client.post("/api/process-flow-instances", json=instance_create_payload(source))
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["inputBindings"]["incoming_hbm"]["geometryId"], saved["id"])

    def test_hbm_and_dram_generator_materializations_can_still_be_saved(self):
        for generator in ("hbm", "dram"):
            with self.subTest(generator=generator):
                response = self.client.post(f"/api/geometry-generators/{generator}/preview", json={"generatorVersion": 2, "parameters": {}})
                self.assertEqual(response.status_code, 200, response.text)
                preview = response.json()
                self.assertTrue(preview["valid"])
                materialized = self.client.post("/api/geometry-materializations", json={"previewToken": preview["previewToken"]})
                self.assertEqual(materialized.status_code, 200, materialized.text)
                generated = materialized.json()["geometryEntityJson"]
                response = self.client.post("/api/geometries", json={**generated, "name": f"Saved {generator}", "owner": "QA"})
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json()["structure"], generated["structure"])
                self.assertEqual(response.json()["generation"], generated["generation"])

    def test_invalid_structures_never_write_and_errors_include_field_paths(self):
        cases = []

        def add(path, value, expected):
            payload = entity()
            target = payload
            for field in path[:-1]:
                target = target[field]
            target[path[-1]] = value
            cases.append((payload, expected))

        add(["structureFormat"], "custom", "structureFormat")
        add(["structure", "schemaVersion"], "2.0.0", "structure.schemaVersion")
        add(["structure", "unitSystem"], "mm", "structure.unitSystem")
        add(["structure", "root"], [], "structure.root")
        add(["structure", "root", "children"], None, "structure.root.children")
        add(["structure", "root", "bodies"], {}, "structure.root.bodies")
        add(["structure", "root", "key"], "unknown", "structure.root.key")
        add(["structure", "root", "id"], None, "structure.root.id")
        base = ["structure", "root", "bodies", 0]
        add([*base, "material"], " ", "bodies[0].material")
        add([*base, "key"], None, "bodies[0].key")
        add([*base, "density"], 50, "bodies[0].density")
        add([*base, "geometry", "type"], "UnknownGeometry", "geometry.type")
        for value in (0, -1, True, "5"):
            add([*base, "geometry", "thk"], value, "geometry.thk")
        add([*base, "geometry", "bottom_left"], [0, 0], "geometry.bottom_left")
        add([*base, "geometry", "top_right"], [0, 0, 0], "geometry.top_right")
        add([*base, "geometry", "top_right"], [20, 20, 1], "geometry.top_right")
        add([*base, "geometry"], {"type": "CylinderGeometry", "center": [0, 0, 0], "bottom_radius": 0, "thk": 5}, "bottom_radius")
        add([*base, "geometry"], {"type": "PolygonGeometry", "polys": [[[0, 0, 0], [20, 20, 0], [0, 20, 0], [20, 0, 0]]], "thk": 5}, "geometry.polys")
        add(["structure", "root", "children"], [{"bodies": [{"material": "Cu", "geometry": {**box(), "thk": -1}}]}], "children[0].bodies[0].geometry.thk")
        duplicate = entity({"id": "duplicate", "bodies": [{"id": "duplicate", "material": "Si", "geometry": box()}]})
        cases.append((duplicate, "structure.root"))
        for kind in ("vias", "circuits", "bumps"):
            feature = {"geometry": box(), "material": "Cu", "density": 50, "koz": 0}
            if kind != "circuits":
                feature["direction"] = "+z"
            for field, value in (("density", -1), ("density", 101), ("density", True), ("koz", -1), ("key", "hbm")):
                invalid = {**feature, field: value}
                cases.append((entity({kind: [invalid]}), f"{kind}[0].{field}"))
            if kind != "circuits":
                for value in (None, "z"):
                    cases.append((entity({kind: [{**feature, "direction": value}]}), f"{kind}[0].direction"))
        count = len(self.client.get("/api/geometries").json())
        for payload, path in cases:
            with self.subTest(path=path, payload=payload):
                response = self.client.post("/api/geometries", json=payload)
                self.assertEqual(response.status_code, 400, response.text)
                self.assertIn(path, response.json()["message"])
                self.assertEqual(len(self.client.get("/api/geometries").json()), count)

    def test_nonfinite_numbers_and_missing_required_primitive_fields(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            payload = entity()
            payload["structure"]["root"]["bodies"][0]["geometry"]["thk"] = value
            with self.assertRaisesRegex(ValueError, r"geometry.thk"):
                validate_catalog_structure(payload)
        payload = entity()
        payload["structure"]["root"]["bodies"][0]["geometry"].pop("bottom_left")
        with self.assertRaisesRegex(ValueError, "bottom_left"):
            validate_catalog_structure(payload)

    def test_metadata_validation_remains_422(self):
        for field, value in (("name", " "), ("entityType", ""), ("iconScale", 0), ("dim", None)):
            payload = {**entity(), field: value}
            response = self.client.post("/api/geometries", json=payload)
            self.assertEqual(response.status_code, 422, response.text)

    def test_seed_geometry_contract_is_compatible_and_helper_does_not_mutate_input(self):
        for payload in load_seed_fixtures()["geometries"]:
            with self.subTest(id=payload["id"]):
                original = copy.deepcopy(payload)
                validate_catalog_structure(payload)
                self.assertEqual(payload, original)
