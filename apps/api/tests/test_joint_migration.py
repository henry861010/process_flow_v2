from __future__ import annotations

import copy
import json
import sqlite3
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from process_flow_api.fixture_export import build_fixture_archive, load_fixture_archive
from process_flow_api.joint_migration import LEGACY_JOINT_ID, MR_JOINT_ID, TCB_JOINT_ID
from process_flow_api.main import create_app
from process_flow_api.repository import DATABASE_SCHEMA_VERSION, SQLiteStore
from process_flow_api.seed import load_seed_fixtures


def legacy_fixtures():
    fixtures = load_seed_fixtures()
    fixtures["processStepTemplates"] = [
        step for step in fixtures["processStepTemplates"] if step["id"] != TCB_JOINT_ID
    ]
    old = next(step for step in fixtures["processStepTemplates"] if step["id"] == MR_JOINT_ID)
    old.update(id=LEGACY_JOINT_ID, name="Bump Joint", category="bump", program="bump/bump_joint")
    old["owner"] = "custom.owner"
    old["parameterDefinitions"][0]["defaultValue"] = 37
    flow = next(flow for flow in fixtures["processFlowTemplates"] if flow["id"] == "flow_tpl_dual_bump_demo")
    joint = next(ref for ref in flow["stepRefs"] if ref["stepRefId"] == "joint")
    joint.update(processStepTemplateId=LEGACY_JOINT_ID, stepLabel="Bump Joint")
    return fixtures


def legacy_draft(flow, instance):
    nodes = [
        {"id": ref["stepRefId"], "kind": "processStep", "position": {"x": index * 100, "y": 20},
         "stepRef": copy.deepcopy(ref)}
        for index, ref in enumerate(flow["stepRefs"])
    ]
    custom = copy.deepcopy(nodes[-1])
    custom["id"] = custom["stepRef"]["stepRefId"] = "custom_joint"
    custom["stepRef"]["stepLabel"] = "Keep my label"
    nodes.append(custom)
    return {
        "schemaVersion": 1, "id": "legacy-draft", "user": "user", "name": "Joint draft",
        "revision": 4, "createdAt": "2026-01-01", "updatedAt": "2026-02-01",
        "state": {
            "metadata": {"name": "Draft", "version": "V0.0.0", "owner": "user", "description": ""},
            "configuration": {key: copy.deepcopy(instance.get(key, {})) for key in
                              ("inputBindings", "stepConfigurations", "embeddedGeometries")},
            "nodes": nodes, "edges": [], "viewport": {"x": 10, "y": 20, "zoom": 1.5},
        },
    }


