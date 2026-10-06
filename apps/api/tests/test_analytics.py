from __future__ import annotations

import asyncio
import copy
import json
import sqlite3
import time
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

import pytest
from fastapi.testclient import TestClient
from starlette.requests import ClientDisconnect

from process_flow_api.analytics import AnalyticsRecorder, consistent_backup, request_context
from process_flow_api.analytics_cli import main as maintenance
from process_flow_api.analytics_http import AnalyticsMiddleware
from process_flow_api.main import create_app
from process_flow_api.repository import SQLiteStore
from process_flow_api.seed import load_seed_fixtures


@pytest.fixture
def service(tmp_path):
    app = create_app(db_path=tmp_path / "business.sqlite3")
    with TestClient(app, raise_server_exceptions=False) as client:
        yield app, client
    app.state.store.close()


def rows(app, table, where="1", parameters=()):
    assert app.state.analytics.flush()
    with sqlite3.connect(app.state.analytics.db_path) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(f"SELECT * FROM {table} WHERE {where} ORDER BY rowid", parameters)]


def request_record(recorder, request_id="request-test"):
    return {**recorder.common("dataset-test"), "request_id": request_id,
            "started_at": "2026-10-06T00:00:00.000Z", "method": "GET", "route": "/api/health",
            "status_code": 200, "duration_ms": 1, "traffic_kind": "system",
            "completion_state": "completed"}


def instance_source(client):
    bootstrap = client.get("/api/bootstrap").json()
    instance = bootstrap["processFlowInstances"][0]
    template = next(item for item in bootstrap["processFlowTemplates"] if item["id"] == instance["processFlowTemplateId"])
    return template, instance


def test_request_routes_owner_cors_and_privacy(service):
    app, client = service
    response = client.get("/api/bootstrap?secret=do-not-store", headers={
        "Origin": "http://localhost:3001", "Authorization": "Bearer do-not-store",
        "Cookie": "secret=do-not-store", "X-Request-Owner": "forged-user",
        "X-Request-Id": "forged-id",
    })
    assert response.status_code == 200
    assert response.headers["X-Request-Id"] != "forged-id"
    assert "X-Request-Id" in response.headers["Access-Control-Expose-Headers"]
    client.get("/secret-do-not-store?secret=do-not-store")
    client.get("/api/process-flow-instances/missing")
    client.get("/api/export-jobs?clientId=secret-do-not-store")
    records = rows(app, "api_requests")
    assert len(records) == 4
    assert all(row["request_owner"] == "unknown" for row in records)
    assert all(row["occurred_at"].endswith("Z") and row["duration_ms"] >= 0 for row in records)
    assert any(row["route"] == "__unmatched__" and row["status_code"] == 404 for row in records)
    assert any(row["route"] == "/api/process-flow-instances/{instance_id}" for row in records)
    assert any(row["traffic_kind"] == "polling" for row in records)
    assert "do-not-store" not in json.dumps(records)
    assert not rows(app, "usage_events")


def test_success_conflict_and_validation_events_do_not_save_body_owner(service):
    app, client = service
    template, source = instance_source(client)
    payload = {**source, "id": "analytics-copy", "owner": "resource-owner-not-actor"}
    created = client.post("/api/process-flow-instances", json=payload)
    assert created.status_code == 201
    assert client.post("/api/process-flow-instances", json=payload).status_code == 409
    assert client.post("/api/process-flow-instances", json={"owner": "injected-owner"}).status_code == 422
    events = rows(app, "usage_events", "event_name='flow_instance.create'")
    assert len(events) == 3
    assert [event["outcome"] for event in events] == ["success", "failure", "failure"]
    assert events[0]["flow_template_id"] == template["id"]
    properties = json.loads(events[0]["properties_json"])
    assert properties["step_count"] == len(template["stepRefs"])
    assert properties["instance_name"] == source["name"]
    assert all(event["request_owner"] == "unknown" for event in events)
    serialized = json.dumps(events)
    assert "resource-owner-not-actor" not in serialized
    assert "injected-owner" not in serialized
    assert "parameterValues" not in serialized
    assert events[1]["error_code"] == "RESOURCE_CONFLICT"
    assert events[2]["error_code"] == "VALIDATION_ERROR"


