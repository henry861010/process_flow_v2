"""API guarantees for shared layouts across separately requested step snapshots."""
from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from process_flow_api import services as api_services
from process_flow_api.main import create_app


def _geometry(name, key, *, carrier=False):
    return {
        "id": "layout-" + name, "name": name,
        "entityType": "panel" if carrier else "die", "category": key,
        "dim": "", "structureFormat": "standard",
        "structure": {
            "schemaVersion": "1.0.0", "unitSystem": "um",
            "root": {
                "id": name + "-root", "key": key,
                "bodies": [{
                    "id": name + "-body", "material": "glass" if carrier else "Si",
                    **({"key": "carrier"} if carrier else {}),
                    "geometry": {"type": "BoxGeometry", "bottom_left": [0, 0, 0],
                                 "top_right": [100, 100, 0] if carrier else [20, 20, 0],
                                 "thk": 10 if carrier else 4},
                }],
                "vias": [], "circuits": [], "bumps": [], "children": [],
            },
        },
    }


def _placement(x):
    return {"targetRegion": {"type": "rectangle", "bottomLeftX": x, "bottomLeftY": 10,
                             "topRightX": x + 20, "topRightY": 30},
            "pose": {"x": 0, "y": 0, "rotationZ": 0}, "anchor": "center"}


def _input_edge(edge_id, input_id, step, port):
    return {"edgeId": edge_id, "source": {"kind": "flowInput", "flowInputId": input_id},
            "target": {"stepRefId": step, "inputPortId": port}}


def _output_edge(edge_id, source, target):
    return {"edgeId": edge_id,
            "source": {"kind": "stepOutput", "stepRefId": source, "outputPortId": "result_geometry"},
            "target": {"stepRefId": target, "inputPortId": "main_geometry"}}


def _flow():
    flow = {
        "definition": {
            "flowInputs": [{"flowInputId": key, "name": key, "dataType": "geometry", "required": True}
                           for key in ("carrier", "soc", "hbm", "dmy")],
            "stepRefs": [{"stepRefId": "place_" + key, "stepLabel": "Place " + key,
                          "processStepTemplateId": "step_tpl_pnp"} for key in ("soc", "hbm", "dmy")],
            "flowEdges": [_input_edge("carrier", "carrier", "place_soc", "main_geometry"),
                          _output_edge("soc-hbm", "place_soc", "place_hbm"),
                          _output_edge("hbm-dmy", "place_hbm", "place_dmy"),
                          *[_input_edge(key, key, "place_" + key, "die_geometry")
                            for key in ("soc", "hbm", "dmy")]],
        },
        "configuration": {
            "inputBindings": {key: {"kind": "catalog", "geometryId": "layout-" + key}
                              for key in ("carrier", "soc", "hbm", "dmy")},
            "stepConfigurations": {
                "place_" + key: {
                    "selectedRecipeId": "selected",
                    "recipeCandidates": [{"recipeId": "selected", "name": "Selected",
                                          "parameterValues": {"placements": [_placement(x)]}}],
                } for key, x in (("soc", 5), ("hbm", 35), ("dmy", 65))
            },
        },
    }
    return flow


def _add_independent_path(flow):
    flow["definition"]["flowInputs"].append({
        "flowInputId": "other_carrier", "name": "Other carrier", "dataType": "geometry", "required": True,
    })
    flow["configuration"]["inputBindings"]["other_carrier"] = {"kind": "catalog", "geometryId": "layout-carrier"}
    for key in ("soc", "hbm", "dmy"):
        original = "place_" + key
        other = "other_" + key
        flow["definition"]["stepRefs"].append({
            "stepRefId": other, "processStepTemplateId": "step_tpl_pnp",
        })
        flow["configuration"]["stepConfigurations"][other] = copy.deepcopy(
            flow["configuration"]["stepConfigurations"][original])
        flow["definition"]["flowEdges"].append(_input_edge("other-die-" + key, key, other, "die_geometry"))
    flow["definition"]["flowEdges"].extend([
        _input_edge("other-main", "other_carrier", "other_soc", "main_geometry"),
        _output_edge("other-soc-hbm", "other_soc", "other_hbm"),
        _output_edge("other-hbm-dmy", "other_hbm", "other_dmy"),
    ])


def _component_positions(document):
    return {label: sorted((item["x"], item["width"]) for item in document["components"] if item["label"] == label)
            for label in {item["label"] for item in document["components"]}}


def _carrier_span(document):
    item_ids = {item["id"] for item in document["items"] if item["label"] == "carrier"}
    return [(shape["x"], shape["width"]) for shape in document["shapes"]
            if shape["itemId"] in item_ids and shape["kind"] == "rect"]


class SchematicLayoutPreviewTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.app = create_app(db_path=Path(self.directory.name) / "layout.sqlite3")
        self.client_context = TestClient(self.app)
        self.client = self.client_context.__enter__()
        for name, key in (("carrier", "carrier.panel"), ("soc", "soc"), ("hbm", "hbm"), ("dmy", "wafer-dmy")):
            self.app.state.store.insert_geometry(_geometry(name, key, carrier=name == "carrier"))

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        self.app.state.store.close()
        self.directory.cleanup()

    def preview(self, flow, step):
        response = self.client.post("/api/preview-sessions", json={
            "flow": flow, "target": {"type": "stepOutput", "stepRefId": step},
        })
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()
        snapshot = next(item for item in session["snapshots"] if item["snapshotId"] == session["initialSnapshotId"])
        self.assertIsNotNone(snapshot["schematic"], snapshot["schematicWarnings"])
        self.assertEqual(snapshot["schematic"]["warnings"], [])
        return session, snapshot

    def test_separate_step_requests_preserve_die_and_carrier_positions_without_future_contents(self):
        flow = _flow()
        documents = []
        for step, labels in (("place_soc", {"SoC"}), ("place_hbm", {"SoC", "HBM"}),
                             ("place_dmy", {"SoC", "HBM", "Wafer DMY"})):
            # Each target must derive the same plan even after the shared plan
            # cache is evicted between requests.
            self.app.state.preview_sessions._layout_plans.clear()
            _, snapshot = self.preview(flow, step)
            document = snapshot["schematic"]
            self.assertEqual(set(_component_positions(document)), labels)
            self.assertTrue({item["groupLabel"] for item in document["items"]} <= labels | {"Structure"})
            self.assertEqual(len(snapshot["geometryEntityJson"]["structure"]["root"]["children"]), len(documents) + 1)
            documents.append(document)
        final_positions = _component_positions(documents[-1])
        self.assertEqual(len(final_positions["Wafer DMY"]), 2)
        self.assertTrue(_carrier_span(documents[0]))
        for document in documents:
            for label, positions in _component_positions(document).items():
                self.assertEqual(positions, final_positions[label])
            self.assertEqual(document["viewBox"][2], documents[-1]["viewBox"][2])
            self.assertEqual(_carrier_span(document), _carrier_span(documents[-1]))

    def test_first_incomplete_future_step_stops_its_path_while_independent_path_continues(self):
        baseline = _flow()
        _, complete = self.preview(baseline, "place_soc")
        for kind in ("recipe", "parameter", "wire", "geometry", "template"):
            with self.subTest(kind=kind):
                flow = _flow()
                _add_independent_path(flow)
                if kind == "recipe":
                    flow["configuration"]["stepConfigurations"]["place_hbm"]["selectedRecipeId"] = None
                elif kind == "parameter":
                    flow["configuration"]["stepConfigurations"]["place_hbm"]["recipeCandidates"][0]["parameterValues"] = {}
                elif kind == "wire":
                    flow["definition"]["flowEdges"] = [edge for edge in flow["definition"]["flowEdges"]
                        if edge["target"] != {"stepRefId": "place_hbm", "inputPortId": "die_geometry"}]
                elif kind == "geometry":
                    flow["definition"]["flowInputs"].append({"flowInputId": "missing_hbm", "name": "Missing HBM"})
                    next(edge for edge in flow["definition"]["flowEdges"]
                         if edge["target"] == {"stepRefId": "place_hbm", "inputPortId": "die_geometry"})["source"]["flowInputId"] = "missing_hbm"
                else:
                    next(ref for ref in flow["definition"]["stepRefs"] if ref["stepRefId"] == "place_hbm")["processStepTemplateId"] = "unfinished-template"
                _, stopped = self.preview(flow, "place_soc")
                self.assertEqual(set(_component_positions(stopped["schematic"])), {"SoC"})
                self.assertLess(stopped["schematic"]["viewBox"][2], complete["schematic"]["viewBox"][2])
                self.assertTrue(any("place_hbm" in note for note in stopped["schematic"]["notes"]))
                _, independent = self.preview(flow, "other_soc")
                self.assertEqual(_component_positions(independent["schematic"]), _component_positions(complete["schematic"]))
                self.assertEqual(independent["schematic"]["viewBox"][2], complete["schematic"]["viewBox"][2])
                self.assertEqual(_carrier_span(independent["schematic"]), _carrier_span(complete["schematic"]))
                self.assertFalse(any("place_hbm" in note for note in independent["schematic"]["notes"]))

    def test_incomplete_molding_also_stops_lookahead_before_later_ready_pnp(self):
        flow = _flow()
        flow["definition"]["stepRefs"].insert(1, {
            "stepRefId": "mold", "stepLabel": "Pause molding", "processStepTemplateId": "step_tpl_molding",
        })
        flow["definition"]["flowEdges"] = [edge for edge in flow["definition"]["flowEdges"]
                                                if edge["edgeId"] != "soc-hbm"]
        flow["definition"]["flowEdges"].extend([
            _output_edge("soc-mold", "place_soc", "mold"), _output_edge("mold-hbm", "mold", "place_hbm"),
        ])
        flow["configuration"]["stepConfigurations"]["mold"] = {
            "selectedRecipeId": "mold", "recipeCandidates": [{
                "recipeId": "mold", "name": "Mold", "parameterValues": {"material": "EMC"},
            }],
        }
        _, stopped = self.preview(flow, "place_soc")
        self.assertTrue(any("stopped at mold:" in note for note in stopped["schematic"]["notes"]))
        flow["configuration"]["stepConfigurations"]["mold"]["recipeCandidates"][0]["parameterValues"]["thickness"] = 12
        _, completed = self.preview(flow, "place_soc")
        self.assertLess(stopped["schematic"]["viewBox"][2], completed["schematic"]["viewBox"][2])
        self.assertFalse(any("stopped" in note for note in completed["schematic"]["notes"]))
        self.assertEqual(set(_component_positions(completed["schematic"])), {"SoC"})

    def test_generator_beyond_stopped_horizon_is_not_resolved(self):
        flow = _flow()
        flow["configuration"]["stepConfigurations"]["place_hbm"]["selectedRecipeId"] = None
        flow["configuration"]["inputBindings"]["dmy"] = {
            "kind": "generator", "generatorId": "wafer-dmy", "generatorVersion": 1, "parameters": {},
        }
        with mock.patch.object(self.app.state.geometry_generators, "generate",
                               wraps=self.app.state.geometry_generators.generate) as generate:
            _, stopped = self.preview(flow, "place_soc")
            generate.assert_not_called()
            flow["configuration"]["stepConfigurations"]["place_hbm"]["selectedRecipeId"] = "selected"
            _, completed = self.preview(flow, "place_soc")
            self.assertEqual(generate.call_count, 1)
            self.assertEqual(generate.call_args.args[:2], ("wafer-dmy", 1))
        self.assertEqual(stopped["geometryHash"], completed["geometryHash"])
        self.assertLess(stopped["schematic"]["viewBox"][2], completed["schematic"]["viewBox"][2])

    def test_planning_and_binding_failure_keep_local_preview_and_geometry_with_warning(self):
        hashes = []
        for helper in ("plan_flow_schematic", "bind_schematic_snapshots"):
            with self.subTest(helper=helper):
                flow = _flow()
                # Distinct requests prevent a cached response from bypassing
                # either forced failure.
                flow["definition"]["stepRefs"][0]["stepLabel"] = helper
                with mock.patch("process_flow_api.preview_sessions." + helper,
                                side_effect=RuntimeError("forced presentation failure")):
                    _, snapshot = self.preview(flow, "place_soc")
                self.assertEqual(set(_component_positions(snapshot["schematic"])), {"SoC"})
                self.assertEqual(snapshot["schematic"]["viewBox"][2], 1000)
                self.assertTrue(_carrier_span(snapshot["schematic"]))
                self.assertTrue(any("Shared flow layout" in warning and "local layout" in warning
                                    and "exports are still available" in warning
                                    for warning in snapshot["schematicWarnings"]))
                structure = snapshot["geometryEntityJson"]["structure"]
                self.assertEqual(structure["schemaVersion"], "1.0.0")
                self.assertEqual(len(structure["root"]["children"]), 1)
                hashes.append(snapshot["geometryHash"])
        self.assertEqual(hashes[0], hashes[1])

    def test_preview_compiles_and_executes_only_requested_prefix_once(self):
        original_compile = api_services.FlowCompiler.compile
        with (
            mock.patch.object(api_services.FlowCompiler, "compile", autospec=True,
                              side_effect=original_compile) as compile_flow,
            mock.patch("process_flow_api.services._execute_preview_plan", wraps=api_services._execute_preview_plan) as execute,
        ):
            session, snapshot = self.preview(_flow(), "place_soc")
        self.assertEqual(compile_flow.call_count, 1)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual([item["stepRefId"] for item in session["snapshots"]], ["place_soc"])
        self.assertEqual([step.step_ref_id for step in execute.call_args.args[0].steps], ["place_soc"])
        self.assertEqual(len(snapshot["geometryEntityJson"]["structure"]["root"]["children"]), 1)


if __name__ == "__main__":
    unittest.main()
