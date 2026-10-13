from __future__ import annotations

import copy
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from flow_requests import instance_create_payload, template_create_payload
from process_flow_api.fixture_export import build_fixture_archive
from process_flow_api.main import create_app
from process_flow_api.repository import DuplicateItemError, SQLiteStore


@pytest.fixture
def service(tmp_path):
    app = create_app(db_path=tmp_path / "identity.sqlite3")
    with TestClient(app) as client:
        before = client.get("/api/bootstrap").json()
        instance = before["processFlowInstances"][0]
        template = next(item for item in before["processFlowTemplates"]
                        if item["id"] == instance["processFlowTemplateId"])
        yield app, client, before, template, instance
    app.state.store.close()


@pytest.mark.parametrize("kind", ["templates", "instances"])
def test_duplicate_create_is_rejected_but_new_name_or_version_is_allowed(service, kind):
    app, client, before, template, instance = service
    request = template_create_payload(template) if kind == "templates" else instance_create_payload(instance)
    route = f"/api/process-flow-{kind}"
    response = client.post(route, json=request)
    assert response.status_code == 409, response.text
    assert "name and version already exists" in response.json()["message"]
    assert client.get("/api/bootstrap").json() == before
    for change in ({"version": "V-next"}, {"name": "Another name"}):
        response = client.post(route, json={**request, **change})
        assert response.status_code == 201, response.text
        assert client.post(route, json={**request, **change}).status_code == 409


def test_template_rename_checks_other_records_and_allows_self_update(service):
    app, client, before, template, instance = service
    created = client.post("/api/process-flow-templates", json={
        **template_create_payload(template), "name": "Rename source",
    }).json()
    route = f"/api/process-flow-templates/{created['id']}"
    response = client.put(route, json={**created, "description": "Updated"})
    assert response.status_code == 200, response.text
    saved = response.json()
    response = client.put(route, json={**saved, "name": template["name"]})
    assert response.status_code == 409, response.text
    assert client.get(route).json() == saved


@pytest.mark.parametrize("collision", ["template", "instance"])
def test_combined_create_rolls_back_duplicate_identity(service, collision):
    app, client, before, template, instance = service
    template_request = {**template_create_payload(template), "name": "Combined template"}
    instance_request = {**instance_create_payload(instance, for_new_template=True), "name": "Combined instance"}
    if collision == "template":
        template_request["name"] = template["name"]
    else:
        instance_request["name"] = instance["name"]
    # Materialization must also roll back when the instance identity conflicts.
    binding_id = next(iter(instance_request["inputBindings"]))
    instance_request["inputBindings"] = copy.deepcopy(instance_request["inputBindings"])
    original_geometry_id = instance_request["inputBindings"][binding_id]["geometryId"]
    geometry = next(item for item in before["geometries"] if item["id"] == original_geometry_id)
    instance_request["inputBindings"][binding_id] = {"kind": "embedded", "localId": "local"}
    instance_request["embeddedGeometries"] = {"local": {k: v for k, v in geometry.items() if k != "id"}}
    response = client.post("/api/process-flow-template-instances", json={
        "processFlowTemplate": template_request, "processFlowInstance": instance_request,
    })
    assert response.status_code == 409, response.text
    assert client.get("/api/bootstrap").json() == before


@pytest.mark.parametrize("collection", ["processFlowTemplates", "processFlowInstances"])
def test_fixture_import_rejects_duplicate_identity_without_reset(service, collection):
    app, client, before, template, instance = service
    fixtures = copy.deepcopy(before)
    fixtures[collection].append({**fixtures[collection][0], "id": "another-id"})
    response = client.post("/api/reset-from-zip", content=build_fixture_archive(fixtures),
                           headers={"Content-Type": "application/zip"})
    assert response.status_code == 400, response.text
    assert "duplicate name and version" in response.text
    assert client.get("/api/bootstrap").json() == before