def test_500_is_correlated_and_does_not_store_error_message(service):
    app, client = service
    @app.get("/analytics-test-error")
    async def broken():
        raise RuntimeError("secret diagnostic do-not-store")
    response = client.get("/analytics-test-error", headers={"Origin": "http://localhost:3001"})
    assert response.status_code == 500
    assert response.headers["X-Request-Id"]
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3001"
    assert response.headers["Access-Control-Expose-Headers"] == "X-Request-Id"
    records = rows(app, "api_requests", "status_code=500")
    assert len(records) == 1
    assert records[0]["completion_state"] == "exception"
    assert records[0]["error_code"] == "INTERNAL_ERROR"
    assert "do-not-store" not in json.dumps(records)


def test_operation_400_and_500(service):
    app, client = service
    template, source = instance_source(client)
    payload = {**source, "id": "analytics-error"}
    with mock.patch("process_flow_api.main.create_flow_instance", side_effect=ValueError("secret-body")):
        assert client.post("/api/process-flow-instances", json=payload).status_code == 400
    with mock.patch("process_flow_api.main.create_flow_instance", side_effect=RuntimeError("secret-body")):
        assert client.post("/api/process-flow-instances", json=payload).status_code == 500
    events = rows(app, "usage_events")
    assert [event["error_code"] for event in events] == ["INVALID_INPUT", "INTERNAL_ERROR"]
    assert "secret-body" not in json.dumps(events)


def test_workspace_commit_retry_and_reset_history(service):
    app, client = service
    template, source = instance_source(client)
    first_dataset = app.state.store.dataset_id
    response = client.post("/api/process-flow-workspaces", json={
        "name": "Analytics workspace", "processFlowTemplateId": template["id"],
        "inputBindings": source["inputBindings"], "stepConfigurations": source["stepConfigurations"],
    })
    assert response.status_code == 201, response.text
    workspace = response.json()
    commit = {"instanceId": "analytics-committed", "instanceName": "Analytics build",
              "instanceVersion": "V1", "instanceOwner": "not-request-owner", "revision": 1}
    route = f"/api/process-flow-workspaces/{workspace['id']}/commit"
    assert client.post(route, json=commit).status_code == 200
    assert client.post(route, json={**commit, "instanceId": "ignored-retry"}).status_code == 200
    creates = rows(app, "usage_events", "event_name='flow_instance.create' AND outcome='success'")
    assert len(creates) == 1
    commits = rows(app, "usage_events", "event_name='workspace.commit'")
    assert [json.loads(row["properties_json"])["created_instance"] for row in commits] == [True, False]
    assert all(row["workspace_id"] == workspace["id"] for row in commits)
    before = len(rows(app, "usage_events"))
    assert client.post("/api/reset").status_code == 200
    new_dataset = app.state.store.dataset_id
    assert new_dataset != first_dataset
    assert len(rows(app, "usage_events")) == before + 1
    reset = rows(app, "usage_events", "event_name='data.reset'")[0]
    assert reset["dataset_id"] == first_dataset
    assert json.loads(reset["properties_json"])["new_dataset_id"] == new_dataset
    assert client.post("/api/reset-from-zip", content=b"broken", headers={"Content-Type": "application/zip"}).status_code == 400
    assert app.state.store.dataset_id == new_dataset
    snapshot = client.get("/api/fixture-export").content
    assert client.post("/api/reset-from-zip", content=snapshot, headers={"Content-Type": "application/zip"}).status_code == 200
    assert app.state.store.dataset_id != new_dataset
    assert len(rows(app, "usage_events", "event_name='flow_instance.create' AND outcome='success'")) == 1


def test_dataset_rotation_is_transactional_and_survives_reopen(tmp_path):
    path = tmp_path / "business.sqlite3"
    store = SQLiteStore(path)
    fixtures = load_seed_fixtures()
    store.seed(fixtures)
    dataset = store.dataset_id
    broken = copy.deepcopy(fixtures)
    broken["processFlowTemplates"].append(broken["processFlowTemplates"][0])
    with pytest.raises(sqlite3.IntegrityError):
        store.seed(broken, reset=True)
    assert store.dataset_id == dataset
    store.close()
    reopened = SQLiteStore(path)
    assert reopened.dataset_id == dataset
    assert len(reopened.list_process_flow_templates()) == len(fixtures["processFlowTemplates"])
    reopened.close()


