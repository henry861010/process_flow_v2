from __future__ import annotations

import json
import sqlite3
import uuid
import copy
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import ProcessStepTemplate
from .step_template_transfer import locked_process_step_template
from .instance_data import restore_missing_active_recipes, upgrade_legacy_instance

JsonObject = dict[str, Any]
DATABASE_SCHEMA_VERSION = "15"


class DuplicateItemError(ValueError):
    pass


class NotFoundError(KeyError):
    pass


class ResourceConflictError(ValueError):
    pass


class DraftConflictError(ResourceConflictError):
    pass


class SQLiteStore:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        if self.db_path != Path(":memory:"):
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        try:
            self.initialize()
        except Exception:
            self._connection.close()
            raise

    def close(self) -> None:
        self._connection.close()

    def initialize(self) -> None:
        self._connection.executescript(
            """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS schema_metadata (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS process_step_templates (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              category TEXT NOT NULL,
              version TEXT NOT NULL,
              owner TEXT NOT NULL,
              payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_process_step_templates_category
              ON process_step_templates(category);

            CREATE TABLE IF NOT EXISTS process_flow_templates (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              version TEXT NOT NULL,
              owner TEXT NOT NULL,
              payload TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS process_flow_instances (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              process_flow_template_id TEXT NOT NULL,
              payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_process_flow_instances_template
              ON process_flow_instances(process_flow_template_id);

            CREATE TABLE IF NOT EXISTS geometries (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              category TEXT,
              entity_type TEXT NOT NULL,
              dim TEXT NOT NULL,
              vendor TEXT,
              type1 TEXT,
              type2 TEXT,
              owner TEXT,
              payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_geometries_category ON geometries(category);
            CREATE INDEX IF NOT EXISTS idx_geometries_entity_type ON geometries(entity_type);
            """
        )
        self._ensure_schema_version()
        self._connection.execute(
            "INSERT OR IGNORE INTO schema_metadata(key,value) VALUES ('analyticsDatasetId', ?)",
            (str(uuid.uuid4()),),
        )
        self._connection.commit()
        self.dataset_id = self._connection.execute(
            "SELECT value FROM schema_metadata WHERE key='analyticsDatasetId'"
        ).fetchone()["value"]

    def _ensure_schema_version(self) -> None:
        row = self._connection.execute(
            "SELECT value FROM schema_metadata WHERE key = 'databaseSchemaVersion'"
        ).fetchone()
        if row is not None and row["value"] == DATABASE_SCHEMA_VERSION:
            return
        if row is not None and (
            not row["value"].isdigit()
            or int(row["value"]) > int(DATABASE_SCHEMA_VERSION)
        ):
            raise RuntimeError(
                "Unsupported database schema migration: "
                f"{row['value']} -> {DATABASE_SCHEMA_VERSION}"
            )
        with self._connection:
            # Explicitly include DDL in the transaction and prevent writes
            # between checking existing identities and installing the indexes.
            self._connection.execute("BEGIN IMMEDIATE")
            current_version = int(row["value"]) if row is not None else None
            if current_version == 8:
                self._migrate_v8_to_v9()
                current_version = 9
            if current_version == 9:
                self._migrate_v9_to_v10()
                current_version = 10
            if current_version == 10:
                self._migrate_v10_to_v11()
                current_version = 11
            if current_version == 11:
                self._migrate_v11_to_v12()
                current_version = 12
            if current_version in (12, 13):
                self._migrate_v13_to_v14()
                current_version = 14
            if current_version == 14:
                self._migrate_v14_to_v15()
                self._set_schema_version()
                return
            # Older local data is rebuilt from fixtures so no stale references to
            # retired identifiers remain. Rebuild the geometry table before seeding.
            for table in (*RESOURCE_TABLES, "process_flow_workspaces"):
                if self._table_exists(table):
                    self._connection.execute(f"DELETE FROM {table}")
            self._connection.execute(
                "INSERT INTO schema_metadata(key,value) VALUES ('analyticsDatasetId', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (str(uuid.uuid4()),),
            )
            if current_version is not None:
                self._migrate_v9_to_v10()
            self._migrate_v10_to_v11()
            self._migrate_v11_to_v12()
            self._migrate_v13_to_v14()
            self._migrate_v14_to_v15()
            self._set_schema_version()

    def _migrate_v14_to_v15(self) -> None:
        from .models import InstanceStepConfiguration
        for row in self._connection.execute("SELECT id,payload FROM process_flow_instances").fetchall():
            payload = json.loads(row["payload"])
            updated = restore_missing_active_recipes(payload)
            for station in updated.get("stepConfigurations", {}).values():
                InstanceStepConfiguration.model_validate(station)
            if updated != payload:
                self._connection.execute("UPDATE process_flow_instances SET payload=? WHERE id=?",
                                         (_json(updated), row["id"]))

    def _migrate_v13_to_v14(self) -> None:
        for row in self._connection.execute("SELECT id,payload FROM process_flow_instances").fetchall():
            payload = json.loads(row["payload"])
            template = self.get_process_flow_template(payload.get("processFlowTemplateId", ""))
            payload = upgrade_legacy_instance(payload, template)
            self._connection.execute("UPDATE process_flow_instances SET payload=? WHERE id=?",
                                     (_json(payload), row["id"]))
        self._connection.execute("DROP TABLE IF EXISTS process_flow_instance_drafts")

    def _table_exists(self, table: str) -> bool:
        return self._connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,),
        ).fetchone() is not None

    def _migrate_v11_to_v12(self) -> None:
        for kind in ("template",):
            table = _draft_table(kind)
            parent = "process_flow_template_id TEXT NOT NULL," if kind == "instance" else ""
            self._connection.execute(f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    id TEXT PRIMARY KEY, user TEXT NOT NULL, name TEXT NOT NULL,
                    {parent} revision INTEGER NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL
                )
            """)
            self._connection.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_updated ON {table}(updated_at DESC)")
            self._connection.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_user ON {table}(user)")
            if kind == "instance":
                self._connection.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_template ON {table}(process_flow_template_id)")
        if self._table_exists("process_flow_workspaces"):
            self._connection.execute("DROP TABLE process_flow_workspaces")

    def _set_schema_version(self) -> None:
        self._connection.execute(
            """
            INSERT INTO schema_metadata(key, value)
            VALUES ('databaseSchemaVersion', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (DATABASE_SCHEMA_VERSION,),
        )

    def _migrate_v8_to_v9(self) -> None:
        template_owners: dict[str, str] = {}
        for row in self._connection.execute(
            "SELECT id, payload FROM process_flow_templates"
        ).fetchall():
            payload = json.loads(row["payload"])
            owner = payload.get("owner")
            if isinstance(owner, str) and owner.strip():
                template_owners[row["id"]] = owner

        for row in self._connection.execute(
            "SELECT id, payload FROM process_flow_instances"
        ).fetchall():
            payload = json.loads(row["payload"])
            template_id = payload.get("processFlowTemplateId")
            payload["version"] = "V0.0.0"
            payload["owner"] = template_owners.get(template_id) or "legacy.import"
            payload["description"] = ""
            self._connection.execute(
                "UPDATE process_flow_instances SET payload = ? WHERE id = ?",
                (_json(payload), row["id"]),
            )

    def _migrate_v10_to_v11(self) -> None:
        # Instances keep version in their JSON payload. Index the same value
        # used by the API so every write path enforces the identity atomically.
        identities = (
            ("process_flow_templates", "version"),
            ("process_flow_instances", "COALESCE(json_extract(payload, '$.version'), '')"),
        )
        conflicts = []
        for table, version_expression in identities:
            rows = self._connection.execute(
                f"SELECT name, {version_expression} AS version, GROUP_CONCAT(id) AS ids "
                f"FROM {table} GROUP BY name, {version_expression} HAVING COUNT(*) > 1"
            ).fetchall()
            conflicts.extend(
                f"{table}: name={row['name']!r}, version={row['version']!r}, ids={row['ids']}"
                for row in rows
            )
        if conflicts:
            raise RuntimeError(
                "Cannot enforce unique flow names and versions; resolve existing duplicates "
                "before restarting: " + "; ".join(conflicts)
            )
        for table, version_expression in identities:
            self._connection.execute(
                f"CREATE UNIQUE INDEX IF NOT EXISTS idx_{table}_name_version "
                f"ON {table}(name, {version_expression})"
            )

    def _migrate_v9_to_v10(self) -> None:
        self._connection.execute(
            """
            CREATE TABLE geometries_v10 (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              category TEXT,
              entity_type TEXT NOT NULL,
              dim TEXT NOT NULL,
              vendor TEXT,
              type1 TEXT,
              type2 TEXT,
              owner TEXT,
              payload TEXT NOT NULL
            )
            """
        )
        rows = self._connection.execute("SELECT payload FROM geometries").fetchall()
        for row in rows:
            payload = json.loads(row["payload"])
            payload.pop("version", None)
            if not isinstance(payload.get("dim"), str):
                payload["dim"] = _legacy_geometry_dim(payload.get("description"))
            values = _geometry_values(payload)
            columns = list(values)
            self._connection.execute(
                f"INSERT INTO geometries_v10 ({', '.join(columns)}) "
                f"VALUES ({', '.join('?' for _ in columns)})",
                [values[column] for column in columns],
            )
        self._connection.execute("DROP TABLE geometries")
        self._connection.execute("ALTER TABLE geometries_v10 RENAME TO geometries")
        self._connection.execute(
            "CREATE INDEX idx_geometries_category ON geometries(category)"
        )
        self._connection.execute(
            "CREATE INDEX idx_geometries_entity_type ON geometries(entity_type)"
        )

    def reset(self) -> None:
        with self._connection:
            for table in TABLES:
                self._connection.execute(f"DELETE FROM {table}")

    def is_empty(self) -> bool:
        return all(self.count(table) == 0 for table in TABLES)

    def count(self, table: str) -> int:
        row = self._connection.execute(f"SELECT COUNT(*) AS count FROM {table}").fetchone()
        return int(row["count"])

    def insert_process_step_template(self, payload: JsonObject) -> JsonObject:
        return self._insert(
            "process_step_templates",
            {
                "id": payload["id"],
                "name": payload.get("name", ""),
                "category": payload.get("category", ""),
                "version": payload.get("version", ""),
                "owner": payload.get("owner", ""),
                "payload": _json(payload),
            },
        )

    def list_process_step_templates(self, *, search: str | None = None, category: str | None = None) -> list[JsonObject]:
        clauses = []
        params: list[Any] = []
        if search:
            clauses.append("LOWER(name) LIKE ?")
            params.append(f"%{search.lower()}%")
        if category:
            clauses.append("(category = ? OR category LIKE ?)")
            params.extend([category, f"{category}.%"])
        return self._list("process_step_templates", clauses, params, "category ASC, name ASC, id ASC")

    def get_process_step_template(self, id_: str) -> JsonObject | None:
        return self._get("process_step_templates", id_)

    def import_process_step_templates(self, templates: list[JsonObject]) -> JsonObject:
        """Merge validated templates, protecting references in the same write transaction."""
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            current = {item["id"]: item for item in self.list_process_step_templates()}
            structural_changes = {
                item["id"] for item in templates
                if item["id"] in current and
                locked_process_step_template(
                    ProcessStepTemplate.model_validate(current[item["id"]]).payload(), allow_description=True,
                ) != locked_process_step_template(
                    ProcessStepTemplate.model_validate(item).payload(), allow_description=True,
                )
            }
            if structural_changes:
                for flow in self.list_process_flow_templates():
                    self._check_import_step_references(
                        flow.get("stepRefs", []), structural_changes, f"flow template {flow['id']}",
                    )
                # Draft summaries omit state; inspect full records, including every user's drafts.
                for draft in self._list("process_flow_template_drafts", [], [], "id ASC"):
                    self._check_import_step_references(
                        [node["stepRef"] for node in draft["state"]["nodes"] if node["kind"] == "processStep"],
                        structural_changes, f"template draft {draft['id']}",
                    )
            updated = sum(item["id"] in current for item in templates)
            for item in templates:
                self._upsert_process_step_template_in_transaction(item)
            result = {
                "processStepTemplates": self.list_process_step_templates(),
                "createdCount": len(templates) - updated,
                "updatedCount": updated,
            }
        return result

    @staticmethod
    def _check_import_step_references(step_refs, structural_changes: set[str], resource: str) -> None:
        for step_ref in step_refs:
            template_id = step_ref.get("processStepTemplateId")
            if template_id in structural_changes:
                raise ResourceConflictError(
                    f"Cannot change the structure of process step template {template_id}: referenced by {resource}. "
                    "Only status, owner, category, program, description, inputPorts order, "
                    "and parameter defaultValue fields can be imported for referenced steps."
                )

    def _upsert_process_step_template_in_transaction(self, payload: JsonObject) -> None:
        self._connection.execute(
            """
            INSERT INTO process_step_templates (id, name, category, version, owner, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, category=excluded.category, version=excluded.version,
                owner=excluded.owner, payload=excluded.payload
            """,
            (payload["id"], payload["name"], payload["category"], payload["version"], payload["owner"], _json(payload)),
        )

    def update_process_step_template(self, payload: JsonObject) -> JsonObject:
        values = {
            "name": payload.get("name", ""),
            "category": payload.get("category", ""),
            "version": payload.get("version", ""),
            "owner": payload.get("owner", ""),
            "payload": _json(payload),
            "id": payload["id"],
        }
        with self._connection:
            cursor = self._connection.execute(
                """
                UPDATE process_step_templates
                SET name = ?, category = ?, version = ?, owner = ?, payload = ?
                WHERE id = ?
                """,
                (
                    values["name"],
                    values["category"],
                    values["version"],
                    values["owner"],
                    values["payload"],
                    values["id"],
                ),
            )
        if cursor.rowcount == 0:
            raise NotFoundError(payload["id"])
        return payload

    def insert_geometry(self, payload: JsonObject) -> JsonObject:
        return self._insert("geometries", _geometry_values(payload))

    def list_geometries(
        self,
        *,
        search: str | None = None,
        category: str | None = None,
        entity_type: str | None = None,
    ) -> list[JsonObject]:
        clauses = []
        params: list[Any] = []
        if search:
            clauses.append("(LOWER(name) LIKE ? OR LOWER(payload) LIKE ?)")
            params.extend([f"%{search.lower()}%", f"%{search.lower()}%"])
        if category:
            clauses.append("(category = ? OR category LIKE ?)")
            params.extend([category, f"{category}.%"])
        if entity_type:
            clauses.append("entity_type = ?")
            params.append(entity_type)
        return self._list("geometries", clauses, params, "category ASC, name ASC, id ASC")

    def get_geometry(self, id_: str) -> JsonObject | None:
        return self._get("geometries", id_)

    def delete_geometry(self, id_: str) -> None:
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            if self.get_geometry(id_) is None:
                raise NotFoundError(id_)
            for table, label in (
                ("process_flow_instances", "instance"),
                ("process_flow_template_drafts", "template draft"),
            ):
                for row in self._connection.execute(f"SELECT id, payload FROM {table}"):
                    payload = json.loads(row["payload"])
                    configuration = payload.get("state", {}).get("configuration", payload)
                    bindings = configuration.get("inputBindings", {})
                    if any(binding.get("kind") == "catalog" and binding.get("geometryId") == id_
                           for binding in bindings.values()):
                        raise ResourceConflictError(
                            f"Geometry {id_} is referenced by {label} {row['id']}"
                        )
            self._delete_in_transaction("geometries", id_)

    def insert_process_flow_template(self, payload: JsonObject) -> JsonObject:
        return self._insert(
            "process_flow_templates",
            {
                "id": payload["id"],
                "name": payload.get("name", ""),
                "version": payload.get("version", ""),
                "owner": payload.get("owner", ""),
                "payload": _json(payload),
            },
        )

    def list_process_flow_templates(self) -> list[JsonObject]:
        return self._list("process_flow_templates", [], [], "name ASC, version ASC, id ASC")

    def get_process_flow_template(self, id_: str) -> JsonObject | None:
        return self._get("process_flow_templates", id_)

    def delete_process_flow_template(self, id_: str) -> None:
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            if self.get_process_flow_template(id_) is None:
                raise NotFoundError(id_)
            instance = self._connection.execute(
                "SELECT id FROM process_flow_instances WHERE process_flow_template_id = ? LIMIT 1",
                (id_,),
            ).fetchone()
            if instance is not None:
                raise ResourceConflictError(
                    f"Process flow template {id_} is referenced by instance {instance['id']}"
                )
            self._delete_in_transaction("process_flow_templates", id_)

    def update_process_flow_template(self, payload: JsonObject) -> JsonObject:
        try:
            with self._connection:
                cursor = self._connection.execute(
                    """
                    UPDATE process_flow_templates
                    SET name = ?, version = ?, owner = ?, payload = ?
                    WHERE id = ?
                    """,
                    (
                        payload.get("name", ""),
                        payload.get("version", ""),
                        payload.get("owner", ""),
                        _json(payload),
                        payload["id"],
                    ),
                )
        except sqlite3.IntegrityError as error:
            raise _duplicate_item_error(error) from error
        if cursor.rowcount == 0:
            raise NotFoundError(payload["id"])
        return payload

    def insert_process_flow_instance(self, payload: JsonObject) -> JsonObject:
        return self._insert(
            "process_flow_instances",
            {
                "id": payload["id"],
                "name": payload.get("name", ""),
                "process_flow_template_id": payload.get("processFlowTemplateId", ""),
                "payload": _json(payload),
            },
        )

    def list_process_flow_instances(self) -> list[JsonObject]:
        return self._list("process_flow_instances", [], [], "name ASC, id ASC")

    def get_process_flow_instance(self, id_: str) -> JsonObject | None:
        return self._get("process_flow_instances", id_)

    def update_process_flow_instance(self, id_: str, revision: int, mutate) -> JsonObject:
        """Check the latest snapshot and preserve immutable recipes in one transaction."""
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            current = self.get_process_flow_instance(id_)
            if current is None:
                raise NotFoundError(id_)
            if current["revision"] != revision:
                raise ResourceConflictError("Instance changed in another session. Reload before applying changes.")
            updated, geometries = mutate(copy.deepcopy(current))
            mutable = {"revision", "inputBindings", "stepConfigurations"}
            if {k: v for k, v in current.items() if k not in mutable} != {k: v for k, v in updated.items() if k not in mutable}:
                raise ResourceConflictError("Instance identity and metadata cannot be changed")
            if set(current["stepConfigurations"]) != set(updated["stepConfigurations"]):
                raise ResourceConflictError("Instance stations cannot be changed")
            for key, station in current["stepConfigurations"].items():
                if updated["stepConfigurations"][key]["recipes"][:len(station["recipes"])] != station["recipes"]:
                    raise ResourceConflictError("Existing recipes cannot be changed or deleted")
            updated["revision"] = revision + 1
            from .models import ProcessFlowInstance
            updated = ProcessFlowInstance.model_validate(updated).payload()
            for geometry in geometries:
                self._insert_geometry_in_transaction(geometry)
            self._connection.execute("UPDATE process_flow_instances SET payload=? WHERE id=?", (_json(updated), id_))
        return updated

    def delete_process_flow_instance(self, id_: str) -> None:
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            if self.get_process_flow_instance(id_) is None:
                raise NotFoundError(id_)
            self._delete_in_transaction("process_flow_instances", id_)

    def insert_editor_draft(self, kind: str, payload: JsonObject) -> JsonObject:
        try:
            with self._connection:
                self._connection.execute("BEGIN IMMEDIATE")
                if kind == "instance" and self.get_process_flow_template(payload["processFlowTemplateId"]) is None:
                    raise NotFoundError(payload["processFlowTemplateId"])
                self._insert_values(_draft_table(kind), _draft_values(kind, payload))
        except sqlite3.IntegrityError as error:
            raise _duplicate_item_error(error) from error
        return payload

    def list_editor_drafts(self, kind: str, *, template_id: str | None = None,
                          user: str | None = None, search: str | None = None) -> list[JsonObject]:
        clauses, params = [], []
        if template_id is not None:
            clauses.append("process_flow_template_id = ?")
            params.append(template_id)
        if user:
            clauses.append("user = ?")
            params.append(user)
        if search:
            clauses.append("(LOWER(name) LIKE ? OR LOWER(user) LIKE ?)")
            params.extend([f"%{search.lower()}%"] * 2)
        return [{key: value for key, value in item.items() if key != "state"}
                for item in self._list(_draft_table(kind), clauses, params, "updated_at DESC, id ASC")]

    def get_editor_draft(self, kind: str, id_: str, *, template_id: str | None = None) -> JsonObject | None:
        item = self._get(_draft_table(kind), id_)
        if item and template_id is not None and item.get("processFlowTemplateId") != template_id:
            return None
        return item

    def _required_draft(self, kind: str, id_: str, revision: int,
                        template_id: str | None = None) -> JsonObject:
        current = self.get_editor_draft(kind, id_, template_id=template_id)
        if current is None:
            raise NotFoundError(id_)
        if current["revision"] != revision:
            raise DraftConflictError("Draft changed in another session. Reload it or save as a new draft.")
        return current

    def update_editor_draft(self, kind: str, id_: str, body: JsonObject) -> JsonObject:
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            current = self._required_draft(kind, id_, body["revision"], body.get("processFlowTemplateId"))
            payload = {**current, **body, "revision": body["revision"] + 1, "updatedAt": utc_now()}
            values = _draft_values(kind, payload)
            assignments = ", ".join(f"{key}=?" for key in values if key != "id")
            self._connection.execute(f"UPDATE {_draft_table(kind)} SET {assignments} WHERE id=? AND revision=?",
                [value for key, value in values.items() if key != "id"] + [id_, body["revision"]])
        return payload

    def delete_editor_draft(self, kind: str, id_: str, revision: int,
                            *, template_id: str | None = None) -> None:
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            self._required_draft(kind, id_, revision, template_id)
            self._delete_in_transaction(_draft_table(kind), id_)

    def commit_editor_draft(self, kind: str, id_: str, revision: int, resource: JsonObject,
                            *, geometries: Iterable[JsonObject] = ()) -> JsonObject:
        try:
            with self._connection:
                self._connection.execute("BEGIN IMMEDIATE")
                self._required_draft(kind, id_, revision, resource.get("processFlowTemplateId"))
                for geometry in geometries:
                    self._insert_geometry_in_transaction(geometry)
                if kind == "template":
                    self._insert_process_flow_template_in_transaction(resource)
                else:
                    self._insert_process_flow_instance_in_transaction(resource)
                self._delete_in_transaction(_draft_table(kind), id_)
        except sqlite3.IntegrityError as error:
            raise _duplicate_item_error(error) from error
        return resource

    def insert_template_and_instance(
        self,
        template: JsonObject,
        instance: JsonObject,
        *,
        geometries: Iterable[JsonObject] = (),
        draft: tuple[str, int] | None = None,
    ) -> tuple[JsonObject, JsonObject]:
        try:
            with self._connection:
                self._connection.execute("BEGIN IMMEDIATE")
                if draft is not None:
                    self._required_draft("template", draft[0], draft[1])
                self._insert_process_flow_template_in_transaction(template)
                for geometry in geometries:
                    self._insert_geometry_in_transaction(geometry)
                self._insert_process_flow_instance_in_transaction(instance)
                if draft is not None:
                    self._delete_in_transaction(_draft_table("template"), draft[0])
        except sqlite3.IntegrityError as error:
            raise _duplicate_item_error(error) from error
        return template, instance

    def insert_instance_with_geometries(
        self,
        instance: JsonObject,
        *,
        geometries: Iterable[JsonObject] = (),
    ) -> JsonObject:
        try:
            with self._connection:
                for geometry in geometries:
                    self._insert_geometry_in_transaction(geometry)
                self._insert_process_flow_instance_in_transaction(instance)
        except sqlite3.IntegrityError as error:
            raise _duplicate_item_error(error) from error
        return instance

    def seed(self, fixtures: dict[str, Iterable[JsonObject]], *, reset: bool = False) -> None:
        if not reset and not self.is_empty():
            return
        dataset_id = str(uuid.uuid4()) if reset else self.dataset_id
        with self._connection:
            if reset:
                for table in TABLES:
                    self._connection.execute(f"DELETE FROM {table}")
                self._connection.execute(
                    "UPDATE schema_metadata SET value=? WHERE key='analyticsDatasetId'",
                    (dataset_id,),
                )
            for payload in fixtures["processStepTemplates"]:
                self._insert_process_step_template_in_transaction(payload)
            for payload in fixtures["processFlowTemplates"]:
                self._insert_process_flow_template_in_transaction(payload)
            for payload in fixtures["processFlowInstances"]:
                self._insert_process_flow_instance_in_transaction(payload)
            for payload in fixtures["geometries"]:
                self._insert_geometry_in_transaction(payload)
        self.dataset_id = dataset_id

    def _insert(self, table: str, values: dict[str, Any]) -> JsonObject:
        try:
            with self._connection:
                self._insert_values(table, values)
        except sqlite3.IntegrityError as error:
            raise _duplicate_item_error(error) from error
        return json.loads(values["payload"])

    def _insert_values(self, table: str, values: dict[str, Any]) -> None:
        columns = list(values.keys())
        placeholders = ", ".join("?" for _ in columns)
        column_list = ", ".join(columns)
        self._connection.execute(
            f"INSERT INTO {table} ({column_list}) VALUES ({placeholders})",
            [values[column] for column in columns],
        )

    def _insert_process_step_template_in_transaction(self, payload: JsonObject) -> None:
        self._insert_values(
            "process_step_templates",
            {
                "id": payload["id"],
                "name": payload.get("name", ""),
                "category": payload.get("category", ""),
                "version": payload.get("version", ""),
                "owner": payload.get("owner", ""),
                "payload": _json(payload),
            },
        )

    def _insert_process_flow_template_in_transaction(self, payload: JsonObject) -> None:
        self._insert_values(
            "process_flow_templates",
            {
                "id": payload["id"],
                "name": payload.get("name", ""),
                "version": payload.get("version", ""),
                "owner": payload.get("owner", ""),
                "payload": _json(payload),
            },
        )

    def _insert_process_flow_instance_in_transaction(self, payload: JsonObject) -> None:
        self._insert_values(
            "process_flow_instances",
            {
                "id": payload["id"],
                "name": payload.get("name", ""),
                "process_flow_template_id": payload.get("processFlowTemplateId", ""),
                "payload": _json(payload),
            },
        )

    def _insert_geometry_in_transaction(self, payload: JsonObject) -> None:
        self._insert_values("geometries", _geometry_values(payload))

    def _list(self, table: str, clauses: list[str], params: list[Any], order_by: str) -> list[JsonObject]:
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self._connection.execute(
            f"SELECT payload FROM {table}{where} ORDER BY {order_by}",
            params,
        ).fetchall()
        return [_normalize_resource_payload(table, json.loads(row["payload"])) for row in rows]

    def _get(self, table: str, id_: str) -> JsonObject | None:
        row = self._connection.execute(
            f"SELECT payload FROM {table} WHERE id = ?",
            (id_,),
        ).fetchone()
        return None if row is None else _normalize_resource_payload(table, json.loads(row["payload"]))

    def _delete_in_transaction(self, table: str, id_: str) -> None:
        cursor = self._connection.execute(f"DELETE FROM {table} WHERE id = ?", (id_,))
        if cursor.rowcount == 0:
            raise NotFoundError(id_)


