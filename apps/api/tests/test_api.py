from __future__ import annotations

import asyncio
import copy
import json
import re
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from process_flow_kernel import ProcessStepModuleResolver

import process_flow_api.main as api_main
from process_flow_api.main import create_app
from process_flow_api import services as api_services
from process_flow_api.export_job_logging import ExportJobLogError
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

    def assert_log_actions_in_order(self, log_text, actions):
        cursor = 0
        for action in actions:
            index = log_text.find(action, cursor)
            self.assertNotEqual(index, -1, f"Missing log action after offset {cursor}: {action}")
            cursor = index + len(action)

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
        self.assertEqual(
            self.client.get("/openapi.json").json()["info"]["version"], "0.0.0"
        )

        response = self.client.get("/api/bootstrap")
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_seed_payload_counts(response.json())

    def test_fixture_export_contains_current_database_as_four_json_files(self):
        bootstrap = self.client.get("/api/bootstrap").json()

        response = self.client.get("/api/fixture-export")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["content-type"], "application/zip")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertRegex(
            response.headers["content-disposition"],
            r'^attachment; filename="process-flow-fixtures-\d{8}T\d{6}Z\.zip"$',
        )

        expected_payloads = {
            "process-step-templates.json": bootstrap["processStepTemplates"],
            "process-flow-templates.json": bootstrap["processFlowTemplates"],
            "process-flow-instances.json": bootstrap["processFlowInstances"],
            "geometries.json": bootstrap["geometries"],
        }
        with zipfile.ZipFile(BytesIO(response.content)) as archive:
            self.assertEqual(set(archive.namelist()), set(expected_payloads))
            for filename, expected in expected_payloads.items():
                with self.subTest(filename=filename):
                    self.assertEqual(json.loads(archive.read(filename)), expected)

    def test_seed_resources_use_unreleased_versions_and_resolvable_ids(self):
        payload = self.client.get("/api/bootstrap").json()
        step_templates = {
            item["id"]: item for item in payload["processStepTemplates"]
        }
        flow_templates = {
            item["id"]: item for item in payload["processFlowTemplates"]
        }
        geometries = {item["id"]: item for item in payload["geometries"]}

        self.assertEqual(
            {item["version"] for item in step_templates.values()}, {"V0.0.0"}
        )
        self.assertEqual(
            {item["version"] for item in flow_templates.values()}, {"V0.0.0"}
        )
        self.assertTrue(all("version" not in item for item in geometries.values()))
        self.assertTrue(all(isinstance(item["dim"], str) for item in geometries.values()))

        versioned_id = re.compile(r"_v?\d+_\d+_\d+$")
        for resource_id in (*step_templates, *flow_templates, *geometries):
            with self.subTest(resource_id=resource_id):
                self.assertIsNone(versioned_id.search(resource_id))

        for flow_template in flow_templates.values():
            for flow_input in flow_template["flowInputs"]:
                categories = flow_input.get("geometryConstraints", {}).get(
                    "categories", []
                )
                self.assertTrue(
                    categories,
                    f"{flow_template['id']}.{flow_input['flowInputId']} needs a category constraint",
                )
                self.assertTrue(
                    all(
                        isinstance(category, str) and category.strip()
                        for category in categories
                    )
                )
            for step_ref in flow_template["stepRefs"]:
                self.assertIn(step_ref["processStepTemplateId"], step_templates)

        for instance in payload["processFlowInstances"]:
            self.assertIn(instance["processFlowTemplateId"], flow_templates)
            for binding in instance["inputBindings"].values():
                if binding["kind"] == "catalog":
                    self.assertIn(binding["geometryId"], geometries)

    def test_carrier_bond_fixture_has_no_daf_parameters(self):
        payload = self.client.get("/api/bootstrap").json()
        carrier_bond = next(
            template
            for template in payload["processStepTemplates"]
            if template["id"] == "step_tpl_carrier_bond"
        )

        self.assertEqual(carrier_bond["program"], "carrier/bond")
        self.assertEqual(carrier_bond["parameterDefinitions"], [])

    def test_seed_defaults_use_scalar_flow_snapshots(self):
        payload = self.client.get("/api/bootstrap").json()
        step_templates = {
            item["id"]: item for item in payload["processStepTemplates"]
        }
        flow_templates = {
            item["id"]: item for item in payload["processFlowTemplates"]
        }

        molding_defaults = {
            definition["id"]: definition.get("defaultValue")
            for definition in step_templates["step_tpl_molding"]["parameterDefinitions"]
        }
        self.assertEqual(
            molding_defaults,
            {"material": "EMC-G700", "thickness": 180},
        )
        self.assertIn(
            "defaultValue",
            step_templates["step_tpl_rdl"]["parameterDefinitions"][0],
        )

        aaa_defaults = {
            step_ref["stepRefId"]: step_ref["parameterDefaults"]
            for step_ref in flow_templates["flow_tpl_aaa_demo"]["stepRefs"]
        }
        self.assertEqual(aaa_defaults["pnp_hbm"], {})
        self.assertEqual(aaa_defaults["rdl_build"], {})
        self.assertEqual(
            aaa_defaults["mold_cap"],
            {"material": "EMC-G700", "thickness": 180},
        )

        fanout_defaults = {
            step_ref["stepRefId"]: step_ref["parameterDefaults"]
            for step_ref in flow_templates["flow_tpl_fanout_demo"]["stepRefs"]
        }
        self.assertEqual(fanout_defaults["pnp_soc"], {})
        self.assertEqual(
            fanout_defaults["bga_array"],
            {"material": "SAC305", "thk": 240, "density": 36, "koz": 35},
        )

    def test_debond_fixture_exposes_recursive_optional_daf_contract(self):
        payload = self.client.get("/api/bootstrap").json()
        debond = next(
            template
            for template in payload["processStepTemplates"]
            if template["id"] == "step_tpl_debond"
        )

        self.assertEqual(debond["version"], "V0.0.0")
        self.assertEqual(debond["program"], "carrier/debond")
        self.assertEqual(debond["parameterDefinitions"], [])
        self.assertIn("full geometry top", debond["description"])
        self.assertIn("touching DAF is optional", debond["inputPorts"][0]["description"])
        api_services.validate_process_step_template(debond)
        self.assertTrue(callable(ProcessStepModuleResolver().resolve(debond).execute))

    def test_frame_step_fixtures_expose_mount_and_demount_contracts(self):
        payload = self.client.get("/api/bootstrap").json()
        templates = {
            template["id"]: template for template in payload["processStepTemplates"]
        }
        mount = templates["step_tpl_frame_mount"]
        demount = templates["step_tpl_frame_demount"]

        self.assertEqual(mount["version"], "V0.0.0")
        self.assertEqual(mount["program"], "frame/mount")
        self.assertEqual(
            [port["portId"] for port in mount["inputPorts"]],
            ["main_geometry", "frame_geometry"],
        )
        self.assertEqual(mount["inputPorts"][1]["role"], "auxiliary")
        self.assertEqual(mount["parameterDefinitions"], [])

        self.assertEqual(demount["version"], "V0.0.0")
        self.assertEqual(demount["program"], "frame/demount")
        self.assertEqual(
            [port["portId"] for port in demount["inputPorts"]],
            ["main_geometry"],
        )
        self.assertEqual(demount["parameterDefinitions"], [])

        for template in (mount, demount):
            api_services.validate_process_step_template(template)
            self.assertTrue(callable(ProcessStepModuleResolver().resolve(template).execute))

    def test_daf_fixture_exposes_standalone_contract(self):
        payload = self.client.get("/api/bootstrap").json()
        daf = next(
            template
            for template in payload["processStepTemplates"]
            if template["id"] == "step_tpl_daf"
        )

        self.assertEqual(daf["version"], "V0.0.0")
        self.assertEqual(daf["name"], "DAF")
        self.assertEqual(daf["category"], "layer")
        self.assertEqual(daf["program"], "layer/daf")
        self.assertEqual(
            [
                (definition["id"], definition["name"], definition["valueType"])
                for definition in daf["parameterDefinitions"]
            ],
            [
                ("material", "DAF material", "materialRef"),
                ("thk", "DAF thk", "float"),
            ],
        )
        self.assertEqual(
            daf["parameterDefinitions"][1]["validation"],
            {"min": 0, "exclusiveMin": True},
        )
        api_services.validate_process_step_template(daf)
        self.assertTrue(callable(ProcessStepModuleResolver().resolve(daf).execute))

    def test_tiv_fixture_exposes_via_contract(self):
        payload = self.client.get("/api/bootstrap").json()
        tiv = next(
            template
            for template in payload["processStepTemplates"]
            if template["id"] == "step_tpl_tiv"
        )

        self.assertEqual(tiv["version"], "V0.0.0")
        self.assertEqual(tiv["name"], "tiv")
        self.assertEqual(tiv["category"], "tiv")
        self.assertEqual(tiv["program"], "tiv/tiv")
        api_services.validate_process_step_template(tiv)
        self.assertEqual(
            [
                (definition["id"], definition["valueType"])
                for definition in tiv["parameterDefinitions"]
            ],
            [("thk", "float"), ("material", "materialRef"), ("density", "float")],
        )
        self.assertEqual(
            tiv["parameterDefinitions"][0]["validation"],
            {"min": 0, "exclusiveMin": True},
        )
        self.assertEqual(
            tiv["parameterDefinitions"][2]["validation"],
            {"min": 0, "max": 100},
        )

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
        self.assertEqual(created.json()["version"], "V2.0.0")
        duplicate = self.client.post("/api/process-step-templates", json=template)
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        deleted = self.client.delete("/api/process-step-templates/custom_step")
        self.assertEqual(deleted.status_code, 204, deleted.text)
        missing = self.client.get("/api/process-step-templates/custom_step")
        self.assertEqual(missing.status_code, 404, missing.text)

    def test_step_template_update_is_restricted_and_preserves_existing_flow_defaults(self):
        bootstrap = self.reset_poc_data()
        original = next(
            item
            for item in bootstrap["processStepTemplates"]
            if item["id"] == "step_tpl_molding"
        )
        existing_flow = next(
            item
            for item in bootstrap["processFlowTemplates"]
            if item["id"] == "flow_tpl_aaa_demo"
        )
        existing_molding_ref = next(
            step_ref
            for step_ref in existing_flow["stepRefs"]
            if step_ref["processStepTemplateId"] == original["id"]
        )
        self.assertEqual(existing_molding_ref["parameterDefaults"]["thickness"], 180)

        updated = copy.deepcopy(original)
        updated["owner"] = "process.integration"
        updated["category"] = "layer.updated"
        updated["program"] = "layer/molding_v2"
        updated["parameterDefinitions"][0]["defaultValue"] = "EMC-UPDATED"
        updated["parameterDefinitions"][1]["defaultValue"] = 210

        response = self.client.put(
            "/api/process-step-templates/step_tpl_molding",
            json=updated,
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["owner"], updated["owner"])
        self.assertEqual(response.json()["category"], updated["category"])
        self.assertEqual(response.json()["program"], updated["program"])
        detail = self.client.get("/api/process-step-templates/step_tpl_molding")
        self.assertEqual(detail.json()["owner"], "process.integration")
        listed = next(
            item
            for item in self.client.get("/api/process-step-templates").json()
            if item["id"] == "step_tpl_molding"
        )
        self.assertEqual(listed["category"], "layer.updated")
        refreshed_bootstrap = self.client.get("/api/bootstrap").json()
        refreshed = next(
            item
            for item in refreshed_bootstrap["processStepTemplates"]
            if item["id"] == "step_tpl_molding"
        )
        self.assertEqual(refreshed["program"], "layer/molding_v2")

        persisted_existing_flow = self.client.get(
            "/api/process-flow-templates/flow_tpl_aaa_demo"
        ).json()
        persisted_molding_ref = next(
            step_ref
            for step_ref in persisted_existing_flow["stepRefs"]
            if step_ref["processStepTemplateId"] == original["id"]
        )
        self.assertEqual(persisted_molding_ref["parameterDefaults"]["thickness"], 180)

        future_flow = copy.deepcopy(existing_flow)
        future_flow["id"] = "flow_tpl_updated_step_defaults"
        for step_ref in future_flow["stepRefs"]:
            step_ref.pop("parameterDefaults", None)
        created_flow = self.client.post("/api/process-flow-templates", json=future_flow)
        self.assertEqual(created_flow.status_code, 201, created_flow.text)
        future_molding_ref = next(
            step_ref
            for step_ref in created_flow.json()["stepRefs"]
            if step_ref["processStepTemplateId"] == original["id"]
        )
        self.assertEqual(
            future_molding_ref["parameterDefaults"],
            {"material": "EMC-UPDATED", "thickness": 210},
        )

    def test_step_template_update_rejects_identity_contract_and_invalid_defaults(self):
        bootstrap = self.reset_poc_data()
        original = next(
            item
            for item in bootstrap["processStepTemplates"]
            if item["id"] == "step_tpl_molding"
        )

        mismatch = copy.deepcopy(original)
        mismatch["id"] = "step_tpl_other"
        mismatch_response = self.client.put(
            "/api/process-step-templates/step_tpl_molding",
            json=mismatch,
        )
        self.assertEqual(mismatch_response.status_code, 400, mismatch_response.text)

        missing = copy.deepcopy(original)
        missing["id"] = "step_tpl_missing"
        missing_response = self.client.put(
            "/api/process-step-templates/step_tpl_missing",
            json=missing,
        )
        self.assertEqual(missing_response.status_code, 404, missing_response.text)

        disallowed_updates = []
        renamed = copy.deepcopy(original)
        renamed["name"] = "Renamed molding"
        disallowed_updates.append(renamed)
        changed_port = copy.deepcopy(original)
        changed_port["inputPorts"][0]["name"] = "Changed input"
        disallowed_updates.append(changed_port)
        changed_parameter = copy.deepcopy(original)
        changed_parameter["parameterDefinitions"][0]["name"] = "Changed material"
        disallowed_updates.append(changed_parameter)

        for candidate in disallowed_updates:
            with self.subTest(candidate=candidate):
                rejected = self.client.put(
                    "/api/process-step-templates/step_tpl_molding",
                    json=candidate,
                )
                self.assertEqual(rejected.status_code, 409, rejected.text)
                self.assertIn("Only owner, category, program", rejected.json()["message"])

        invalid_default = copy.deepcopy(original)
        invalid_default["parameterDefinitions"][1]["defaultValue"] = -1
        invalid_response = self.client.put(
            "/api/process-step-templates/step_tpl_molding",
            json=invalid_default,
        )
        self.assertEqual(invalid_response.status_code, 400, invalid_response.text)
        self.assertIn("defaultValue", invalid_response.json()["message"])
        self.assertEqual(
            self.client.get("/api/process-step-templates/step_tpl_molding").json(),
            original,
        )

    def test_step_template_defaults_are_validated_and_persisted(self):
        bootstrap = self.reset_poc_data()
        source = next(
            item
            for item in bootstrap["processStepTemplates"]
            if item["id"] == "step_tpl_molding"
        )
        template = copy.deepcopy(source)
        template["id"] = "step_tpl_default_test"
        template["parameterDefinitions"][0]["defaultValue"] = "EMC-TEST"
        template["parameterDefinitions"][1]["defaultValue"] = 25

        created = self.client.post("/api/process-step-templates", json=template)

        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(
            [
                definition["defaultValue"]
                for definition in created.json()["parameterDefinitions"]
            ],
            ["EMC-TEST", 25],
        )

        for fixture_id, created_id in (
            ("step_tpl_rdl", "step_tpl_repeat_default_test"),
            ("step_tpl_pnp", "step_tpl_placement_default_test"),
        ):
            collection_template = copy.deepcopy(
                next(
                    item
                    for item in bootstrap["processStepTemplates"]
                    if item["id"] == fixture_id
                )
            )
            collection_template["id"] = created_id
            if fixture_id == "step_tpl_pnp":
                collection_template["parameterDefinitions"][0]["defaultValue"] = []
            collection_created = self.client.post(
                "/api/process-step-templates",
                json=collection_template,
            )
            self.assertEqual(collection_created.status_code, 201, collection_created.text)
            self.assertIn(
                "defaultValue",
                collection_created.json()["parameterDefinitions"][0],
            )

        invalid = copy.deepcopy(source)
        invalid["id"] = "step_tpl_invalid_default"
        invalid["parameterDefinitions"][1]["defaultValue"] = "not-a-number"
        rejected = self.client.post("/api/process-step-templates", json=invalid)
        self.assertEqual(rejected.status_code, 400, rejected.text)
        self.assertIn("defaultValue", rejected.json()["message"])

        null_default = copy.deepcopy(source)
        null_default["id"] = "step_tpl_null_default"
        null_default["parameterDefinitions"][0]["defaultValue"] = None
        rejected_null = self.client.post(
            "/api/process-step-templates",
            json=null_default,
        )
        self.assertEqual(rejected_null.status_code, 422, rejected_null.text)
        self.assertIn("defaultValue cannot be null", rejected_null.text)

    def test_flow_template_materializes_only_scalar_step_defaults(self):
        bootstrap = self.reset_poc_data()
        source = next(
            item
            for item in bootstrap["processFlowTemplates"]
            if item["id"] == "flow_tpl_aaa_demo"
        )
        template = copy.deepcopy(source)
        template["id"] = "flow_tpl_default_materialization"
        for step_ref in template["stepRefs"]:
            step_ref.pop("parameterDefaults", None)

        created = self.client.post("/api/process-flow-templates", json=template)

        self.assertEqual(created.status_code, 201, created.text)
        defaults = {
            step_ref["stepRefId"]: step_ref["parameterDefaults"]
            for step_ref in created.json()["stepRefs"]
        }
        self.assertEqual(defaults["pnp_hbm"], {})
        self.assertEqual(
            defaults["mold_cap"],
            {"material": "EMC-G700", "thickness": 180},
        )
        self.assertEqual(defaults["rdl_build"], {})
        self.assertEqual(
            defaults["c4_bump"],
            {"material": "SAC305", "thk": 65, "density": 58, "koz": 18},
        )

    def test_flow_template_update_persists_metadata_and_defaults_without_changing_instances(self):
        bootstrap = self.reset_poc_data()
        original = next(
            item
            for item in bootstrap["processFlowTemplates"]
            if item["id"] == "flow_tpl_aaa_demo"
        )
        instances_before = copy.deepcopy(
            [
                item
                for item in bootstrap["processFlowInstances"]
                if item["processFlowTemplateId"] == original["id"]
            ]
        )
        updated = copy.deepcopy(original)
        updated["name"] = "AAA Production Flow"
        updated["owner"] = "process.integration"
        updated["description"] = "Updated flow defaults for future products."
        molding_ref = next(
            step_ref
            for step_ref in updated["stepRefs"]
            if step_ref["stepRefId"] == "mold_cap"
        )
        molding_ref["parameterDefaults"] = {
            "material": "EMC-UPDATED",
            "thickness": 205,
        }

        response = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=updated,
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["name"], "AAA Production Flow")
        self.assertEqual(response.json()["owner"], "process.integration")
        self.assertEqual(
            next(
                step_ref
                for step_ref in response.json()["stepRefs"]
                if step_ref["stepRefId"] == "mold_cap"
            )["parameterDefaults"],
            {"material": "EMC-UPDATED", "thickness": 205},
        )

        detail = self.client.get(
            "/api/process-flow-templates/flow_tpl_aaa_demo"
        ).json()
        listed = next(
            item
            for item in self.client.get("/api/process-flow-templates").json()
            if item["id"] == original["id"]
        )
        bootstrapped = next(
            item
            for item in self.client.get("/api/bootstrap").json()["processFlowTemplates"]
            if item["id"] == original["id"]
        )
        self.assertEqual(detail, listed)
        self.assertEqual(listed, bootstrapped)
        self.assertEqual(
            [
                item
                for item in self.client.get("/api/process-flow-instances").json()
                if item["processFlowTemplateId"] == original["id"]
            ],
            instances_before,
        )

        omitted = copy.deepcopy(response.json())
        omitted["name"] = "AAA Production Flow 2"
        next(
            step_ref
            for step_ref in omitted["stepRefs"]
            if step_ref["stepRefId"] == "mold_cap"
        ).pop("parameterDefaults")
        preserved = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=omitted,
        )
        self.assertEqual(preserved.status_code, 200, preserved.text)
        self.assertEqual(
            next(
                step_ref
                for step_ref in preserved.json()["stepRefs"]
                if step_ref["stepRefId"] == "mold_cap"
            )["parameterDefaults"],
            {"material": "EMC-UPDATED", "thickness": 205},
        )

        cleared = copy.deepcopy(preserved.json())
        next(
            step_ref
            for step_ref in cleared["stepRefs"]
            if step_ref["stepRefId"] == "mold_cap"
        )["parameterDefaults"] = {}
        cleared_response = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=cleared,
        )
        self.assertEqual(cleared_response.status_code, 200, cleared_response.text)
        self.assertEqual(
            next(
                step_ref
                for step_ref in cleared_response.json()["stepRefs"]
                if step_ref["stepRefId"] == "mold_cap"
            )["parameterDefaults"],
            {},
        )

    def test_flow_template_update_rejects_locked_fields_blank_metadata_and_invalid_defaults(self):
        bootstrap = self.reset_poc_data()
        original = next(
            item
            for item in bootstrap["processFlowTemplates"]
            if item["id"] == "flow_tpl_aaa_demo"
        )

        mismatch = copy.deepcopy(original)
        mismatch["id"] = "flow_tpl_other"
        mismatch_response = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=mismatch,
        )
        self.assertEqual(mismatch_response.status_code, 400, mismatch_response.text)

        for field in ("name", "owner"):
            invalid_metadata = copy.deepcopy(original)
            invalid_metadata[field] = "   "
            rejected = self.client.put(
                "/api/process-flow-templates/flow_tpl_aaa_demo",
                json=invalid_metadata,
            )
            self.assertEqual(rejected.status_code, 400, rejected.text)

        version_change = copy.deepcopy(original)
        version_change["version"] = "V1.0.0"
        version_response = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=version_change,
        )
        self.assertEqual(version_response.status_code, 409, version_response.text)

        topology_change = copy.deepcopy(original)
        topology_change["stepRefs"][0]["stepLabel"] = "Changed step"
        topology_response = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=topology_change,
        )
        self.assertEqual(topology_response.status_code, 409, topology_response.text)

        unknown_default = copy.deepcopy(original)
        unknown_default["stepRefs"][0]["parameterDefaults"] = {"missing": 1}
        unknown_response = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=unknown_default,
        )
        self.assertEqual(unknown_response.status_code, 400, unknown_response.text)
        self.assertIn("Unknown parameter default", unknown_response.json()["message"])

        invalid_scalar = copy.deepcopy(original)
        next(
            step_ref
            for step_ref in invalid_scalar["stepRefs"]
            if step_ref["stepRefId"] == "mold_cap"
        )["parameterDefaults"] = {"thickness": "not-a-number"}
        scalar_response = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=invalid_scalar,
        )
        self.assertEqual(scalar_response.status_code, 400, scalar_response.text)

        collection_default = copy.deepcopy(original)
        rdl_default = next(
            item
            for item in bootstrap["processStepTemplates"]
            if item["id"] == "step_tpl_rdl"
        )["parameterDefinitions"][0]["defaultValue"]
        next(
            step_ref
            for step_ref in collection_default["stepRefs"]
            if step_ref["stepRefId"] == "rdl_build"
        )["parameterDefaults"] = {"layers": rdl_default}
        collection_response = self.client.put(
            "/api/process-flow-templates/flow_tpl_aaa_demo",
            json=collection_default,
        )
        self.assertEqual(collection_response.status_code, 400, collection_response.text)
        self.assertIn("must use a scalar valueType", collection_response.json()["message"])

    def test_flow_template_explicit_defaults_are_exact_and_scalar_only(self):
        bootstrap = self.reset_poc_data()
        source = next(
            item
            for item in bootstrap["processFlowTemplates"]
            if item["id"] == "flow_tpl_aaa_demo"
        )
        explicit = copy.deepcopy(source)
        explicit["id"] = "flow_tpl_explicit_empty_defaults"
        next(
            step_ref
            for step_ref in explicit["stepRefs"]
            if step_ref["stepRefId"] == "mold_cap"
        )["parameterDefaults"] = {}
        created = self.client.post("/api/process-flow-templates", json=explicit)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(
            next(
                step_ref
                for step_ref in created.json()["stepRefs"]
                if step_ref["stepRefId"] == "mold_cap"
            )["parameterDefaults"],
            {},
        )

        collection = copy.deepcopy(source)
        collection["id"] = "flow_tpl_collection_default"
        rdl_default = next(
            item
            for item in bootstrap["processStepTemplates"]
            if item["id"] == "step_tpl_rdl"
        )["parameterDefinitions"][0]["defaultValue"]
        next(
            step_ref
            for step_ref in collection["stepRefs"]
            if step_ref["stepRefId"] == "rdl_build"
        )["parameterDefaults"] = {"layers": rdl_default}
        rejected = self.client.post("/api/process-flow-templates", json=collection)
        self.assertEqual(rejected.status_code, 400, rejected.text)
        self.assertIn("must use a scalar valueType", rejected.json()["message"])

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
            "version": "V0.0.0",
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
            "dim": "",
            "owner": None,
            "description": "generated",
            "structureFormat": "standard",
            "structure": simple_structure(),
        }

        response = self.client.post("/api/geometries", json=geometry)

        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["id"].startswith("geom_preview_artifact_"))
        self.assertNotIn("vendor", response.json())
        self.assertNotIn("type1", response.json())
        self.assertNotIn("type2", response.json())

    def test_geometry_import_persists_optional_catalog_metadata(self):
        geometry = {
            **preview_geometry_entity(),
            "vendor": "Generic",
            "type1": "memory",
            "type2": "stacked",
        }

        response = self.client.post("/api/geometries", json=geometry)

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["vendor"], "Generic")
        self.assertEqual(response.json()["type1"], "memory")
        self.assertEqual(response.json()["type2"], "stacked")

    def test_geometry_import_requires_dim_and_rejects_retired_version(self):
        missing_dim = preview_geometry_entity()
        missing_dim.pop("dim")
        retired_version = {**preview_geometry_entity(), "version": "v0.0.0"}

        missing_response = self.client.post("/api/geometries", json=missing_dim)
        retired_response = self.client.post("/api/geometries", json=retired_version)

        self.assertEqual(missing_response.status_code, 422, missing_response.text)
        self.assertEqual(retired_response.status_code, 422, retired_response.text)

    def test_geometry_import_rejects_invalid_explicit_semantic_keys(self):
        invalid_cases = (
            ("container null", "container", None),
            ("container empty", "container", ""),
            ("container unknown", "container", "hbm-03"),
            ("body null", "body", None),
            ("body unknown", "body", "die"),
        )

        for label, target, value in invalid_cases:
            with self.subTest(label=label):
                geometry = preview_geometry_entity()
                root = geometry["structure"]["root"]
                if target == "container":
                    root["key"] = value
                else:
                    root["bodies"][0]["key"] = value

                response = self.client.post("/api/geometries", json=geometry)

                self.assertEqual(response.status_code, 400, response.text)

    def test_create_from_template_instance(self):
        bootstrap = self.reset_poc_data()
        source = bootstrap["processFlowInstances"][0]
        instance = {**source, "id": "flow_inst_test_copy", "name": "Test Copy"}

        response = self.client.post("/api/process-flow-instances", json=instance)

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(response.json()["id"], "flow_inst_test_copy")
        self.assertEqual(response.json()["version"], source["version"])
        self.assertEqual(response.json()["owner"], source["owner"])
        self.assertEqual(response.json()["description"], source["description"])

        missing_owner = {**instance, "id": "flow_inst_missing_owner"}
        missing_owner.pop("owner")
        rejected = self.client.post("/api/process-flow-instances", json=missing_owner)
        self.assertEqual(rejected.status_code, 422, rejected.text)
        blank_owner = {**instance, "id": "flow_inst_blank_owner", "owner": "   "}
        rejected = self.client.post("/api/process-flow-instances", json=blank_owner)
        self.assertEqual(rejected.status_code, 422, rejected.text)

    def test_direct_instance_create_rejects_wrong_geometry_category_without_writing(self):
        bootstrap = self.reset_poc_data()
        source = next(
            instance
            for instance in bootstrap["processFlowInstances"]
            if instance["processFlowTemplateId"] == "flow_tpl_aaa_demo"
        )
        request = copy.deepcopy(source)
        request["id"] = "flow_inst_wrong_geometry_category"
        request["name"] = "Wrong geometry category"
        request["inputBindings"]["incoming_hbm"] = {
            "kind": "catalog",
            "geometryId": "dram_ddr5_x8",
        }
        instance_count = len(bootstrap["processFlowInstances"])

        response = self.client.post("/api/process-flow-instances", json=request)

        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn(
            "Geometry category die.dram is not accepted",
            response.json()["message"],
        )
        self.assertEqual(
            len(self.client.get("/api/process-flow-instances").json()),
            instance_count,
        )

    def test_direct_instance_create_materializes_generated_geometry(self):
        bootstrap = self.reset_poc_data()
        source = bootstrap["processFlowInstances"][0]
        hbm = next(
            geometry
            for geometry in bootstrap["geometries"]
            if geometry["id"] == "hbm3_8hi"
        )
        embedded = {key: value for key, value in hbm.items() if key != "id"}
        embedded["name"] = "HBM generated for direct instance"
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
            if geometry["id"] == "hbm3_8hi"
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
            if geometry["id"] == "panel_plp_310x310mm_glass"
        )
        embedded_panel = {key: value for key, value in panel.items() if key != "id"}
        embedded_panel["name"] = "Generated transaction panel"
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
            "version": "V0.0.0",
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
                    "processStepTemplateId": "step_tpl_molding",
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
            "version": "V0.0.0",
            "owner": "test-owner",
            "description": "Combined create transaction fixture.",
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
        self.assertEqual(created_instance["version"], "V0.0.0")
        self.assertEqual(created_instance["owner"], "test-owner")
        self.assertEqual(
            created_instance["description"],
            "Combined create transaction fixture.",
        )
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

        response = self.client.post("/api/process-flow-instances/flow_inst_aaa_demo_hbm4_alpha/execute")

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
                        "containerKey": None,
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
        self.assertIsNone(payload["regions"][0]["containerKey"])
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
                "instanceVersion": "V0.0.0",
                "instanceOwner": "test-owner",
                "instanceDescription": "Workspace commit fixture.",
                "revision": 2,
            },
        )
        self.assertEqual(committed.status_code, 200, committed.text)
        self.assertEqual(committed.json()["workspace"]["status"], "committed")
        self.assertEqual(
            committed.json()["processFlowInstance"]["id"],
            "flow_inst_workspace_commit",
        )
        self.assertEqual(committed.json()["processFlowInstance"]["owner"], "test-owner")
        self.assertEqual(
            committed.json()["processFlowInstance"]["description"],
            "Workspace commit fixture.",
        )

        retried = self.client.post(
            f"/api/process-flow-workspaces/{workspace['id']}/commit",
            json={
                "instanceId": "ignored_retry_id",
                "instanceName": "Ignored retry",
                "instanceVersion": "V0.0.0",
                "instanceOwner": "test-owner",
                "instanceDescription": "Ignored retry metadata.",
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
        hbm = next(geometry for geometry in bootstrap["geometries"] if geometry["id"] == "hbm3_8hi")
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
                "instanceVersion": "V0.0.0",
                "instanceOwner": "test-owner",
                "instanceDescription": "Embedded workspace commit fixture.",
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
        self.assertEqual(job["symmetry"], "full")
        self.assertGreater(job["nodeCount"], 0)
        self.assertGreater(job["elementCount"], 0)
        self.assertIsNone(job["queuePosition"])
        self.assertGreaterEqual(job["runElapsedSeconds"], 0)
        self.assertEqual(job["progress"]["stage"], "finalizing")
        self.assertEqual(job["logPath"], str(Path(self.tmp.name) / f"{job['jobId']}.log"))
        self.assertTrue(normalized_output_path.exists())
        content = normalized_output_path.read_text(encoding="utf-8")
        self.assertIn("*NODES,index,x,y,z", content)
        self.assertIn("*ELEMENTS,index,n0,n1,n2,n3,n4,n5,n6,n7", content)
        self.assertIn("*COMPS,component_id,name", content)
        log_text = Path(job["logPath"]).read_text(encoding="utf-8")
        self.assertIn("Log schema: process-flow-export-log/v2", log_text)
        self.assertIn("Type: CDB", log_text)
        self.assertIn("Symmetry: full", log_text)
        self.assertIn("Input SHA-256:", log_text)
        self.assertIn("--- Timeline (elapsed) ---", log_text)
        self.assertIn("--- Summary ---", log_text)
        self.assertIn("Status: success", log_text)
        self.assertIn("Total time:", log_text)
        self.assertIn("Mesh: components=", log_text)
        self.assert_log_actions_in_order(
            log_text,
            (
                "Preparing export",
                "Checking geometry",
                "Analyzing geometry",
                "Building 2D mesh",
                "Building 3D mesh",
                "Writing output",
                "Finalizing files",
            ),
        )
        timeline_lines = [
            line for line in log_text.splitlines() if re.match(r"^\d{2}:\d{2}:\d{2}\.\d{3}: ", line)
        ]
        self.assertTrue(timeline_lines)
        self.assertNotIn('"event":', log_text)
        self.assertNotIn("processing_features", log_text)
        self.assertNotIn("geometryStructure", log_text)

    def test_running_job_exposes_live_worker_stage_progress(self):
        output_path = Path(self.tmp.name) / "slow.cdb"

        async def start_slow_worker(*, output_path, **_):
            script = (
                "import json,pathlib,sys,time\n"
                "event={'event':'stage.started','stage':'building_2d_mesh',"
                "'current':2,'total':10,'unit':'features',"
                "'message':'Imprinting feature 3 of 10.','data':{}}\n"
                "print('PROCESS_FLOW_PROGRESS {bad-json',file=sys.stderr,flush=True)\n"
                "print('PROCESS_FLOW_PROGRESS '+json.dumps(event),file=sys.stderr,flush=True)\n"
                "time.sleep(0.6)\n"
                "pathlib.Path(sys.argv[1]).write_text('fake cdb',encoding='utf-8')\n"
                "print(json.dumps({'nodeCount':8,'elementCount':1,'componentCount':2}),flush=True)\n"
            )
            return await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                script,
                str(output_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

        with mock.patch(
            "process_flow_api.file_export_jobs.start_cdb_worker",
            new=start_slow_worker,
        ):
            response = self.client.post(
                "/api/geometry-preview/export-jobs",
                json={
                    "clientId": "client-live-progress",
                    "kind": "cdb",
                    "geometryStructure": simple_structure(),
                    "elementSize": 5,
                    "outputPath": str(output_path),
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            job_id = response.json()["job"]["jobId"]

            running = None
            for _ in range(40):
                candidate = self.client.get(
                    f"/api/export-jobs/{job_id}?clientId=client-live-progress"
                ).json()["job"]
                if candidate["progress"] and candidate["progress"]["stage"] == "building_2d_mesh":
                    running = candidate
                    break
                time.sleep(0.025)

            self.assertIsNotNone(running)
            self.assertEqual(running["status"], "running")
            self.assertEqual(running["progress"]["current"], 2)
            self.assertEqual(running["progress"]["total"], 10)
            self.assertEqual(running["progress"]["unit"], "features")
            self.assertGreaterEqual(running["runElapsedSeconds"], 0)
            completed = wait_for_export_job(
                self.client,
                job_id,
                "client-live-progress",
            )
            self.assertEqual(completed["status"], "success", completed)
            log_text = Path(completed["logPath"]).read_text(encoding="utf-8")
            self.assertIn("Malformed worker progress event", log_text)
            self.assertNotIn('"event":"stage.started"', log_text)

    def test_cancel_running_job_keeps_terminal_log(self):
        output_path = Path(self.tmp.name) / "cancel-running.cdb"

        async def start_long_worker(*, output_path, **_):
            script = (
                "import json,sys,time\n"
                "event={'event':'stage.started','stage':'validating',"
                "'message':'Checking geometry input.','data':{}}\n"
                "print('PROCESS_FLOW_PROGRESS '+json.dumps(event),file=sys.stderr,flush=True)\n"
                "time.sleep(10)\n"
            )
            return await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                script,
                str(output_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

        with mock.patch(
            "process_flow_api.file_export_jobs.start_cdb_worker",
            new=start_long_worker,
        ):
            response = self.client.post(
                "/api/geometry-preview/export-jobs",
                json={
                    "clientId": "client-cancel-running",
                    "kind": "cdb",
                    "geometryStructure": simple_structure(),
                    "elementSize": 5,
                    "outputPath": str(output_path),
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            job_id = response.json()["job"]["jobId"]
            for _ in range(40):
                running = self.client.get(
                    f"/api/export-jobs/{job_id}?clientId=client-cancel-running"
                ).json()["job"]
                if running["progress"] and running["progress"]["stage"] == "validating":
                    break
                time.sleep(0.025)
            cancel = self.client.post(
                f"/api/export-jobs/{job_id}/cancel",
                json={"clientId": "client-cancel-running"},
            )
            self.assertEqual(cancel.status_code, 200, cancel.text)
            self.assertEqual(cancel.json()["job"]["status"], "canceling")
            completed = wait_for_export_job(
                self.client,
                job_id,
                "client-cancel-running",
            )

        self.assertEqual(completed["status"], "canceled", completed)
        self.assertFalse(output_path.exists())
        log_text = Path(completed["logPath"]).read_text(encoding="utf-8")
        self.assertIn("Cancellation requested", log_text)
        self.assertIn("Status: canceled", log_text)

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
        self.assertIsNone(job["symmetry"])
        self.assertTrue(normalized_output_path.exists())
        content = normalized_output_path.read_text(encoding="utf-8")
        self.assertEqual(json.loads(content), geometry_entity)
        self.assertIn('\n  "entityType": "preview"', content)
        json_log = Path(job["logPath"]).read_text(encoding="utf-8")
        self.assert_log_actions_in_order(
            json_log,
            ("Preparing export", "Writing output", "Finalizing files"),
        )
        jobs = self.client.get("/api/export-jobs?clientId=client-json")
        self.assertEqual(jobs.status_code, 200, jobs.text)
        self.assertIn(job["jobId"], [candidate["jobId"] for candidate in jobs.json()["jobs"]])

    def test_jobs_using_the_same_output_keep_unique_per_job_logs(self):
        output_path = Path(self.tmp.name) / "reused.json"
        logs = []

        for client_id in ("client-log-a", "client-log-b"):
            response = self.client.post(
                "/api/geometry-preview/export-jobs",
                json={
                    "clientId": client_id,
                    "kind": "json",
                    "geometryEntityJson": preview_geometry_entity(),
                    "outputPath": str(output_path),
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            job = wait_for_export_job(
                self.client,
                response.json()["job"]["jobId"],
                client_id,
            )
            logs.append(Path(job["logPath"]))

        self.assertNotEqual(logs[0], logs[1])
        self.assertTrue(all(path.exists() for path in logs))
        self.assertTrue(all(path.name.endswith(".log") for path in logs))

    def test_export_job_is_rejected_when_log_cannot_be_created(self):
        output_path = Path(self.tmp.name) / "no-log.json"

        with mock.patch(
            "process_flow_api.file_export_jobs.ExportJobLogger.create",
            side_effect=ExportJobLogError("log folder is not writable"),
        ):
            response = self.client.post(
                "/api/geometry-preview/export-jobs",
                json={
                    "clientId": "client-log-failure",
                    "kind": "json",
                    "geometryEntityJson": preview_geometry_entity(),
                    "outputPath": str(output_path),
                },
            )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("log folder is not writable", response.json()["message"])
        self.assertFalse(output_path.exists())

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
        self.assertIsNone(job["symmetry"])
        self.assertTrue(normalized_output_path.exists())
        content = normalized_output_path.read_text(encoding="utf-8", errors="replace")
        self.assertIn("ISO-10303-21", content)
        step_log = Path(job["logPath"]).read_text(encoding="utf-8")
        self.assert_log_actions_in_order(
            step_log,
            (
                "Preparing export",
                "Checking geometry",
                "Analyzing geometry",
                "Building CAD model",
                "Writing output",
                "Finalizing files",
            ),
        )

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

    def test_cdb_export_job_supports_each_symmetry(self):
        symmetries = (
            "full",
            "upper_half",
            "right_half",
            "upper_right_quarter",
        )
        element_counts = {}

        for symmetry in symmetries:
            with self.subTest(symmetry=symmetry):
                response = self.client.post(
                    "/api/geometry-preview/export-jobs",
                    json={
                        "clientId": "client-symmetry-modes",
                        "kind": "cdb",
                        "geometryStructure": simple_structure(),
                        "elementSize": 5,
                        "symmetry": symmetry,
                        "outputPath": str(Path(self.tmp.name) / f"{symmetry}.cdb"),
                    },
                )

                self.assertEqual(response.status_code, 200, response.text)
                job = wait_for_export_job(
                    self.client,
                    response.json()["job"]["jobId"],
                    "client-symmetry-modes",
                )
                self.assertEqual(job["status"], "success", job)
                self.assertEqual(job["symmetry"], symmetry)
                element_counts[symmetry] = job["elementCount"]

        self.assertLess(
            element_counts["upper_right_quarter"],
            element_counts["full"],
        )
        self.assertLess(
            element_counts["upper_half"],
            element_counts["full"],
        )
        self.assertLess(
            element_counts["right_half"],
            element_counts["full"],
        )

    def test_cdb_export_job_rejects_unknown_symmetry(self):
        output_path = Path(self.tmp.name) / "unknown-symmetry.cdb"

        response = self.client.post(
            "/api/geometry-preview/export-jobs",
            json={
                "clientId": "client-symmetry-modes",
                "kind": "cdb",
                "geometryStructure": simple_structure(),
                "elementSize": 5,
                "symmetry": "Upper_Model",
                "outputPath": str(output_path),
            },
        )

        self.assertEqual(response.status_code, 422, response.text)
        self.assertFalse(output_path.exists())

    def test_cdb_export_job_rejects_legacy_model_type_field(self):
        output_path = Path(self.tmp.name) / "legacy-model-type.cdb"

        response = self.client.post(
            "/api/geometry-preview/export-jobs",
            json={
                "clientId": "client-legacy-model-type",
                "kind": "cdb",
                "geometryStructure": simple_structure(),
                "elementSize": 5,
                "modelType": "Full_Model",
                "outputPath": str(output_path),
            },
        )

        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn("modelType", response.text)
        self.assertFalse(output_path.exists())

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
        self.assertEqual(response.json()["job"]["queuePosition"], 1)
        log_path = Path(response.json()["job"]["logPath"])
        self.assertEqual(log_path.name, f"{job_id}.log")
        self.assertTrue(log_path.exists())

        cancel = self.client.post(
            f"/api/export-jobs/{job_id}/cancel",
            json={"clientId": "client-a"},
        )

        self.assertEqual(cancel.status_code, 200, cancel.text)
        self.assertEqual(cancel.json()["job"]["status"], "canceled")
        self.assertFalse(output_path.exists())
        log_text = log_path.read_text(encoding="utf-8")
        self.assertIn("Cancellation requested", log_text)
        self.assertIn("Status: canceled", log_text)


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
        "dim": "",
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
