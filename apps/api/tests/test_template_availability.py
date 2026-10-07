from __future__ import annotations

import copy
import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
import zipfile

from fastapi.testclient import TestClient

from process_flow_api.main import create_app
from process_flow_api.repository import SQLiteStore


class TemplateAvailabilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp.name) / "availability.sqlite3"
        self.app = create_app(db_path=self.db_path)
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        bootstrap = self.client.get("/api/bootstrap").json()
        self.flow = bootstrap["processFlowTemplates"][0]
        self.instance = bootstrap["processFlowInstances"][0]
        self.step = next(item for item in bootstrap["processStepTemplates"]
                         if item["id"] == self.flow["stepRefs"][0]["processStepTemplateId"])

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.app.state.store.close()
        self.tmp.cleanup()

    def set_status(self, kind, template, status):
        response = self.client.put(f"/api/process-{kind}-templates/{template['id']}",
                                   json={**template, "status": status})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def create_workspace(self):
        response = self.client.post("/api/process-flow-workspaces", json={
            "name": "Availability workspace", "processFlowTemplateId": self.flow["id"],
            "inputBindings": self.instance["inputBindings"],
            "stepConfigurations": self.instance["stepConfigurations"],
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def commit_body(self, revision):
        return {"revision": revision, "instanceId": "committed-availability",
                "instanceName": "Committed availability", "instanceVersion": "V0.0.0",
                "instanceOwner": "test", "instanceDescription": ""}

    def test_status_validation_defaults_and_updates_without_status(self):
        for kind, template in (("flow", self.flow), ("step", self.step)):
            path = f"/api/process-{kind}-templates"
            with self.subTest(kind=kind):
                for invalid in (None, "draft", True):
                    response = self.client.put(f"{path}/{template['id']}",
                                               json={**template, "status": invalid})
                    self.assertEqual(response.status_code, 422, response.text)
                    response = self.client.post(path, json={**template, "id": f"invalid-{kind}", "status": invalid})
                    self.assertEqual(response.status_code, 422, response.text)
                legacy_create = {**template, "id": f"legacy-created-{kind}"}
                legacy_create.pop("status")
                created = self.client.post(path, json=legacy_create)
                self.assertEqual(created.status_code, 201, created.text)
                self.assertEqual(created.json()["status"], "enabled")
                disabled_create = self.client.post(path, json={**template, "id": f"disabled-created-{kind}", "status": "disabled"})
                self.assertEqual(disabled_create.status_code, 201, disabled_create.text)
                self.assertEqual(disabled_create.json()["status"], "disabled")
                disabled = self.set_status(kind, template, "disabled")
                legacy_update = copy.deepcopy(disabled)
                legacy_update.pop("status")
                legacy_update["owner"] = "updated-owner"
                updated = self.client.put(f"{path}/{template['id']}", json=legacy_update)
                self.assertEqual(updated.status_code, 200, updated.text)
                self.assertEqual(updated.json()["status"], "disabled")
                self.assertEqual(self.client.get(f"{path}/{template['id']}").json()["status"], "disabled")
                self.assertEqual(next(item for item in self.client.get(path).json()
                                      if item["id"] == template["id"])["status"], "disabled")
                self.set_status(kind, updated.json(), "enabled")

    def test_disabled_flow_blocks_new_use_but_workspace_edit_and_reenable_work(self):
        workspace = self.create_workspace()
        disabled = self.set_status("flow", self.flow, "disabled")
        source = {**self.instance, "id": "new-availability-instance"}
        response = self.client.post("/api/process-flow-instances", json=source)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn(self.flow["id"], response.text)
        response = self.client.post("/api/process-flow-workspaces", json={
            "name": "Blocked", "processFlowTemplateId": self.flow["id"],
        })
        self.assertEqual(response.status_code, 409, response.text)
        update = self.client.put(f"/api/process-flow-workspaces/{workspace['id']}", json={
            "revision": workspace["revision"], "name": "Still editable",
            "inputBindings": workspace["inputBindings"],
            "stepConfigurations": workspace["stepConfigurations"],
        })
        self.assertEqual(update.status_code, 200, update.text)
        revision = update.json()["revision"]
        commit_path = f"/api/process-flow-workspaces/{workspace['id']}/commit"
        blocked = self.client.post(commit_path, json=self.commit_body(revision))
        self.assertEqual(blocked.status_code, 409, blocked.text)
        self.assertEqual(self.client.get(f"/api/process-flow-workspaces/{workspace['id']}").json()["revision"], revision)
        self.assertEqual(self.client.get("/api/process-flow-instances/committed-availability").status_code, 404)
        self.set_status("flow", disabled, "enabled")
        committed = self.client.post(commit_path, json=self.commit_body(revision))
        self.assertEqual(committed.status_code, 200, committed.text)
        self.set_status("flow", self.flow, "disabled")
        retried = self.client.post(commit_path, json=self.commit_body(revision))
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(retried.json(), committed.json())

    def test_disabled_step_blocks_new_flows_but_existing_flows_remain_usable(self):
        self.set_status("step", self.step, "disabled")
        new_flow = {**self.flow, "id": "new-availability-flow"}
        for status in ("enabled", "disabled"):
            response = self.client.post("/api/process-flow-templates", json={**new_flow, "status": status})
            self.assertEqual(response.status_code, 409, response.text)
            self.assertIn(self.step["id"], response.text)
        updated = self.client.put(f"/api/process-flow-templates/{self.flow['id']}",
                                  json={**self.flow, "description": "Still editable"})
        self.assertEqual(updated.status_code, 200, updated.text)
        instance = self.client.post("/api/process-flow-instances", json={**self.instance, "id": "new-existing-flow"})
        self.assertEqual(instance.status_code, 201, instance.text)
        workspace = self.create_workspace()
        committed = self.client.post(f"/api/process-flow-workspaces/{workspace['id']}/commit",
                                     json=self.commit_body(workspace["revision"]))
        self.assertEqual(committed.status_code, 200, committed.text)
        self.assertEqual(self.client.delete(f"/api/process-step-templates/{self.step['id']}").status_code, 409)
        self.set_status("step", self.step, "enabled")
        response = self.client.post("/api/process-flow-templates", json=new_flow)
        self.assertEqual(response.status_code, 201, response.text)

    def test_combined_create_enforces_both_rules_without_partial_writes(self):
        flow = {**self.flow, "id": "combined-availability"}
        instance = {**self.instance, "id": "combined-availability-instance", "processFlowTemplateId": flow["id"]}
        response = self.client.post("/api/process-flow-template-instances", json={
            "processFlowTemplate": {**flow, "status": "disabled"}, "processFlowInstance": instance,
        })
        self.assertEqual(response.status_code, 409, response.text)
        self.set_status("step", self.step, "disabled")
        response = self.client.post("/api/process-flow-template-instances", json={
            "processFlowTemplate": flow, "processFlowInstance": instance,
        })
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.client.get(f"/api/process-flow-templates/{flow['id']}").status_code, 404)
        self.assertEqual(self.client.get(f"/api/process-flow-instances/{instance['id']}").status_code, 404)
        self.set_status("step", self.step, "enabled")
        response = self.client.post("/api/process-flow-template-instances", json={
            "processFlowTemplate": flow, "processFlowInstance": instance,
        })
        self.assertEqual(response.status_code, 201, response.text)

    def test_disabled_templates_preserve_execution_preview_and_export(self):
        path = f"/api/process-flow-instances/{self.instance['id']}"
        before = self.client.post(f"{path}/execute")
        self.assertEqual(before.status_code, 200, before.text)
        self.set_status("flow", self.flow, "disabled")
        self.set_status("step", self.step, "disabled")
        self.assertEqual(self.client.get(path).json(), self.instance)
        after = self.client.post(f"{path}/execute")
        self.assertEqual(after.status_code, 200, after.text)
        self.assertEqual(after.json(), before.json())
        preview = self.client.post("/api/geometry-preview", json={
            "processFlowTemplateId": self.flow["id"],
            "target": {"type": "stepOutput", "stepRefId": self.flow["stepRefs"][0]["stepRefId"], "outputPortId": "result_geometry"},
            "configuration": {"inputBindings": self.instance["inputBindings"],
                              "stepConfigurations": self.instance["stepConfigurations"]},
        })
        self.assertEqual(preview.status_code, 200, preview.text)
        exported = self.client.post("/api/geometry-preview/step", json={
            "geometryStructure": after.json()["geometryStructure"],
        })
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertTrue(exported.json()["stepBase64"])

    def test_legacy_reads_persistence_and_fixture_round_trip(self):
        store = self.app.state.store
        for table, template in (("process_flow_templates", self.flow), ("process_step_templates", self.step)):
            legacy = {key: value for key, value in template.items() if key != "status"}
            with store._connection:
                store._connection.execute(f"UPDATE {table} SET payload = ? WHERE id = ?",
                                          (json.dumps(legacy), template["id"]))
        bootstrap = self.client.get("/api/bootstrap").json()
        self.assertTrue(all(item["status"] == "enabled" for key in ("processStepTemplates", "processFlowTemplates")
                            for item in bootstrap[key]))
        for table, template in (("process_flow_templates", self.flow), ("process_step_templates", self.step)):
            raw = json.loads(store._connection.execute(
                f"SELECT payload FROM {table} WHERE id = ?", (template["id"],)
            ).fetchone()["payload"])
            self.assertNotIn("status", raw)
        self.set_status("flow", self.flow, "disabled")
        self.set_status("step", self.step, "disabled")
        reopened = SQLiteStore(self.db_path)
        try:
            self.assertEqual(reopened.get_process_flow_template(self.flow["id"])["status"], "disabled")
            self.assertEqual(reopened.get_process_step_template(self.step["id"])["status"], "disabled")
            self.assertEqual(reopened.get_process_flow_instance(self.instance["id"]), self.instance)
        finally:
            reopened.close()
        archive = self.client.get("/api/fixture-export").content
        restored = self.client.post("/api/reset-from-zip", content=archive,
                                    headers={"Content-Type": "application/zip"})
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(restored.json()["processFlowTemplates"][0]["status"], "disabled")
        self.assertEqual(self.client.get(f"/api/process-step-templates/{self.step['id']}").json()["status"], "disabled")
        # Old ZIPs without status are accepted and get explicit defaults.
        output = BytesIO()
        with zipfile.ZipFile(BytesIO(archive)) as source, zipfile.ZipFile(output, "w") as target:
            for name in source.namelist():
                items = json.loads(source.read(name))
                if name in ("process-flow-templates.json", "process-step-templates.json"):
                    for item in items:
                        item.pop("status", None)
                target.writestr(name, json.dumps(items))
        restored = self.client.post("/api/reset-from-zip", content=output.getvalue(),
                                    headers={"Content-Type": "application/zip"})
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertTrue(all(item["status"] == "enabled" for key in ("processStepTemplates", "processFlowTemplates")
                            for item in restored.json()[key]))