def test_preview_context_and_inline_draft_attribution(service):
    app, client = service
    template, source = instance_source(client)
    target = {"type": "flowInput", "flowInputId": template["flowInputs"][0]["flowInputId"]}
    config = {"inputBindings": source["inputBindings"], "stepConfigurations": source["stepConfigurations"]}
    for context in ({"flowTemplateId": template["id"], "flowInstanceId": source["id"]},
                    {"flowTemplateId": "missing", "flowInstanceId": source["id"]}):
        payload = {"processFlowTemplateId": template["id"], "target": target,
                   "configuration": config, "analyticsContext": context}
        response = client.post("/api/preview-sessions", json=payload)
        assert response.status_code == 200, response.text
    inline = {"flowTemplate": template, "target": target, "configuration": config,
              "analyticsContext": {"flowTemplateId": template["id"]}}
    assert client.post("/api/preview-sessions", json=inline).status_code == 200
    events = rows(app, "usage_events", "event_name='flow.preview'")
    assert len(events) == 3
    assert events[0]["flow_instance_id"] == source["id"]
    assert json.loads(events[0]["properties_json"])["context_confirmed"] is True
    assert json.loads(events[1]["properties_json"])["context_confirmed"] is False
    assert json.loads(events[1]["properties_json"])["cache_hit"] is True
    assert events[1]["flow_instance_id"] is None
    assert events[2]["source_kind"] == "inline_draft" and events[2]["flow_template_id"] is None
    assert json.loads(events[2]["properties_json"])["base_flow_template_id"] == template["id"]


def wait_job(client, job_id):
    for _ in range(100):
        result = client.get(f"/api/export-jobs/{job_id}?clientId=not-an-actor").json()["job"]
        if result["status"] in ("success", "failed", "canceled"):
            return result
        time.sleep(0.01)
    raise AssertionError("Export timed out")


def test_exports_lifecycle_results_and_polling(service, tmp_path):
    app, client = service
    template, source = instance_source(client)
    payload = {"kind": "json", "clientId": "not-an-actor", "outputPath": str(tmp_path / "export.json"),
               "geometryEntityJson": {"secret": "do-not-store"},
               "analyticsContext": {"flowTemplateId": template["id"], "flowInstanceId": source["id"]}}
    accepted = client.post("/api/geometry-preview/export-jobs", json=payload)
    assert accepted.status_code == 200
    job_id = accepted.json()["job"]["jobId"]
    assert wait_job(client, job_id)["status"] == "success"
    for _ in range(3):
        client.get("/api/export-jobs?clientId=not-an-actor")
    events = rows(app, "usage_events", "operation_id=?", (job_id,))
    assert [event["phase"] for event in events] == ["accepted", "started", "finished"]
    assert events[-1]["outcome"] == "success" and events[-1]["duration_ms"] >= 0
    assert all(event["request_id"] == accepted.headers["X-Request-Id"] for event in events)
    assert all(event["flow_instance_id"] == source["id"] for event in events)
    assert all(event["request_owner"] == "unknown" for event in events)
    assert json.loads(events[-1]["properties_json"])["output_bytes"] > 0
    serialized = json.dumps(events)
    assert str(tmp_path) not in serialized and "not-an-actor" not in serialized and "do-not-store" not in serialized

    app.state.file_export_jobs.max_concurrent_jobs = 0
    queued = client.post("/api/geometry-preview/export-jobs", json={**payload, "outputPath": str(tmp_path / "cancel.json")}).json()["job"]
    assert client.post(f"/api/export-jobs/{queued['jobId']}/cancel", json={"clientId": "not-an-actor"}).status_code == 200
    cancelled = rows(app, "usage_events", "operation_id=? AND event_name='export'", (queued["jobId"],))
    assert [event["phase"] for event in cancelled] == ["accepted", "finished"]
    assert cancelled[-1]["outcome"] == "cancelled"

    app.state.file_export_jobs.max_concurrent_jobs = 1
    with mock.patch("process_flow_api.file_export_jobs._write_json_export", side_effect=RuntimeError("private-path")):
        failed = client.post("/api/geometry-preview/export-jobs", json={**payload, "outputPath": str(tmp_path / "fail.json")}).json()["job"]
        assert wait_job(client, failed["jobId"])["status"] == "failed"
    terminal = rows(app, "usage_events", "operation_id=? AND phase='finished'", (failed["jobId"],))
    assert len(terminal) == 1 and terminal[0]["outcome"] == "failure"
    assert terminal[0]["error_code"] == "EXPORT_FAILED"
    assert "private-path" not in json.dumps(terminal)


