"""Best-effort, bounded analytics storage. Never stores HTTP bodies or credentials."""
from __future__ import annotations

import contextvars
import json
import logging
import os
import queue
import sqlite3
import threading
import time
import uuid
from datetime import UTC, datetime
from contextlib import closing
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
request_context: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "analytics_request", default=None
)
SCHEMA_VERSION = 1
COMMON_COLUMNS = "request_owner,occurred_at,environment,app_version,server_instance_id,dataset_id,record_version"
REQUEST_COLUMNS = COMMON_COLUMNS + ",request_id,started_at,method,route,status_code,duration_ms,request_bytes,response_bytes,traffic_kind,completion_state,error_code"
EVENT_COLUMNS = COMMON_COLUMNS + ",event_id,request_id,operation_id,event_name,phase,outcome,flow_template_id,flow_instance_id,workspace_id,source_kind,duration_ms,error_code,properties_json"

SCHEMA = """
CREATE TABLE IF NOT EXISTS analytics_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_requests (
 request_owner TEXT NOT NULL DEFAULT 'unknown', occurred_at TEXT NOT NULL,
 environment TEXT NOT NULL, app_version TEXT NOT NULL, server_instance_id TEXT NOT NULL,
 dataset_id TEXT NOT NULL, record_version INTEGER NOT NULL,
 request_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, method TEXT NOT NULL,
 route TEXT NOT NULL, status_code INTEGER, duration_ms INTEGER NOT NULL,
 request_bytes INTEGER, response_bytes INTEGER, traffic_kind TEXT NOT NULL,
 completion_state TEXT NOT NULL, error_code TEXT
);
CREATE TABLE IF NOT EXISTS usage_events (
 request_owner TEXT NOT NULL DEFAULT 'unknown', occurred_at TEXT NOT NULL,
 environment TEXT NOT NULL, app_version TEXT NOT NULL, server_instance_id TEXT NOT NULL,
 dataset_id TEXT NOT NULL, record_version INTEGER NOT NULL,
 event_id TEXT PRIMARY KEY, request_id TEXT, operation_id TEXT NOT NULL,
 event_name TEXT NOT NULL, phase TEXT NOT NULL, outcome TEXT,
 flow_template_id TEXT, flow_instance_id TEXT, workspace_id TEXT, source_kind TEXT NOT NULL,
 duration_ms INTEGER, error_code TEXT,
 properties_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(properties_json) AND json_type(properties_json) = 'object'),
 UNIQUE(operation_id, event_name, phase)
);
CREATE INDEX IF NOT EXISTS requests_time ON api_requests(occurred_at);
CREATE INDEX IF NOT EXISTS requests_route_time ON api_requests(route,occurred_at);
CREATE INDEX IF NOT EXISTS requests_owner_time ON api_requests(request_owner,occurred_at);
CREATE INDEX IF NOT EXISTS events_time ON usage_events(occurred_at);
CREATE INDEX IF NOT EXISTS events_name_time ON usage_events(event_name,occurred_at);
CREATE INDEX IF NOT EXISTS events_owner_time ON usage_events(request_owner,occurred_at);
CREATE INDEX IF NOT EXISTS events_flow_time ON usage_events(dataset_id,flow_template_id,occurred_at);
CREATE INDEX IF NOT EXISTS events_request ON usage_events(request_id);
"""


def utc_timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def request_owner(scope: dict[str, Any]) -> str:
    """Future authentication middleware may set this trusted ASGI state field.

    No caller-provided header, body owner, cookie, IP or export clientId is used.
    """
    value = scope.get("state", {}).get("authenticated_user_id")
    return value if isinstance(value, str) and 0 < len(value) <= 256 else "unknown"


def current_origin() -> dict[str, Any] | None:
    context = request_context.get()
    if context is None:
        return None
    return {
        **context["common"],
        "request_owner": request_owner(context["scope"]),
        "request_id": context["request_id"],
        **context.get("usage", {}),
    }


def consistent_backup(connection: sqlite3.Connection, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + f".{uuid.uuid4().hex}.tmp")
    try:
        with closing(sqlite3.connect(temporary)) as target:
            connection.backup(target)
            if target.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("Analytics backup integrity check failed")
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


