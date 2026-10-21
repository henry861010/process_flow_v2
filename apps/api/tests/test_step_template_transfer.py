from __future__ import annotations

import copy
from unittest import mock

import pytest
from fastapi.testclient import TestClient

import process_flow_api.main as api_main
from process_flow_api.main import create_app
from process_flow_api.seed import load_seed_fixtures


@pytest.fixture
def service(tmp_path):
    app = create_app(db_path=tmp_path / "transfer.sqlite3")
    with TestClient(app) as client:
        yield client, app.state.store
    app.state.store.close()


def steps(client):
    return {item["id"]: item for item in client.get("/api/process-step-templates").json()}


def make_draft(client, kind, step=None):
    flow = client.get("/api/bootstrap").json()["processFlowTemplates"][0]
    body = {"user": "another.engineer", "name": "Unfinished work", "state": {
        "metadata": {"name": "", "version": "", "owner": "", "description": ""},
        "configuration": {"inputBindings": {}, "stepConfigurations": {}, "embeddedGeometries": {}},
    }}
    if kind == "instance":
        body["processFlowTemplateId"] = flow["id"]
    else:
        body["state"].update(nodes=[{
            "id": "unfinished", "kind": "processStep", "position": {"x": 0, "y": 0},
            "stepRef": {"stepRefId": "unfinished", "processStepTemplateId": step["id"]},
        }], edges=[], viewport={"x": 0, "y": 0, "zoom": 1})
    response = client.post(f"/api/process-flow-{kind}-drafts", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_export_downloads_all_current_steps_and_round_trips(service):
    client, _ = service
    source = steps(client)["step_tpl_molding"]
    response = client.post("/api/process-step-templates/import", json=[{
        **source, "status": "disabled", "description": "目前模板說明",
    }])
    assert response.status_code == 200, response.text
    before = client.get("/api/bootstrap").json()
    exported = client.get("/api/process-step-templates/export")
    assert exported.status_code == 200
    assert exported.headers["content-type"] == "application/json"
    assert exported.headers["cache-control"] == "no-store"
    assert "process-step-templates-" in exported.headers["content-disposition"]
    assert exported.headers["content-disposition"].endswith('.json"')
    assert "目前模板說明" in exported.content.decode("utf-8")
    assert b"\n  {" in exported.content
    assert exported.json() == before["processStepTemplates"]
    imported = client.post("/api/process-step-templates/import", content=exported.content,
                           headers={"Content-Type": "application/json; charset=utf-8"})
    assert imported.status_code == 200, imported.text
    assert imported.json()["createdCount"] == 0
    assert imported.json()["updatedCount"] == len(exported.json())
    assert client.get("/api/bootstrap").json() == before


def test_merge_fully_overwrites_by_id_and_preserves_other_data_and_drafts(service):
    client, store = service
    original = steps(client)
    template_draft = make_draft(client, "template", original["step_tpl_molding"])
    before = client.get("/api/bootstrap").json()
    dataset_id = store.dataset_id
    replacement = copy.deepcopy(original["step_tpl_ecl"])
    replacement.update(name="Replacement", version="V9", description="Replaced", parameterDefinitions=[])
    added = {**replacement, "id": "step_tpl_new"}
    response = client.post("/api/process-step-templates/import", json=[replacement, added])
    assert response.status_code == 200, response.text
    assert response.json()["createdCount"] == 1
    assert response.json()["updatedCount"] == 1
    after_steps = steps(client)
    assert after_steps[replacement["id"]] == replacement
    assert after_steps[added["id"]] == added
    for id_, step in original.items():
        if id_ != replacement["id"]:
            assert after_steps[id_] == step
    after = client.get("/api/bootstrap").json()
    assert {key: value for key, value in after.items() if key != "processStepTemplates"} == {
        key: value for key, value in before.items() if key != "processStepTemplates"
    }
    assert store.get_editor_draft("template", template_draft["id"]) == template_draft
    assert store.dataset_id == dataset_id


def test_referenced_steps_allow_description_metadata_order_and_recursive_defaults(service):
    client, _ = service
    original = steps(client)
    molding = copy.deepcopy(original["step_tpl_molding"])
    molding.update(status="disabled", owner="new.owner", category="custom", program="custom.module",
                   description="New description")
    molding["parameterDefinitions"][1]["defaultValue"] = 123
    pnp = copy.deepcopy(original["step_tpl_pnp"])
    pnp["inputPorts"].reverse()
    rdl = copy.deepcopy(original["step_tpl_rdl"])

    def remove_defaults(definitions):
        for definition in definitions:
            definition.pop("defaultValue", None)
            remove_defaults(definition.get("repeatDefinition", {}).get("itemParameterDefinitions", []))

    remove_defaults(rdl["parameterDefinitions"])
    response = client.post("/api/process-step-templates/import", json=[molding, pnp, rdl])
    assert response.status_code == 200, response.text
    for expected in [molding, pnp, rdl]:
        assert steps(client)[expected["id"]] == expected
    # Description remains locked on the existing single-step PUT endpoint.
    changed = {**molding, "description": "Another description"}
    assert client.put(f"/api/process-step-templates/{molding['id']}", json=changed).status_code == 409


@pytest.mark.parametrize("change", [
    {"name": "Changed identity"}, {"version": "V9"}, {"parameterDefinitions": []},
])
def test_referenced_structure_conflict_rejects_entire_batch(service, change):
    client, _ = service
    original = steps(client)
    source = original["step_tpl_molding"]
    flow = next(flow for flow in client.get("/api/bootstrap").json()["processFlowTemplates"]
                if any(ref["processStepTemplateId"] == source["id"] for ref in flow["stepRefs"]))
    response = client.post("/api/process-step-templates/import", json=[
        {**original["step_tpl_ecl"], "id": "must_not_be_inserted"}, {**source, **change},
    ])
    assert response.status_code == 409, response.text
    assert source["id"] in response.json()["message"]
    assert flow["id"] in response.json()["message"]
    assert steps(client) == original


def test_incomplete_template_draft_from_any_user_protects_step_structure(service):
    client, _ = service
    source = steps(client)["step_tpl_ecl"]  # Not referenced by saved flows.
    draft = make_draft(client, "template", source)
    response = client.post("/api/process-step-templates/import", json=[{**source, "parameterDefinitions": []}])
    assert response.status_code == 409, response.text
    assert draft["id"] in response.json()["message"]
    assert steps(client)[source["id"]] == source
    allowed = client.post("/api/process-step-templates/import", json=[{**source, "description": "Draft-safe edit"}])
    assert allowed.status_code == 200, allowed.text


@pytest.mark.parametrize("step_id", ["step_tpl_pnp", "step_tpl_rdl"])
def test_referenced_port_and_nested_parameter_structure_changes_are_locked(service, step_id):
    client, _ = service
    before = steps(client)
    changed = copy.deepcopy(before[step_id])
    if step_id == "step_tpl_pnp":
        changed["inputPorts"][1]["name"] = "Changed auxiliary port"
    else:
        nested = changed["parameterDefinitions"][0]["repeatDefinition"]["itemParameterDefinitions"]
        nested[0]["name"] = "Changed nested parameter"
    response = client.post("/api/process-step-templates/import", json=[changed])
    assert response.status_code == 409, response.text
    assert steps(client) == before


def test_accepts_packaged_fixture_and_empty_array_without_resetting_dataset(service):
    client, store = service
    dataset_id = store.dataset_id
    response = client.post("/api/process-step-templates/import", json=load_seed_fixtures()["processStepTemplates"])
    assert response.status_code == 200, response.text
    before = steps(client)
    empty = client.post("/api/process-step-templates/import", json=[])
    assert empty.json() == {"processStepTemplates": list(before.values()), "createdCount": 0, "updatedCount": 0}
    assert store.dataset_id == dataset_id


@pytest.mark.parametrize("content", [b"not JSON", b"{}", b"[null]", b'[1]', b'[{"id":"broken"}]',
                                     b"[NaN]", b"[Infinity]", b"\xff"])
def test_bad_json_is_rejected_without_writes(service, content):
    client, _ = service
    before = client.get("/api/bootstrap").json()
    response = client.post("/api/process-step-templates/import", content=content,
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 400, response.text
    assert client.get("/api/bootstrap").json() == before


def test_duplicate_ids_and_semantically_invalid_ports_and_defaults_are_rejected(service):
    client, _ = service
    source = steps(client)["step_tpl_molding"]
    invalid_ports = {**source, "inputPorts": [source["inputPorts"][0]] * 2}
    invalid_default = copy.deepcopy(source)
    invalid_default["parameterDefinitions"][1]["defaultValue"] = "not a number"
    before = steps(client)
    for items in [[source, source], [invalid_ports], [invalid_default]]:
        response = client.post("/api/process-step-templates/import", json=items)
        assert response.status_code == 400, response.text
        assert steps(client) == before


def test_import_enforces_media_type_and_both_declared_and_streamed_size_limits(service):
    client, _ = service
    before = steps(client)
    response = client.post("/api/process-step-templates/import", content=b"[]",
                           headers={"Content-Type": "text/plain"})
    assert response.status_code == 415
    with mock.patch.object(api_main, "MAX_STEP_TEMPLATE_JSON_BYTES", 10):
        for headers in [{}, {"Content-Length": "1"}]:
            response = client.post("/api/process-step-templates/import", content=b" " * 11,
                                   headers={"Content-Type": "application/json", **headers})
            assert response.status_code == 413, response.text
    assert steps(client) == before


def test_mid_batch_write_failure_rolls_back_updates_and_inserts(service):
    client, store = service
    before = client.get("/api/bootstrap").json()
    source = steps(client)["step_tpl_ecl"]
    original_upsert = store._upsert_process_step_template_in_transaction
    calls = 0

    def fail_third_write(item):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise RuntimeError("Write failed")
        original_upsert(item)

    with mock.patch.object(store, "_upsert_process_step_template_in_transaction", side_effect=fail_third_write):
        with pytest.raises(RuntimeError, match="Write failed"):
            client.post("/api/process-step-templates/import", json=[
                {**source, "description": "Must roll back"},
                {**source, "id": "also_rolled_back"},
                {**source, "id": "fails"},
            ])
    assert calls == 3
    assert client.get("/api/bootstrap").json() == before
