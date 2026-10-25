from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from flow_requests import flow_create_payload, fixture_flow
from process_flow_api.main import create_app


class ManagementDeletionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.tmp.name) / "deletion.sqlite3")
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.store = self.app.state.store
        self.bootstrap = self.client.get("/api/bootstrap").json()
        source = fixture_flow(self.bootstrap)
        self.flow = copy.deepcopy(source)
        self.flow.update(id="deletion-flow", name="Deletion flow")
        steps = {item["id"]: item for item in self.bootstrap["processStepTemplates"]}
        self.step_ids = []
        for original_id in dict.fromkeys(ref["processStepTemplateId"] for ref in self.flow["definition"]["stepRefs"]):
            step = {**steps[original_id], "id": f"deletion-{original_id}"}
            response = self.client.post("/api/process-step-templates", json=step)
            self.assertEqual(response.status_code, 201, response.text)
            self.step_ids.append(step["id"])
        for ref in self.flow["definition"]["stepRefs"]:
            ref["processStepTemplateId"] = f"deletion-{ref['processStepTemplateId']}"
        response = self.client.post("/api/process-flows", json=flow_create_payload(self.flow))
        self.assertEqual(response.status_code, 201, response.text)
        self.flow["id"] = response.json()["id"]
        self.instance = {**source, "id": "deletion-instance", "name": "Deletion instance", "origin": {"flowId": self.flow["id"], "revision": 1}, "definition": self.flow["definition"]}
        self.steps_before_deletion = self.client.get("/api/process-step-templates").json()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.store.close()
        self.tmp.cleanup()


    def assert_deleted(self, collection, identifier):
        path = f"/api/{collection}/{identifier}"
        if collection == "process-flows": path += "?revision=1"
        response = self.client.delete(path)
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(response.content, b"")
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertNotIn(identifier, [item["id"] for item in self.client.get(f"/api/{collection}").json()])
        self.assertEqual(self.client.delete(path).status_code, 404)

    def create_deletable_geometry(self):
        self.instance = copy.deepcopy(self.instance)
        binding = next(binding for binding in self.instance["configuration"]["inputBindings"].values()
                       if binding["kind"] == "catalog")
        geometry = copy.deepcopy(next(item for item in self.bootstrap["geometries"]
                                      if item["id"] == binding["geometryId"]))
        geometry.update(id="deletion-geometry", name="Deletion geometry")
        response = self.client.post("/api/geometries", json=geometry)
        self.assertEqual(response.status_code, 201, response.text)
        binding["geometryId"] = geometry["id"]
        return response.json()

    def assert_geometry_conflict(self, geometry, resource_type, resource_id):
        before = self.client.get("/api/bootstrap").json()
        drafts = self.store.list_flow_drafts()
        response = self.client.delete(f"/api/geometries/{geometry['id']}")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn(f"{resource_type} {resource_id}", response.json()["message"])
        self.assertEqual(self.client.get("/api/bootstrap").json(), before)
        self.assertEqual(self.store.list_flow_drafts(), drafts)

    def test_unreferenced_geometry_deletion_preserves_other_resources(self):
        geometry = self.create_deletable_geometry()
        before = self.client.get("/api/bootstrap").json()
        before["geometries"] = [item for item in before["geometries"] if item["id"] != geometry["id"]]
        self.assert_deleted("geometries", geometry["id"])
        self.assertEqual(self.client.get("/api/bootstrap").json(), before)
        self.assertEqual(self.client.delete("/api/geometries/missing").status_code, 404)

    def test_geometry_referenced_by_instance_is_protected_until_instance_is_deleted(self):
        geometry = self.create_deletable_geometry()
        response = self.client.post("/api/process-flows", json=flow_create_payload(self.instance))
        self.assertEqual(response.status_code, 201, response.text)
        self.instance["id"] = response.json()["id"]
        self.assert_geometry_conflict(geometry, "flow", self.instance["id"])
        self.assert_deleted("process-flows", self.instance["id"])
        self.assert_deleted("geometries", geometry["id"])


    def test_geometry_delete_failure_rolls_back_and_releases_transaction(self):
        geometry = self.create_deletable_geometry()
        before = self.client.get("/api/bootstrap").json()
        with self.store._connection:
            self.store._connection.execute(
                "CREATE TRIGGER reject_geometry_delete BEFORE DELETE ON geometries "
                "BEGIN SELECT RAISE(ABORT, 'test deletion failure'); END"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.delete_geometry(geometry["id"])
        self.assertEqual(self.client.get("/api/bootstrap").json(), before)
        with self.store._connection:
            self.store._connection.execute("DROP TRIGGER reject_geometry_delete")
        self.assert_deleted("geometries", geometry["id"])

    def test_geometry_delete_analytics_record_conflict_success_and_missing(self):
        geometry = self.create_deletable_geometry()
        response = self.client.post("/api/process-flows", json=flow_create_payload(self.instance))
        self.assertEqual(response.status_code, 201, response.text)
        self.instance["id"] = response.json()["id"]
        self.assert_geometry_conflict(geometry, "flow", self.instance["id"])
        self.assert_deleted("process-flows", self.instance["id"])
        self.assert_deleted("geometries", geometry["id"])
        self.assertTrue(self.app.state.analytics.flush())
        with sqlite3.connect(self.app.state.analytics.db_path) as connection:
            connection.row_factory = sqlite3.Row
            events = [dict(row) for row in connection.execute(
                "SELECT * FROM usage_events WHERE event_name = 'geometry.delete' ORDER BY rowid"
            )]
        self.assertEqual([event["outcome"] for event in events], ["failure", "success", "failure"])
        self.assertEqual([event["error_code"] for event in events], ["RESOURCE_CONFLICT", None, "NOT_FOUND"])
        for event in events:
            self.assertEqual(event["source_kind"], "geometry")
            self.assertEqual(json.loads(event["properties_json"])["geometry_id"], geometry["id"])
        for event in events[:2]:
            properties = json.loads(event["properties_json"])
            self.assertEqual(properties["geometry_name"], geometry["name"])
            self.assertEqual(properties["geometry_type"], geometry["entityType"])


    def test_step_deletion_is_unavailable_with_or_without_references(self):
        for referenced in (True, False):
            with self.subTest(referenced=referenced):
                for identifier in self.step_ids:
                    response = self.client.delete(f"/api/process-step-templates/{identifier}")
                    self.assertEqual(response.status_code, 405, response.text)
                    self.assertIsNotNone(self.store.get_process_step_template(identifier))
                if referenced:
                    self.assert_deleted("process-flows", self.flow["id"])


    def test_delete_analytics_record_resource_context_and_conflict(self):
        path = f"/api/process-flows/{self.flow['id']}"
        self.assertEqual(self.client.delete(path + '?revision=2').status_code, 409)
        self.assertEqual(self.client.delete(path + '?revision=1').status_code, 204)
        self.assertTrue(self.app.state.analytics.flush())
        with sqlite3.connect(self.app.state.analytics.db_path) as db:
            db.row_factory = sqlite3.Row
            events = list(db.execute("SELECT * FROM usage_events WHERE event_name='flow.delete' ORDER BY rowid"))
        self.assertEqual([event['outcome'] for event in events], ['failure', 'success'])
        self.assertTrue(all(event['flow_id'] == self.flow['id'] and event['flow_revision'] == 1 for event in events))