class AnalyticsRecorder:
    def __init__(self, db_path: Path | str, *, queue_size: int = 4096,
                 backup_directory: Path | None = None) -> None:
        self.db_path = Path(db_path)
        self.environment = os.environ.get("PROCESS_FLOW_API_ENVIRONMENT", "development")
        self.app_version = os.environ.get("PROCESS_FLOW_API_VERSION", "unknown")
        self.server_instance_id = str(uuid.uuid4())
        self.backup_directory = backup_directory or self.db_path.parent / "analytics-backups"
        self._queue: queue.Queue[tuple[str, dict[str, Any]]] = queue.Queue(maxsize=queue_size)
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self.dropped_records = 0
        self._pending_drops = 0
        self._last_warning = 0.0
        self._last_loss_common: dict[str, Any] | None = None
        self._last_backup_date: str | None = None

    def common(self, dataset_id: str) -> dict[str, Any]:
        return {"request_owner": "unknown", "occurred_at": utc_timestamp(),
                "environment": self.environment, "app_version": self.app_version,
                "server_instance_id": self.server_instance_id,
                "dataset_id": dataset_id, "record_version": 1}

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="analytics-writer", daemon=True)
        self._thread.start()
        self._ready.wait(timeout=2)

    def record_request(self, record: dict[str, Any]) -> None:
        self._enqueue("api_requests", record)

    def event(self, origin: dict[str, Any], *, event_name: str, phase: str = "finished",
              outcome: str | None = None, operation_id: str | None = None,
              duration_ms: int | None = None, error_code: str | None = None,
              properties: dict[str, Any] | None = None) -> None:
        try:
            record = {key: origin.get(key) for key in COMMON_COLUMNS.split(",")}
            record.update(event_id=str(uuid.uuid4()), occurred_at=utc_timestamp(),
                          request_id=origin.get("request_id"),
                          operation_id=operation_id or origin.get("request_id") or str(uuid.uuid4()),
                          event_name=event_name, phase=phase, outcome=outcome,
                          source_kind=origin.get("source_kind", "system"),
                          duration_ms=duration_ms, error_code=error_code)
            for key in ("flow_template_id", "flow_instance_id", "workspace_id"):
                record[key] = origin.get(key)
            record["properties_json"] = json.dumps(
                properties if properties is not None else origin.get("properties", {}),
                ensure_ascii=False, separators=(",", ":"), allow_nan=False,
            )
            self._enqueue("usage_events", record)
        except Exception:
            self._loss(1, origin)

    def _enqueue(self, table: str, record: dict[str, Any]) -> None:
        try:
            if self._stop.is_set():
                self._loss(1, record)
                return
            self._queue.put_nowait((table, record))
        except queue.Full:
            self._loss(1, record)

    def _loss(self, count: int, common: dict[str, Any]) -> None:
        with self._lock:
            self.dropped_records += count
            self._pending_drops += count
            self._last_loss_common = self.common(common.get("dataset_id") or "unknown")
            now = time.monotonic()
            if now - self._last_warning >= 60:
                self._last_warning = now
                # Exception messages can contain paths/input; log only counters.
                logger.warning("Analytics records lost; cumulative=%d", self.dropped_records)

    def _connect(self) -> sqlite3.Connection:
        if self.db_path != Path(":memory:"):
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self.db_path), timeout=0.05)
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("CREATE TABLE IF NOT EXISTS analytics_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            row = connection.execute("SELECT value FROM analytics_metadata WHERE key='schema_version'").fetchone()
            if row is not None and row[0] != str(SCHEMA_VERSION):
                raise RuntimeError("Unsupported analytics schema version; history preserved")
            connection.executescript(SCHEMA)
            connection.execute("INSERT OR IGNORE INTO analytics_metadata VALUES ('schema_version', ?)", (str(SCHEMA_VERSION),))
            connection.commit()
            self._recover_exports(connection)
            return connection
        except BaseException:
            connection.close()
            raise

    def _recover_exports(self, connection: sqlite3.Connection) -> None:
        columns = EVENT_COLUMNS.split(",")
        rows = connection.execute(
            "SELECT * FROM usage_events a WHERE event_name='export' AND phase='accepted' "
            "AND server_instance_id<>? AND NOT EXISTS (SELECT 1 FROM usage_events f "
            "WHERE f.operation_id=a.operation_id AND f.event_name='export' AND f.phase='finished')",
            (self.server_instance_id,),
        )
        names = [column[0] for column in rows.description]
        pending = [dict(zip(names, row)) for row in rows]
        with connection:
            for record in pending:
                record.update(event_id=str(uuid.uuid4()), occurred_at=utc_timestamp(),
                              phase="finished", outcome="unknown", duration_ms=None,
                              error_code="SERVER_RESTART", server_instance_id=self.server_instance_id)
                self._insert(connection, "usage_events", record, columns)

    @staticmethod
    def _insert(connection: sqlite3.Connection, table: str, record: dict[str, Any],
                columns: list[str] | None = None) -> None:
        columns = columns or (REQUEST_COLUMNS if table == "api_requests" else EVENT_COLUMNS).split(",")
        # Ignore only duplicate operation/event/phase; malformed records must fail.
        conflict = "request_id" if table == "api_requests" else "operation_id,event_name,phase"
        connection.execute(
            f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)}) "
            f"ON CONFLICT({conflict}) DO NOTHING", [record.get(key) for key in columns],
        )

    def _write_batch(self, connection: sqlite3.Connection,
                     batch: list[tuple[str, dict[str, Any]]]) -> None:
        with self._lock:
            lost = self._pending_drops
            common = dict(self._last_loss_common or {})
        with connection:
            if lost:
                gap = {**common, "occurred_at": utc_timestamp(), "event_id": str(uuid.uuid4()),
                       "operation_id": str(uuid.uuid4()), "event_name": "analytics.gap",
                       "phase": "finished", "outcome": "unknown", "source_kind": "system",
                       "error_code": "RECORDS_LOST",
                       "properties_json": json.dumps({"lost_record_count": lost})}
                self._insert(connection, "usage_events", gap)
            for table, record in batch:
                self._insert(connection, table, record)
        with self._lock:
            self._pending_drops -= lost

    def _backup_if_due(self, connection: sqlite3.Connection) -> None:
        if self.db_path == Path(":memory:"):
            return
        day = datetime.now(UTC).strftime("%Y-%m-%d")
        if day == self._last_backup_date:
            return
        destination = self.backup_directory / f"analytics-{day}.sqlite3"
        # A restart on the same day must not replace the existing daily snapshot.
        if not destination.exists():
            consistent_backup(connection, destination)
        for path in sorted(self.backup_directory.glob("analytics-????-??-??.sqlite3"))[:-30]:
            path.unlink()
        self._last_backup_date = day

    def _run(self) -> None:
        connection = None
        last_backup_attempt = 0.0
        try:
            while not self._stop.is_set() or not self._queue.empty():
                batch: list[tuple[str, dict[str, Any]]] = []
                try:
                    if connection is None:
                        connection = self._connect()
                    self._ready.set()
                    deadline = time.monotonic() + 0.1
                    while len(batch) < 100:
                        try:
                            batch.append(self._queue.get(timeout=max(0, deadline - time.monotonic())))
                        except queue.Empty:
                            break
                    self._write_batch(connection, batch)
                    if time.monotonic() - last_backup_attempt >= 60:
                        last_backup_attempt = time.monotonic()
                        try:
                            self._backup_if_due(connection)
                        except Exception:
                            logger.warning("Analytics daily backup failed; retry in 60 seconds")
                except Exception:
                    self._ready.set()
                    if not batch:
                        try:
                            batch.append(self._queue.get(timeout=0.1))
                        except queue.Empty:
                            pass
                    if batch:
                        self._loss(len(batch), batch[-1][1])
                    if connection is not None:
                        connection.close()
                        connection = None
                finally:
                    for _ in batch:
                        self._queue.task_done()
        finally:
            if connection is not None:
                connection.close()

    def flush(self, timeout: float = 5) -> bool:
        """Bounded drain for tests/maintenance; never used in an HTTP request."""
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks and time.monotonic() < deadline:
            time.sleep(0.01)
        return self._queue.unfinished_tasks == 0

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
