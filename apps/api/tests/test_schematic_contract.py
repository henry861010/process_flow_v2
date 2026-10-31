from __future__ import annotations

import copy
import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient
from pydantic import ValidationError

from flow_requests import fixture_flow
from process_flow_api.main import create_app
from process_flow_api.models import PreviewSnapshot, SchematicDocument


def document_payload():
    style = {"itemId": "layer", "fill": "#abcdef", "stroke": "none", "strokeWidth": 0}
    return {
        "schemaVersion": 1,
        "unit": "custom-unit",
        "viewBox": [-20, -10, 100, 80],
        "shapes": [
            {**style, "id": "rect", "kind": "rect", "x": -2, "y": 0, "width": 0, "height": 10,
             "clip": {"x": -2, "y": 0, "width": 20, "height": 10,
                      "exclusions": [{"x": 1, "y": 0, "width": 0, "height": 10}]}},
            {**style, "id": "circle", "kind": "circle", "cx": 2, "cy": -3, "r": 0},
            {**style, "id": "path", "kind": "path", "points": [[0, 0], [0, 0], [-2, 3]], "closed": False},
        ],
        "items": [{"id": "layer", "label": "Layer", "material": "Si", "groupLabel": "Component",
                   "sourceIds": ["body-1", "body-2"], "zMin": -3, "zMax": -3, "thickness": 0}],
        "components": [{"id": "component", "label": "Component", "sourceIds": ["container"],
                        "x": -2, "y": -1, "width": 20, "height": 0}],
        "totalThickness": 0,
        "notes": ["Not to scale"],
        "warnings": [],
    }


def snapshot_payload(document):
    return {
        "snapshotId": "snapshot-id", "sourceKind": "flowInput", "label": "Input", "order": 0,
        "geometryHash": "geometry-hash", "geometryEntityJson": {"structure": {"root": {}}},
        "meshUrl": "/mesh", "sectionUrl": "/section", "schematic": document,
        "schematicWarnings": ["Existing notice"],
    }


class SchematicContractTests(unittest.TestCase):
    def test_neutral_shapes_round_trip_with_signed_coordinates_and_coincident_points(self):
        payload = document_payload()
        parsed = SchematicDocument.model_validate(payload)
        self.assertEqual(parsed.payload(), payload)
        self.assertEqual(parsed.unit, "custom-unit")

    def test_empty_path_and_zero_dimensions_are_valid(self):
        payload = document_payload()
        payload["shapes"][2]["points"] = []
        payload["shapes"][2].pop("closed")
        payload["viewBox"][2:] = [0, 0]
        path = SchematicDocument.model_validate(payload).shapes[2]
        self.assertEqual(path.points, [])
        self.assertFalse(path.closed)

    def test_invalid_shape_contracts_are_rejected(self):
        cases = [
            ("unknown primitive", lambda d: d["shapes"][0].update(kind="oval")),
            ("missing rect coordinate", lambda d: d["shapes"][0].pop("x")),
            ("cross-kind field", lambda d: d["shapes"][0].update(r=3)),
            ("non-finite x", lambda d: d["shapes"][0].update(x=math.nan)),
            ("coerced coordinate", lambda d: d["shapes"][0].update(x="2")),
            ("boolean coordinate", lambda d: d["shapes"][0].update(x=True)),
            ("negative width", lambda d: d["shapes"][0].update(width=-1)),
            ("negative stroke", lambda d: d["shapes"][0].update(strokeWidth=-1)),
            ("infinite center", lambda d: d["shapes"][1].update(cx=math.inf)),
            ("negative radius", lambda d: d["shapes"][1].update(r=-1)),
            ("invalid path point", lambda d: d["shapes"][2].update(points=[[0, 1, 2]])),
            ("non-finite path point", lambda d: d["shapes"][2].update(points=[[0, math.inf]])),
            ("negative clip size", lambda d: d["shapes"][0]["clip"]["exclusions"][0].update(height=-1)),
        ]
        for label, change in cases:
            with self.subTest(label=label):
                payload = document_payload()
                change(payload)
                with self.assertRaises(ValidationError):
                    SchematicDocument.model_validate(payload)

    def test_measurement_and_document_contracts_are_rejected_when_invalid(self):
        cases = [
            ("unknown version", lambda d: d.update(schemaVersion=2)),
            ("wrong viewBox size", lambda d: d.update(viewBox=[0, 0, 10])),
            ("negative viewBox size", lambda d: d.update(viewBox=[0, 0, -1, 10])),
            ("infinite thickness", lambda d: d.update(totalThickness=math.inf)),
            ("negative thickness", lambda d: d["items"][0].update(thickness=-1)),
            ("non-finite Z", lambda d: d["items"][0].update(zMin=math.nan)),
            ("reversed Z", lambda d: d["items"][0].update(zMin=1, zMax=0)),
            ("empty source ID", lambda d: d["items"][0].update(sourceIds=[""])),
            ("negative component size", lambda d: d["components"][0].update(height=-1)),
            ("process-specific field", lambda d: d.update(process="rdl")),
        ]
        for label, change in cases:
            with self.subTest(label=label):
                payload = document_payload()
                change(payload)
                with self.assertRaises(ValidationError):
                    SchematicDocument.model_validate(payload)

    def test_invalid_document_is_quarantined_without_mutating_source_or_geometry(self):
        document = document_payload()
        document["shapes"][0]["width"] = -1
        source = snapshot_payload(document)
        before = copy.deepcopy(source)
        snapshot = PreviewSnapshot.model_validate(source)
        self.assertIsNone(snapshot.schematic)
        self.assertEqual(snapshot.geometryEntityJson, before["geometryEntityJson"])
        self.assertEqual(snapshot.geometryHash, before["geometryHash"])
        self.assertEqual(snapshot.schematicWarnings[0], "Existing notice")
        self.assertIn("exports are still available", snapshot.schematicWarnings[-1])
        self.assertEqual(source, before)

    def test_missing_and_null_schematic_remain_compatible(self):
        source = snapshot_payload(None)
        self.assertIsNone(PreviewSnapshot.model_validate(source).schematic)
        source.pop("schematic")
        self.assertIsNone(PreviewSnapshot.model_validate(source).schematic)

    def test_invalid_builder_document_does_not_turn_session_into_http_500(self):
        with tempfile.TemporaryDirectory() as directory:
            app = create_app(db_path=Path(directory) / "test.sqlite3")
            try:
                with TestClient(app) as client:
                    bootstrap = client.post("/api/reset").json()
                    flow = fixture_flow(bootstrap)
                    with mock.patch("process_flow_api.preview_sessions.build_schematic", return_value={"schemaVersion": 1}):
                        response = client.post("/api/preview-sessions", json={
                            "flowId": flow["id"],
                            "target": {"type": "flowInput", "flowInputId": "incoming_panel"},
                        })
                    self.assertEqual(response.status_code, 200, response.text)
                    snapshot = response.json()["snapshots"][0]
                    self.assertIsNone(snapshot["schematic"])
                    self.assertTrue(snapshot["schematicWarnings"])
                    self.assertTrue(snapshot["geometryEntityJson"]["structure"])
            finally:
                app.state.store.close()


if __name__ == "__main__":
    unittest.main()
