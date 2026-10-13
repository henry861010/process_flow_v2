from __future__ import annotations

import copy
import re
import sqlite3
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from flow_requests import instance_create_payload, template_create_payload
from flow_requests import instance_create_payload, template_create_payload
from process_flow_api.main import create_app


@pytest.fixture
def service(tmp_path):
    app = create_app(db_path=tmp_path / "generated-ids.sqlite3")
    with TestClient(app) as client:
        snapshot = client.get("/api/bootstrap").json()
        instance = snapshot["processFlowInstances"][0]
        template = next(item for item in snapshot["processFlowTemplates"]
                        if item["id"] == instance["processFlowTemplateId"])
        yield app, client, snapshot, template, instance
    app.state.store.close()


@pytest.mark.parametrize("kind", ["templates", "instances"])
def test_create_assigns_unique_ids_and_preserves_existing_records(service, kind):
    app, client, snapshot, template, instance = service
    request = template_create_payload(template) if kind == "templates" else instance_create_payload(instance)
    route = f"/api/process-flow-{kind}"
    created = [client.post(route, json={**request, "name": f"Generated {kind} {index}"}) for index in range(2)]
    assert all(response.status_code == 201 for response in created)
    identifiers = [response.json()["id"] for response in created]
    assert identifiers[0] != identifiers[1]
    assert all(re.fullmatch(r"[0-9a-f]{32}", identifier) for identifier in identifiers)
    for response in created:
        assert client.get(f"{route}/{response.json()['id']}").json() == response.json()
    for original in snapshot["processFlowTemplates" if kind == "templates" else "processFlowInstances"]:
        assert client.get(f"{route}/{original['id']}").json() == original
    assert app.state.analytics.flush()
    with sqlite3.connect(app.state.analytics.db_path) as connection:
        column = "flow_template_id" if kind == "templates" else "flow_instance_id"
        event = "flow_template.create" if kind == "templates" else "flow_instance.create"
        recorded = [row[0] for row in connection.execute(
            f"SELECT {column} FROM usage_events WHERE event_name = ? AND outcome = 'success' ORDER BY rowid",
            (event,),
        )]
    assert recorded == identifiers


@pytest.mark.parametrize("identifier", ["client-selected-id", "", None])
def test_create_rejects_client_ids_in_all_request_shapes(service, identifier):
    app, client, before, template, instance = service
    template_request = template_create_payload(template)
    instance_request = instance_create_payload(instance)
    combined_request = {"processFlowTemplate": template_request,
                        "processFlowInstance": instance_create_payload(instance, for_new_template=True)}
    requests = [
        ("/api/process-flow-templates", {**template_request, "id": identifier}),
        ("/api/process-flow-instances", {**instance_request, "id": identifier}),
        ("/api/process-flow-template-instances", {
            **combined_request, "processFlowTemplate": {**template_request, "id": identifier},
        }),
        ("/api/process-flow-template-instances", {
            **combined_request, "processFlowInstance": {**combined_request["processFlowInstance"], "id": identifier},
        }),
        ("/api/process-flow-template-instances", {
            **combined_request,
            "processFlowInstance": {**combined_request["processFlowInstance"], "processFlowTemplateId": identifier},
        }),
    ]
    for route, body in requests:
        response = client.post(route, json=body)
        assert response.status_code == 422, response.text
    assert client.get("/api/bootstrap").json() == before


def test_combined_create_assigns_relationship_and_analytics_ids(service):
    app, client, before, template, instance = service
    request = {"processFlowTemplate": template_create_payload(template),
               "processFlowInstance": instance_create_payload(instance, for_new_template=True)}
    created = [client.post("/api/process-flow-template-instances", json={
        "processFlowTemplate": {**request["processFlowTemplate"], "name": f"Generated template {index}"},
        "processFlowInstance": {**request["processFlowInstance"], "name": f"Generated instance {index}"},
    }) for index in range(2)]
    for response in created:
        assert response.status_code == 201, response.text
        saved_template = response.json()["processFlowTemplate"]
        saved_instance = response.json()["processFlowInstance"]
        assert re.fullmatch(r"[0-9a-f]{32}", saved_template["id"])
        assert re.fullmatch(r"[0-9a-f]{32}", saved_instance["id"])
        assert saved_instance["processFlowTemplateId"] == saved_template["id"]
        assert client.get(f"/api/process-flow-instances/{saved_instance['id']}").json() == saved_instance
    assert created[0].json()["processFlowTemplate"]["id"] != created[1].json()["processFlowTemplate"]["id"]
    assert created[0].json()["processFlowInstance"]["id"] != created[1].json()["processFlowInstance"]["id"]
    assert app.state.analytics.flush()
    with sqlite3.connect(app.state.analytics.db_path) as connection:
        events = connection.execute(
            "SELECT event_name, flow_template_id, flow_instance_id FROM usage_events "
            "WHERE outcome = 'success' AND event_name IN ('flow_template.create', 'flow_instance.create') ORDER BY rowid"
        ).fetchall()
    expected = []
    for response in created:
        result = response.json()
        expected.extend((event, result["processFlowTemplate"]["id"], result["processFlowInstance"]["id"])
                        for event in ("flow_template.create", "flow_instance.create"))
    assert events == expected


@pytest.mark.parametrize("kind", ["template", "instance", "combined-template", "combined-instance"])
def test_id_collision_rolls_back_all_records(service, kind):
    app, client, before, template, instance = service
    instance_request = {**instance_create_payload(instance), "name": "ID collision instance"}
    geometry = next(item for item in before["geometries"] if item["id"] == "hbm3_8hi")
    instance_request["inputBindings"] = copy.deepcopy(instance_request["inputBindings"])
    instance_request["inputBindings"]["incoming_hbm"] = {"kind": "embedded", "localId": "collision-geometry"}
    instance_request["embeddedGeometries"] = {
        "collision-geometry": {key: value for key, value in geometry.items() if key != "id"},
    }
    if kind == "template":
        route, request = "/api/process-flow-templates", {**template_create_payload(template), "name": "ID collision template"}
    elif kind == "instance":
        route, request = "/api/process-flow-instances", instance_request
    else:
        route = "/api/process-flow-template-instances"
        request = {"processFlowTemplate": {**template_create_payload(template), "name": "ID collision template"},
                   "processFlowInstance": instance_create_payload(instance_request, for_new_template=True)}
    resource = "template" if kind.endswith("template") else "instance"
    existing_id = template["id"] if resource == "template" else instance["id"]
    with mock.patch(f"process_flow_api.services.generated_flow_{resource}_id", return_value=existing_id):
        response = client.post(route, json=request)
    assert response.status_code == 409, response.text
    assert client.get("/api/bootstrap").json() == before
