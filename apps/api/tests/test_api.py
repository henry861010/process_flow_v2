from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

import process_flow_api.main as api_main
from process_flow_api.main import create_app
from process_flow_api import services as api_services
from process_flow_api.models import PreviewSectionResponse
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

    def test_direct_instance_create_materializes_generated_geometry(self):
        bootstrap = self.reset_poc_data()
        source = bootstrap["processFlowInstances"][0]
        hbm = next(
            geometry
            for geometry in bootstrap["geometries"]
            if geometry["id"] == "hbm_v1_3_1"
        )
        embedded = {key: value for key, value in hbm.items() if key != "id"}
        embedded["name"] = "HBM generated for direct instance"
        embedded["version"] = "v2.0.0"
        embedded["owner"] = "test-owner"
        embedded["generation"] = {
            "generatorId": "hbm",
            "schemaVersion": 1,
            "parameters": {"packageX": 12000, "coreDieCount": 4},
        }
        input_bindings = dict(source["inputBindings"])
        input_bindings["incoming_hbm"] = {
            "kind": "embedded",
            "localId": "draft_generated_hbm",
        }
        request = {
            **source,
            "id": "flow_inst_direct_embedded",
            "name": "Direct embedded instance",
            "inputBindings": input_bindings,
            "embeddedGeometries": {"draft_generated_hbm": embedded},
        }

        response = self.client.post("/api/process-flow-instances", json=request)

        self.assertEqual(response.status_code, 201, response.text)
        binding = response.json()["inputBindings"]["incoming_hbm"]
        self.assertEqual(binding["kind"], "catalog")
        self.assertNotIn("embeddedGeometries", response.json())
        saved = self.client.get(f"/api/geometries/{binding['geometryId']}")
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["generation"], embedded["generation"])

    def test_direct_instance_materialization_rolls_back_on_duplicate_instance(self):
        bootstrap = self.reset_poc_data()
        source = bootstrap["processFlowInstances"][0]
        hbm = next(
            geometry
            for geometry in bootstrap["geometries"]
            if geometry["id"] == "hbm_v1_3_1"
        )
        embedded = {key: value for key, value in hbm.items() if key != "id"}
        bindings = dict(source["inputBindings"])
        bindings["incoming_hbm"] = {
            "kind": "embedded",
            "localId": "draft_rollback_hbm",
        }
        geometry_count = len(bootstrap["geometries"])

        response = self.client.post(
            "/api/process-flow-instances",
            json={
                **source,
                "inputBindings": bindings,
                "embeddedGeometries": {"draft_rollback_hbm": embedded},
            },
        )

        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(
            len(self.client.get("/api/geometries").json()),
            geometry_count,
        )

    def test_create_template_and_bound_instance_transaction(self):
        bootstrap = self.reset_poc_data()
        panel = next(
            geometry
            for geometry in bootstrap["geometries"]
            if geometry["id"] == "panel_v1_0_0"
        )
        embedded_panel = {key: value for key, value in panel.items() if key != "id"}
        embedded_panel["name"] = "Generated transaction panel"
        embedded_panel["version"] = "v2.0.0"
        embedded_panel["owner"] = "test-owner"
        embedded_panel["generation"] = {
            "generatorId": "test-panel",
            "schemaVersion": 1,
            "parameters": {"source": "combined-save-test"},
        }
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
                "incoming_panel": {
                    "kind": "embedded",
                    "localId": "draft_transaction_panel",
                }
            },
            "stepConfigurations": {
                "molding": {
                    "parameterValues": {
                        "material": "EMC",
                        "thickness": 10,
                    }
                }
            },
            "embeddedGeometries": {
                "draft_transaction_panel": embedded_panel,
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
        created_instance = response.json()["processFlowInstance"]
        self.assertEqual(created_instance["id"], instance["id"])
        created_binding = created_instance["inputBindings"]["incoming_panel"]
        self.assertEqual(created_binding["kind"], "catalog")
        self.assertNotIn("embeddedGeometries", created_instance)
        saved_geometry = self.client.get(
            f"/api/geometries/{created_binding['geometryId']}"
        )
        self.assertEqual(saved_geometry.status_code, 200, saved_geometry.text)
        self.assertEqual(saved_geometry.json()["generation"], embedded_panel["generation"])

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

    def test_preview_session_flow_input_mesh_cache_etag_and_not_found(self):
        bootstrap = self.reset_poc_data()
        flow_template = bootstrap["processFlowTemplates"][0]
        instance = bootstrap["processFlowInstances"][0]
        request_payload = preview_session_request(
            flow_template,
            instance,
            target={"type": "flowInput", "flowInputId": "incoming_panel"},
            source_label="Panel timeline input",
        )

        created = self.client.post("/api/preview-sessions", json=request_payload)
        repeated = self.client.post("/api/preview-sessions", json=request_payload)

        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(repeated.json(), created.json())
        payload = created.json()
        self.assertTrue(payload["sessionId"].startswith("preview_"))
        self.assertEqual(len(payload["snapshots"]), 1)
        snapshot = payload["snapshots"][0]
        self.assertEqual(payload["initialSnapshotId"], snapshot["snapshotId"])
        self.assertEqual(snapshot["sourceKind"], "flowInput")
        self.assertIsNone(snapshot["stepRefId"])
        self.assertEqual(snapshot["order"], 0)
        self.assertTrue(snapshot["meshUrl"].startswith("/api/preview-sessions/"))
        self.assertTrue(snapshot["sectionUrl"].startswith("/api/preview-sessions/"))

        mesh_exporter = mock.AsyncMock(return_value=b"glTF-preview-session-test")
        self.app.state.preview_sessions._mesh_exporter = mesh_exporter
        mesh = self.client.get(snapshot["meshUrl"])
        self.assertEqual(mesh.status_code, 200, mesh.text)
        self.assertEqual(mesh.content, b"glTF-preview-session-test")
        self.assertEqual(mesh.headers["content-type"], "model/gltf-binary")
        self.assertIn("immutable", mesh.headers["cache-control"])
        self.assertTrue(mesh.headers["etag"].startswith('"geometry-'))

        not_modified = self.client.get(
            snapshot["meshUrl"],
            headers={"If-None-Match": mesh.headers["etag"]},
        )
        self.assertEqual(not_modified.status_code, 304, not_modified.text)
        self.assertEqual(not_modified.content, b"")
        mesh_exporter.assert_awaited_once()

        missing_session = self.client.get(
            "/api/preview-sessions/preview_missing/snapshots/snapshot_missing/mesh"
        )
        missing_snapshot = self.client.get(
            snapshot["meshUrl"].replace(snapshot["snapshotId"], "snapshot_missing")
        )
        self.assertEqual(missing_session.status_code, 404, missing_session.text)
        self.assertEqual(missing_snapshot.status_code, 404, missing_snapshot.text)

    def test_preview_session_step_timeline_compiles_and_executes_once(self):
        bootstrap = self.reset_poc_data()
        flow_template = bootstrap["processFlowTemplates"][0]
        instance = bootstrap["processFlowInstances"][0]
        target_step_ref_id = flow_template["stepRefs"][1]["stepRefId"]
        request_payload = preview_session_request(
            flow_template,
            instance,
            target={
                "type": "stepOutput",
                "stepRefId": target_step_ref_id,
                "outputPortId": "result_geometry",
            },
            source_label="Mold target",
            bootstrap=bootstrap,
            through_step_index=1,
        )
        request_payload["processFlowTemplateId"] = request_payload.pop("flowTemplate")["id"]
        original_compile = api_services.FlowCompiler.compile
        original_execute = api_services._execute_preview_plan

        with (
            mock.patch.object(
                api_services.FlowCompiler,
                "compile",
                autospec=True,
                side_effect=original_compile,
            ) as compile_flow,
            mock.patch(
                "process_flow_api.services._execute_preview_plan",
                wraps=original_execute,
            ) as execute_flow,
        ):
            created = self.client.post("/api/preview-sessions", json=request_payload)
            repeated = self.client.post("/api/preview-sessions", json=request_payload)

        self.assertEqual(created.status_code, 200, created.text)
        self.assertEqual(repeated.json(), created.json())
        snapshots = created.json()["snapshots"]
        self.assertEqual(
            [snapshot["stepRefId"] for snapshot in snapshots],
            [step_ref["stepRefId"] for step_ref in flow_template["stepRefs"][:2]],
        )
        self.assertEqual([snapshot["order"] for snapshot in snapshots], [0, 1])
        self.assertTrue(all(snapshot["sourceKind"] == "stepOutput" for snapshot in snapshots))
        self.assertEqual(created.json()["initialSnapshotId"], snapshots[-1]["snapshotId"])
        self.assertEqual(snapshots[-1]["label"], "Mold target")
        self.assertEqual(compile_flow.call_count, 1)
        self.assertEqual(execute_flow.call_count, 1)

        invalid_port = {
            **request_payload,
            "target": {
                "type": "stepOutput",
                "stepRefId": target_step_ref_id,
                "outputPortId": "unknown_output",
            },
        }
        rejected = self.client.post("/api/preview-sessions", json=invalid_port)
        self.assertEqual(rejected.status_code, 400, rejected.text)

    def test_preview_session_exact_section_cache_etag_and_validation(self):
        bootstrap = self.reset_poc_data()
        flow_template = bootstrap["processFlowTemplates"][0]
        instance = bootstrap["processFlowInstances"][0]
        request_payload = preview_session_request(
            flow_template,
            instance,
            target={"type": "flowInput", "flowInputId": "incoming_panel"},
        )
        created = self.client.post("/api/preview-sessions", json=request_payload)
        self.assertEqual(created.status_code, 200, created.text)
        snapshot = created.json()["snapshots"][0]
        section_generator = mock.Mock(
            return_value={
                "unitSystem": "um",
                "axis": "x",
                "position": 5.0,
                "regions": [
                    {
                        "bodyId": "body-1",
                        "sourceIds": ["body-1"],
                        "containerId": "container-1",
                        "containerKey": "",
                        "material": "Cu",
                        "bodyKind": "body",
                        "featureType": None,
                        "approximationKind": "exact",
                        "area": 0.5,
                        "outer": [[0, 0], [1, 0], [1, 1], [0, 0]],
                        "holes": [],
                    }
                ],
            }
        )
        self.app.state.preview_sessions._section_generator = section_generator
        section_url = f'{snapshot["sectionUrl"]}?axis=x&position=5&tolerance=0.25'

        section = self.client.get(section_url)
        self.assertEqual(section.status_code, 200, section.text)
        payload = section.json()
        self.assertEqual(payload["snapshotId"], snapshot["snapshotId"])
        self.assertEqual(payload["geometryHash"], snapshot["geometryHash"])
        self.assertEqual(payload["unitSystem"], "um")
        self.assertEqual(payload["axis"], "x")
        self.assertEqual(payload["position"], 5.0)
        self.assertEqual(len(payload["regions"]), 1)
        self.assertEqual(payload["regions"][0]["containerKey"], "")
        self.assertEqual(
            set(payload["regions"][0]),
            {
                "bodyId",
                "sourceIds",
                "containerId",
                "containerKey",
                "material",
                "bodyKind",
                "featureType",
                "approximationKind",
                "area",
                "outer",
                "holes",
            },
        )
        self.assertIn("immutable", section.headers["cache-control"])

        invalid_shape = {
            **payload,
            "regions": [
                {
                    **payload["regions"][0],
                    "outer": [[0, 0], [1, 0], [1, 1], [0, 1]],
                }
            ],
        }
        with self.assertRaises(ValueError):
            PreviewSectionResponse.model_validate(invalid_shape)

        alternate_session = self.client.post(
            "/api/preview-sessions",
            json={**request_payload, "sourceLabel": "Alternate snapshot identity"},
        )
        self.assertEqual(alternate_session.status_code, 200, alternate_session.text)
        alternate_snapshot = alternate_session.json()["snapshots"][0]
        self.assertEqual(alternate_snapshot["geometryHash"], snapshot["geometryHash"])
        self.assertNotEqual(alternate_snapshot["snapshotId"], snapshot["snapshotId"])
        alternate_section = self.client.get(
            f'{alternate_snapshot["sectionUrl"]}?axis=x&position=5&tolerance=0.25'
        )
        self.assertEqual(alternate_section.status_code, 200, alternate_section.text)
        self.assertEqual(
            alternate_section.json()["snapshotId"],
            alternate_snapshot["snapshotId"],
        )
        self.assertNotEqual(alternate_section.headers["etag"], section.headers["etag"])

        not_modified = self.client.get(
            section_url,
            headers={"If-None-Match": section.headers["etag"]},
        )
        self.assertEqual(not_modified.status_code, 304, not_modified.text)
        self.assertEqual(section_generator.call_count, 1)

        invalid_axis = self.client.get(
            f'{snapshot["sectionUrl"]}?axis=z&position=5&tolerance=0.25'
        )
        invalid_tolerance = self.client.get(
            f'{snapshot["sectionUrl"]}?axis=x&position=5&tolerance=0'
        )
        self.assertEqual(invalid_axis.status_code, 422, invalid_axis.text)
        self.assertEqual(invalid_tolerance.status_code, 422, invalid_tolerance.text)

    def test_preview_session_prepares_cad_once_for_multiple_section_positions(self):
        bootstrap = self.reset_poc_data()
        flow_template = bootstrap["processFlowTemplates"][0]
        instance = bootstrap["processFlowInstances"][0]
        created = self.client.post(
            "/api/preview-sessions",
            json=preview_session_request(
                flow_template,
                instance,
                target={"type": "flowInput", "flowInputId": "incoming_panel"},
            ),
        )
        self.assertEqual(created.status_code, 200, created.text)
        snapshot = created.json()["snapshots"][0]
        prepared_model = mock.Mock()
        prepared_model.section.side_effect = lambda *, axis, position, tolerance: {
            "unitSystem": "um",
            "axis": axis,
            "position": position,
            "regions": [],
        }
        section_preparer = mock.Mock(return_value=prepared_model)
        manager = self.app.state.preview_sessions
        manager._section_generator = None
        manager._section_preparer = section_preparer

        first = self.client.get(f'{snapshot["sectionUrl"]}?axis=x&position=2')
        second = self.client.get(f'{snapshot["sectionUrl"]}?axis=x&position=8')
        repeated = self.client.get(f'{snapshot["sectionUrl"]}?axis=x&position=2')

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(first.json()["position"], 2)
        self.assertEqual(second.json()["position"], 8)
        section_preparer.assert_called_once()
        self.assertEqual(prepared_model.section.call_count, 2)

    def test_preview_section_inflight_limit_returns_retryable_503(self):
        bootstrap = self.reset_poc_data()
        flow_template = bootstrap["processFlowTemplates"][0]
        instance = bootstrap["processFlowInstances"][0]
        created = self.client.post(
            "/api/preview-sessions",
            json=preview_session_request(
                flow_template,
                instance,
                target={"type": "flowInput", "flowInputId": "incoming_panel"},
            ),
        )
        self.assertEqual(created.status_code, 200, created.text)
        snapshot = created.json()["snapshots"][0]
        started = threading.Event()
        release = threading.Event()

        def blocking_section(*_, axis, position, tolerance):
            started.set()
            release.wait(timeout=5)
            return {
                "unitSystem": "um",
                "axis": axis,
                "position": position,
                "regions": [],
            }

        manager = self.app.state.preview_sessions
        manager._section_generator = blocking_section
        manager._max_section_inflight = 1
        first_url = f'{snapshot["sectionUrl"]}?axis=x&position=1'
        overflow_url = f'{snapshot["sectionUrl"]}?axis=x&position=2'

        with ThreadPoolExecutor(max_workers=1) as executor:
            first_future = executor.submit(self.client.get, first_url)
            try:
                self.assertTrue(started.wait(timeout=2), "first section did not start")
                overflow = self.client.get(overflow_url)
            finally:
                release.set()
            first = first_future.result(timeout=5)

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(overflow.status_code, 503, overflow.text)
        self.assertEqual(overflow.headers["retry-after"], "1")
        self.assertIn("queue is full", overflow.json()["message"])

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


def preview_session_request(
    flow_template,
    instance,
    *,
    target,
    source_label=None,
    bootstrap=None,
    through_step_index=None,
):
    step_configurations = instance["stepConfigurations"]
    if bootstrap is not None and through_step_index is not None:
        step_templates = {
            template["id"]: template for template in bootstrap["processStepTemplates"]
        }
        filtered_configurations = {}
        for step_ref in flow_template["stepRefs"][: through_step_index + 1]:
            step_ref_id = step_ref["stepRefId"]
            allowed_parameters = {
                definition["id"]
                for definition in step_templates[step_ref["processStepTemplateId"]][
                    "parameterDefinitions"
                ]
            }
            raw_values = step_configurations.get(step_ref_id, {}).get("parameterValues", {})
            filtered_configurations[step_ref_id] = {
                "parameterValues": {
                    key: value for key, value in raw_values.items() if key in allowed_parameters
                }
            }
        step_configurations = filtered_configurations
    payload = {
        "target": target,
        "flowTemplate": flow_template,
        "configuration": {
            "inputBindings": instance["inputBindings"],
            "stepConfigurations": step_configurations,
            "embeddedGeometries": {},
        },
    }
    if source_label is not None:
        payload["sourceLabel"] = source_label
    return payload


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