RESOURCE_TABLES = (
    "process_step_templates",
    "process_flow_templates",
    "process_flow_instances",
    "geometries",
)

TABLES = ("process_flow_template_drafts", *RESOURCE_TABLES)


def _duplicate_item_error(error: sqlite3.IntegrityError) -> DuplicateItemError:
    message = str(error)
    if "process_flow_templates.name, process_flow_templates.version" in message:
        message = "A process flow template with this name and version already exists."
    elif "idx_process_flow_instances_name_version" in message:
        message = "A process flow instance with this name and version already exists."
    return DuplicateItemError(message)


def _normalize_resource_payload(table: str, payload: JsonObject) -> JsonObject:
    # Older template payloads remain valid without rewriting historical data.
    if table in {"process_step_templates", "process_flow_templates"}:
        payload.setdefault("status", "enabled")
    return payload


def _json(payload: JsonObject) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _draft_table(kind: str) -> str:
    if kind != "template":
        raise ValueError("Unknown draft kind")
    return f"process_flow_{kind}_drafts"


def _draft_values(kind: str, payload: JsonObject) -> dict[str, Any]:
    values = {
        "id": payload["id"], "user": payload["user"], "name": payload["name"],
        "revision": payload["revision"], "created_at": payload["createdAt"],
        "updated_at": payload["updatedAt"], "payload": _json(payload),
    }
    if kind == "instance":
        values["process_flow_template_id"] = payload["processFlowTemplateId"]
    return values


def _geometry_values(payload: JsonObject) -> dict[str, Any]:
    return {
        "id": payload["id"],
        "name": payload.get("name", ""),
        "category": payload.get("category"),
        "entity_type": payload.get("entityType", ""),
        "dim": payload.get("dim", ""),
        "vendor": payload.get("vendor"),
        "type1": payload.get("type1"),
        "type2": payload.get("type2"),
        "owner": payload.get("owner"),
        "payload": _json(payload),
    }


def _legacy_geometry_dim(description: Any) -> str:
    if not isinstance(description, str):
        return ""
    dimension, separator, _ = description.partition(" — ")
    return dimension if separator and dimension.endswith(" um") else ""
