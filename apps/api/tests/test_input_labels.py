"""Flow-local geometry labels survive persistence without changing geometry."""
import asyncio
import copy
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from process_flow_api.fixture_export import build_fixture_archive, load_fixture_archive
from process_flow_api.main import create_app
from process_flow_api.models import GeometryPreviewRequest
from process_flow_api.services import (
    materialize_preview_snapshots, prepare_preview_execution, resolve_preview_request,
)


class InputLabelTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(db_path=":memory:")
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()
        self.bootstrap = self.client.get("/api/bootstrap").json()
        source = self.bootstrap["processFlows"][0]
        self.flow = {key: copy.deepcopy(value) for key, value in source.items() if key not in {"id", "revision"}}
        self.flow["name"] = "Two DMY generators"
        for index, item in enumerate(self.flow["definition"]["flowInputs"]):
            item.update(name="DMY input", inputLabel=["Lower DMY", "Upper DMY"][index],
                        geometryConstraints={"categories": ["die.wafer-dmy"]})
            self.flow["configuration"]["inputBindings"][item["flowInputId"]] = {
                "kind": "generator", "generatorId": "wafer-dmy", "generatorVersion": 1,
                "parameters": {"siThickness": 100 + index * 100, "siMaterial": "si"},
            }

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.app.state.store.close()

    def test_flow_round_trip_isolation_duplicates_and_empty_labels(self):
        self.flow["definition"]["flowInputs"][0]["inputLabel"] = "  Lower DMY  "
        with patch.object(self.app.state.geometry_generators, "generate", side_effect=AssertionError("save must not generate")):
            response = self.client.post("/api/process-flows", json=self.flow)
        self.assertEqual(response.status_code, 201, response.text)
        saved = response.json()
        original_configuration = copy.deepcopy(saved["configuration"])
        self.assertEqual(saved["configuration"]["inputBindings"], self.flow["configuration"]["inputBindings"])
        self.assertEqual(saved["definition"]["flowInputs"][0]["inputLabel"], "Lower DMY")
        route = "/api/process-flows/" + saved["id"]
        for value in ("Upper DMY", "", "   ", None):
            body = {key: copy.deepcopy(item) for key, item in saved.items() if key != "id"}
            body["definition"]["flowInputs"][0]["inputLabel"] = value
            response = self.client.put(route, json=body)
            self.assertEqual(response.status_code, 200, response.text)
            saved = response.json()
            self.assertEqual(self.client.get(route).json(), saved)
            first, second = saved["definition"]["flowInputs"]
            if value == "Upper DMY":
                self.assertEqual(first["inputLabel"], second["inputLabel"])
            else:
                self.assertNotIn("inputLabel", first)
            self.assertEqual(second["inputLabel"], "Upper DMY")
            self.assertEqual(first["name"], "DMY input")
            self.assertEqual(saved["configuration"], original_configuration)
            self.assertEqual(saved["definition"]["flowEdges"], self.flow["definition"]["flowEdges"])
        del body["definition"]["flowInputs"][0]["inputLabel"]
        body["revision"] = saved["revision"]
        self.assertEqual(self.client.put(route, json=body).status_code, 200)

    def test_draft_resume_commit_and_fixture_export_preserve_labels(self):
        state = {
            "metadata": {key: self.flow[key] for key in ("name", "version", "owner", "description")},
            "configuration": self.flow["configuration"],
            "nodes": [{"id": item["flowInputId"], "kind": "flowInput", "position": {"x": 0, "y": index * 180},
                       "definition": item} for index, item in enumerate(self.flow["definition"]["flowInputs"])],
            "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1},
        }
        response = self.client.post("/api/process-flow-drafts", json={
            "schemaVersion": 2, "name": "Label draft", "user": "RD", "state": state,
        })
        self.assertEqual(response.status_code, 201, response.text)
        draft = response.json()
        route = "/api/process-flow-drafts/" + draft["id"]
        resumed = self.client.get(route).json()
        self.assertEqual([node["definition"]["inputLabel"] for node in resumed["state"]["nodes"]],
                         ["Lower DMY", "Upper DMY"])
        result = self.client.post(route + "/commit", json={"revision": draft["revision"], "flow": self.flow})
        self.assertEqual(result.status_code, 200, result.text)
        saved = result.json()
        fixtures = {**self.bootstrap, "processFlows": [saved]}
        restored = load_fixture_archive(build_fixture_archive(fixtures))
        self.assertEqual(restored["processFlows"][0], saved)

    def test_preview_uses_custom_or_generator_label_without_changing_geometry(self):
        input_id = self.flow["definition"]["flowInputs"][0]["flowInputId"]
        snapshots = []
        for label, source_label, expected in (("Lower DMY", None, "Lower DMY"),
                                               (None, None, "DMY die generator"),
                                               ("Lower DMY", "Explicit title", "Explicit title")):
            self.flow["definition"]["flowInputs"][0]["inputLabel"] = label
            request = GeometryPreviewRequest.model_validate({
                "flow": {key: self.flow[key] for key in ("definition", "configuration")},
                "target": {"type": "flowInput", "flowInputId": input_id}, "sourceLabel": source_label,
            })
            context = resolve_preview_request(self.app.state.store, request)
            prepared = prepare_preview_execution(context, self.app.state.geometry_generators)
            snapshot, = asyncio.run(materialize_preview_snapshots(prepared))
            self.assertEqual(snapshot.label, expected)
            snapshots.append(snapshot)
        for snapshot in snapshots[1:]:
            self.assertEqual(snapshot.geometry_structure, snapshots[0].geometry_structure)
            self.assertEqual(snapshot.provenance, snapshots[0].provenance)