def test_future_authenticated_owner_and_export_original_owner(tmp_path):
    actor = {"id": "stable-user-123"}
    app = create_app(db_path=tmp_path / "business.sqlite3")
    class TrustedAuth:
        def __init__(self, app):
            self.app = app
        async def __call__(self, scope, receive, send):
            scope.setdefault("state", {})["authenticated_user_id"] = actor["id"]
            await self.app(scope, receive, send)
    app.add_middleware(TrustedAuth)
    with TestClient(app) as client:
        app.state.file_export_jobs.max_concurrent_jobs = 0
        response = client.post("/api/geometry-preview/export-jobs", json={
            "kind": "json", "clientId": "not-an-actor", "outputPath": str(tmp_path / "owner.json"),
            "geometryEntityJson": {"test": True},
        })
        job_id = response.json()["job"]["jobId"]
        actor["id"] = "different-polling-user"
        client.post(f"/api/export-jobs/{job_id}/cancel", json={"clientId": "not-an-actor"})
        events = rows(app, "usage_events", "event_name='export'")
        assert all(row["request_owner"] == "stable-user-123" for row in events)
        requests = rows(app, "api_requests")
        assert [row["request_owner"] for row in requests] == ["stable-user-123", "different-polling-user"]
    app.state.store.close()


def test_writer_dedup_restart_and_schema_preservation(tmp_path):
    path = tmp_path / "analytics.sqlite3"
    recorder = AnalyticsRecorder(path)
    recorder.start()
    origin = {**recorder.common("dataset-test"), "request_id": "submit", "source_kind": "geometry"}
    recorder.event(origin, event_name="export", phase="accepted", operation_id="unfinished-job")
    recorder.event(origin, event_name="export", phase="accepted", operation_id="unfinished-job")
    assert recorder.flush()
    recorder.close()
    for _ in range(2):
        reopened = AnalyticsRecorder(path)
        reopened.start()
        reopened.close()
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT count(*) FROM usage_events").fetchone()[0] == 2
        assert connection.execute("SELECT outcome,error_code FROM usage_events WHERE phase='finished'").fetchone() == ("unknown", "SERVER_RESTART")
        connection.execute("UPDATE analytics_metadata SET value='99' WHERE key='schema_version'")
    unsupported = AnalyticsRecorder(path)
    unsupported.start()
    unsupported.record_request(request_record(unsupported))
    assert unsupported.flush()
    assert unsupported.dropped_records == 1
    unsupported.close()
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT count(*) FROM usage_events").fetchone()[0] == 2
        assert connection.execute("SELECT value FROM analytics_metadata WHERE key='schema_version'").fetchone()[0] == "99"


def test_database_unavailable_does_not_block_service(tmp_path):
    blocked = tmp_path / "not-a-directory"
    blocked.write_text("block")
    app = create_app(db_path=tmp_path / "business.sqlite3", analytics_db_path=blocked / "analytics.sqlite3")
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.post("/api/reset").status_code == 200
        assert app.state.analytics.flush()
        assert app.state.analytics.dropped_records >= 3
    app.state.store.close()


def test_queue_overflow_and_write_failure_leave_recovery_gap(tmp_path):
    recorder = AnalyticsRecorder(tmp_path / "analytics.sqlite3", queue_size=1)
    recorder.record_request(request_record(recorder, "kept"))
    recorder.record_request(request_record(recorder, "dropped"))
    assert recorder.dropped_records == 1
    recorder.start()
    assert recorder.flush()
    # Simulate a failed batch transaction (including SQLITE_FULL/SQLITE_BUSY).
    original = recorder._write_batch
    called = threading.Event()
    def fail_once(connection, batch):
        if batch and not called.is_set():
            called.set()
            raise sqlite3.OperationalError("disk full; private path")
        return original(connection, batch)
    with mock.patch.object(recorder, "_write_batch", side_effect=fail_once):
        recorder.record_request(request_record(recorder, "write-failed"))
        assert recorder.flush()
        assert called.is_set()
    recorder.record_request(request_record(recorder, "recovered"))
    assert recorder.flush()
    recorder.close()
    with sqlite3.connect(recorder.db_path) as connection:
        assert connection.execute("SELECT request_id FROM api_requests ORDER BY request_id").fetchall() == [("kept",), ("recovered",)]
        gaps = connection.execute("SELECT properties_json FROM usage_events WHERE event_name='analytics.gap'").fetchall()
        assert sum(json.loads(row[0])["lost_record_count"] for row in gaps) == 2


