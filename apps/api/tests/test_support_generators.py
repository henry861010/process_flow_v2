from __future__ import annotations

import copy
import unittest

from fastapi.testclient import TestClient

from flow_requests import instance_create_payload, template_create_payload
from process_flow_api.main import create_app
from process_flow_kernel import GeometryArtifact, validate_geometry_semantic_keys
from process_flow_steps.pnp.adapters import adapt_geometry


class SupportGeneratorApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(db_path=":memory:")
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()

    def test_preview_materialization_and_adaptation_contracts(self):
        region = {"type": "rectangle", "width": 200, "height": 400}
        for generator_id in ("wafer-carrier", "panel-carrier", "frame"):
            with self.subTest(generator=generator_id):
                response = self.client.get(f"/api/geometry-generators/{generator_id}/versions/1")
                self.assertEqual(response.status_code, 200, response.text)
                definition = response.json()
                response = self.client.post(f"/api/geometry-generators/{generator_id}/preview", json={
                    "generatorVersion": 1, "parameters": {},
                })
                self.assertEqual(response.status_code, 200, response.text)
                preview = response.json()
                self.assertTrue(preview["valid"], preview["errors"])
                self.assertEqual(preview["normalizedParameters"], definition["defaultParameters"])
                entity = preview["geometryEntityJson"]
                validate_geometry_semantic_keys(entity["structure"])
                materialized = self.client.post("/api/geometry-materializations", json={
                    "previewToken": preview["previewToken"],
                })
                self.assertEqual(materialized.status_code, 200, materialized.text)
                self.assertEqual(materialized.json()["geometryEntityJson"], entity)
                adapted = adapt_geometry(GeometryArtifact.from_entity(entity), region)
                body = adapted["root"]["bodies"][0]
                original = entity["structure"]["root"]["bodies"][0]
                self.assertEqual(body["key"], original["key"])
                self.assertEqual(body["material"], original["material"])
                if generator_id == "panel-carrier":
                    bottom = body["geometry"]["bottom_left"]
                    top = body["geometry"]["top_right"]
                    self.assertEqual([top[0] - bottom[0], top[1] - bottom[1]], [200, 400])
                    self.assertEqual(body["geometry"]["thk"], original["geometry"]["thk"])
                else:
                    self.assertEqual(body["geometry"], original["geometry"])

    def test_flow_bindings_reopen_edit_execute_and_remove_support(self):
        bootstrap_response = self.client.post("/api/reset")
        self.assertEqual(bootstrap_response.status_code, 200, bootstrap_response.text)
        bootstrap = bootstrap_response.json()
        geometry_count = len(bootstrap["geometries"])
        for generator_id, category, layer in (
            ("wafer-carrier", "carrier.wafer", "carrier"),
            ("panel-carrier", "carrier.panel", "carrier"),
            ("frame", "frame", "tape"),
        ):
            with self.subTest(generator=generator_id):
                is_frame = generator_id == "frame"
                port = "frame_geometry" if is_frame else "carrier_geometry"
                template = copy.deepcopy(bootstrap["processFlowTemplates"][0])
                template["name"] = f"{generator_id} support lifecycle"
                template["flowInputs"][1].update({
                    "flowInputId": "support", "name": "Support",
                    "geometryConstraints": {"categories": [category]},
                })
                template["stepRefs"] = [
                    {"stepRefId": "attach", "processStepTemplateId":
                     "step_tpl_frame_mount" if is_frame else "step_tpl_carrier_bond"},
                    {"stepRefId": "remove", "processStepTemplateId":
                     "step_tpl_frame_demount" if is_frame else "step_tpl_debond"},
                ]
                template["flowEdges"] = [
                    {"edgeId": "main-to-attach", "source": {"kind": "flowInput", "flowInputId": "incoming_panel"},
                     "target": {"stepRefId": "attach", "inputPortId": "main_geometry"}},
                    {"edgeId": "support-to-attach", "source": {"kind": "flowInput", "flowInputId": "support"},
                     "target": {"stepRefId": "attach", "inputPortId": port}},
                    {"edgeId": "attach-to-remove", "source": {
                        "kind": "stepOutput", "stepRefId": "attach", "outputPortId": "result_geometry"},
                     "target": {"stepRefId": "remove", "inputPortId": "main_geometry"}},
                ]
                instance = copy.deepcopy(bootstrap["processFlowInstances"][0])
                instance["name"] = f"{generator_id} default"
                instance["inputBindings"].pop("incoming_hbm")
                instance["inputBindings"]["support"] = {
                    "kind": "generator", "generatorId": generator_id, "generatorVersion": 1, "parameters": {},
                }
                instance["stepConfigurations"] = {"attach": {"parameterValues": {}}, "remove": {"parameterValues": {}}}
                response = self.client.post("/api/process-flow-template-instances", json={
                    "processFlowTemplate": template_create_payload(template),
                    "processFlowInstance": instance_create_payload(instance, for_new_template=True),
                })
                self.assertEqual(response.status_code, 201, response.text)
                saved = response.json()["processFlowInstance"]
                defaults = self.app.state.geometry_generators.definition(generator_id)["defaultParameters"]
                edited = {key: value / 2 for key, value in defaults.items() if isinstance(value, (int, float))}
                edited[f"{layer}Material"] = "Custom support"
                for parameters in (defaults, edited):
                    if parameters == edited:
                        request = copy.deepcopy(saved)
                        request["name"] = f"{generator_id} edited"
                        request["inputBindings"]["support"]["parameters"] = {
                            **parameters, f"{layer}Material": "  Custom support  ",
                        }
                        response = self.client.post("/api/process-flow-instances", json=instance_create_payload(request))
                        self.assertEqual(response.status_code, 201, response.text)
                        saved = response.json()
                    self.assertEqual(saved["inputBindings"]["support"]["parameters"], parameters)
                    reopened = self.client.get(f"/api/process-flow-instances/{saved['id']}")
                    self.assertEqual(reopened.status_code, 200, reopened.text)
                    self.assertEqual(reopened.json(), saved)
                    response = self.client.post(f"/api/process-flow-instances/{saved['id']}/execute")
                    self.assertEqual(response.status_code, 200, response.text)
                    result = response.json()
                    attached = result["stepOutputs"]["attach"]
                    validate_geometry_semantic_keys(attached)
                    body = attached["root"]["bodies"][-1]
                    self.assertEqual(body["key"], "frame" if is_frame else "carrier")
                    # The main panel already uses glass; the kernel allocates a new
                    # material instance for a second glass layer during bond.
                    material = parameters[f"{layer}Material"]
                    self.assertEqual(body["material"], "glass_dup2" if material == "glass" else material)
                    self.assertEqual(body["geometry"]["thk"], parameters[f"{layer}Thickness"])
                    if "diameter" in parameters:
                        self.assertEqual(body["geometry"]["bottom_radius"], parameters["diameter"] / 2)
                    else:
                        self.assertEqual(body["geometry"]["bottom_left"][:2], [-parameters["packageX"] / 2, -parameters["packageY"] / 2])
                        self.assertEqual(body["geometry"]["top_right"][:2], [parameters["packageX"] / 2, parameters["packageY"] / 2])
                    remaining = result["geometryStructure"]["root"]["bodies"]
                    self.assertEqual(len(remaining), 1)
                    self.assertEqual(remaining[0], attached["root"]["bodies"][0])
                    validate_geometry_semantic_keys(result["geometryStructure"])
        self.assertEqual(len(self.client.get("/api/geometries").json()), geometry_count)


if __name__ == "__main__":
    unittest.main()