@pytest.mark.parametrize("kind", ["template", "instance"])
def test_unique_index_enforces_identity_across_store_connections(tmp_path, kind):
    path = tmp_path / "two-connections.sqlite3"
    first, second = SQLiteStore(path), SQLiteStore(path)
    try:
        payload = {"id": "first", "name": "Same", "version": "V1"}
        getattr(first, f"insert_process_flow_{kind}")(payload)
        with pytest.raises(DuplicateItemError, match="name and version already exists"):
            getattr(second, f"insert_process_flow_{kind}")({**payload, "id": "second"})
        # Raw writes are protected too, independently of application checks.
        with second._connection, pytest.raises(sqlite3.IntegrityError):
            if kind == "template":
                second._connection.execute("INSERT INTO process_flow_templates SELECT 'raw-copy', name, version, owner, payload FROM process_flow_templates")
            else:
                second._connection.execute("INSERT INTO process_flow_instances SELECT 'raw-copy', name, process_flow_template_id, payload FROM process_flow_instances")
    finally:
        first.close()
        second.close()


def test_disabled_template_still_reserves_its_name_and_version(service):
    app, client, before, template, instance = service
    response = client.put(f"/api/process-flow-templates/{template['id']}",
                          json={**template, "status": "disabled"})
    assert response.status_code == 200, response.text
    response = client.post("/api/process-flow-templates", json=template_create_payload(template))
    assert response.status_code == 409, response.text
    assert "name and version already exists" in response.json()["message"]


@pytest.mark.parametrize("duplicate_table", [None, "process_flow_templates", "process_flow_instances"])
def test_v10_migration_preserves_records_and_reports_existing_duplicates(tmp_path, duplicate_table):
    path = tmp_path / "v10.sqlite3"
    store = SQLiteStore(path)
    template = {"id": "template", "name": "Flow", "version": "V1", "owner": "test"}
    instance = {"id": "instance", "name": "Product", "version": "V1", "processFlowTemplateId": "template"}
    store.insert_process_flow_template(template)
    store.insert_process_flow_instance(instance)
    dataset_id = store.dataset_id
    with store._connection:
        for table in ("process_flow_templates", "process_flow_instances"):
            store._connection.execute(f"DROP INDEX idx_{table}_name_version")
        store._connection.execute("UPDATE schema_metadata SET value = '10' WHERE key = 'databaseSchemaVersion'")
        if duplicate_table:
            source = template if duplicate_table == "process_flow_templates" else instance
            getattr(store, "insert_process_flow_template" if duplicate_table == "process_flow_templates"
                    else "insert_process_flow_instance")({**source, "id": "duplicate"})
    store.close()
    if duplicate_table:
        with pytest.raises(RuntimeError, match=f"{duplicate_table}.*version='V1'.*duplicate"):
            SQLiteStore(path)
        with sqlite3.connect(path) as connection:
            assert connection.execute("SELECT value FROM schema_metadata WHERE key = 'databaseSchemaVersion'").fetchone()[0] == "10"
            assert connection.execute(f"SELECT COUNT(*) FROM {duplicate_table}").fetchone()[0] == 2
            # No partial unique indexes were installed on the other collection.
            assert connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE '%_name_version'").fetchone()[0] == 0
            assert json.loads(connection.execute(f"SELECT payload FROM {duplicate_table} WHERE id='duplicate'").fetchone()[0])["version"] == "V1"
        return
    migrated = SQLiteStore(path)
    try:
        assert migrated.dataset_id == dataset_id
        assert migrated.get_process_flow_template("template") == {**template, "status": "enabled"}
        assert migrated.get_process_flow_instance("instance") == instance
        for kind, source in (("template", template), ("instance", instance)):
            with pytest.raises(DuplicateItemError):
                getattr(migrated, f"insert_process_flow_{kind}")({**source, "id": "duplicate"})
    finally:
        migrated.close()
