from __future__ import annotations

import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import process_flow_api.main as api_main
from process_flow_api.main import create_app
from process_flow_api.seed import load_seed_fixtures


class ProcessFlowApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.tmp.name) / "test.sqlite3")
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.app.state.store.close()
        self.tmp.cleanup()

    def reset_poc_data(self):
        response = self.client.post("/api/reset")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def assert_seed_payload_counts(self, payload):
        fixtures = load_seed_fixtures()
        self.assertEqual(
            len(payload["processStepTemplates"]),
            len(fixtures["processStepTemplates"]),
        )
        self.assertEqual(
            len(payload["processFlowTemplates"]),
            len(fixtures["processFlowTemplates"]),
        )
        self.assertEqual(
            len(payload["processFlowInstances"]),
            len(fixtures["processFlowInstances"]),
        )
        self.assertEqual(len(payload["geometries"]), len(fixtures["geometries"]))

    def test_health_and_startup_bootstrap(self):
        self.assertEqual(self.client.get("/api/health").json(), {"status": "ok"})

        response = self.client.get("/api/bootstrap")
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_seed_payload_counts(response.json())

    def test_existing_empty_database_is_seeded_on_startup(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            db_path = Path(tmp_name) / "existing-empty.sqlite3"
            db_path.touch()
            app = create_app(db_path=db_path)
            try:
                with TestClient(app) as client:
                    response = client.get("/api/bootstrap")
                self.assertEqual(response.status_code, 200, response.text)
                self.assert_seed_payload_counts(response.json())
            finally:
                app.state.store.close()

    def test_unversioned_database_is_replaced_with_v2_fixtures(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            db_path = Path(tmp_name) / "legacy.sqlite3"
            connection = sqlite3.connect(db_path)
            connection.execute(
                """
                CREATE TABLE process_flow_templates (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  version TEXT NOT NULL,
                  owner TEXT NOT NULL,
                  payload TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "INSERT INTO process_flow_templates VALUES (?, ?, ?, ?, ?)",
                ("legacy", "Legacy", "V1.0.0", "test", '{"id":"legacy"}'),
            )
            connection.commit()
            connection.close()

            app = create_app(db_path=db_path)
            try:
                with TestClient(app) as client:
                    payload = client.get("/api/bootstrap").json()
                self.assert_seed_payload_counts(payload)
                self.assertTrue(
                    all(
                        item["schemaVersion"] == 2
                        for item in payload["processFlowTemplates"]
                    )
                )
            finally:
                app.state.store.close()

    def test_reset_reloads_poc_data(self):
        source = self.client.get("/api/bootstrap").json()["processFlowInstances"][0]
        instance = {**source, "id": "flow_inst_reset_test", "name": "Reset Test"}
        created = self.client.post("/api/process-flow-instances", json=instance)
        self.assertEqual(created.status_code, 201, created.text)

        payload = self.reset_poc_data()

        self.assert_seed_payload_counts(payload)
        self.assertNotIn(
            "flow_inst_reset_test",
            {instance["id"] for instance in payload["processFlowInstances"]},
        )

    def test_admin_seed_endpoint_is_removed(self):
        response = self.client.post("/api/admin/seed", json={"mode": "reset"})

        self.assertEqual(response.status_code, 404, response.text)

    def test_step_template_create_duplicate_and_delete(self):
        self.reset_poc_data()
        template = {
            "schemaVersion": 2,
            "id": "custom_step",
            "version": "V2.0.0",
            "name": "Custom step",
            "category": "custom",
            "program": "layer/molding",
            "description": "",
            "owner": "test",
            "inputPorts": [
                {
                    "portId": "main_geometry",
                    "name": "Main geometry",
                    "dataType": "geometry",
                    "role": "primary",
                    "required": True,
                }
            ],
            "outputPorts": [
                {
                    "portId": "result_geometry",
                    "name": "Result geometry",
                    "dataType": "geometry",
                }
            ],
            "parameterDefinitions": [],
        }

        created = self.client.post("/api/process-step-templates", json=template)
        self.assertEqual(created.status_code, 201, created.text)
        duplicate = self.client.post("/api/process-step-templates", json=template)
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        deleted = self.client.delete("/api/process-step-templates/custom_step")
        self.assertEqual(deleted.status_code, 204, deleted.text)
        missing = self.client.get("/api/process-step-templates/custom_step")
        self.assertEqual(missing.status_code, 404, missing.text)

    def test_referenced_step_template_cannot_be_deleted(self):
        bootstrap = self.reset_poc_data()
        step_template_id = bootstrap["processFlowTemplates"][0]["stepRefs"][0][
            "processStepTemplateId"
        ]

        response = self.client.delete(f"/api/process-step-templates/{step_template_id}")

        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("is referenced by flow template", response.json()["message"])
        self.assertEqual(
            self.client.get(f"/api/process-step-templates/{step_template_id}").status_code,
            200,
        )

    def test_step_template_rejects_legacy_geometry_value_type(self):
        self.reset_poc_data()
        template = {
            "schemaVersion": 2,
            "id": "legacy_geometry_step",
            "version": "V2.0.0",
            "name": "Legacy geometry step",
            "category": "custom",
            "program": "layer/molding",
            "description": "",
            "owner": "test",
            "fieldDefinitions": [
                {
                    "id": "main_geometry",
                    "name": "main_geometry",
                    "scope": "inputState",
                    "valueType": "geometryRef",
                    "controlType": None,
                    "selectionMode": None,
                    "unit": None,
                }
            ],
        }

        response = self.client.post("/api/process-step-templates", json=template)

        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("geometryRef", response.text)

    def test_geometry_import_assigns_id_for_preview_json(self):
        self.reset_poc_data()
        geometry = {
            "id": None,
            "category": "preview.generated",
            "entityType": "preview",
            "name": "Preview Artifact",
            "version": None,
            "owner": None,
            "description": "generated",
            "structureFormat": "standard",
            "structure": simple_structure(),
        }

        response = self.client.post("/api/geometries", json=geometry)

        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["id"].startswith("geom_preview_artifact_"))

    def test_create_from_template_instance(self):
        bootstrap = self.reset_poc_data()
        source = bootstrap["processFlowInstances"][0]
        instance = {**source, "id": "flow_inst_test_copy", "name": "Test Copy"}

        response = self.client.post("/api/process-flow-instances", json=instance)

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["id"], "flow_inst_test_copy")

    def test_create_template_and_bound_instance_transaction(self):
        self.reset_poc_data()
        template = {
            "schemaVersion": 2,
            "id": "flow_tpl_transaction_test",
            "name": "Transaction Test",
            "version": "V2.0.0",
            "description": "",
            "owner": "test",
            "flowInputs": [
                {
                    "flowInputId": "incoming_panel",
                    "name": "Incoming panel",
                    "dataType": "geometry",
                    "required": True,
                }
            ],
            "stepRefs": [
                {
                    "stepRefId": "molding",
                    "stepLabel": "molding",
                    "processStepTemplateId": "step_tpl_molding_2_0_0",
                }
            ],
            "flowEdges": [
                {
                    "edgeId": "edge_input_to_molding",
                    "source": {"kind": "flowInput", "flowInputId": "incoming_panel"},
                    "target": {"stepRefId": "molding", "inputPortId": "main_geometry"},
                }
            ],
        }
        instance = {
            "schemaVersion": 2,
            "id": "flow_inst_transaction_test",
            "name": "Transaction Test Instance",
            "processFlowTemplateId": "flow_tpl_transaction_test",
            "inputBindings": {
                "incoming_panel": {"kind": "catalog", "geometryId": "panel_v1_0_0"}
            },
            "stepConfigurations": {
                "molding": {
                    "parameterValues": {
                        "material": "EMC",
                        "thickness": 10,
                        "workingTemp": 175,
                    }
                }
            },
        }

        response = self.client.post(
            "/api/process-flow-template-instances",
            json={"processFlowTemplate": template, "processFlowInstance": instance},
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["processFlowTemplate"]["id"], template["id"])
        self.assertEqual(
            response.json()["processFlowTemplate"]["stepRefs"][0]["stepLabel"],
            "molding",
        )
        self.assertEqual(response.json()["processFlowInstance"]["id"], instance["id"])

    def test_execute_saved_instance(self):
        self.reset_poc_data()

        response = self.client.post("/api/process-flow-instances/flow_inst_cowosl_demo_hbm4_alpha/execute")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertIn("geometryStructure", payload)
        self.assertIn("terminalStepRefIds", payload)
        self.assertGreater(len(payload["stepOutputs"]), 0)

    def test_preview_and_step_export(self):
        bootstrap = self.reset_poc_data()
        flow_template = bootstrap["processFlowTemplates"][0]
        instance = bootstrap["processFlowInstances"][0]

        preview = self.client.post(
            "/api/geometry-preview",
            json={
                "target": {"type": "flowInput", "flowInputId": "incoming_panel"},
                "sourceLabel": "Panel input",
                "flowTemplate": flow_template,
                "configuration": {
                    "inputBindings": instance["inputBindings"],
                    "stepConfigurations": instance["stepConfigurations"],
                    "embeddedGeometries": {},
                },
            },
        )
        self.assertEqual(preview.status_code, 200, preview.text)
        preview_payload = preview.json()
        self.assertIn("glbBase64", preview_payload)
        self.assertEqual(preview_payload["geometryEntityJson"]["entityType"], "preview")

        draft_template = {**flow_template, "id": ""}
        draft_preview = self.client.post(
            "/api/geometry-preview",
            json={
                "target": {"type": "flowInput", "flowInputId": "incoming_panel"},
                "sourceLabel": "Unsaved panel input",
                "flowTemplate": draft_template,
                "configuration": {
                    "inputBindings": instance["inputBindings"],
                    "stepConfigurations": instance["stepConfigurations"],
                    "embeddedGeometries": {},
                },
            },
        )
        self.assertEqual(draft_preview.status_code, 200, draft_preview.text)
        self.assertIn("glbBase64", draft_preview.json())

        draft_step_preview = self.client.post(
            "/api/geometry-preview",
            json={
                "target": {
                    "type": "stepOutput",
                    "stepRefId": flow_template["stepRefs"][-1]["stepRefId"],
                    "outputPortId": "result_geometry",
                },
                "sourceLabel": "Unsaved terminal step",
                "flowTemplate": draft_template,
                "configuration": {
                    "inputBindings": instance["inputBindings"],
                    "stepConfigurations": instance["stepConfigurations"],
                    "embeddedGeometries": {},
                },
            },
        )
        self.assertEqual(
            draft_step_preview.status_code,
            200,
            draft_step_preview.text,
        )
        self.assertIn("glbBase64", draft_step_preview.json())

        rejected_save = self.client.post(
            "/api/process-flow-templates",
            json=draft_template,
        )
        self.assertEqual(rejected_save.status_code, 422, rejected_save.text)

        step = self.client.post(
            "/api/geometry-preview/step",
            json={"geometryStructure": preview_payload["geometryEntityJson"]["structure"]},
        )
        self.assertEqual(step.status_code, 200, step.text)
        self.assertIn("stepBase64", step.json())

    def test_workspace_save_reload_stale_update_and_commit(self):
        bootstrap = self.reset_poc_data()
        template = bootstrap["processFlowTemplates"][0]
        source = bootstrap["processFlowInstances"][0]

        created = self.client.post(
            "/api/process-flow-workspaces",
            json={
                "name": "Workspace study",
                "processFlowTemplateId": template["id"],
                "inputBindings": {},
                "stepConfigurations": {},
                "embeddedGeometries": {},
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        workspace = created.json()
        self.assertEqual(workspace["revision"], 1)

        update_payload = {
            "name": "Workspace study complete",
            "revision": 1,
            "inputBindings": source["inputBindings"],
            "stepConfigurations": source["stepConfigurations"],
            "embeddedGeometries": {},
        }
        updated = self.client.put(
            f"/api/process-flow-workspaces/{workspace['id']}",
            json=update_payload,
        )
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["revision"], 2)
        loaded = self.client.get(f"/api/process-flow-workspaces/{workspace['id']}")
        self.assertEqual(loaded.json(), updated.json())

        stale = self.client.put(
            f"/api/process-flow-workspaces/{workspace['id']}",
            json=update_payload,
        )
        self.assertEqual(stale.status_code, 409, stale.text)

        committed = self.client.post(
            f"/api/process-flow-workspaces/{workspace['id']}/commit",
            json={
                "instanceId": "flow_inst_workspace_commit",
                "instanceName": "Workspace Commit",
                "revision": 2,
            },
        )
        self.assertEqual(committed.status_code, 200, committed.text)
        self.assertEqual(committed.json()["workspace"]["status"], "committed")
        self.assertEqual(
            committed.json()["processFlowInstance"]["id"],
            "flow_inst_workspace_commit",
        )

        retried = self.client.post(
            f"/api/process-flow-workspaces/{workspace['id']}/commit",
            json={
                "instanceId": "ignored_retry_id",
                "instanceName": "Ignored retry",
                "revision": 2,
            },
        )
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(
            retried.json()["processFlowInstance"]["id"],
            "flow_inst_workspace_commit",
        )

    def test_workspace_commit_materializes_embedded_geometry(self):
        bootstrap = self.reset_poc_data()
        source = bootstrap["processFlowInstances"][0]
        hbm = next(geometry for geometry in bootstrap["geometries"] if geometry["id"] == "hbm_v1_3_1")
        bindings = dict(source["inputBindings"])
        bindings["incoming_hbm"] = {"kind": "embedded", "localId": "draft_hbm"}
        embedded_geometry = {key: value for key, value in hbm.items() if key != "id"}

        created = self.client.post(
            "/api/process-flow-workspaces",
            json={
                "name": "Embedded HBM study",
                "processFlowTemplateId": source["processFlowTemplateId"],
                "inputBindings": bindings,
                "stepConfigurations": source["stepConfigurations"],
                "embeddedGeometries": {"draft_hbm": embedded_geometry},
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        workspace = created.json()
        committed = self.client.post(
            f"/api/process-flow-workspaces/{workspace['id']}/commit",
            json={
                "instanceId": "flow_inst_embedded_commit",
                "instanceName": "Embedded Commit",
                "revision": 1,
            },
        )
        self.assertEqual(committed.status_code, 200, committed.text)
        binding = committed.json()["processFlowInstance"]["inputBindings"]["incoming_hbm"]
        self.assertEqual(binding["kind"], "catalog")
        self.assertTrue(binding["geometryId"].startswith("geom_hbm3_"))
        workspace_payload = committed.json()["workspace"]
        self.assertEqual(workspace_payload["inputBindings"]["incoming_hbm"], binding)
        self.assertEqual(workspace_payload["embeddedGeometries"], {})
        saved_geometry = self.client.get(f"/api/geometries/{binding['geometryId']}")
        self.assertEqual(saved_geometry.status_code, 200, saved_geometry.text)

    def test_cdb_export_job_writes_text_cdb_file(self):
        output_path = Path(self.tmp.name) / "MODEL.CDB"

        response = self.client.post(
            "/api/geometry-preview/cdb-jobs",
            json={
                "clientId": "client-a",
                "geometryStructure": simple_structure(),
                "elementSize": 5,
                "outputPath": str(output_path),
                "sourceLabel": "Unit test",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        job = wait_for_export_job(self.client, response.json()["job"]["jobId"], "client-a")
        normalized_output_path = Path(self.tmp.name) / "MODEL.cdb"
        self.assertEqual(job["status"], "success", job)
        self.assertEqual(job["outputPath"], str(normalized_output_path))
        self.assertGreater(job["nodeCount"], 0)
        self.assertGreater(job["elementCount"], 0)
        self.assertTrue(normalized_output_path.exists())
        content = normalized_output_path.read_text(encoding="utf-8")
        self.assertIn("*NODES,index,x,y,z", content)
        self.assertIn("*ELEMENTS,index,n0,n1,n2,n3,n4,n5,n6,n7", content)
        self.assertIn("*COMPS,component_id,name", content)

    def test_json_export_job_writes_geometry_entity_file(self):
        output_path = Path(self.tmp.name) / "PREVIEW.JSON"
        geometry_entity = preview_geometry_entity()

        response = self.client.post(
            "/api/geometry-preview/export-jobs",
            json={
                "clientId": "client-json",
                "kind": "json",
                "geometryEntityJson": geometry_entity,
                "outputPath": str(output_path),
                "sourceLabel": "JSON unit test",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        job = wait_for_export_job(self.client, response.json()["job"]["jobId"], "client-json")
        normalized_output_path = Path(self.tmp.name) / "PREVIEW.json"
        self.assertEqual(job["status"], "success", job)
        self.assertEqual(job["kind"], "json")
        self.assertEqual(job["outputPath"], str(normalized_output_path))
        self.assertIsNone(job["elementSize"])
        self.assertTrue(normalized_output_path.exists())
        content = normalized_output_path.read_text(encoding="utf-8")
        self.assertEqual(json.loads(content), geometry_entity)
        self.assertIn('\n  "entityType": "preview"', content)
        jobs = self.client.get("/api/export-jobs?clientId=client-json")
        self.assertEqual(jobs.status_code, 200, jobs.text)
        self.assertIn(job["jobId"], [candidate["jobId"] for candidate in jobs.json()["jobs"]])

    def test_step_export_job_writes_step_file(self):
        output_path = Path(self.tmp.name) / "MODEL.STEP"

        response = self.client.post(
            "/api/geometry-preview/export-jobs",
            json={
                "clientId": "client-step",
                "kind": "step",
                "geometryStructure": simple_structure(),
                "outputPath": str(output_path),
                "sourceLabel": "STEP unit test",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        job = wait_for_export_job(self.client, response.json()["job"]["jobId"], "client-step")
        normalized_output_path = Path(self.tmp.name) / "MODEL.step"
        self.assertEqual(job["status"], "success", job)
        self.assertEqual(job["kind"], "step")
        self.assertEqual(job["outputPath"], str(normalized_output_path))
        self.assertTrue(normalized_output_path.exists())
        content = normalized_output_path.read_text(encoding="utf-8", errors="replace")
        self.assertIn("ISO-10303-21", content)

    def test_cdb_export_job_rejects_non_cdb_extension(self):
        response = self.client.post(
            "/api/geometry-preview/cdb-jobs",
            json={
                "clientId": "client-a",
                "geometryStructure": simple_structure(),
                "elementSize": 5,
                "outputPath": str(Path(self.tmp.name) / "mesh.txt"),
            },
        )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn(".cdb", response.json()["message"])

    def test_export_job_rejects_wrong_generic_extension(self):
        response = self.client.post(
            "/api/geometry-preview/export-jobs",
            json={
                "clientId": "client-a",
                "kind": "step",
                "geometryStructure": simple_structure(),
                "outputPath": str(Path(self.tmp.name) / "model.stp"),
            },
        )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn(".step", response.json()["message"])

    def test_file_export_jobs_are_filtered_by_client_id(self):
        response = self.client.post(
            "/api/geometry-preview/cdb-jobs",
            json={
                "clientId": "client-a",
                "geometryStructure": simple_structure(),
                "elementSize": 5,
                "outputPath": str(Path(self.tmp.name) / "mesh.cdb"),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)

        own_jobs = self.client.get("/api/export-jobs?clientId=client-a")
        other_jobs = self.client.get("/api/export-jobs?clientId=client-b")

        self.assertEqual(own_jobs.status_code, 200, own_jobs.text)
        self.assertEqual(other_jobs.status_code, 200, other_jobs.text)
        self.assertGreaterEqual(len(own_jobs.json()["jobs"]), 1)
        self.assertEqual(other_jobs.json()["jobs"], [])

    def test_file_export_job_cancel_queued(self):
        self.app.state.file_export_jobs.max_concurrent_jobs = 0
        output_path = Path(self.tmp.name) / "queued.cdb"
        response = self.client.post(
            "/api/geometry-preview/cdb-jobs",
            json={
                "clientId": "client-a",
                "geometryStructure": simple_structure(),
                "elementSize": 5,
                "outputPath": str(output_path),
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        job_id = response.json()["job"]["jobId"]
        self.assertEqual(response.json()["job"]["status"], "queued")

        cancel = self.client.post(
            f"/api/export-jobs/{job_id}/cancel",
            json={"clientId": "client-a"},
        )

        self.assertEqual(cancel.status_code, 200, cancel.text)
        self.assertEqual(cancel.json()["job"]["status"], "canceled")
        self.assertFalse(output_path.exists())


def preview_geometry_entity():
    return {
        "id": None,
        "category": "preview.generated",
        "entityType": "preview",
        "name": "Preview - unit output",
        "version": None,
        "owner": None,
        "description": "generated",
        "structureFormat": "standard",
        "structure": simple_structure(),
    }


def simple_structure():
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "key": "test",
            "bodies": [
                {
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [0, 0, 0],
                        "top_right": [10, 10, 0],
                        "thk": 1,
                    },
                    "material": "test",
                }
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": [],
        },
    }


def wait_for_export_job(client: TestClient, job_id: str, client_id: str):
    for _ in range(80):
        response = client.get(f"/api/export-jobs/{job_id}?clientId={client_id}")
        if response.status_code != 200:
            raise AssertionError(response.text)
        job = response.json()["job"]
        if job["status"] in {"success", "failed", "canceled"}:
            return job
        time.sleep(0.1)
    raise AssertionError(f"Timed out waiting for export job {job_id}")

def tearDownModule():
    api_main.app.state.store.close()


if __name__ == "__main__":
    unittest.main()