class JointMigrationTests(unittest.TestCase):
    def build_v12(self, path, *, conflict=None, disabled=False):
        fixtures = legacy_fixtures()
        old = next(step for step in fixtures["processStepTemplates"] if step["id"] == LEGACY_JOINT_ID)
        if disabled:
            old["status"] = "disabled"
        if conflict:
            occupied = copy.deepcopy(next(step for step in load_seed_fixtures()["processStepTemplates"] if step["id"] == conflict))
            occupied["program"] = "layer/molding"
            fixtures["processStepTemplates"].append(occupied)
        store = SQLiteStore(path)
        try:
            store.seed(fixtures)
            flow = store.get_process_flow_template("flow_tpl_dual_bump_demo")
            instance = store.get_process_flow_instance("flow_inst_dual_bump_demo")
            draft = legacy_draft(flow, instance)
            store.insert_editor_draft("template", draft)
            instance_draft = {
                **draft, "id": "legacy-instance-draft", "processFlowTemplateId": flow["id"],
                "state": {key: draft["state"][key] for key in ("metadata", "configuration")},
            }
            store.insert_editor_draft("instance", instance_draft)
            with store._connection:
                store._connection.execute("UPDATE schema_metadata SET value='12' WHERE key='databaseSchemaVersion'")
            return fixtures, draft, instance_draft, store.dataset_id
        finally:
            store.close()

    def test_v12_migration_preserves_settings_refs_drafts_and_instance(self):
        for disabled in (False, True):
            with self.subTest(disabled=disabled), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "legacy.sqlite3"
                fixtures, draft, instance_draft, dataset_id = self.build_v12(path, disabled=disabled)
                store = SQLiteStore(path)
                try:
                    old = next(step for step in fixtures["processStepTemplates"] if step["id"] == LEGACY_JOINT_ID)
                    expected = {**old, "id": MR_JOINT_ID, "name": "MR joint", "category": "joint", "program": "joint/mr_joint"}
                    self.assertEqual(store.get_process_step_template(MR_JOINT_ID), expected)
                    canonical_tcb = next(step for step in load_seed_fixtures()["processStepTemplates"] if step["id"] == TCB_JOINT_ID)
                    self.assertEqual(store.get_process_step_template(TCB_JOINT_ID), canonical_tcb)
                    self.assertIsNone(store.get_process_step_template(LEGACY_JOINT_ID))
                    self.assertEqual(store.dataset_id, dataset_id)
                    self.assertEqual(store._connection.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], DATABASE_SCHEMA_VERSION)
                    for flow in fixtures["processFlowTemplates"]:
                        expected = copy.deepcopy(flow)
                        for ref in expected["stepRefs"]:
                            if ref["processStepTemplateId"] == LEGACY_JOINT_ID:
                                ref.update(processStepTemplateId=MR_JOINT_ID, stepLabel="MR joint")
                        self.assertEqual(store.get_process_flow_template(flow["id"]), expected)
                    for node in draft["state"]["nodes"]:
                        if node["stepRef"]["processStepTemplateId"] == LEGACY_JOINT_ID:
                            node["stepRef"]["processStepTemplateId"] = MR_JOINT_ID
                            if node["stepRef"]["stepLabel"] == "Bump Joint":
                                node["stepRef"]["stepLabel"] = "MR joint"
                    self.assertEqual(store.get_editor_draft("template", draft["id"]), draft)
                    self.assertEqual(store.get_editor_draft("instance", instance_draft["id"]), instance_draft)
                    self.assertEqual(store.list_process_flow_instances(), sorted(fixtures["processFlowInstances"], key=lambda item: (item["name"], item["id"])))
                    before = store.list_process_step_templates()
                finally:
                    store.close()
                reopened = SQLiteStore(path)
                try:
                    self.assertEqual(reopened.list_process_step_templates(), before)
                    self.assertEqual(reopened.get_editor_draft("template", draft["id"]), draft)
                finally:
                    reopened.close()

    def test_migrated_database_executes_and_restores_template_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.sqlite3"
            self.build_v12(path)
            app = create_app(db_path=path)
            try:
                with TestClient(app) as client:
                    response = client.post("/api/process-flow-instances/flow_inst_dual_bump_demo/execute")
                    self.assertEqual(response.status_code, 200, response.text)
                    root = response.json()["geometryStructure"]["root"]
                    self.assertEqual([child["bumps"][0]["stage"] for child in root["children"]], ["joined", "joined"])
                    restored = client.get("/api/process-flow-template-drafts/legacy-draft")
                    self.assertEqual(restored.status_code, 200, restored.text)
                    known_ids = {step["id"] for step in client.get("/api/bootstrap").json()["processStepTemplates"]}
                    self.assertTrue(all(node["stepRef"]["processStepTemplateId"] in known_ids for node in restored.json()["state"]["nodes"]))
            finally:
                app.state.store.close()

    def test_compatible_replacement_ids_are_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.sqlite3"
            fixtures, _, _, _ = self.build_v12(path)
            old = next(step for step in fixtures["processStepTemplates"] if step["id"] == LEGACY_JOINT_ID)
            mr = {**old, "id": MR_JOINT_ID, "name": "MR joint", "category": "joint", "program": "joint/mr_joint"}
            tcb = next(step for step in load_seed_fixtures()["processStepTemplates"] if step["id"] == TCB_JOINT_ID)
            # Populate the two IDs without running the pending migration first.
            with sqlite3.connect(path) as connection:
                for step in (mr, tcb):
                    connection.execute("INSERT INTO process_step_templates VALUES (?,?,?,?,?,?)",
                                       (step["id"], step["name"], step["category"], step["version"], step["owner"], json.dumps(step)))
            store = SQLiteStore(path)
            try:
                self.assertEqual(store.get_process_step_template(MR_JOINT_ID), mr)
                self.assertEqual(store.get_process_step_template(TCB_JOINT_ID), tcb)
                self.assertIsNone(store.get_process_step_template(LEGACY_JOINT_ID))
                self.assertEqual(store.count("process_step_templates"), len(fixtures["processStepTemplates"]) + 1)
            finally:
                store.close()

    def test_migration_conflicts_and_late_failures_roll_back(self):
        for failure in (MR_JOINT_ID, TCB_JOINT_ID, "late"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "legacy.sqlite3"
                fixtures, draft, _, dataset_id = self.build_v12(path, conflict=None if failure == "late" else failure)
                if failure == "late":
                    patch = mock.patch("process_flow_api.joint_migration.migrate_joint_flow", side_effect=ValueError("late failure"))
                else:
                    patch = nullcontext()
                with patch, self.assertRaisesRegex(ValueError, "conflict|late failure"):
                    SQLiteStore(path)
                with sqlite3.connect(path) as connection:
                    self.assertEqual(connection.execute("SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'").fetchone()[0], "12")
                    self.assertEqual(connection.execute("SELECT value FROM schema_metadata WHERE key='analyticsDatasetId'").fetchone()[0], dataset_id)
                    steps = [json.loads(row[0]) for row in connection.execute("SELECT payload FROM process_step_templates")]
                    self.assertEqual({step["id"]: step for step in steps}, {step["id"]: step for step in fixtures["processStepTemplates"]})
                    flows = [json.loads(row[0]) for row in connection.execute("SELECT payload FROM process_flow_templates")]
                    self.assertEqual({flow["id"]: flow for flow in flows}, {flow["id"]: flow for flow in fixtures["processFlowTemplates"]})
                    self.assertEqual(json.loads(connection.execute("SELECT payload FROM process_flow_template_drafts WHERE id=?", (draft["id"],)).fetchone()[0]), draft)

    def test_legacy_zip_import_converts_and_executes_without_mutating_source(self):
        fixtures = legacy_fixtures()
        before = copy.deepcopy(fixtures)
        content = build_fixture_archive(fixtures)
        migrated = load_fixture_archive(content)
        self.assertEqual(fixtures, before)
        self.assertEqual({step["id"] for step in migrated["processStepTemplates"] if step["category"] == "joint"}, {MR_JOINT_ID, TCB_JOINT_ID})
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(db_path=Path(directory) / "import.sqlite3")
            try:
                with TestClient(app) as client:
                    response = client.post("/api/reset-from-zip", content=content, headers={"Content-Type": "application/zip"})
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertNotIn(LEGACY_JOINT_ID, {step["id"] for step in response.json()["processStepTemplates"]})
                    response = client.post("/api/process-flow-instances/flow_inst_dual_bump_demo/execute")
                    self.assertEqual(response.status_code, 200, response.text)
                    exported = load_fixture_archive(client.get("/api/fixture-export").content)
                    for key in migrated:
                        self.assertEqual({item["id"]: item for item in exported[key]}, {item["id"]: item for item in migrated[key]})
            finally:
                app.state.store.close()

    def test_zip_collision_rejects_without_resetting_database(self):
        fixtures = legacy_fixtures()
        conflict = copy.deepcopy(next(step for step in load_seed_fixtures()["processStepTemplates"] if step["id"] == MR_JOINT_ID))
        conflict["program"] = "layer/molding"
        fixtures["processStepTemplates"].append(conflict)
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(db_path=Path(directory) / "import.sqlite3")
            try:
                with TestClient(app) as client:
                    before = client.get("/api/bootstrap").json()
                    response = client.post("/api/reset-from-zip", content=build_fixture_archive(fixtures), headers={"Content-Type": "application/zip"})
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertIn("Joint migration conflict", response.text)
                    self.assertEqual(client.get("/api/bootstrap").json(), before)
            finally:
                app.state.store.close()

    def test_empty_v12_database_still_seeds_all_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "empty.sqlite3"
            store = SQLiteStore(path)
            with store._connection:
                store._connection.execute("UPDATE schema_metadata SET value='12' WHERE key='databaseSchemaVersion'")
            store.close()
            app = create_app(db_path=path)
            try:
                with TestClient(app):
                    for table in ("process_step_templates", "process_flow_templates", "process_flow_instances", "geometries"):
                        self.assertGreater(app.state.store.count(table), 0)
            finally:
                app.state.store.close()


if __name__ == "__main__":
    unittest.main()
