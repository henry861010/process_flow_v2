from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from process_flow_api.repository import DATABASE_SCHEMA_VERSION, SQLiteStore


class RepositoryMigrationTests(unittest.TestCase):
    def test_v7_to_v8_clears_resources_with_retired_fixture_ids(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            db_path = Path(tmp_name) / "v7.sqlite3"
            connection = sqlite3.connect(db_path)
            connection.executescript(
                """
                CREATE TABLE schema_metadata (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                );
                CREATE TABLE geometries (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  category TEXT,
                  entity_type TEXT NOT NULL,
                  version TEXT,
                  owner TEXT,
                  payload TEXT NOT NULL
                );
                CREATE TABLE process_flow_workspaces (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  process_flow_template_id TEXT NOT NULL,
                  revision INTEGER NOT NULL,
                  status TEXT NOT NULL,
                  committed_instance_id TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  payload TEXT NOT NULL
                );
                INSERT INTO schema_metadata(key, value)
                VALUES ('databaseSchemaVersion', '7');
                """
            )
            for item in (
                geometry("hbm-existing", "die.hbm"),
                geometry("soc-existing", "die.soc"),
            ):
                connection.execute(
                    "INSERT INTO geometries VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        item["id"],
                        item["name"],
                        item["category"],
                        item["entityType"],
                        None,
                        None,
                        json.dumps(item),
                    ),
                )
            workspace = workspace_payload()
            connection.execute(
                "INSERT INTO process_flow_workspaces VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    workspace["id"],
                    workspace["name"],
                    workspace["processFlowTemplateId"],
                    workspace["revision"],
                    workspace["status"],
                    None,
                    workspace["createdAt"],
                    workspace["updatedAt"],
                    json.dumps(workspace),
                ),
            )
            connection.commit()
            connection.close()

            store = SQLiteStore(db_path)
            try:
                version = store._connection.execute(
                    "SELECT value FROM schema_metadata "
                    "WHERE key = 'databaseSchemaVersion'"
                ).fetchone()["value"]
                self.assertEqual(version, DATABASE_SCHEMA_VERSION)
                self.assertEqual(store.list_geometries(), [])
                self.assertIsNone(store.get_process_flow_workspace("workspace-existing"))
            finally:
                store.close()

    def test_v8_to_v9_backfills_instance_metadata_without_changing_configuration(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            db_path = Path(tmp_name) / "v8.sqlite3"
            store = SQLiteStore(db_path)
            store.close()

            template = {
                "schemaVersion": 2,
                "id": "flow-template",
                "name": "Flow template",
                "version": "V0.0.0",
                "owner": "template.owner",
                "description": "",
                "flowInputs": [],
                "stepRefs": [],
                "flowEdges": [],
            }
            referenced = legacy_instance("instance-referenced", "flow-template")
            orphan = legacy_instance("instance-orphan", "missing-template")
            connection = sqlite3.connect(db_path)
            connection.execute(
                "UPDATE schema_metadata SET value = '8' WHERE key = 'databaseSchemaVersion'"
            )
            connection.execute(
                "INSERT INTO process_flow_templates VALUES (?, ?, ?, ?, ?)",
                (
                    template["id"],
                    template["name"],
                    template["version"],
                    template["owner"],
                    json.dumps(template),
                ),
            )
            for instance in (referenced, orphan):
                connection.execute(
                    "INSERT INTO process_flow_instances VALUES (?, ?, ?, ?)",
                    (
                        instance["id"],
                        instance["name"],
                        instance["processFlowTemplateId"],
                        json.dumps(instance),
                    ),
                )
            connection.commit()
            connection.close()

            migrated_store = SQLiteStore(db_path)
            try:
                migrated = migrated_store.get_process_flow_instance("instance-referenced")
                self.assertEqual(migrated["version"], "V0.0.0")
                self.assertEqual(migrated["owner"], "template.owner")
                self.assertEqual(migrated["description"], "")
                self.assertEqual(migrated["inputBindings"], referenced["inputBindings"])
                self.assertEqual(
                    migrated["stepConfigurations"],
                    referenced["stepConfigurations"],
                )
                self.assertEqual(
                    migrated_store.get_process_flow_instance("instance-orphan")["owner"],
                    "legacy.import",
                )
            finally:
                migrated_store.close()

    def test_future_schema_version_is_rejected_without_deleting_rows(self):
        with tempfile.TemporaryDirectory() as tmp_name:
            db_path = Path(tmp_name) / "future.sqlite3"
            connection = sqlite3.connect(db_path)
            connection.executescript(
                """
                CREATE TABLE schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO schema_metadata(key, value)
                VALUES ('databaseSchemaVersion', '999');
                """
            )
            connection.commit()
            connection.close()

            with self.assertRaisesRegex(RuntimeError, "Unsupported database schema migration"):
                SQLiteStore(db_path)


def geometry(id_: str, category: str):
    return {"id": id_, **embedded_geometry(id_, category)}


def embedded_geometry(name: str, category: str):
    return {
        "name": name,
        "entityType": "die",
        "category": category,
        "structure": {
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
        },
    }


def workspace_payload():
    return {
        "id": "workspace-existing",
        "name": "Existing workspace",
        "processFlowTemplateId": "flow-existing",
        "revision": 1,
        "status": "draft",
        "createdAt": "2026-01-01T00:00:00+00:00",
        "updatedAt": "2026-01-01T00:00:00+00:00",
        "inputBindings": {},
        "stepConfigurations": {},
        "embeddedGeometries": {
            "vrm-local": embedded_geometry("VRM local", "die.vrm")
        },
    }


def legacy_instance(id_: str, template_id: str):
    return {
        "schemaVersion": 2,
        "id": id_,
        "name": id_,
        "processFlowTemplateId": template_id,
        "inputBindings": {"incoming": {"kind": "catalog", "geometryId": "geometry"}},
        "stepConfigurations": {"step": {"parameterValues": {"thickness": 10}}},
    }


if __name__ == "__main__":
    unittest.main()
