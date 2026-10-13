from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from flow_requests import instance_create_payload, template_create_payload
from process_flow_api.main import create_app
from process_flow_api.repository import SQLiteStore
from process_flow_api.analytics import AnalyticsRecorder, SCHEMA, EVENT_COLUMNS


METADATA = {"name": "", "version": "V0.0.0", "owner": "", "description": ""}


class EditorDraftTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "business.sqlite3"
        self.app = create_app(db_path=self.path)
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.store = self.app.state.store
        self.bootstrap = self.client.get("/api/bootstrap").json()
        self.instance = copy.deepcopy(self.bootstrap["processFlowInstances"][0])
        self.template = copy.deepcopy(next(item for item in self.bootstrap["processFlowTemplates"]
                                          if item["id"] == self.instance["processFlowTemplateId"]))

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.store.close()
        self.tmp.cleanup()

    def body(self, kind="instance", complete=False):
        configuration = {
            "inputBindings": copy.deepcopy(self.instance["inputBindings"]) if complete else {},
            "stepConfigurations": copy.deepcopy(self.instance["stepConfigurations"]) if complete else {
                "unfinished": {"parameterValues": {"array": ["", None], "placements": [], "number": ""}}
            }, "embeddedGeometries": {},
        }
        state = {"metadata": copy.deepcopy(METADATA), "configuration": configuration}
        body = {"schemaVersion": 1, "user": "engineer", "name": "Half finished", "state": state}
        if kind == "instance":
            body["processFlowTemplateId"] = self.template["id"]
        else:
            state.update(nodes=[{"id": "node", "kind": "processStep", "position": {"x": 112, "y": -35},
                                 "stepRef": copy.deepcopy(self.template["stepRefs"][0])}],
                         edges=[], viewport={"x": 31, "y": -2, "zoom": 0.72})
        return body

    def create(self, kind="instance", body=None):
        response = self.client.post(f"/api/process-flow-{kind}-drafts", json=body or self.body(kind))
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def detail(self, kind, draft):
        params = {"processFlowTemplateId": self.template["id"]} if kind == "instance" else {}
        return self.client.get(f"/api/process-flow-{kind}-drafts/{draft['id']}", params=params)

    def test_incomplete_snapshots_round_trip_and_survive_reopen(self):
        for kind in ("template", "instance"):
            body = self.body(kind)
            draft = self.create(kind, body)
            self.assertEqual(draft["state"], body["state"])
            self.assertEqual(self.detail(kind, draft).json(), draft)
            reopened = SQLiteStore(self.path)
            try:
                self.assertEqual(reopened.get_editor_draft(kind, draft["id"]), draft)
            finally:
                reopened.close()
        tables = {row[0] for row in self.store._connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertNotIn("process_flow_workspaces", tables)

    def test_required_metadata_and_distinct_snapshot_types(self):
        for kind in ("template", "instance"):
            for field in ("user", "name"):
                body = self.body(kind)
                body[field] = "  "
                self.assertEqual(self.client.post(f"/api/process-flow-{kind}-drafts", json=body).status_code, 422)
            body = self.body(kind)
            body["id"] = "caller-id"
            self.assertEqual(self.client.post(f"/api/process-flow-{kind}-drafts", json=body).status_code, 422)
        body = self.body("instance")
        body["state"] = self.body("template")["state"]
        self.assertEqual(self.client.post("/api/process-flow-instance-drafts", json=body).status_code, 422)
        body = self.body("template")
        body["state"]["viewport"]["zoom"] = 0
        self.assertEqual(self.client.post("/api/process-flow-template-drafts", json=body).status_code, 422)

    def test_draft_id_collision_returns_conflict_without_overwriting(self):
        for kind in ("template", "instance"):
            draft = self.create(kind)
            with mock.patch("process_flow_api.draft_service.generated_draft_id", return_value=draft["id"]):
                response = self.client.post(f"/api/process-flow-{kind}-drafts", json={**self.body(kind), "name": "Collision"})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.detail(kind, draft).json(), draft)

    def test_update_and_new_copy_with_stale_update_delete_and_commit(self):
        for kind in ("template", "instance"):
            draft = self.create(kind)
            body = {**self.body(kind), "revision": 1, "name": "Updated"}
            route = f"/api/process-flow-{kind}-drafts/{draft['id']}"
            response = self.client.put(route, json=body)
            self.assertEqual(response.status_code, 200, response.text)
            updated = response.json()
            self.assertEqual(updated["revision"], 2)
            self.assertEqual(updated["id"], draft["id"])
            self.assertEqual(updated["createdAt"], draft["createdAt"])
            self.assertEqual(self.client.put(route, json=body).status_code, 409)
            params = {"revision": 1, **({"processFlowTemplateId": self.template["id"]} if kind == "instance" else {})}
            self.assertEqual(self.client.delete(route, params=params).status_code, 409)
            field = "processFlowTemplate" if kind == "template" else "processFlowInstance"
            payload = template_create_payload(self.template) if kind == "template" else instance_create_payload(self.instance)
            self.assertEqual(self.client.post(route + "/commit", json={"revision": 1, field: payload}).status_code, 409)
            self.assertEqual(self.detail(kind, draft).json(), updated)
            other = self.create(kind)
            self.assertNotEqual(other["id"], draft["id"])

    def test_search_user_filter_summary_and_order(self):
        for kind in ("template", "instance"):
            first = self.create(kind)
            second = self.create(kind, {**self.body(kind), "name": "Experiment B", "user": "another"})
            params = {"processFlowTemplateId": self.template["id"]} if kind == "instance" else {}
            route = f"/api/process-flow-{kind}-drafts"
            rows = self.client.get(route, params=params).json()
            self.assertEqual([row["id"] for row in rows], [second["id"], first["id"]])
            self.assertTrue(all("state" not in row for row in rows))
            self.assertEqual(len(self.client.get(route, params={**params, "user": "engineer"}).json()), 1)
            self.assertEqual(self.client.get(route, params={**params, "search": "EXPERIMENT"}).json()[0]["id"], second["id"])

    def test_instance_template_isolation_and_wrong_kind(self):
        draft = self.create()
        route = f"/api/process-flow-instance-drafts/{draft['id']}"
        self.assertEqual(self.client.get(route, params={"processFlowTemplateId": "other"}).status_code, 404)
        self.assertEqual(self.client.get("/api/process-flow-instance-drafts", params={"processFlowTemplateId": "other"}).json(), [])
        self.assertEqual(self.client.get(f"/api/process-flow-template-drafts/{draft['id']}").status_code, 404)
        self.assertEqual(self.client.put(route, json={**self.body(), "revision": 1, "processFlowTemplateId": "other"}).status_code, 404)
        payload = {**instance_create_payload(self.instance), "processFlowTemplateId": "other"}
        self.assertEqual(self.client.post(route + "/commit", json={"revision": 1, "processFlowInstance": payload}).status_code, 404)
        self.assertEqual(self.client.delete(route, params={"revision": 1, "processFlowTemplateId": "other"}).status_code, 404)
        self.assertEqual(self.detail("instance", draft).json(), draft)

    def test_commit_uses_current_payload_and_consumes_only_its_draft(self):
        for kind in ("template", "instance"):
            draft = self.create(kind)
            other = self.create(kind)
            payload = template_create_payload(self.template) if kind == "template" else instance_create_payload(self.instance)
            payload.update(name=f"Latest {kind}", owner="final.owner")
            field = "processFlowTemplate" if kind == "template" else "processFlowInstance"
            response = self.client.post(f"/api/process-flow-{kind}-drafts/{draft['id']}/commit",
                                        json={"revision": 1, field: payload})
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(response.json()["name"], payload["name"])
            self.assertEqual(response.json()["owner"], "final.owner")
            self.assertEqual(self.detail(kind, draft).status_code, 404)
            self.assertEqual(self.detail(kind, other).status_code, 200)

    def test_failed_validation_and_duplicate_identity_preserve_draft(self):
        for kind in ("template", "instance"):
            draft = self.create(kind)
            field = "processFlowTemplate" if kind == "template" else "processFlowInstance"
            payload = template_create_payload(self.template) if kind == "template" else instance_create_payload(self.instance)
            route = f"/api/process-flow-{kind}-drafts/{draft['id']}/commit"
            before = self.client.get("/api/bootstrap").json()
            self.assertEqual(self.client.post(route, json={"revision": 1, field: payload}).status_code, 409)
            payload["name"] = f"Incomplete {kind}"
            if kind == "template":
                payload["flowEdges"] = []
            else:
                payload["inputBindings"] = {}
            self.assertEqual(self.client.post(route, json={"revision": 1, field: payload}).status_code, 400)
            self.assertEqual(self.detail(kind, draft).json(), draft)
            self.assertEqual(self.client.get("/api/bootstrap").json(), before)

    def test_materialization_rolls_back_when_instance_insert_fails(self):
        draft = self.create()
        payload = instance_create_payload(self.instance)
        geometry = copy.deepcopy(self.bootstrap["geometries"][0])
        embedded = {key: value for key, value in geometry.items() if key != "id"}
        input_id = next(iter(payload["inputBindings"]))
        payload["inputBindings"][input_id] = {"kind": "embedded", "localId": "local"}
        payload["embeddedGeometries"] = {"local": embedded}
        before = self.client.get("/api/bootstrap").json()
        # Duplicate instance identity fails after any materialized geometries are inserted.
        response = self.client.post(f"/api/process-flow-instance-drafts/{draft['id']}/commit",
                                    json={"revision": 1, "processFlowInstance": payload})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(self.client.get("/api/bootstrap").json(), before)
        self.assertEqual(self.detail("instance", draft).json(), draft)

    def test_disabled_flow_drafts_remain_editable_but_cannot_commit(self):
        draft = self.create()
        disabled = {**self.template, "status": "disabled"}
        self.assertEqual(self.client.put(f"/api/process-flow-templates/{self.template['id']}", json=disabled).status_code, 200)
        self.create()
        route = f"/api/process-flow-instance-drafts/{draft['id']}"
        self.assertEqual(self.client.put(route, json={**self.body(), "revision": 1}).status_code, 200)
        payload = {**instance_create_payload(self.instance), "name": "Disabled copy"}
        self.assertEqual(self.client.post(route + "/commit", json={"revision": 2, "processFlowInstance": payload}).status_code, 409)
        self.assertEqual(self.detail("instance", draft).status_code, 200)

    def test_disabled_step_blocks_new_templates_but_existing_flow_still_commits(self):
        step_id = self.template["stepRefs"][0]["processStepTemplateId"]
        step = next(item for item in self.bootstrap["processStepTemplates"] if item["id"] == step_id)
        self.assertEqual(self.client.put(f"/api/process-step-templates/{step_id}", json={**step, "status": "disabled"}).status_code, 200)
        template_draft = self.create("template")
        new_template = {**template_create_payload(self.template), "name": "Disabled step copy"}
        self.assertEqual(self.client.post(f"/api/process-flow-template-drafts/{template_draft['id']}/commit",
                         json={"revision": 1, "processFlowTemplate": new_template}).status_code, 409)
        instance_draft = self.create()
        payload = {**instance_create_payload(self.instance), "name": "Existing enabled flow copy"}
        response = self.client.post(f"/api/process-flow-instance-drafts/{instance_draft['id']}/commit",
                                    json={"revision": 1, "processFlowInstance": payload})
        self.assertEqual(response.status_code, 201, response.text)

    def test_instance_draft_commit_materializes_embedded_geometry(self):
        draft = self.create()
        payload = {**instance_create_payload(self.instance), "name": "Embedded draft completion"}
        input_id, binding = next(iter(payload["inputBindings"].items()))
        geometry = next(item for item in self.bootstrap["geometries"] if item["id"] == binding["geometryId"])
        payload["inputBindings"][input_id] = {"kind": "embedded", "localId": "local"}
        payload["embeddedGeometries"] = {"local": {key: value for key, value in geometry.items() if key != "id"}}
        before = len(self.store.list_geometries())
        response = self.client.post(f"/api/process-flow-instance-drafts/{draft['id']}/commit",
                                    json={"revision": 1, "processFlowInstance": payload})
        self.assertEqual(response.status_code, 201, response.text)
        saved = response.json()
        self.assertEqual(saved["inputBindings"][input_id]["kind"], "catalog")
        self.assertNotIn("embeddedGeometries", saved)
        self.assertEqual(len(self.store.list_geometries()), before + 1)
        self.assertIsNone(self.store.get_editor_draft("instance", draft["id"]))

    def test_zero_placements_can_commit_without_the_unused_die_binding(self):
        draft = self.create()
        payload = {**instance_create_payload(self.instance), "name": "Zero placement draft completion"}
        step_templates = {item["id"]: item for item in self.bootstrap["processStepTemplates"]}
        pnp_ref = next(ref for ref in self.template["stepRefs"] if step_templates[ref["processStepTemplateId"]]["program"] == "pnp/pnp")
        payload["stepConfigurations"][pnp_ref["stepRefId"]]["parameterValues"]["placements"] = []
        edge = next(edge for edge in self.template["flowEdges"] if edge["target"] == {"stepRefId": pnp_ref["stepRefId"], "inputPortId": "die_geometry"})
        payload["inputBindings"].pop(edge["source"]["flowInputId"])
        response = self.client.post(f"/api/process-flow-instance-drafts/{draft['id']}/commit",
                                    json={"revision": 1, "processFlowInstance": payload})
        self.assertEqual(response.status_code, 201, response.text)

    def test_generator_snapshot_round_trip_and_commit_preserve_recipe(self):
        body = self.body(complete=True)
        recipe = {"kind": "generator", "generatorId": "hbm", "generatorVersion": 2,
                  "parameters": {"packageX": 1400, "packageY": 1000, "coreDieX": 800, "coreDieY": 600}}
        body["state"]["configuration"]["inputBindings"]["incoming_hbm"] = recipe
        draft = self.create(body=body)
        self.assertEqual(self.detail("instance", draft).json()["state"]["configuration"]["inputBindings"]["incoming_hbm"], recipe)
        payload = {**instance_create_payload(self.instance), "name": "Generator draft completion",
                   "inputBindings": body["state"]["configuration"]["inputBindings"]}
        before = len(self.store.list_geometries())
        response = self.client.post(f"/api/process-flow-instance-drafts/{draft['id']}/commit",
                                    json={"revision": 1, "processFlowInstance": payload})
        self.assertEqual(response.status_code, 201, response.text)
        saved = response.json()["inputBindings"]["incoming_hbm"]
        self.assertEqual(saved["kind"], "generator")
        self.assertEqual(saved["generatorVersion"], 2)
        self.assertEqual(saved["parameters"]["coreDieCount"], 4)
        self.assertEqual(len(self.store.list_geometries()), before)

    def test_missing_and_non_catalog_references_do_not_block_geometry_deletion(self):
        geometry = {**self.bootstrap["geometries"][0], "id": "not-a-catalog-reference"}
        self.assertEqual(self.client.post("/api/geometries", json=geometry).status_code, 201)
        body = self.body()
        body["state"]["configuration"]["inputBindings"] = {
            "input": {"kind": "generator", "generatorId": "not-installed", "generatorVersion": 999,
                      "parameters": {"geometryId": geometry["id"]}}
        }
        draft = self.create(body=body)
        self.assertEqual(self.client.delete(f"/api/geometries/{geometry['id']}").status_code, 204)
        self.assertEqual(self.detail("instance", draft).status_code, 200)

    def test_geometry_references_are_protected_for_both_draft_types(self):
        for kind in ("template", "instance"):
            geometry = {**self.bootstrap["geometries"][0], "id": f"draft-geometry-{kind}"}
            self.assertEqual(self.client.post("/api/geometries", json=geometry).status_code, 201)
            body = self.body(kind)
            body["state"]["configuration"]["inputBindings"] = {"input": {"kind": "catalog", "geometryId": geometry["id"]}}
            draft = self.create(kind, body)
            self.assertEqual(self.client.delete(f"/api/geometries/{geometry['id']}").status_code, 409)
            params = {"revision": 1, **({"processFlowTemplateId": self.template["id"]} if kind == "instance" else {})}
            self.assertEqual(self.client.delete(f"/api/process-flow-{kind}-drafts/{draft['id']}", params=params).status_code, 204)
            self.assertEqual(self.client.delete(f"/api/geometries/{geometry['id']}").status_code, 204)

    def test_template_delete_cascade_and_rollback(self):
        template = {**template_create_payload(self.template), "name": "Deletable"}
        created = self.client.post("/api/process-flow-templates", json=template).json()
        body = {**self.body(), "processFlowTemplateId": created["id"]}
        draft = self.create(body=body)
        with self.store._connection:
            self.store._connection.execute("CREATE TRIGGER reject_delete BEFORE DELETE ON process_flow_templates BEGIN SELECT RAISE(ABORT,'failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.delete_process_flow_template(created["id"])
        self.assertIsNotNone(self.store.get_editor_draft("instance", draft["id"]))
        with self.store._connection:
            self.store._connection.execute("DROP TRIGGER reject_delete")
        self.store.delete_process_flow_template(created["id"])
        self.assertIsNone(self.store.get_editor_draft("instance", draft["id"]))

    def test_reset_clears_drafts_and_fixture_zip_contract_is_unchanged(self):
        self.create("template")
        self.create("instance")
        archive = self.client.get("/api/fixture-export").content
        self.assertEqual(self.client.post("/api/reset-from-zip", content=archive, headers={"Content-Type": "application/zip"}).status_code, 200)
        self.assertEqual(self.store.list_editor_drafts("template"), [])
        self.assertEqual(self.store.list_editor_drafts("instance"), [])
        self.create("template")
        self.assertEqual(self.client.post("/api/reset").status_code, 200)
        self.assertEqual(self.store.list_editor_drafts("template"), [])

    def test_retired_workspace_routes_and_analytics(self):
        self.assertFalse(any("workspaces" in path for path in self.app.openapi()["paths"]))
        for method in ("get", "post", "put", "delete"):
            self.assertEqual(getattr(self.client, method)("/api/process-flow-workspaces").status_code, 404)
        draft = self.create("template")
        self.assertTrue(self.app.state.analytics.flush())
        with sqlite3.connect(self.app.state.analytics.db_path) as connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(usage_events)")}
            self.assertNotIn("workspace_id", columns)
            row = connection.execute("SELECT request_owner, properties_json FROM usage_events WHERE event_name='template_draft.create'").fetchone()
            self.assertEqual(row[0], "unknown")
            self.assertEqual(json.loads(row[1])["draft_id"], draft["id"])


class DraftMigrationTests(unittest.TestCase):
    def legacy_database(self, path, *, malformed=False):
        store = SQLiteStore(path)
        store.seed(__import__("process_flow_api.seed", fromlist=["load_seed_fixtures"]).load_seed_fixtures())
        instance = store.list_process_flow_instances()[0]
        with store._connection:
            store._connection.execute("DROP TABLE process_flow_template_drafts")
            store._connection.execute("DROP TABLE process_flow_instance_drafts")
            store._connection.execute("UPDATE schema_metadata SET value='11' WHERE key='databaseSchemaVersion'")
            store._connection.execute("CREATE TABLE process_flow_workspaces (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            for status in ("draft", "committed"):
                payload = {"id": f"old-{status}", "name": "Old progress", "status": status, "revision": 4,
                           "processFlowTemplateId": instance["processFlowTemplateId"],
                           "createdAt": "2026-01-01", "updatedAt": "2026-02-01",
                           "inputBindings": instance["inputBindings"], "stepConfigurations": instance["stepConfigurations"],
                           "embeddedGeometries": {}}
                if malformed and status == "draft": payload["revision"] = 0
                store._connection.execute("INSERT INTO process_flow_workspaces VALUES (?,?)", (payload["id"], json.dumps(payload)))
        store.close()
        return instance

    def test_v11_converts_drafts_removes_committed_and_preserves_products(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "legacy.sqlite3"
            instance = self.legacy_database(path)
            store = SQLiteStore(path)
            try:
                draft = store.get_editor_draft("instance", "old-draft")
                self.assertEqual(draft["user"], "legacy.import")
                self.assertEqual(draft["revision"], 4)
                self.assertEqual(draft["createdAt"], "2026-01-01")
                self.assertEqual(draft["state"]["configuration"]["inputBindings"], instance["inputBindings"])
                self.assertEqual(draft["state"]["metadata"], METADATA)
                self.assertIsNone(store.get_editor_draft("instance", "old-committed"))
                self.assertEqual(store.get_process_flow_instance(instance["id"]), instance)
                self.assertFalse(store._table_exists("process_flow_workspaces"))
            finally: store.close()

    def test_failed_business_migration_preserves_old_table_and_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "legacy.sqlite3"
            self.legacy_database(path, malformed=True)
            with self.assertRaises(ValueError): SQLiteStore(path)
            with sqlite3.connect(path) as connection:
                self.assertEqual(connection.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], "11")
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM process_flow_workspaces").fetchone()[0], 2)
                self.assertIsNone(connection.execute("SELECT name FROM sqlite_master WHERE name='process_flow_instance_drafts'").fetchone())

    def test_analytics_migration_preserves_history_and_rolls_back_on_failure(self):
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "analytics.sqlite3"
                connection = sqlite3.connect(path)
                connection.executescript(SCHEMA.replace("flow_instance_id TEXT, source_kind", "flow_instance_id TEXT, workspace_id TEXT, source_kind"))
                connection.execute("INSERT INTO analytics_metadata VALUES ('schema_version','1')")
                recorder = AnalyticsRecorder(path)
                record = {**recorder.common("dataset"), "event_id": "event", "operation_id": "operation",
                          "event_name": "workspace.create", "phase": "finished", "outcome": "success",
                          "source_kind": "workspace", "workspace_id": "legacy-id", "properties_json": '{"kept":true}'}
                columns = [*EVENT_COLUMNS.split(","), "workspace_id"]
                connection.execute(f"INSERT INTO usage_events ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", [record.get(key) for key in columns])
                connection.commit(); connection.close()
                if fail:
                    with mock.patch("process_flow_api.analytics.json.loads", side_effect=ValueError("conversion failure")):
                        with self.assertRaises(ValueError): recorder._connect()
                else:
                    migrated = recorder._connect(); migrated.close()
                with sqlite3.connect(path) as connection:
                    marker = connection.execute("SELECT value FROM analytics_metadata WHERE key='schema_version'").fetchone()[0]
                    self.assertEqual(marker, "1" if fail else "2")
                    self.assertEqual(connection.execute("SELECT COUNT(*) FROM usage_events").fetchone()[0], 1)
                    if not fail:
                        properties = json.loads(connection.execute("SELECT properties_json FROM usage_events").fetchone()[0])
                        self.assertEqual(properties, {"kept": True, "legacy_workspace_id": "legacy-id"})
                        self.assertNotIn("workspace_id", {row[1] for row in connection.execute("PRAGMA table_info(usage_events)")})
