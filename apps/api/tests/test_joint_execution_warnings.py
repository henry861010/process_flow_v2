from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from process_flow_api.main import create_app
from process_flow_api.models import ExecuteFlowResponse, GeometryPreviewResponse, PreviewSnapshot
from process_flow_api.preview_sessions import PreviewSnapshotRecord
from process_flow_kernel import ProcessGeometryState


def assembly_geometry(*, filled=True):
    main = ProcessGeometryState.create()
    main.initialize_box_layer(material="RDL", key="rdl", bottom_left=[0, 0, 350],
                              top_right=[100, 100, 350], thickness=30)
    main.add_bump_above_cursor(material="SnAg", density=40, thickness=28, stage="reflowed")
    die = ProcessGeometryState.create()
    die.initialize_box_layer(material="Si", bottom_left=[0, 0, 28], top_right=[20, 20, 28],
                             thickness=50)
    die.add_bump(material="SnAg", density=40, direction="-z", stage="reflowed",
                 geometry={"type": "box", "bottomLeft": [0, 0, 0],
                           "topRight": [20, 20, 0], "thickness": 28})
    main.place_geometry_state(die, x=10, y=10, bottom_z=408, anchor="bottomLeft")
    if filled:
        main.apply_under_fill(material="UF", thickness=28, gap=5, key="uf")
    return {
        "id": "joint-warning-assembly" if filled else "joint-warning-empty-assembly",
        "name": "Filled assembly" if filled else "Unfilled assembly", "entityType": "assembly",
        "category": "test", "dim": "", "structureFormat": "standard",
        "structure": main.to_geometry_structure(),
    }


def selected_recipe(values):
    return {"selectedRecipeId": "selected", "recipeCandidates": [
        {"recipeId": "selected", "name": "Selected", "parameterValues": values},
    ]}


def output_edge(edge_id, source, target):
    return {"edgeId": edge_id,
            "source": {"kind": "stepOutput", "stepRefId": source, "outputPortId": "result_geometry"},
            "target": {"stepRefId": target, "inputPortId": "main_geometry"}}


def joint_flow(geometry_id="joint-warning-assembly", *, joint_template="step_tpl_mr_joint",
               unrelated=False):
    flow = {
        "definition": {
            "flowInputs": [{"flowInputId": "assembly", "name": "Assembly", "dataType": "geometry",
                            "required": True}],
            "stepRefs": [
                {"stepRefId": "joint", "stepLabel": "Package joint", "processStepTemplateId": joint_template},
                {"stepRefId": "mold", "stepLabel": "Molding", "processStepTemplateId": "step_tpl_molding"},
                {"stepRefId": "finish", "stepLabel": "Final molding", "processStepTemplateId": "step_tpl_molding"},
            ],
            "flowEdges": [
                {"edgeId": "input-joint", "source": {"kind": "flowInput", "flowInputId": "assembly"},
                 "target": {"stepRefId": "joint", "inputPortId": "main_geometry"}},
                output_edge("joint-mold", "joint", "mold"),
                output_edge("mold-finish", "mold", "finish"),
            ],
        },
        "configuration": {
            "inputBindings": {"assembly": {"kind": "catalog", "geometryId": geometry_id}},
            "stepConfigurations": {
                "joint": selected_recipe({"bump_joined_height": 10}),
                "mold": selected_recipe({"material": "EMC", "thickness": 20}),
                "finish": selected_recipe({"material": "EMC", "thickness": 10}),
            },
        },
    }
    if unrelated:
        flow["definition"]["stepRefs"].append({
            "stepRefId": "unrelated", "stepLabel": "Independent molding",
            "processStepTemplateId": "step_tpl_molding",
        })
        flow["definition"]["flowEdges"].append({
            "edgeId": "input-unrelated", "source": {"kind": "flowInput", "flowInputId": "assembly"},
            "target": {"stepRefId": "unrelated", "inputPortId": "main_geometry"},
        })
        flow["configuration"]["stepConfigurations"]["unrelated"] = selected_recipe(
            {"material": "EMC", "thickness": 15})
    return flow


class JointExecutionWarningApiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.directory.name) / "warnings.sqlite3")
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()
        self.filled = assembly_geometry()
        self.app.state.store.insert_geometry(self.filled)
        self.app.state.store.insert_geometry(assembly_geometry(filled=False))

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.app.state.store.close()
        self.directory.cleanup()

    def preview(self, flow, step="finish"):
        response = self.client.post("/api/preview-sessions", json={
            "flow": flow, "target": {"type": "stepOutput", "stepRefId": step},
        })
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()
        snapshots = {item["stepRefId"]: item for item in session["snapshots"]}
        return session, snapshots

    def assert_preserved_warning(self, warnings):
        self.assertEqual(len(warnings), 1)
        warning = warnings[0]
        self.assertEqual(set(warning), {"code", "stepRefId", "stepLabel", "message", "details"})
        self.assertEqual(warning["code"], "joint_soh_preserved")
        self.assertEqual(warning["stepRefId"], "joint")
        self.assertEqual(warning["stepLabel"], "Package joint")
        self.assertEqual(warning["details"], {
            "childId": self.filled["structure"]["root"]["children"][0]["id"],
            "requestedSoh": 10, "actualSoh": 56, "unit": "um", "supportMaterials": ["UF"],
        })
        self.assertTrue(warning["message"])

    def test_joint_warning_reaches_downstream_preview_with_actual_geometry(self):
        for template in ("step_tpl_mr_joint", "step_tpl_tcb_joint"):
            with self.subTest(template=template):
                flow = joint_flow(joint_template=template)
                snapshots = {}
                for step in ("joint", "mold", "finish"):
                    session, selected = self.preview(flow, step)
                    self.assertEqual(list(selected), [step])
                    snapshots.update(selected)
                for snapshot in snapshots.values():
                    self.assert_preserved_warning(snapshot["executionWarnings"])
                joint = snapshots["joint"]["geometryEntityJson"]["structure"]["root"]
                self.assertEqual(joint["bodies"][0]["geometry"]["bottom_left"][2], 350)
                self.assertEqual(joint["bodies"][0]["geometry"]["thk"], 30)
                child = joint["children"][0]
                self.assertEqual(child["bodies"][0]["geometry"]["bottom_left"][2], 436)
                uf = next(body for body in child["bodies"] if body.get("key") == "uf")
                self.assertEqual(uf["geometry"]["bottom_left"][2], 408)
                self.assertEqual(uf["geometry"]["thk"], 28)
                self.assertEqual(child["bumps"][0]["geometry"]["bottom_left"][2], 380)
                self.assertEqual(child["bumps"][0]["geometry"]["thk"], 56)
                self.assertEqual(child["bumps"][0]["stage"], "joined")
                final = snapshots["finish"]
                self.assertEqual(session["initialSnapshotId"], final["snapshotId"])
                self.assertIsNotNone(final["schematic"], final["schematicWarnings"])
                self.assertEqual(final["schematicWarnings"], [])
                self.assertEqual(final["schematic"]["warnings"], [])

    def test_execute_reports_warning_once_without_leaking_to_unrelated_preview(self):
        flow = joint_flow(unrelated=True)
        created = self.client.post("/api/process-flows", json={
            **flow, "name": "Joint warning", "version": "V0", "owner": "test",
        })
        self.assertEqual(created.status_code, 201, created.text)
        executed = self.client.post(f"/api/process-flows/{created.json()['id']}/execute")
        self.assertEqual(executed.status_code, 200, executed.text)
        self.assert_preserved_warning(executed.json()["executionWarnings"])
        self.assertEqual(set(executed.json()["stepOutputs"]), {"joint", "mold", "finish", "unrelated"})
        _, snapshots = self.preview(flow, "unrelated")
        self.assertEqual(set(snapshots), {"unrelated"})
        self.assertEqual(snapshots["unrelated"]["executionWarnings"], [])

    def test_unfilled_joint_and_flow_input_have_empty_warning_lists(self):
        _, snapshots = self.preview(joint_flow("joint-warning-empty-assembly"))
        self.assertTrue(all(item["executionWarnings"] == [] for item in snapshots.values()))
        response = self.client.post("/api/preview-sessions", json={
            "flow": joint_flow(), "target": {"type": "flowInput", "flowInputId": "assembly"},
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["snapshots"][0]["executionWarnings"], [])

    def test_legacy_preview_exposes_selected_warning_without_modifying_geometry_entity(self):
        with mock.patch("process_flow_api.services.export_geometry", new_callable=mock.AsyncMock,
                        return_value=b"glb-data"):
            response = self.client.post("/api/geometry-preview", json={
                "flow": joint_flow(), "target": {"type": "stepOutput", "stepRefId": "finish"},
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_preserved_warning(response.json()["executionWarnings"])
        self.assertNotIn("executionWarnings", response.json()["geometryEntityJson"])
        self.assertNotIn("executionWarnings", response.json()["geometryEntityJson"]["structure"])

    def test_schematic_failure_preserves_process_warning_and_geometry(self):
        with mock.patch("process_flow_api.preview_sessions.build_schematic", side_effect=RuntimeError("failed")):
            _, snapshots = self.preview(joint_flow())
        final = snapshots["finish"]
        self.assert_preserved_warning(final["executionWarnings"])
        self.assertIsNone(final["schematic"])
        self.assertIn("exports are still available", final["schematicWarnings"][-1])
        self.assertIn("root", final["geometryEntityJson"]["structure"])


class ExecutionWarningContractTests(unittest.TestCase):
    def warning(self):
        return {"code": "joint_soh_preserved", "stepRefId": "joint", "stepLabel": "Joint",
                "message": "Existing fill preserves actual SOH 56 um instead of requested 10 um.",
                "details": {"requestedSoh": 10, "actualSoh": 56, "supportMaterials": ["UF"]}}

    def snapshot(self):
        return {"snapshotId": "snapshot", "sourceKind": "stepOutput", "stepRefId": "joint",
                "label": "Joint", "order": 0, "geometryHash": "hash", "geometryEntityJson": {},
                "meshUrl": "/mesh", "sectionUrl": "/section"}

    def test_legacy_response_payloads_default_to_empty_execution_warnings(self):
        self.assertEqual(ExecuteFlowResponse.model_validate({
            "geometryStructure": {}, "stepOutputs": {}, "terminalStepRefIds": [],
        }).executionWarnings, [])
        self.assertEqual(GeometryPreviewResponse.model_validate({
            "geometryEntityJson": {}, "glbBase64": "",
        }).executionWarnings, [])
        self.assertEqual(PreviewSnapshot.model_validate(self.snapshot()).executionWarnings, [])

    def test_invalid_schematic_document_retains_valid_execution_warnings(self):
        source = {**self.snapshot(), "schematic": {"schemaVersion": -1},
                  "executionWarnings": [self.warning()]}
        before = copy.deepcopy(source)
        parsed = PreviewSnapshot.model_validate(source)
        self.assertIsNone(parsed.schematic)
        self.assertEqual(parsed.payload()["executionWarnings"], source["executionWarnings"])
        self.assertTrue(parsed.schematicWarnings)
        self.assertEqual(source, before)

    def test_snapshot_warning_payload_does_not_mutate_cached_warnings(self):
        warning = self.warning()
        record = PreviewSnapshotRecord(
            snapshot_id="snapshot", source_kind="stepOutput", step_ref_id="joint", label="Joint",
            order=0, geometry_hash="hash", geometry_entity_json={}, mesh_url="/mesh", section_url="/section",
            execution_warnings=(warning,),
        )
        payload = record.payload()
        payload["executionWarnings"][0]["details"]["supportMaterials"].append("Changed")
        payload["executionWarnings"][0]["message"] = "Changed"
        self.assertEqual(record.payload()["executionWarnings"], [self.warning()])
