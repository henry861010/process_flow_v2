from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import ProcessStepTemplate
from .step_template_transfer import locked_process_step_template

JsonObject = dict[str, Any]
DATABASE_SCHEMA_VERSION = "14"


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
        tables = {row[0] for row in self._connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not tables:
            with self._connection:
                self._connection.execute("BEGIN IMMEDIATE")
                self._create_tables()
                self._set_schema_version()
        else:
            row = self._connection.execute(
                "SELECT value FROM schema_metadata WHERE key='databaseSchemaVersion'"
            ).fetchone() if "schema_metadata" in tables else None
            version = row[0] if row else None
            if version != DATABASE_SCHEMA_VERSION:
                if version not in {"8", "9", "10", "11", "12", "13"}:
                    raise RuntimeError(f"Unsupported database schema migration: {version} -> {DATABASE_SCHEMA_VERSION}")
                self._migrate(int(version), tables)
        with self._connection:
            self._connection.execute(
                "INSERT OR IGNORE INTO schema_metadata(key,value) VALUES ('analyticsDatasetId', ?)",
                (str(uuid.uuid4()),),
            )
        self._connection.execute("PRAGMA journal_mode = WAL")
        self.dataset_id = self._connection.execute(
            "SELECT value FROM schema_metadata WHERE key='analyticsDatasetId'"
        ).fetchone()[0]

    def _create_tables(self) -> None:
        statements = (
            "CREATE TABLE IF NOT EXISTS schema_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
            "CREATE TABLE IF NOT EXISTS process_step_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, version TEXT NOT NULL, owner TEXT NOT NULL, payload TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_process_step_templates_category ON process_step_templates(category)",
            "CREATE TABLE IF NOT EXISTS geometries (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, entity_type TEXT NOT NULL, dim TEXT NOT NULL, vendor TEXT, type1 TEXT, type2 TEXT, owner TEXT, payload TEXT NOT NULL)",
            "CREATE INDEX IF NOT EXISTS idx_geometries_category ON geometries(category)",
            "CREATE INDEX IF NOT EXISTS idx_geometries_entity_type ON geometries(entity_type)",
            "CREATE TABLE process_flows (id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL, owner TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), payload TEXT NOT NULL, UNIQUE(name, version))",
            "CREATE TABLE process_flow_drafts (id TEXT PRIMARY KEY, user TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)",
            "CREATE INDEX idx_process_flow_drafts_updated ON process_flow_drafts(updated_at DESC)",
            "CREATE INDEX idx_process_flow_drafts_user ON process_flow_drafts(user)",
        )
        for statement in statements:
            self._connection.execute(statement)

    def _set_schema_version(self) -> None:
        self._connection.execute(
            "INSERT INTO schema_metadata(key,value) VALUES ('databaseSchemaVersion', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (DATABASE_SCHEMA_VERSION,),
        )

    def _migrate(self, version: int, tables: set[str]) -> None:
        from .flow_migration import LEGACY_TABLES, convert_legacy
        # SQLite's backup API produces a consistent, independently recoverable snapshot.
        if self.db_path != Path(":memory:"):
            backup_path = self.db_path.with_name(f"{self.db_path.name}.pre-v14-{uuid.uuid4().hex}.bak")
            backup = sqlite3.connect(str(backup_path))
            try:
                self._connection.backup(backup)
            finally:
                backup.close()
            self.migration_backup_path = backup_path
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            data = {table: [json.loads(row[0]) for row in self._connection.execute(f"SELECT payload FROM {table}")]
                    for table in (*LEGACY_TABLES, "process_step_templates", "geometries") if table in tables}
            converted = convert_legacy(data, version)
            if version < 10:
                self._connection.execute("DROP TABLE geometries")
            self._create_tables()
            for flow in converted["processFlows"]:
                self._insert_values("process_flows", _flow_values(flow))
            for draft in converted["flowDrafts"]:
                self._insert_values("process_flow_drafts", _draft_values(draft))
            existing_geometry_ids = {row[0] for row in self._connection.execute("SELECT id FROM geometries")}
            for geometry in converted["geometries"]:
                if geometry["id"] not in existing_geometry_ids:
                    self._insert_geometry_in_transaction(geometry)
            if self.count("process_flows") != len(converted["processFlows"]) or self.count("process_flow_drafts") != len(converted["flowDrafts"]):
                raise RuntimeError("Flow migration row count verification failed")
            for table in LEGACY_TABLES:
                if table in tables:
                    self._connection.execute(f"DROP TABLE {table}")
            self._set_schema_version()

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
                for flow in self.list_process_flows():
                    self._check_import_step_references(
                        flow["definition"].get("stepRefs", []), structural_changes, f"flow {flow['id']}",
                    )
                # Draft summaries omit state; inspect full records, including every user's drafts.
                for draft in self._list("process_flow_drafts", [], [], "id ASC"):
                    self._check_import_step_references(
                        [node["stepRef"] for node in draft["state"]["nodes"] if node["kind"] == "processStep"],
                        structural_changes, f"flow draft {draft['id']}",
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
            for table, label in (("process_flows", "flow"), ("process_flow_drafts", "flow draft")):
                for row in self._connection.execute(f"SELECT id, payload FROM {table}"):
                    payload = json.loads(row["payload"])
                    configuration = payload.get("state", payload).get("configuration", {})
                    bindings = configuration.get("inputBindings", {})
                    if any(binding.get("kind") == "catalog" and binding.get("geometryId") == id_
                           for binding in bindings.values()):
                        raise ResourceConflictError(
                            f"Geometry {id_} is referenced by {label} {row['id']}"
                        )
            self._delete_in_transaction("geometries", id_)

    def insert_process_flow(self, payload: JsonObject) -> JsonObject:
        return self._insert("process_flows", _flow_values(payload))

    def list_process_flows(self) -> list[JsonObject]:
        return self._list("process_flows", [], [], "name ASC, version ASC, id ASC")

    def get_process_flow(self, id_: str) -> JsonObject | None:
        return self._get("process_flows", id_)

    def _required_flow(self, id_: str, revision: int) -> JsonObject:
        current = self.get_process_flow(id_)
        if current is None:
            raise NotFoundError(id_)
        if current["revision"] != revision:
            raise ResourceConflictError("Flow changed in another session. Reload it or save as a new flow.")
        return current

    def _update_flow_in_transaction(self, payload: JsonObject, revision: int) -> JsonObject:
        current = self._required_flow(payload["id"], revision)
        # Provenance is immutable for updates, including direct repository callers.
        payload = {key: value for key, value in payload.items() if key != "origin"}
        if "origin" in current:
            payload["origin"] = current["origin"]
        payload["revision"] = revision + 1
        values = _flow_values(payload)
        assignments = ", ".join(f"{key}=?" for key in values if key != "id")
        self._connection.execute(f"UPDATE process_flows SET {assignments} WHERE id=? AND revision=?",
            [value for key, value in values.items() if key != "id"] + [payload["id"], revision])
        return payload

    def update_process_flow(self, payload: JsonObject, revision: int) -> JsonObject:
        try:
            with self._connection:
                self._connection.execute("BEGIN IMMEDIATE")
                return self._update_flow_in_transaction(payload, revision)
        except sqlite3.IntegrityError as error:
            raise _duplicate_item_error(error) from error

    def delete_process_flow(self, id_: str, revision: int) -> None:
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            self._required_flow(id_, revision)
            self._delete_in_transaction("process_flows", id_)

    def insert_flow_draft(self, payload: JsonObject) -> JsonObject:
        return self._insert("process_flow_drafts", _draft_values(payload))

    def list_flow_drafts(self, *, user: str | None = None, search: str | None = None) -> list[JsonObject]:
        clauses, params = [], []
        if user:
            clauses.append("user = ?")
            params.append(user)
        if search:
            clauses.append("(LOWER(name) LIKE ? OR LOWER(user) LIKE ?)")
            params.extend([f"%{search.lower()}%"] * 2)
        return [{key: value for key, value in item.items() if key != "state"}
                for item in self._list("process_flow_drafts", clauses, params, "updated_at DESC, id ASC")]

    def get_flow_draft(self, id_: str) -> JsonObject | None:
        return self._get("process_flow_drafts", id_)

    def _required_draft(self, id_: str, revision: int) -> JsonObject:
        current = self.get_flow_draft(id_)
        if current is None:
            raise NotFoundError(id_)
        if current["revision"] != revision:
            raise DraftConflictError("Draft changed in another session. Reload it or save as a new draft.")
        return current

    def update_flow_draft(self, id_: str, body: JsonObject) -> JsonObject:
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            current = self._required_draft(id_, body["revision"])
            payload = {**body, "id": id_, "createdAt": current["createdAt"],
                       "revision": body["revision"] + 1, "updatedAt": utc_now()}
            values = _draft_values(payload)
            assignments = ", ".join(f"{key}=?" for key in values if key != "id")
            self._connection.execute(f"UPDATE process_flow_drafts SET {assignments} WHERE id=? AND revision=?",
                [value for key, value in values.items() if key != "id"] + [id_, body["revision"]])
        return payload

    def delete_flow_draft(self, id_: str, revision: int) -> None:
        with self._connection:
            self._connection.execute("BEGIN IMMEDIATE")
            self._required_draft(id_, revision)
            self._delete_in_transaction("process_flow_drafts", id_)

    def commit_flow_draft(self, id_: str, revision: int, resource: JsonObject,
                          *, target_revision: int | None = None) -> JsonObject:
        try:
            with self._connection:
                self._connection.execute("BEGIN IMMEDIATE")
                self._required_draft(id_, revision)
                if target_revision is None:
                    self._insert_values("process_flows", _flow_values(resource))
                else:
                    resource = self._update_flow_in_transaction(resource, target_revision)
                self._delete_in_transaction("process_flow_drafts", id_)
        except sqlite3.IntegrityError as error:
            raise _duplicate_item_error(error) from error
        return resource

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
            for payload in fixtures["processFlows"]:
                self._insert_values("process_flows", _flow_values(payload))
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


RESOURCE_TABLES = ("process_step_templates", "process_flows", "geometries")
TABLES = ("process_flow_drafts", *RESOURCE_TABLES)


def _duplicate_item_error(error: sqlite3.IntegrityError) -> DuplicateItemError:
    message = str(error)
    if "process_flows.name, process_flows.version" in message:
        message = "A process flow with this name and version already exists."
    return DuplicateItemError(message)


def _normalize_resource_payload(table: str, payload: JsonObject) -> JsonObject:
    if table == "process_step_templates":
        payload.setdefault("status", "enabled")
    return payload


def _json(payload: JsonObject) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _flow_values(payload: JsonObject) -> dict[str, Any]:
    return {**{key: payload[key] for key in ("id", "name", "version", "owner", "revision")}, "payload": _json(payload)}


def _draft_values(payload: JsonObject) -> dict[str, Any]:
    return {"id": payload["id"], "user": payload["user"], "name": payload["name"],
            "revision": payload["revision"], "created_at": payload["createdAt"],
            "updated_at": payload["updatedAt"], "payload": _json(payload)}


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
