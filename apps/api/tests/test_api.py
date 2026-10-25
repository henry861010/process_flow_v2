from __future__ import annotations

import asyncio
import copy
import json
import re
import sqlite3
import stat
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
from flow_requests import flow_create_payload, fixture_flow, selected_values
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
            len(payload["processFlows"]),
            len(fixtures["processFlows"]),
        )
        self.assertEqual(
            len(payload["processFlows"]),
            len(fixtures["processFlows"]),
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

    def test_fixture_export_contains_current_database_as_three_json_files(self):
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
            "process-flows.json": bootstrap["processFlows"],
            "geometries.json": bootstrap["geometries"],
        }
        with zipfile.ZipFile(BytesIO(response.content)) as archive:
            self.assertEqual(set(archive.namelist()), set(expected_payloads))
            for filename, expected in expected_payloads.items():
                with self.subTest(filename=filename):
                    self.assertEqual(json.loads(archive.read(filename)), expected)

    def test_fixture_zip_reset_restores_exported_snapshot(self):
        original = self.client.get("/api/bootstrap").json()
        source = fixture_flow(original)
        added = {**source, "id": "flow_inst_zip_test", "name": "ZIP fixture test"}
        created = self.client.post("/api/process-flows", json=flow_create_payload(added))
        self.assertEqual(created.status_code, 201, created.text)
        added["id"] = created.json()["id"]
        snapshot = self.client.get("/api/fixture-export").content

        self.reset_poc_data()
        response = self.client.post(
            "/api/reset-from-zip", content=snapshot, headers={"Content-Type": "application/zip"}
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn(added["id"], {item["id"] for item in response.json()["processFlows"]})
        self.assertEqual(response.json(), self.client.get("/api/bootstrap").json())

    def test_fixture_zip_reset_rejects_invalid_archives_without_changing_data(self):
        before = self.client.get("/api/bootstrap").json()
        cases = [b"not a zip"]
        for mutate in (lambda payload: payload.pop("geometries.json"),
                       lambda payload: payload["process-step-templates.json"].append({"id": "broken"})):
            with zipfile.ZipFile(BytesIO(self.client.get("/api/fixture-export").content)) as source:
                files = {name: json.loads(source.read(name)) for name in source.namelist()}
            mutate(files)
            output = BytesIO()
            with zipfile.ZipFile(output, "w") as archive:
                for name, data in files.items():
                    archive.writestr(name, json.dumps(data))
            cases.append(output.getvalue())

        for content in cases:
            with self.subTest(content=content[:20]):
                response = self.client.post(
                    "/api/reset-from-zip", content=content, headers={"Content-Type": "application/zip"}
                )
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(self.client.get("/api/bootstrap").json(), before)

    def test_failed_fixture_seed_rolls_back_previous_data(self):
        before = self.client.get("/api/bootstrap").json()
        with mock.patch.object(
            self.app.state.store, "_insert_geometry_in_transaction", side_effect=RuntimeError("insert failed")
        ):
            with self.assertRaisesRegex(RuntimeError, "insert failed"):
                self.app.state.store.seed(load_seed_fixtures(), reset=True)
        self.assertEqual(self.client.get("/api/bootstrap").json(), before)

    def test_seed_resources_use_unreleased_versions_and_resolvable_ids(self):
        payload = self.client.get("/api/bootstrap").json()
        step_templates = {
            item["id"]: item for item in payload["processStepTemplates"]
        }
        flow_templates = {
            item["id"]: item for item in payload["processFlows"]
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
            for flow_input in flow_template["definition"]["flowInputs"]:
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
            for step_ref in flow_template["definition"]["stepRefs"]:
                self.assertIn(step_ref["processStepTemplateId"], step_templates)

        for instance in payload["processFlows"]:
            for binding in instance["configuration"]["inputBindings"].values():
                if binding["kind"] == "catalog":
                    self.assertIn(binding["geometryId"], geometries)

        self.assertFalse(any(item["category"] == "die.soc" for item in geometries.values()))
        self.assertNotIn("flow_tpl_fanout_demo", flow_templates)
        self.assertFalse(
            any(
                item["id"] == "flow_inst_fanout_demo_soc_ev1"
                for item in payload["processFlows"]
            )
        )

    def test_carrier_bond_fixture_has_no_daf_parameters(self):
        payload = self.client.get("/api/bootstrap").json()
        carrier_bond = next(
            template
            for template in payload["processStepTemplates"]
            if template["id"] == "step_tpl_carrier_bond"
        )

        self.assertEqual(carrier_bond["program"], "carrier/bond")
        self.assertEqual(carrier_bond["parameterDefinitions"], [])


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
        self.assertIn("整體結構最上方", debond["description"])
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

    def test_fow_fixture_exposes_standalone_contract(self):
        payload = self.client.get("/api/bootstrap").json()
        fow = next(
            template for template in payload["processStepTemplates"]
            if template["id"] == "step_tpl_fow"
        )

        self.assertEqual(fow["version"], "V0.0.0")
        self.assertEqual(fow["name"], "FOW")
        self.assertEqual(fow["category"], "layer")
        self.assertEqual(fow["program"], "layer/fow")
        self.assertEqual(
            [(item["id"], item["name"], item["valueType"], item["controlType"])
             for item in fow["parameterDefinitions"]],
            [("material", "FOW material", "materialRef", "text"),
             ("thk", "FOW thk", "float", "number")],
        )
        self.assertEqual(fow["parameterDefinitions"][1]["unit"], "um")
        self.assertEqual(
            fow["parameterDefinitions"][1]["validation"],
            {"min": 0, "exclusiveMin": True},
        )
        self.assertTrue(all("defaultValue" not in item for item in fow["parameterDefinitions"]))
        self.assertEqual([port["portId"] for port in fow["inputPorts"]], ["main_geometry"])
        self.assertTrue(fow["inputPorts"][0]["required"])
        self.assertEqual(fow["inputPorts"][0]["role"], "primary")
        self.assertEqual([port["portId"] for port in fow["outputPorts"]], ["result_geometry"])
        api_services.validate_process_step_template(fow)
        self.assertTrue(callable(ProcessStepModuleResolver().resolve(fow).execute))
        listed = self.client.get("/api/process-step-templates", params={"category": "layer", "search": "FOW"})
        self.assertEqual([item["id"] for item in listed.json()], ["step_tpl_fow"])

    def test_fow_can_be_manually_added_to_existing_database_without_reset(self):
        fixtures = load_seed_fixtures()
        fow = next(item for item in fixtures["processStepTemplates"] if item["id"] == "step_tpl_fow")
        fixtures["processStepTemplates"] = [
            item for item in fixtures["processStepTemplates"] if item["id"] != "step_tpl_fow"
        ]
        app = create_app(db_path=Path(self.tmp.name) / "existing.sqlite3")
        try:
            app.state.store.seed(fixtures)
            with TestClient(app) as client:
                before = client.get("/api/bootstrap").json()
                self.assertEqual(client.get("/api/process-step-templates/step_tpl_fow").status_code, 404)
                response = client.post("/api/process-step-templates", json=fow)
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(response.json()["id"], "step_tpl_fow")
                after = client.get("/api/bootstrap").json()
                self.assertEqual(len(after["processStepTemplates"]), len(before["processStepTemplates"]) + 1)
                for key in ("processFlows", "geometries"):
                    self.assertEqual(after[key], before[key])
        finally:
            app.state.store.close()

    def test_fow_step_preview_uses_template_parameters(self):
        bootstrap = self.client.get("/api/bootstrap").json()
        template = copy.deepcopy(fixture_flow(bootstrap))
        template["definition"]["flowInputs"] = [template["definition"]["flowInputs"][0]]
        template["definition"]["stepRefs"] = [{"stepRefId": "fow", "processStepTemplateId": "step_tpl_fow"}]
        template["definition"]["flowEdges"] = [{
            "edgeId": "edge_panel_to_fow",
            "source": {"kind": "flowInput", "flowInputId": "incoming_panel"},
            "target": {"stepRefId": "fow", "inputPortId": "main_geometry"},
        }]
        preview = self.client.post("/api/geometry-preview", json={
            "target": {"type": "stepOutput", "stepRefId": "fow", "outputPortId": "result_geometry"},
            "flow": {"definition": template["definition"], "configuration": {
                "inputBindings": {"incoming_panel": {"kind": "catalog", "geometryId": "panel_plp_310x310mm_glass"}},
                "stepConfigurations": {"fow": {"recipeCandidates": [{"recipeId": "r", "name": "Recipe 1", "description": "", "parameterValues": {"material": "FOW-A", "thk": 3}}], "selectedRecipeId": "r"}},
            }},

        })

        self.assertEqual(preview.status_code, 200, preview.text)
        payload = preview.json()
        self.assertTrue(payload["glbBase64"])
        fow = payload["geometryEntityJson"]["structure"]["root"]["bodies"][-1]
        self.assertEqual(fow["key"], "fow")
        self.assertEqual(fow["material"], "FOW-A")
        self.assertEqual(fow["geometry"]["thk"], 3)
        self.assertEqual(fow["geometry"]["bottom_left"][2], 350)

    def test_tmv_fixture_exposes_via_contract(self):
        payload = self.client.get("/api/bootstrap").json()
        tmv = next(
            template
            for template in payload["processStepTemplates"]
            if template["id"] == "step_tpl_tmv"
        )

        self.assertEqual(tmv["version"], "V0.0.0")
        self.assertEqual(tmv["name"], "tmv")
        self.assertEqual(tmv["category"], "tmv")
        self.assertEqual(tmv["program"], "tmv/tmv")
        api_services.validate_process_step_template(tmv)
        self.assertTrue(callable(ProcessStepModuleResolver().resolve(tmv).execute))
        self.assertEqual(
            [
                (definition["id"], definition["valueType"])
                for definition in tmv["parameterDefinitions"]
            ],
            [("thk", "float"), ("material", "materialRef"), ("density", "float")],
        )
        self.assertEqual(
            tmv["parameterDefinitions"][0]["validation"],
            {"min": 0, "exclusiveMin": True},
        )
        self.assertEqual(
            tmv["parameterDefinitions"][2]["validation"],
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


    def test_reset_reloads_poc_data(self):
        source = self.client.get("/api/bootstrap").json()["processFlows"][0]
        instance = {**source, "id": "flow_inst_reset_test", "name": "Reset Test"}
        created = self.client.post("/api/process-flows", json=flow_create_payload(instance))
        self.assertEqual(created.status_code, 201, created.text)
        instance["id"] = created.json()["id"]

        payload = self.reset_poc_data()

        self.assert_seed_payload_counts(payload)
        self.assertNotIn(
            instance["id"],
            {instance["id"] for instance in payload["processFlows"]},
        )

    def test_admin_seed_endpoint_is_removed(self):
        response = self.client.post("/api/admin/seed", json={"mode": "reset"})

        self.assertEqual(response.status_code, 404, response.text)

    def test_step_template_create_duplicate_and_delete_unavailable(self):
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
        self.assertEqual(deleted.status_code, 405, deleted.text)
        preserved = self.client.get("/api/process-step-templates/custom_step")
        self.assertEqual(preserved.status_code, 200, preserved.text)
        self.assertEqual(preserved.json(), created.json())

    def test_step_template_update_is_restricted_and_preserves_existing_flow_defaults(self):
        bootstrap = self.reset_poc_data()
        original = next(
            item
            for item in bootstrap["processStepTemplates"]
            if item["id"] == "step_tpl_molding"
        )
        existing_flow = next(
            item
            for item in bootstrap["processFlows"]
            if item["id"] == "flow_tpl_aaa_demo"
        )
        existing_molding_ref = next(
            step_ref
            for step_ref in existing_flow["definition"]["stepRefs"]
            if step_ref["processStepTemplateId"] == original["id"]
        )
        self.assertEqual(selected_values(existing_flow, "mold_cap")["thickness"], 180)

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
            "/api/process-flows/flow_tpl_aaa_demo"
        ).json()
        persisted_molding_ref = next(
            step_ref
            for step_ref in persisted_existing_flow["definition"]["stepRefs"]
            if step_ref["processStepTemplateId"] == original["id"]
        )
        self.assertEqual(selected_values(persisted_existing_flow, "mold_cap")["thickness"], 180)

    def test_step_template_input_order_round_trips_without_changing_flows_or_execution(self):
        bootstrap = self.reset_poc_data()
        original = next(item for item in bootstrap["processStepTemplates"] if item["id"] == "step_tpl_pnp")
        self.assertEqual([port["portId"] for port in original["inputPorts"]], ["die_geometry", "main_geometry"])
        instance_id = "flow_inst_aaa_demo_hbm4_alpha"
        before = self.client.post(f"/api/process-flows/{instance_id}/execute")
        self.assertEqual(before.status_code, 200, before.text)

        reordered = copy.deepcopy(original)
        reordered["inputPorts"].reverse()
        response = self.client.put(f"/api/process-step-templates/{original['id']}", json=reordered)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), reordered)
        self.assertEqual(self.client.get(f"/api/process-step-templates/{original['id']}").json(), reordered)
        refreshed = self.client.get("/api/bootstrap").json()
        self.assertEqual(refreshed["processFlows"], bootstrap["processFlows"])

        after = self.client.post(f"/api/process-flows/{instance_id}/execute")
        self.assertEqual(after.status_code, 200, after.text)
        self.assertEqual(after.json(), before.json())
        archive = self.client.get("/api/fixture-export")
        with zipfile.ZipFile(BytesIO(archive.content)) as fixtures:
            saved = json.loads(fixtures.read("process-step-templates.json"))
        self.assertEqual(next(item for item in saved if item["id"] == original["id"]), reordered)

        # Existing databases keep their saved declaration order when fixtures are seeded again.
        self.app.state.store.seed(load_seed_fixtures(), reset=False)
        self.assertEqual(self.app.state.store.get_process_step_template(original["id"]), reordered)

    def test_step_template_input_order_update_preserves_legacy_port_fields(self):
        original = self.app.state.store.get_process_step_template("step_tpl_pnp")
        for port in original["inputPorts"]:
            port.pop("required", None)
        self.app.state.store.update_process_step_template(original)
        request = copy.deepcopy(original)
        request["inputPorts"].reverse()
        response = self.client.put("/api/process-step-templates/step_tpl_pnp", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), request)

    def test_step_template_input_order_update_rejects_definition_changes(self):
        original = self.app.state.store.get_process_step_template("step_tpl_pnp")
        invalid = []
        for field, value in (("name", "Changed"), ("role", "primary"), ("required", False),
                             ("portId", "changed"), ("description", "Changed")):
            candidate = copy.deepcopy(original)
            candidate["inputPorts"].reverse()
            die = next(port for port in candidate["inputPorts"] if port["portId"] == "die_geometry")
            die[field] = value
            invalid.append((field, candidate))
        removed = copy.deepcopy(original)
        removed["inputPorts"].pop()
        invalid.append(("removed", removed))
        added = copy.deepcopy(original)
        added["inputPorts"].append({**added["inputPorts"][0], "portId": "extra_geometry"})
        invalid.append(("added", added))
        duplicate = copy.deepcopy(original)
        duplicate["inputPorts"][1] = copy.deepcopy(duplicate["inputPorts"][0])
        invalid.append(("duplicate", duplicate))
        output_changed = copy.deepcopy(original)
        output_changed["outputPorts"][0]["name"] = "Changed"
        invalid.append(("output", output_changed))
        for label, candidate in invalid:
            with self.subTest(change=label):
                response = self.client.put("/api/process-step-templates/step_tpl_pnp", json=candidate)
                self.assertEqual(response.status_code, 409, response.text)
                self.assertEqual(self.app.state.store.get_process_step_template(original["id"]), original)

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
                self.assertIn("Only status, owner, category, program", rejected.json()["message"])

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


    def test_step_template_delete_is_not_a_public_operation(self):
        bootstrap = self.reset_poc_data()
        step_template_id = fixture_flow(bootstrap)["definition"]["stepRefs"][0][
            "processStepTemplateId"
        ]

        response = self.client.delete(f"/api/process-step-templates/{step_template_id}")

        self.assertEqual(response.status_code, 405, response.text)
        operations = self.client.get("/openapi.json").json()["paths"]["/api/process-step-templates/{template_id}"]
        self.assertNotIn("delete", operations)
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


    def test_execute_saved_instance(self):
        self.reset_poc_data()

        response = self.client.post("/api/process-flows/flow_inst_aaa_demo_hbm4_alpha/execute")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertIn("geometryStructure", payload)
        self.assertIn("terminalStepRefIds", payload)
        self.assertGreater(len(payload["stepOutputs"]), 0)

    def test_preview_and_step_export(self):
        bootstrap = self.reset_poc_data()
        flow_template = fixture_flow(bootstrap)
        instance = fixture_flow(bootstrap)

        preview = self.client.post(
            "/api/geometry-preview",
            json={
                "target": {"type": "flowInput", "flowInputId": "incoming_panel"},
                "sourceLabel": "Panel input",
                "flow": {"definition": flow_template["definition"], "configuration": {
                    "inputBindings": instance["configuration"]["inputBindings"],
                    "stepConfigurations": instance["configuration"]["stepConfigurations"],
                }},

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
                "flow": {"definition": draft_template["definition"], "configuration": {
                    "inputBindings": instance["configuration"]["inputBindings"],
                    "stepConfigurations": instance["configuration"]["stepConfigurations"],
                }},

            },
        )
        self.assertEqual(draft_preview.status_code, 200, draft_preview.text)
        self.assertIn("glbBase64", draft_preview.json())

        draft_step_preview = self.client.post(
            "/api/geometry-preview",
            json={
                "target": {
                    "type": "stepOutput",
                    "stepRefId": flow_template["definition"]["stepRefs"][-1]["stepRefId"],
                    "outputPortId": "result_geometry",
                },
                "sourceLabel": "Unsaved terminal step",
                "flow": {"definition": draft_template["definition"], "configuration": {
                    "inputBindings": instance["configuration"]["inputBindings"],
                    "stepConfigurations": instance["configuration"]["stepConfigurations"],
                }},

            },
        )
        self.assertEqual(
            draft_step_preview.status_code,
            200,
            draft_step_preview.text,
        )
        self.assertIn("glbBase64", draft_step_preview.json())

        rejected_save = self.client.post(
            "/api/process-flows",
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
        flow_template = fixture_flow(bootstrap)
        instance = fixture_flow(bootstrap)
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
        flow_template = fixture_flow(bootstrap)
        instance = fixture_flow(bootstrap)
        target_step_ref_id = flow_template["definition"]["stepRefs"][1]["stepRefId"]
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
        request_payload.pop("flow")
        request_payload["flowId"] = instance["id"]
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
            [step_ref["stepRefId"] for step_ref in flow_template["definition"]["stepRefs"][:2]],
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
        flow_template = fixture_flow(bootstrap)
        instance = fixture_flow(bootstrap)
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
        flow_template = fixture_flow(bootstrap)
        instance = fixture_flow(bootstrap)
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
        flow_template = fixture_flow(bootstrap)
        instance = fixture_flow(bootstrap)
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


    def test_cdb_export_job_writes_text_cdb_file(self):
        output_path = Path(self.tmp.name) / "MODEL.CDB"
        for suffix in (".cdb", ".geometry.json", ".mesh-control.json"):
            existing_path = output_path.with_suffix(suffix)
            existing_path.write_text("previous output", encoding="utf-8")
            existing_path.chmod(0o600)

        response = self.client.post(
            "/api/geometry-preview/cdb-jobs",
            json={
                "clientId": "client-a",
                "kind": "cdb",
                "geometryStructure": simple_structure(),
                "meshControl": mesh_control(),
                "outputPath": str(output_path),
                "sourceLabel": "Unit test",
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        job = wait_for_export_job(self.client, response.json()["job"]["jobId"], "client-a")
        normalized_output_path = Path(self.tmp.name) / "MODEL.cdb"
        self.assertEqual(job["status"], "success", job)
        self.assertEqual(job["outputPath"], str(normalized_output_path))
        geometry_output_path = Path(self.tmp.name) / "MODEL.geometry.json"
        mesh_control_output_path = Path(self.tmp.name) / "MODEL.mesh-control.json"
        self.assertEqual(job["geometryOutputPath"], str(geometry_output_path))
        self.assertEqual(job["meshControlOutputPath"], str(mesh_control_output_path))
        self.assertEqual(job["meshControl"], mesh_control())
        self.assertGreater(job["nodeCount"], 0)
        self.assertGreater(job["elementCount"], 0)
        self.assertIsNone(job["queuePosition"])
        self.assertGreaterEqual(job["runElapsedSeconds"], 0)
        self.assertEqual(job["progress"]["stage"], "finalizing")
        self.assertEqual(job["logPath"], str(Path(self.tmp.name) / f"{job['jobId']}.log"))
        self.assertTrue(normalized_output_path.exists())
        for path in (
            normalized_output_path,
            geometry_output_path,
            mesh_control_output_path,
            Path(job["logPath"]),
        ):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o777, str(path))
        self.assertEqual(
            json.loads(geometry_output_path.read_text(encoding="utf-8")),
            simple_structure(),
        )
        self.assertEqual(
            json.loads(mesh_control_output_path.read_text(encoding="utf-8")),
            mesh_control(),
        )
        content = normalized_output_path.read_text(encoding="utf-8")
        self.assertIn("*NODES,index,x,y,z", content)
        self.assertIn("*ELEMENTS,index,n0,n1,n2,n3,n4,n5,n6,n7", content)
        self.assertIn("*COMPS,component_id,name", content)
        log_text = Path(job["logPath"]).read_text(encoding="utf-8")
        self.assertIn("Log schema: process-flow-export-log/v2", log_text)
        self.assertIn("Type: CDB", log_text)
        self.assertIn("Symmetry: full", log_text)
        self.assertIn("Mesh controls: 0", log_text)
        self.assertIn("Mesh-control SHA-256:", log_text)
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

    def test_cdb_export_keeps_geometry_and_mesh_control_when_mesher_fails(self):
        output_path = Path(self.tmp.name) / "failed-mesh.cdb"

        async def start_failing_worker(**_):
            script = (
                "import sys\n"
                "print('mesh construction failed', file=sys.stderr, flush=True)\n"
                "raise SystemExit(2)\n"
            )
            return await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

        with mock.patch(
            "process_flow_api.file_export_jobs.start_cdb_worker",
            new=start_failing_worker,
        ):
            response = self.client.post(
                "/api/geometry-preview/export-jobs",
                json={
                    "clientId": "client-failed-mesh-sidecars",
                    "kind": "cdb",
                    "geometryStructure": simple_structure(),
                    "meshControl": mesh_control(),
                    "outputPath": str(output_path),
                },
            )
            self.assertEqual(response.status_code, 200, response.text)
            job = wait_for_export_job(
                self.client,
                response.json()["job"]["jobId"],
                "client-failed-mesh-sidecars",
            )

        geometry_output_path = Path(job["geometryOutputPath"])
        mesh_control_output_path = Path(job["meshControlOutputPath"])
        self.assertEqual(job["status"], "failed", job)
        self.assertFalse(output_path.exists())
        for path in (geometry_output_path, mesh_control_output_path, Path(job["logPath"])):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o777, str(path))
        self.assertEqual(
            json.loads(geometry_output_path.read_text(encoding="utf-8")),
            simple_structure(),
        )
        self.assertEqual(
            json.loads(mesh_control_output_path.read_text(encoding="utf-8")),
            mesh_control(),
        )

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
                    "meshControl": mesh_control(),
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
                    "meshControl": mesh_control(),
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
        self.assertEqual(stat.S_IMODE(Path(completed["logPath"]).stat().st_mode), 0o777)
        log_text = Path(completed["logPath"]).read_text(encoding="utf-8")
        self.assertIn("Cancellation requested", log_text)
        self.assertIn("Status: canceled", log_text)

    def test_json_export_job_writes_geometry_entity_file(self):
        output_path = Path(self.tmp.name) / "PREVIEW.JSON"
        output_path.with_suffix(".json").write_text("previous output", encoding="utf-8")
        output_path.with_suffix(".json").chmod(0o600)
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
        self.assertIsNone(job["meshControl"])
        self.assertTrue(normalized_output_path.exists())
        content = normalized_output_path.read_text(encoding="utf-8")
        self.assertEqual(json.loads(content), geometry_entity)
        for path in (normalized_output_path, Path(job["logPath"])):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o777, str(path))
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
        output_path.with_suffix(".step").write_text("previous output", encoding="utf-8")
        output_path.with_suffix(".step").chmod(0o600)

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
        self.assertIsNone(job["meshControl"])
        self.assertTrue(normalized_output_path.exists())
        for path in (normalized_output_path, Path(job["logPath"])):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o777, str(path))
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
                "kind": "cdb",
                "geometryStructure": simple_structure(),
                "meshControl": mesh_control(),
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
                        "meshControl": mesh_control(symmetry=symmetry),
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
                self.assertEqual(job["meshControl"]["symmetry"], symmetry)
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

    def test_cdb_export_passes_new_z_format_unchanged_and_keeps_sidecar_on_mesher_failure(self):
        geometry_structure = simple_structure()
        geometry_structure["root"]["key"] = "hbm"
        controls = [
            {
                "method": "Z_SECTION_AVG",
                "label": "  Refine die interface  ",
                "coordinateMode": "absolute",
                "elementSize": 0.25,
                "startZ": 0,
                "endZ": 1,
            }
        ]
        output_path = Path(self.tmp.name) / "controls.cdb"

        response = self.client.post(
            "/api/geometry-preview/export-jobs",
            json={
                "clientId": "client-controls",
                "kind": "cdb",
                "geometryStructure": geometry_structure,
                "meshControl": mesh_control(controls=controls),
                "outputPath": str(output_path),
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()["job"]["warning"])
        job = wait_for_export_job(
            self.client,
            response.json()["job"]["jobId"],
            "client-controls",
        )
        self.assertEqual(job["status"], "failed", job)
        self.assertIn("CDB export failed", job["message"])
        self.assertEqual(job["meshControl"]["controls"], controls)
        mesh_control_output_path = output_path.with_suffix(".mesh-control.json")
        self.assertEqual(
            json.loads(mesh_control_output_path.read_text(encoding="utf-8"))["controls"],
            controls,
        )
        self.assertIsNone(job["warning"])
        self.assertFalse(output_path.exists())

    def test_cdb_export_validates_mesh_control_union_shapes(self):
        geometry_structure = simple_structure()
        geometry_structure["root"]["key"] = "hbm"
        reference = {"kind": "container", "key": "hbm"}
        valid_controls = [
            {"method": method, "coordinateMode": mode, "label": "Union control", "elementSize": 0.25,
             **({"reference": reference} if mode == "reference" else {}),
             "startZ": {"anchor": "z_min", "offset": 0} if mode == "reference" else 0,
             "endZ": {"anchor": "z_max", "offset": 0} if mode == "reference" else 1}
            for method in ("Z_SECTION_AVG", "Z_SECTION_TOP", "Z_SECTION_BOT", "Z_SECTION_CENTER")
            for mode in ("reference", "absolute")
        ] + [
            {"method": "Z_POINT", "coordinateMode": "absolute", "label": "Point", "z": 0.5},
            {"method": "Z_POINT", "coordinateMode": "reference", "label": "Point", "reference": reference,
             "z": {"anchor": "z_max", "offset": -0.25}},
        ]
        output_path = Path(self.tmp.name) / "valid-control-union.cdb"

        response = self.client.post(
            "/api/geometry-preview/export-jobs",
            json={
                "clientId": "client-control-union",
                "kind": "cdb",
                "geometryStructure": geometry_structure,
                "meshControl": mesh_control(controls=valid_controls),
                "outputPath": str(output_path),
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        job = wait_for_export_job(
            self.client,
            response.json()["job"]["jobId"],
            "client-control-union",
        )
        self.assertEqual(job["status"], "failed", job)
        self.assertIn("CDB export failed", job["message"])

        invalid_controls = (
            {
                "method": "Z_POINT",
                "reference": {"kind": "root", "key": "hbm"},
                "z": {"mode": "absolute", "value": 0},
            },
            {
                "method": "Z_POINT",
                "reference": {"kind": "via", "key": "hbm"},
                "z": {"mode": "absolute", "value": 0},
            },
            {
                "method": "Z_POINT",
                "z": {"mode": "relative", "anchor": "z_min", "offset": 0},
            },
            {
                "method": "Z_POINT",
                "elementSize": 10,
                "z": {"mode": "absolute", "value": 0},
            },
            {
                "method": "Z_SECTION_AVG",
                "elementSize": 10,
                "z": {"mode": "absolute", "value": 0},
            },
            {
                "method": "Z_POINT",
                "z": {
                    "mode": "absolute",
                    "anchor": "z_min",
                    "value": 0,
                },
            },
        )
        for index, control in enumerate(invalid_controls):
            control["label"] = "Invalid union control"
            control["coordinateMode"] = "reference" if "reference" in control else "absolute"
            with self.subTest(index=index):
                invalid = self.client.post(
                    "/api/geometry-preview/export-jobs",
                    json={
                        "clientId": "client-invalid-controls",
                        "kind": "cdb",
                        "geometryStructure": simple_structure(),
                        "meshControl": mesh_control(controls=[control]),
                        "outputPath": str(Path(self.tmp.name) / f"invalid-{index}.cdb"),
                    },
                )
                self.assertEqual(invalid.status_code, 422, invalid.text)
                self.assertIn("Invalid meshControl", invalid.text)

    def test_cdb_export_job_rejects_unknown_symmetry(self):
        output_path = Path(self.tmp.name) / "unknown-symmetry.cdb"

        response = self.client.post(
            "/api/geometry-preview/export-jobs",
            json={
                "clientId": "client-symmetry-modes",
                "kind": "cdb",
                "geometryStructure": simple_structure(),
                "meshControl": mesh_control(symmetry="Upper_Model"),
                "outputPath": str(output_path),
            },
        )

        self.assertEqual(response.status_code, 422, response.text)
        self.assertFalse(output_path.exists())

    def test_cdb_export_job_rejects_each_legacy_mesh_field(self):
        for field, value in (
            ("elementSize", 5),
            ("symmetry", "full"),
            ("modelType", "Full_Model"),
        ):
            with self.subTest(field=field):
                output_path = Path(self.tmp.name) / f"legacy-{field}.cdb"
                response = self.client.post(
                    "/api/geometry-preview/export-jobs",
                    json={
                        "clientId": "client-legacy-mesh-field",
                        "kind": "cdb",
                        "geometryStructure": simple_structure(),
                        "meshControl": mesh_control(),
                        field: value,
                        "outputPath": str(output_path),
                    },
                )

                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn(field, response.text)
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
                "kind": "cdb",
                "geometryStructure": simple_structure(),
                "meshControl": mesh_control(),
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
                "kind": "cdb",
                "geometryStructure": simple_structure(),
                "meshControl": mesh_control(),
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
        self.assertEqual(stat.S_IMODE(log_path.stat().st_mode), 0o777)
        internal_job = self.app.state.file_export_jobs._jobs[job_id]
        input_directory = internal_job.input_directory
        self.assertIsNotNone(input_directory)
        self.assertEqual(internal_job.input_path.name, "geometry.json")
        self.assertEqual(internal_job.mesh_control_input_path.name, "mesh_control.json")
        self.assertTrue(internal_job.input_path.exists())
        self.assertTrue(internal_job.mesh_control_input_path.exists())

        cancel = self.client.post(
            f"/api/export-jobs/{job_id}/cancel",
            json={"clientId": "client-a"},
        )

        self.assertEqual(cancel.status_code, 200, cancel.text)
        self.assertEqual(cancel.json()["job"]["status"], "canceled")
        self.assertFalse(output_path.exists())
        self.assertFalse(input_directory.exists())
        log_text = log_path.read_text(encoding="utf-8")
        self.assertIn("Cancellation requested", log_text)
        self.assertIn("Status: canceled", log_text)
        self.assertEqual(stat.S_IMODE(log_path.stat().st_mode), 0o777)


def preview_session_request(flow, source, *, target, source_label=None, bootstrap=None, through_step_index=None):
    configuration = copy.deepcopy(source["configuration"])
    if through_step_index is not None:
        keep = {ref["stepRefId"] for ref in flow["definition"]["stepRefs"][:through_step_index + 1]}
        configuration["stepConfigurations"] = {key: value for key, value in configuration["stepConfigurations"].items() if key in keep}
    return {"target": target, "sourceLabel": source_label,
            "flow": {"definition": flow["definition"], "configuration": configuration}}


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


def mesh_control(*, element_size=5, symmetry="full", controls=None):
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "mesher": "process_flow_2_5d",
        "globalElementSize": element_size,
        "symmetry": symmetry,
        "controls": [] if controls is None else controls,
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