def test_backup_restore_inspection_and_queries(service, tmp_path, capsys):
    app, client = service
    client.get("/api/health")
    assert app.state.analytics.flush()
    db = app.state.analytics.db_path
    backup = tmp_path / "snapshot.sqlite3"
    maintenance(["--db", str(db), "backup", "--output", str(backup)])
    restored = tmp_path / "restored.sqlite3"
    maintenance(["--db", str(restored), "restore", "--source", str(backup), "--offline"])
    maintenance(["--db", str(restored), "inspect"])
    report = json.loads(capsys.readouterr().out)
    assert report["api_requests"]["rows"] == 1
    assert report["integrity"] == "ok"
    queries = Path(__file__).resolve().parents[3] / "docs/reference/analytics-queries.sql"
    with sqlite3.connect(restored) as connection:
        connection.executescript(queries.read_text())
    with pytest.raises(SystemExit):
        maintenance(["--db", str(restored), "restore", "--source", str(backup), "--offline"])
    Path(str(restored) + "-wal").touch()
    with pytest.raises(SystemExit):
        maintenance(["--db", str(restored), "restore", "--source", str(backup), "--offline", "--replace"])


def test_disconnect_and_cancellation_are_recorded_without_payload(tmp_path):
    recorder = AnalyticsRecorder(tmp_path / "analytics.sqlite3")
    recorder.start()
    class Store:
        dataset_id = "dataset-test"
    async def disconnected(scope, receive, send):
        message = await receive()
        assert message["type"] == "http.disconnect"
        raise ClientDisconnect()
    async def receive():
        return {"type": "http.disconnect"}
    async def send(message):
        raise AssertionError("Do not respond on a disconnected connection")
    middleware = AnalyticsMiddleware(disconnected, recorder=recorder, store=Store())
    with pytest.raises(ClientDisconnect):
        asyncio.run(middleware({"type": "http", "method": "POST", "headers": []}, receive, send))
    async def cancelled(scope, receive, send):
        raise asyncio.CancelledError()
    middleware = AnalyticsMiddleware(cancelled, recorder=recorder, store=Store())
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(middleware({"type": "http", "method": "POST", "headers": []}, receive, send))
    assert recorder.flush()
    recorder.close()
    with sqlite3.connect(recorder.db_path) as connection:
        records = connection.execute("SELECT completion_state,status_code,error_code FROM api_requests").fetchall()
        assert records == [("disconnected", None, "REQUEST_INTERRUPTED")] * 2
    assert request_context.get() is None


def test_daily_backups_are_consistent_retained_and_not_overwritten(tmp_path):
    recorder = AnalyticsRecorder(tmp_path / "analytics.sqlite3")
    connection = recorder._connect()
    try:
        recorder._insert(connection, "api_requests", request_record(recorder, "before-backup"))
        connection.commit()
        seed = tmp_path / "seed.sqlite3"
        consistent_backup(connection, seed)
        recorder.backup_directory.mkdir()
        today = datetime.now(UTC)
        for days_ago in range(1, 36):
            day = (today - timedelta(days=days_ago)).strftime("%Y-%m-%d")
            (recorder.backup_directory / f"analytics-{day}.sqlite3").write_bytes(seed.read_bytes())
        recorder._backup_if_due(connection)
        backups = sorted(recorder.backup_directory.glob("*.sqlite3"))
        assert len(backups) == 30
        current = recorder.backup_directory / f"analytics-{today.strftime('%Y-%m-%d')}.sqlite3"
        original_bytes = current.read_bytes()
        recorder._insert(connection, "api_requests", request_record(recorder, "after-backup"))
        connection.commit()
        recorder._last_backup_date = None
        recorder._backup_if_due(connection)
        assert current.read_bytes() == original_bytes
        with sqlite3.connect(current) as backup:
            assert backup.execute("PRAGMA quick_check").fetchone()[0] == "ok"
            assert backup.execute("SELECT count(*) FROM api_requests").fetchone()[0] == 1
        assert not list(recorder.backup_directory.glob("*.tmp*"))
    finally:
        connection.close()


def test_app_restart_preserves_records_dataset_and_unknown_owners(tmp_path):
    db = tmp_path / "business.sqlite3"
    first = create_app(db_path=db)
    with TestClient(first) as client:
        client.get("/api/health")
        first_dataset = first.state.store.dataset_id
    first.state.store.close()
    second = create_app(db_path=db)
    with TestClient(second) as client:
        client.get("/api/health")
        records = rows(second, "api_requests")
        assert len(records) == 2
        assert {row["dataset_id"] for row in records} == {first_dataset}
        assert {row["request_owner"] for row in records} == {"unknown"}
        assert len({row["server_instance_id"] for row in records}) == 2
    second.state.store.close()
