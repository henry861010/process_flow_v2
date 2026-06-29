from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from pathlib import Path
from typing import Any

JsonObject = dict[str, Any]


class DuplicateItemError(ValueError):
    pass


class NotFoundError(KeyError):
    pass


class SQLiteStore:
    def __init__(self, db_path: str | Path):
        self.db_path = Path(db_path)
        if self.db_path != Path(":memory:"):
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self.initialize()

    def close(self) -> None:
        self._connection.close()

    def initialize(self) -> None:
        self._connection.executescript(
            """
            PRAGMA journal_mode = WAL;
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
              version TEXT,
              owner TEXT,
              payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_geometries_category ON geometries(category);
            CREATE INDEX IF NOT EXISTS idx_geometries_entity_type ON geometries(entity_type);
            """
        )
        self._connection.commit()

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

    def delete_process_step_template(self, id_: str) -> None:
        self._delete("process_step_templates", id_)

    def insert_geometry(self, payload: JsonObject) -> JsonObject:
        return self._insert(
            "geometries",
            {
                "id": payload["id"],
                "name": payload.get("name", ""),
                "category": payload.get("category"),
                "entity_type": payload.get("entityType", ""),
                "version": payload.get("version"),
                "owner": payload.get("owner"),
                "payload": _json(payload),
            },
        )

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

    def insert_template_and_instance(self, template: JsonObject, instance: JsonObject) -> tuple[JsonObject, JsonObject]:
        try:
            with self._connection:
                self._insert_process_flow_template_in_transaction(template)
                self._insert_process_flow_instance_in_transaction(instance)
        except sqlite3.IntegrityError as error:
            raise DuplicateItemError(str(error)) from error
        return template, instance

    def seed(self, fixtures: dict[str, Iterable[JsonObject]], *, reset: bool = False) -> None:
        if reset:
            self.reset()
        elif not self.is_empty():
            return
        with self._connection:
            for payload in fixtures["processStepTemplates"]:
                self._insert_process_step_template_in_transaction(payload)
            for payload in fixtures["processFlowTemplates"]:
                self._insert_process_flow_template_in_transaction(payload)
            for payload in fixtures["processFlowInstances"]:
                self._insert_process_flow_instance_in_transaction(payload)
            for payload in fixtures["geometries"]:
                self._insert_geometry_in_transaction(payload)

    def _insert(self, table: str, values: dict[str, Any]) -> JsonObject:
        try:
            with self._connection:
                self._insert_values(table, values)
        except sqlite3.IntegrityError as error:
            raise DuplicateItemError(str(error)) from error
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
        self._insert_values(
            "geometries",
            {
                "id": payload["id"],
                "name": payload.get("name", ""),
                "category": payload.get("category"),
                "entity_type": payload.get("entityType", ""),
                "version": payload.get("version"),
                "owner": payload.get("owner"),
                "payload": _json(payload),
            },
        )

    def _list(self, table: str, clauses: list[str], params: list[Any], order_by: str) -> list[JsonObject]:
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = self._connection.execute(
            f"SELECT payload FROM {table}{where} ORDER BY {order_by}",
            params,
        ).fetchall()
        return [json.loads(row["payload"]) for row in rows]

    def _get(self, table: str, id_: str) -> JsonObject | None:
        row = self._connection.execute(
            f"SELECT payload FROM {table} WHERE id = ?",
            (id_,),
        ).fetchone()
        return None if row is None else json.loads(row["payload"])

    def _delete(self, table: str, id_: str) -> None:
        with self._connection:
            cursor = self._connection.execute(f"DELETE FROM {table} WHERE id = ?", (id_,))
        if cursor.rowcount == 0:
            raise NotFoundError(id_)


class KernelRepository:
    def __init__(self, store: SQLiteStore, kind: str):
        self._store = store
        self._kind = kind

    def get_by_id(self, id_: str) -> JsonObject | None:
        if self._kind == "geometry":
            return self._store.get_geometry(id_)
        if self._kind == "process_step":
            return self._store.get_process_step_template(id_)
        if self._kind == "process_flow_template":
            return self._store.get_process_flow_template(id_)
        if self._kind == "process_flow_instance":
            return self._store.get_process_flow_instance(id_)
        raise ValueError(f"Unsupported repository kind: {self._kind}")


TABLES = (
    "process_step_templates",
    "process_flow_templates",
    "process_flow_instances",
    "geometries",
)


def _json(payload: JsonObject) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
