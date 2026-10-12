from __future__ import annotations

import copy
import unittest

from fastapi.testclient import TestClient

from flow_requests import instance_create_payload, template_create_payload
from process_flow_api.main import create_app
from process_flow_kernel import validate_geometry_semantic_keys


class WaferDmyGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(db_path=":memory:")
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()

    def test_definition_and_default_single_si_preview(self):
        response = self.client.get("/api/geometry-generators/wafer-dmy/versions/1")
        self.assertEqual(response.status_code, 200, response.text)
        definition = response.json()
        self.assertEqual(definition["label"], "DMY die generator")
        self.assertEqual(definition["entityType"], "die")
        self.assertEqual(definition["category"], "die.wafer-dmy")
        self.assertEqual(definition["icon"], "die.piece")
        self.assertEqual(definition["defaultParameters"], {"siThickness": 200, "siMaterial": "si"})
        self.assertEqual(
            [field["id"] for field in definition["parameterDefinitions"]],
            ["siThickness", "siMaterial"],
        )
        self.assertEqual(definition["parameterGroups"], [
            {"id": "layer-si", "label": "si", "parameterIds": ["siThickness", "siMaterial"]},
        ])
        self.assertEqual(definition["adaptationContract"], {
            "adapterId": "box-rescale", "adapterVersion": 1, "parameters": {},
        })

        response = self.client.post(
            "/api/geometry-generators/wafer-dmy/preview",
            json={"generatorVersion": 1, "parameters": {}},
        )
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"], preview["errors"])
        self.assertEqual(preview["normalizedParameters"], definition["defaultParameters"])
        self.assertEqual(preview["computedParameters"], {
            "packageX": 8000, "packageY": 10000, "totalThickness": 200,
        })
        entity = preview["geometryEntityJson"]
        self.assertEqual(entity["dim"], "8000 x 10000 x 200 um")
        validate_geometry_semantic_keys(entity["structure"])
        root = entity["structure"]["root"]
        self.assertEqual(root["key"], "wafer-dmy")
        self.assertEqual(root["bodies"], [{
            "id": "body:wafer-dmy-si",
            "key": "wafer-dmy.si",
            "geometry": {
                "type": "BoxGeometry",
                "bottom_left": [-4000, -5000, -100],
                "top_right": [4000, 5000, -100],
                "thk": 200,
            },
            "material": "si",
        }])
        for collection in ("vias", "circuits", "bumps", "children"):
            self.assertEqual(root[collection], [])
        top, section = preview["engineeringPreview"]["views"]
        self.assertEqual([top["id"], section["id"]], definition["previewViews"])
        self.assertEqual(top["bounds"], {"uMin": -4000, "uMax": 4000, "vMin": -5000, "vMax": 5000})
        self.assertEqual(section["bounds"], {"uMin": -4000, "uMax": 4000, "vMin": -100, "vMax": 100})
        self.assertEqual(section["dimensions"][0]["value"], 200)
        self.assertEqual(len(top["entities"]), 1)
        self.assertEqual(len(section["entities"]), 1)

    def test_custom_and_zero_thickness_normalize_and_materialize(self):
        for thickness in (75.5, 0):
            with self.subTest(thickness=thickness):
                response = self.client.post(
                    "/api/geometry-generators/wafer-dmy/preview",
                    json={"parameters": {"siThickness": thickness, "siMaterial": "  Si-Custom  "}},
                )
                self.assertEqual(response.status_code, 200, response.text)
                preview = response.json()
                self.assertTrue(preview["valid"], preview["errors"])
                self.assertEqual(preview["normalizedParameters"], {
                    "siThickness": thickness, "siMaterial": "Si-Custom",
                })
                entity = preview["geometryEntityJson"]
                bodies = entity["structure"]["root"]["bodies"]
                self.assertEqual(len(bodies), 1)
                self.assertEqual(bodies[0]["material"], "Si-Custom")
                self.assertEqual(bodies[0]["geometry"]["thk"], thickness)
                self.assertEqual(bodies[0]["geometry"]["bottom_left"][2], -thickness / 2)
                self.assertEqual(entity["generation"], {
                    "generatorId": "wafer-dmy", "schemaVersion": 1,
                    "parameters": preview["normalizedParameters"],
                })
                materialized = self.client.post(
                    "/api/geometry-materializations", json={"previewToken": preview["previewToken"]},
                )
                self.assertEqual(materialized.status_code, 200, materialized.text)
                self.assertEqual(materialized.json()["geometryEntityJson"], entity)
                validate_geometry_semantic_keys(entity["structure"])

    def test_invalid_parameters_do_not_produce_geometry_or_preview_token(self):
        registry = self.app.state.geometry_generators
        cases = [
            ("siThickness", value)
            for value in (-1, True, "200", None, float("nan"), float("inf"), -float("inf"))
        ] + [("siMaterial", value) for value in ("", "  ", None, 200, True)]
        for parameter, value in cases:
            with self.subTest(parameter=parameter, value=value):
                preview = registry.preview("wafer-dmy", {parameter: value}, generator_version=1)
                self.assertFalse(preview["valid"])
                self.assertIn(parameter, preview["errors"])
                self.assertIsNone(preview["geometryEntityJson"])
                self.assertIsNone(preview["previewToken"])
                with self.assertRaises(ValueError):
                    registry.generate("wafer-dmy", 1, {parameter: value})

    def test_flow_recipe_reopens_and_executes_rectangle_and_polygon_placements(self):
        reset = self.client.post("/api/reset")
        self.assertEqual(reset.status_code, 200, reset.text)
        bootstrap = reset.json()
        template = copy.deepcopy(bootstrap["processFlowTemplates"][0])
        template["name"] = "Wafer dummy die placement"
        template["flowInputs"][1].update({
            "flowInputId": "incoming_wafer_dmy", "name": "DMY die",
            "geometryConstraints": {"categories": ["die.wafer-dmy"]},
        })
        template["stepRefs"] = template["stepRefs"][:1]
        template["flowEdges"] = template["flowEdges"][:2]
        template["flowEdges"][1]["source"]["flowInputId"] = "incoming_wafer_dmy"
        instance = copy.deepcopy(bootstrap["processFlowInstances"][0])
        instance["name"] = "Wafer dummy die placement"
        instance["inputBindings"].pop("incoming_hbm")
        instance["inputBindings"]["incoming_wafer_dmy"] = {
            "kind": "generator", "generatorId": "wafer-dmy", "generatorVersion": 1,
            "parameters": {},
        }
        polygon = [[2000, 0], [4000, 0], [3800, 1600], [2000, 1600]]
        regions = [
            {"type": "rectangle", "bottomLeftX": -1000, "bottomLeftY": -800,
             "topRightX": 1000, "topRightY": 800},
            {"type": "polygon", "points": polygon},
        ]
        instance["stepConfigurations"] = {
            "pnp_hbm": {"parameterValues": {"placements": [
                {"targetRegion": region, "pose": {"x": 0, "y": 0, "rotationZ": 0}, "anchor": "center"}
                for region in regions
            ]}},
        }
        geometry_count = len(bootstrap["geometries"])
        created = self.client.post("/api/process-flow-template-instances", json={
            "processFlowTemplate": template_create_payload(template),
            "processFlowInstance": instance_create_payload(instance, for_new_template=True),
        })
        self.assertEqual(created.status_code, 201, created.text)
        saved = created.json()["processFlowInstance"]

        for parameters in (
            {"siThickness": 200, "siMaterial": "si"},
            {"siThickness": 75.5, "siMaterial": "Si-Edited"},
            {"siThickness": 0, "siMaterial": "Si-Edited"},
        ):
            with self.subTest(parameters=parameters):
                if parameters != {"siThickness": 200, "siMaterial": "si"}:
                    edited = copy.deepcopy(saved)
                    edited["name"] = f"Wafer dummy die {parameters['siThickness']} um"
                    edited["inputBindings"]["incoming_wafer_dmy"]["parameters"] = {
                        **parameters, "siMaterial": f"  {parameters['siMaterial']}  ",
                    }
                    response = self.client.post(
                        "/api/process-flow-instances", json=instance_create_payload(edited),
                    )
                    self.assertEqual(response.status_code, 201, response.text)
                    saved = response.json()
                self.assertEqual(saved["inputBindings"]["incoming_wafer_dmy"], {
                    "kind": "generator", "generatorId": "wafer-dmy", "generatorVersion": 1,
                    "parameters": parameters,
                })
                reopened = self.client.get(f"/api/process-flow-instances/{saved['id']}")
                self.assertEqual(reopened.status_code, 200, reopened.text)
                self.assertEqual(reopened.json(), saved)
                executed = self.client.post(f"/api/process-flow-instances/{saved['id']}/execute")
                self.assertEqual(executed.status_code, 200, executed.text)
                structure = executed.json()["geometryStructure"]
                validate_geometry_semantic_keys(structure)
                children = structure["root"]["children"]
                self.assertEqual(len(children), 2)
                for child in children:
                    self.assertEqual(child["key"], "wafer-dmy")
                    self.assertEqual(len(child["bodies"]), 1)
                    body = child["bodies"][0]
                    self.assertEqual(body["key"], "wafer-dmy.si")
                    self.assertEqual(body["material"], parameters["siMaterial"])
                    self.assertEqual(body["geometry"]["thk"], parameters["siThickness"])
                box = children[0]["bodies"][0]["geometry"]
                self.assertEqual(box["type"], "BoxGeometry")
                self.assertEqual(box["bottom_left"][:2], [-1000, -800])
                self.assertEqual(box["top_right"][:2], [1000, 800])
                placed_polygon = children[1]["bodies"][0]["geometry"]
                self.assertEqual(placed_polygon["type"], "PolygonGeometry")
                self.assertEqual([point[:2] for point in placed_polygon["polys"][0]], polygon)
                self.assertEqual(box["bottom_left"][2], placed_polygon["polys"][0][0][2])
                self.assertEqual(len(self.client.get("/api/geometries").json()), geometry_count)


if __name__ == "__main__":
    unittest.main()
