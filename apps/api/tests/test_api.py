from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import process_flow_api.main as api_main
from process_flow_api.main import create_app


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
        self.assertEqual(len(payload["processStepTemplates"]), 13)
        self.assertEqual(len(payload["processFlowTemplates"]), 2)
        self.assertEqual(len(payload["processFlowInstances"]), 3)
        self.assertEqual(len(payload["geometries"]), 5)

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
            "id": "custom_step",
            "version": "V1.0.0",
            "name": "Custom step",
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

        created = self.client.post("/api/process-step-templates", json=template)
        self.assertEqual(created.status_code, 201, created.text)
        duplicate = self.client.post("/api/process-step-templates", json=template)
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        deleted = self.client.delete("/api/process-step-templates/custom_step")
        self.assertEqual(deleted.status_code, 204, deleted.text)
        missing = self.client.get("/api/process-step-templates/custom_step")
        self.assertEqual(missing.status_code, 404, missing.text)

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
            "id": "flow_tpl_transaction_test",
            "name": "Transaction Test",
            "version": "V1.0.0",
            "description": "",
            "owner": "test",
            "stepRefs": [
                {
                    "stepRefId": "molding",
                    "processStepTemplateId": "step_tpl_molding_1_0_0",
                }
            ],
            "flowEdges": [
                {
                    "edgeId": "edge_input_to_molding",
                    "source": {"sourceType": "geometryRef"},
                    "target": {"stepRefId": "molding", "targetFieldId": "main_geometry"},
                }
            ],
        }
        instance = {
            "id": "flow_inst_transaction_test",
            "name": "Transaction Test Instance",
            "processFlowTemplateId": "flow_tpl_transaction_test",
            "stepValueSets": [
                {
                    "stepRefId": "molding",
                    "processStepTemplateId": "step_tpl_molding_1_0_0",
                    "fieldValues": [
                        {"fieldId": "main_geometry", "value": "geom_example_panel"},
                        {"fieldId": "material", "value": "EMC"},
                        {"fieldId": "thickness", "value": 10},
                    ],
                }
            ],
        }

        response = self.client.post(
            "/api/process-flow-template-instances",
            json={"processFlowTemplate": template, "processFlowInstance": instance},
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["processFlowTemplate"]["id"], template["id"])
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
        draft_instance = bootstrap["processFlowInstances"][0]

        preview = self.client.post(
            "/api/geometry-preview",
            json={
                "target": {"type": "edge", "previewEdgeId": "edge_cowosl_panel_to_pnp_main"},
                "sourceLabel": "Panel input",
                "flowTemplate": flow_template,
                "draftInstance": draft_instance,
            },
        )
        self.assertEqual(preview.status_code, 200, preview.text)
        preview_payload = preview.json()
        self.assertIn("glbBase64", preview_payload)
        self.assertEqual(preview_payload["geometryEntityJson"]["entityType"], "preview")

        step = self.client.post(
            "/api/geometry-preview/step",
            json={"geometryStructure": preview_payload["geometryEntityJson"]["structure"]},
        )
        self.assertEqual(step.status_code, 200, step.text)
        self.assertIn("stepBase64", step.json())

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

    def test_cdb_export_jobs_are_filtered_by_client_id(self):
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

    def test_cdb_export_job_cancel_queued(self):
        self.app.state.export_jobs.max_concurrent_jobs = 0
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
