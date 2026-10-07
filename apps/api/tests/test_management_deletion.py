from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from process_flow_api.main import create_app


class ManagementDeletionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.tmp.name) / "deletion.sqlite3")
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.store = self.app.state.store
        self.bootstrap = self.client.get("/api/bootstrap").json()
        source = self.bootstrap["processFlowInstances"][0]
        self.flow = copy.deepcopy(next(item for item in self.bootstrap["processFlowTemplates"]
                                       if item["id"] == source["processFlowTemplateId"]))
        self.flow.update(id="deletion-flow", name="Deletion flow")
        steps = {item["id"]: item for item in self.bootstrap["processStepTemplates"]}
        self.step_ids = []
        for original_id in dict.fromkeys(ref["processStepTemplateId"] for ref in self.flow["stepRefs"]):
            step = {**steps[original_id], "id": f"deletion-{original_id}"}
            response = self.client.post("/api/process-step-templates", json=step)
            self.assertEqual(response.status_code, 201, response.text)
            self.step_ids.append(step["id"])
        for ref in self.flow["stepRefs"]:
            ref["processStepTemplateId"] = f"deletion-{ref['processStepTemplateId']}"
        response = self.client.post("/api/process-flow-templates", json=self.flow)
        self.assertEqual(response.status_code, 201, response.text)
        self.instance = {**source, "id": "deletion-instance", "processFlowTemplateId": self.flow["id"]}
        self.steps_before_deletion = self.client.get("/api/process-step-templates").json()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.store.close()
        self.tmp.cleanup()

    def create_workspace(self, template_id=None):
        response = self.client.post("/api/process-flow-workspaces", json={
            "name": "Deletion workspace", "processFlowTemplateId": template_id or self.flow["id"],
            "inputBindings": self.instance["inputBindings"],
            "stepConfigurations": self.instance["stepConfigurations"],
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def commit_workspace(self, workspace, instance_id="deletion-instance"):
        response = self.client.post(f"/api/process-flow-workspaces/{workspace['id']}/commit", json={
            "revision": workspace["revision"], "instanceId": instance_id,
            "instanceName": "Deletion instance", "instanceVersion": "V0", "instanceOwner": "test",
        })
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_deleted(self, collection, identifier):
        path = f"/api/{collection}/{identifier}"
        response = self.client.delete(path)
        self.assertEqual(response.status_code, 204, response.text)
        self.assertEqual(response.content, b"")
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertNotIn(identifier, [item["id"] for item in self.client.get(f"/api/{collection}").json()])
        self.assertEqual(self.client.delete(path).status_code, 404)

    def test_instance_then_flow_and_related_workspace_cleanup_preserves_steps(self):
        draft = self.create_workspace()
        committed = self.create_workspace()
        unrelated = self.create_workspace(self.bootstrap["processFlowInstances"][0]["processFlowTemplateId"])
        self.commit_workspace(committed)
        self.assert_deleted("process-flow-instances", self.instance["id"])
        self.assertIsNone(self.store.get_process_flow_workspace(committed["id"]))
        self.assertIsNotNone(self.store.get_process_flow_workspace(draft["id"]))
        self.assert_deleted("process-flow-templates", self.flow["id"])
        self.assertIsNone(self.store.get_process_flow_workspace(draft["id"]))
        self.assertIsNotNone(self.store.get_process_flow_workspace(unrelated["id"]))
        payload = self.client.get("/api/bootstrap").json()
        self.assertEqual(payload["geometries"], self.bootstrap["geometries"])
        self.assertEqual(payload["processFlowInstances"], self.bootstrap["processFlowInstances"])
        self.assertEqual(payload["processFlowTemplates"], self.bootstrap["processFlowTemplates"])
        self.assertEqual(payload["processStepTemplates"], self.steps_before_deletion)

    def test_flow_conflict_preserves_instances_and_drafts_even_when_disabled(self):
        draft = self.create_workspace()
        response = self.client.post("/api/process-flow-instances", json=self.instance)
        self.assertEqual(response.status_code, 201, response.text)
        response = self.client.put(f"/api/process-flow-templates/{self.flow['id']}",
                                   json={**self.flow, "status": "disabled"})
        self.assertEqual(response.status_code, 200, response.text)
        before = self.client.get("/api/bootstrap").json()
        response = self.client.delete(f"/api/process-flow-templates/{self.flow['id']}")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn(self.instance["id"], response.json()["message"])
        self.assertEqual(self.client.get("/api/bootstrap").json(), before)
        self.assertEqual(self.store.get_process_flow_workspace(draft["id"]), draft)

    def test_step_deletion_is_unavailable_with_or_without_references(self):
        response = self.client.put(f"/api/process-flow-templates/{self.flow['id']}",
                                   json={**self.flow, "status": "disabled"})
        self.assertEqual(response.status_code, 200, response.text)
        for referenced in (True, False):
            with self.subTest(referenced=referenced):
                for identifier in self.step_ids:
                    response = self.client.delete(f"/api/process-step-templates/{identifier}")
                    self.assertEqual(response.status_code, 405, response.text)
                    self.assertIsNotNone(self.store.get_process_step_template(identifier))
                if referenced:
                    self.assert_deleted("process-flow-templates", self.flow["id"])

    def test_missing_resources_return_404_without_deleting_orphan_workspaces(self):
        draft = self.create_workspace()
        orphan = {**draft, "id": "orphan-draft", "processFlowTemplateId": "missing"}
        self.store.insert_process_flow_workspace(orphan)
        orphan_committed = {**draft, "id": "orphan-committed", "status": "committed",
                            "committedInstanceId": "missing"}
        self.store.insert_process_flow_workspace(orphan_committed)
        for collection in ("process-flow-instances", "process-flow-templates"):
            self.assertEqual(self.client.delete(f"/api/{collection}/missing").status_code, 404)
        self.assertEqual(self.store.get_process_flow_workspace(orphan["id"]), orphan)
        self.assertEqual(self.store.get_process_flow_workspace(orphan_committed["id"]), orphan_committed)

    def test_flow_and_instance_cascades_roll_back_if_resource_delete_fails(self):
        draft = self.create_workspace()
        committed = self.create_workspace()
        self.commit_workspace(committed)
        for table, identifier, delete, workspace in (
            ("process_flow_instances", self.instance["id"], self.store.delete_process_flow_instance, committed),
            ("process_flow_templates", self.flow["id"], self.store.delete_process_flow_template, draft),
        ):
            with self.subTest(table=table):
                with self.store._connection:
                    self.store._connection.execute(
                        f"CREATE TRIGGER reject_delete BEFORE DELETE ON {table} "
                        "BEGIN SELECT RAISE(ABORT, 'test deletion failure'); END"
                    )
                with self.assertRaises(sqlite3.IntegrityError):
                    delete(identifier)
                self.assertIsNotNone(self.store.get_process_flow_workspace(workspace["id"]))
                self.assertEqual(self.client.get(f"/api/{table.replace('_', '-')}/{identifier}").status_code, 200)
                with self.store._connection:
                    self.store._connection.execute("DROP TRIGGER reject_delete")
                if table == "process_flow_instances":
                    self.store.delete_process_flow_instance(identifier)

    def test_delete_analytics_record_resource_context_and_conflict(self):
        response = self.client.post("/api/process-flow-instances", json=self.instance)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.client.delete(f"/api/process-flow-templates/{self.flow['id']}").status_code, 409)
        self.assertEqual(self.client.delete(f"/api/process-flow-instances/{self.instance['id']}").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/process-flow-templates/{self.flow['id']}").status_code, 204)
        self.assertTrue(self.app.state.analytics.flush())
        with sqlite3.connect(self.app.state.analytics.db_path) as connection:
            connection.row_factory = sqlite3.Row
            events = [dict(row) for row in connection.execute(
                "SELECT * FROM usage_events WHERE event_name IN ('flow_template.delete', 'flow_instance.delete') ORDER BY rowid"
            )]
        self.assertEqual([event["outcome"] for event in events], ["failure", "success", "success"])
        self.assertEqual(events[0]["error_code"], "RESOURCE_CONFLICT")
        self.assertEqual(events[1]["flow_instance_id"], self.instance["id"])
        self.assertTrue(all(event["flow_template_id"] == self.flow["id"] for event in events))
        self.assertEqual(json.loads(events[2]["properties_json"])["flow_name"], self.flow["name"])
