from __future__ import annotations

import copy
import unittest

from fastapi.testclient import TestClient

from process_flow_api.main import create_app
from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators
from process_flow_geometry_generators.hbm import HbmGenerator


class GeometryGeneratorApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(db_path=":memory:")
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()

    def test_generator_ui_placements_are_explicit_in_all_definition_endpoints(self):
        expected = {
            "hbm": ["home"],
            "dram": ["home"],
            "soc": ["templateGeometryLibrary", "flowInputPicker"],
            "lsi": ["management", "templateGeometryLibrary", "flowInputPicker"],
        }
        listed = self.client.get("/api/geometry-generators")
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual(
            {item["id"]: item["uiPlacements"] for item in listed.json()}, expected
        )
        self.assertTrue(all(item["schemaVersion"] == 2 for item in listed.json()))

        bootstrap = self.client.get("/api/bootstrap")
        self.assertEqual(bootstrap.status_code, 200, bootstrap.text)
        self.assertEqual(
            {
                item["id"]: (item["schemaVersion"], item["uiPlacements"])
                for item in bootstrap.json()["geometryGenerators"]
            },
            {item["id"]: (item["schemaVersion"], item["uiPlacements"]) for item in listed.json()},
        )
        for definition in listed.json():
            exact = self.client.get(
                f"/api/geometry-generators/{definition['id']}/versions/{definition['version']}"
            )
            self.assertEqual(exact.status_code, 200, exact.text)
            self.assertEqual(exact.json(), definition)

    def test_injected_registry_controls_catalog_and_compilation(self):
        registry = GeometryGeneratorRegistry()
        registry.register(HbmGenerator())
        app = create_app(db_path=":memory:", generator_registry=registry)
        try:
            with TestClient(app) as client:
                self.assertIs(app.state.geometry_generators, registry)
                listed = client.get("/api/geometry-generators")
                self.assertEqual([item["id"] for item in listed.json()], ["hbm"])
                bootstrap = client.get("/api/bootstrap").json()
                self.assertEqual(
                    [item["id"] for item in bootstrap["geometryGenerators"]], ["hbm"]
                )

                source = next(
                    item for item in bootstrap["processFlowInstances"]
                    if item["processFlowTemplateId"] == "flow_tpl_aaa_demo"
                )
                request = copy.deepcopy(source)
                request["id"] = "flow_inst_registered_generator"
                request["inputBindings"]["incoming_hbm"] = {
                    "kind": "generator",
                    "generatorId": "hbm",
                    "generatorVersion": 2,
                    "parameters": {},
                }
                enabled = client.post("/api/process-flow-instances", json=request)
                self.assertEqual(enabled.status_code, 201, enabled.text)

                request["id"] = "flow_inst_unregistered_generator"
                request["inputBindings"]["incoming_hbm"] = {
                    "kind": "generator",
                    "generatorId": "soc",
                    "generatorVersion": 1,
                    "parameters": {},
                }
                disabled = client.post("/api/process-flow-instances", json=request)
                self.assertEqual(disabled.status_code, 400, disabled.text)
                self.assertIn("Geometry generator soc version 1 is not available", disabled.json()["message"])
                self.assertEqual(
                    client.post(
                        "/api/geometry-generators/soc/preview",
                        json={"generatorVersion": 1, "parameters": {}},
                    ).status_code,
                    404,
                )
        finally:
            app.state.store.close()

    def test_registry_rejects_missing_unknown_or_duplicate_ui_placements(self):
        class InvalidPlacementGenerator(HbmGenerator):
            def __init__(self, placements):
                self.placements = placements

            def definition(self):
                definition = super().definition()
                if self.placements is None:
                    del definition["uiPlacements"]
                else:
                    definition["uiPlacements"] = self.placements
                return definition

        for placements in (None, ["unknown"], ["home", "home"]):
            with self.subTest(placements=placements), self.assertRaises(ValueError):
                GeometryGeneratorRegistry((InvalidPlacementGenerator(placements),))

    def test_generator_catalog_is_backend_driven(self):
        response = self.client.get("/api/geometry-generators")

        self.assertEqual(response.status_code, 200, response.text)
        definitions = response.json()
        self.assertEqual([item["id"] for item in definitions], ["hbm", "dram", "soc", "lsi"])
        hbm = definitions[0]
        self.assertEqual(hbm["version"], 2)
        self.assertEqual(hbm["adaptationContract"]["adapterId"], "hbm-package")
        hbm_parameter_ids = [item["id"] for item in hbm["parameterDefinitions"]]
        self.assertIn("coreDieCount", hbm_parameter_ids)
        self.assertIn("hbmThickness", hbm_parameter_ids)
        self.assertIn("topCoreDieThickness", hbm_parameter_ids)
        self.assertNotIn("topMoldingThickness", hbm_parameter_ids)
        self.assertEqual(hbm["defaultParameters"]["hbmThickness"], 480)
        self.assertEqual(hbm["defaultParameters"]["topCoreDieThickness"], 50)
        self.assertEqual(
            hbm["parameterGroups"],
            [
                {
                    "id": "package-core-size",
                    "label": "Package & core die size",
                    "parameterIds": [
                        "packageX",
                        "packageY",
                        "coreDieX",
                        "coreDieY",
                    ],
                },
                {
                    "id": "core-die-count",
                    "label": "Core die count",
                    "parameterIds": ["coreDieCount"],
                },
                {
                    "id": "thickness-gap",
                    "label": "Thickness & gap",
                    "parameterIds": [
                        "hbmThickness",
                        "baseDieThickness",
                        "coreBaseGap",
                        "coreDieThickness",
                        "coreCoreGap",
                        "topCoreDieThickness",
                    ],
                },
                {
                    "id": "material",
                    "label": "Material",
                    "parameterIds": ["moldingMaterial", "dieMaterial"],
                },
            ],
        )
        dram = definitions[1]
        dram_parameter_ids = [item["id"] for item in dram["parameterDefinitions"]]
        self.assertEqual(dram["version"], 2)
        self.assertIn("dramThickness", dram_parameter_ids)
        self.assertIn("topCoreDieThickness", dram_parameter_ids)
        self.assertNotIn("topMoldingThickness", dram_parameter_ids)
        self.assertEqual(dram["defaultParameters"]["dramThickness"], 650)
        self.assertEqual(dram["defaultParameters"]["topCoreDieThickness"], 50)
        self.assertEqual(
            dram["parameterGroups"],
            [
                {
                    "id": "package-core-size",
                    "label": "Package & core die size",
                    "parameterIds": [
                        "packageX",
                        "packageY",
                        "coreDieX",
                        "coreDieY",
                    ],
                },
                {
                    "id": "core-die-count",
                    "label": "Core die count",
                    "parameterIds": ["coreDieCount"],
                },
                {
                    "id": "thickness-gap",
                    "label": "Thickness & gap",
                    "parameterIds": [
                        "dramThickness",
                        "dieGapThickness",
                        "coreDieThickness",
                        "topCoreDieThickness",
                    ],
                },
                {
                    "id": "substrate",
                    "label": "Substrate",
                    "parameterIds": [
                        "topSolderMaskThickness",
                        "bottomSolderMaskThickness",
                        "sbtCoreLayerThickness",
                        "topBuildupLayers",
                        "bottomBuildupLayers",
                    ],
                },
                {
                    "id": "material",
                    "label": "Material",
                    "parameterIds": [
                        "moldingMaterial",
                        "dieMaterial",
                        "solderMaskMaterial",
                        "sbtCoreMaterial",
                        "buildupDielectricMaterial",
                        "buildupConductiveMaterial",
                    ],
                },
            ],
        )
        for definition in definitions:
            self.assertNotIn(
                "vendor",
                [item["id"] for item in definition["parameterDefinitions"]],
            )
        self.assertEqual(hbm["previewViews"], ["top", "cross-section-x"])
        soc = definitions[2]
        self.assertEqual(soc["version"], 1)
        self.assertEqual(soc["entityType"], "die")
        self.assertEqual(soc["category"], "die.soc")
        self.assertEqual(
            soc["adaptationContract"],
            {"adapterId": "box-rescale", "adapterVersion": 1, "parameters": {}},
        )
        self.assertEqual(soc["defaultParameters"], {"thickness": 150, "material": "Si-SoC"})
        self.assertEqual(
            [item["id"] for item in soc["parameterDefinitions"]],
            ["thickness", "material"],
        )
        self.assertEqual(soc["parameterGroups"], [])
        self.assertEqual(soc["previewViews"], ["top", "cross-section-x"])

        lsi = definitions[3]
        self.assertEqual(lsi["version"], 1)
        self.assertEqual(lsi["category"], "die.lsi")
        self.assertEqual(
            lsi["defaultParameters"],
            {
                "generation": "gen1",
                "layer1Material": "Si-LSI",
                "layer1Thickness": 150,
                "layer2Material": "SiO2",
                "layer2Thickness": 20,
                "layer3Material": "Cu",
                "layer3Thickness": 10,
                "layer4Material": "SiN",
                "layer4Thickness": 20,
            },
        )
        self.assertEqual(lsi["adaptationContract"]["adapterId"], "box-rescale")
        self.assertEqual(
            [item["id"] for item in lsi["parameterDefinitions"]],
            ["generation"]
            + [
                field
                for index in range(1, 5)
                for field in (f"layer{index}Material", f"layer{index}Thickness")
            ],
        )
        self.assertEqual(
            [item["visibleWhen"] for item in lsi["parameterDefinitions"][3:]],
            [{"parameterId": "generation", "equals": "gen2"}] * 6,
        )
        self.assertEqual(lsi["previewViews"], ["top", "cross-section-x"])

    def test_lsi_defaults_preview_both_generations_and_ignore_inactive_values(self):
        initial = self.app.state.geometry_generators.preview("lsi", {}, generator_version=1)
        self.assertTrue(initial["valid"])
        self.assertEqual(
            initial["normalizedParameters"],
            {"generation": "gen1", "layer1Material": "Si-LSI", "layer1Thickness": 150},
        )
        self.assertEqual(initial["computedParameters"]["totalThickness"], 150)
        gen2_default = self.app.state.geometry_generators.preview(
            "lsi", {"generation": "gen2"}, generator_version=1
        )
        self.assertTrue(gen2_default["valid"])
        self.assertEqual(gen2_default["computedParameters"]["totalThickness"], 200)
        self.assertEqual(
            len(gen2_default["geometryEntityJson"]["structure"]["root"]["bodies"]),
            4,
        )

        blank = self.app.state.geometry_generators.preview(
            "lsi", {"layer1Material": "", "layer1Thickness": ""}, generator_version=1
        )
        self.assertFalse(blank["valid"])
        self.assertEqual(set(blank["errors"]), {"layer1Material", "layer1Thickness"})

        response = self.client.post(
            "/api/geometry-generators/lsi/preview",
            json={
                "generatorVersion": 1,
                "parameters": {
                    "generation": "gen1",
                    "layer1Material": "  Si-LSI  ",
                    "layer1Thickness": 150,
                    "layer2Material": "",
                    "layer2Thickness": -10,
                },
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        self.assertEqual(
            preview["normalizedParameters"],
            {"generation": "gen1", "layer1Material": "Si-LSI", "layer1Thickness": 150},
        )
        self.assertEqual(
            preview["computedParameters"],
            {"packageX": 8000, "packageY": 10000, "totalThickness": 150},
        )
        entity = preview["geometryEntityJson"]
        self.assertEqual(entity["dim"], "8000 x 10000 x 150 um")
        self.assertEqual(entity["generation"]["parameters"], preview["normalizedParameters"])
        self.assertEqual(entity["structure"]["root"]["key"], "lsi")
        self.assertEqual(len(entity["structure"]["root"]["bodies"]), 1)
        self.assertEqual(
            entity["structure"]["root"]["bodies"][0]["geometry"],
            {
                "type": "BoxGeometry",
                "bottom_left": [-4000, -5000, -75],
                "top_right": [4000, 5000, -75],
                "thk": 150,
            },
        )

    def test_lsi_gen2_stacks_four_layers_and_materializes(self):
        parameters = {
            "generation": "gen2",
            "layer1Material": "  Si  ",
            "layer1Thickness": 10,
            "layer2Material": "Oxide",
            "layer2Thickness": 20,
            "layer3Material": "Cu",
            "layer3Thickness": 30,
            "layer4Material": "Nitride",
            "layer4Thickness": 40,
        }
        response = self.client.post(
            "/api/geometry-generators/lsi/preview",
            json={"generatorVersion": 1, "parameters": parameters},
        )
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        self.assertEqual(preview["normalizedParameters"]["layer1Material"], "Si")
        self.assertEqual(preview["computedParameters"]["totalThickness"], 100)
        self.assertEqual(preview["geometryEntityJson"]["dim"], "8000 x 10000 x 100 um")
        self.assertEqual(
            _dimension_values(preview["engineeringPreview"]["views"][1]),
            {"Total thickness": 100},
        )
        bodies = preview["geometryEntityJson"]["structure"]["root"]["bodies"]
        self.assertEqual(len(bodies), 4)
        self.assertEqual(
            [body["material"] for body in bodies],
            ["Si", "Oxide", "Cu", "Nitride"],
        )
        self.assertEqual(
            [body["geometry"]["bottom_left"][2] for body in bodies],
            [-50, -40, -20, 10],
        )
        self.assertEqual([body["geometry"]["thk"] for body in bodies], [10, 20, 30, 40])
        self.assertEqual(
            [body["geometry"]["bottom_left"][:2] for body in bodies],
            [[-4000, -5000]] * 4,
        )

        materialized = self.client.post(
            "/api/geometry-materializations",
            json={"previewToken": preview["previewToken"]},
        )
        self.assertEqual(materialized.status_code, 200, materialized.text)
        self.assertEqual(materialized.json()["geometryEntityJson"], preview["geometryEntityJson"])
        saved = self.client.post(
            "/api/geometries",
            json={**materialized.json()["geometryEntityJson"], "name": "Four-layer LSI", "owner": "test"},
        )
        self.assertEqual(saved.status_code, 201, saved.text)
        self.assertEqual(saved.json()["generation"]["parameters"], preview["normalizedParameters"])

    def test_lsi_rejects_invalid_generation_and_active_layers(self):
        registry = self.app.state.geometry_generators
        invalid_generation = registry.preview("lsi", {"generation": "gen3"}, generator_version=1)
        self.assertEqual(set(invalid_generation["errors"]), {"generation"})

        invalid_gen2 = registry.preview(
            "lsi",
            {
                "generation": "gen2",
                "layer1Material": "Si",
                "layer1Thickness": 10,
                "layer2Material": " ",
                "layer2Thickness": 0,
                "layer3Material": "Cu",
                "layer3Thickness": True,
                "layer4Material": "Nitride",
                "layer4Thickness": 40,
            },
            generator_version=1,
        )
        self.assertEqual(
            set(invalid_gen2["errors"]),
            {"layer2Material", "layer2Thickness", "layer3Thickness"},
        )
        self.assertFalse(invalid_gen2["valid"])

    def test_soc_preview_has_one_box_and_only_two_saved_parameters(self):
        default = self.app.state.geometry_generators.preview(
            "soc", {}, generator_version=1
        )
        self.assertEqual(
            default["normalizedParameters"],
            {"thickness": 150, "material": "Si-SoC"},
        )
        default_box = default["geometryEntityJson"]["structure"]["root"]["bodies"][0]["geometry"]
        self.assertEqual(default_box["bottom_left"], [-4000, -5000, -75])

        response = self.client.post(
            "/api/geometry-generators/soc/preview",
            json={
                "generatorVersion": 1,
                "parameters": {"thickness": 220, "material": "  Si-Custom  "},
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        self.assertEqual(
            preview["normalizedParameters"],
            {"thickness": 220, "material": "Si-Custom"},
        )
        self.assertEqual(
            preview["computedParameters"],
            {"packageX": 8000, "packageY": 10000, "totalThickness": 220},
        )
        top, section = preview["engineeringPreview"]["views"]
        self.assertEqual(_dimension_values(top), {"Overall X": 8000, "Overall Y": 10000})
        self.assertEqual(_dimension_values(section), {"Total thickness": 220})

        entity = preview["geometryEntityJson"]
        self.assertEqual(entity["dim"], "8000 x 10000 x 220 um")
        self.assertEqual(entity["generation"], {
            "generatorId": "soc",
            "schemaVersion": 1,
            "parameters": {"thickness": 220, "material": "Si-Custom"},
        })
        self.assertEqual(
            entity["adaptationContract"],
            {"adapterId": "box-rescale", "adapterVersion": 1, "parameters": {}},
        )
        root = entity["structure"]["root"]
        self.assertEqual(root["key"], "soc")
        self.assertEqual(len(root["bodies"]), 1)
        self.assertEqual(root["children"], [])
        body = root["bodies"][0]
        self.assertEqual(body["key"], "envelope")
        self.assertEqual(body["material"], "Si-Custom")
        self.assertEqual(body["geometry"], {
            "type": "BoxGeometry",
            "bottom_left": [-4000, -5000, -110],
            "top_right": [4000, 5000, -110],
            "thk": 220,
        })

    def test_soc_rejects_invalid_thickness_and_material(self):
        for thickness in (0, -1, True, "150", float("nan"), float("inf")):
            with self.subTest(thickness=thickness):
                preview = self.app.state.geometry_generators.preview(
                    "soc", {"thickness": thickness}, generator_version=1
                )
                self.assertFalse(preview["valid"])
                self.assertIn("thickness", preview["errors"])
                self.assertIsNone(preview["geometryEntityJson"])
        for material in ("", "  ", None):
            with self.subTest(material=material):
                preview = self.app.state.geometry_generators.preview(
                    "soc", {"material": material}, generator_version=1
                )
                self.assertFalse(preview["valid"])
                self.assertIn("material", preview["errors"])

    def test_exact_definition_endpoint_and_versioned_registry(self):
        exact = self.client.get("/api/geometry-generators/hbm/versions/2")
        self.assertEqual(exact.status_code, 200, exact.text)
        self.assertEqual(exact.json()["version"], 2)
        missing = self.client.get("/api/geometry-generators/hbm/versions/1")
        self.assertEqual(missing.status_code, 404, missing.text)

        class HbmV3(HbmGenerator):
            def definition(self):
                definition = super().definition()
                definition["version"] = 3
                return definition

        registry = GeometryGeneratorRegistry((HbmGenerator(), HbmV3()))
        self.assertEqual(registry.definitions()[0]["version"], 3)
        self.assertEqual(registry.definition("hbm", 2)["version"], 2)
        self.assertEqual(registry.generate("hbm", 2, {})["generation"]["schemaVersion"], 2)
        self.assertEqual(registry.generate("hbm", 3, {})["generation"]["schemaVersion"], 3)

    def test_v2_default_structures_remain_stable(self):
        registry = GeometryGeneratorRegistry()
        register_builtin_generators(registry)
        self.assertEqual(
            registry.preview("hbm", {}, generator_version=2)["geometryHash"],
            "sha256:398ea0156cfd06137ae9a573168ba4cca31f040f2c6c3990f86b8681bbd2e371",
        )
        self.assertEqual(
            registry.preview("dram", {}, generator_version=2)["geometryHash"],
            "sha256:0638938a920195a3689cfb0aa42f7f4ff1c33de1a23169a0ada619087df17e09",
        )

    def test_hbm_preview_materializes_geometry_and_engineering_views(self):
        response = self.client.post(
            "/api/geometry-generators/hbm/preview",
            json={
                "generatorVersion": 2,
                "parameters": {
                    "packageX": 1400,
                    "packageY": 1000,
                    "hbmThickness": 340,
                    "coreDieX": 800,
                    "coreDieY": 600,
                    "coreDieThickness": 40,
                    "topCoreDieThickness": 70,
                    "coreDieCount": 3,
                    "topMoldingThickness": 999,
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        self.assertTrue(preview["geometryHash"].startswith("sha256:"))
        self.assertTrue(preview["previewToken"].startswith("generator_preview_"))
        self.assertEqual(
            [view["id"] for view in preview["engineeringPreview"]["views"]],
            ["top", "cross-section-x"],
        )
        top_view, section_view = preview["engineeringPreview"]["views"]
        self.assertEqual(
            _dimension_values(top_view),
            {
                "Overall X": 1400,
                "Overall Y": 1000,
                "Core die X": 800,
                "Core die Y": 600,
            },
        )
        self.assertEqual(
            _dimension_values(section_view)["Core die thickness"],
            40,
        )
        self.assertEqual(_dimension_values(section_view)["Total thickness"], 340)
        self.assertEqual(preview["computedParameters"]["totalThickness"], 340)
        self.assertEqual(preview["computedParameters"]["topMoldingThickness"], 30)
        self.assertNotIn("topMoldingThickness", preview["normalizedParameters"])
        entity = preview["geometryEntityJson"]
        self.assertEqual(entity["adaptationContract"]["adapterId"], "hbm-package")
        self.assertEqual(entity["dim"], "1400 x 1000 x 340 um")
        self.assertEqual(entity["generation"]["schemaVersion"], 2)
        self.assertNotIn(
            "topMoldingThickness", entity["generation"]["parameters"]
        )
        self.assertNotIn("vendor", entity)
        root = entity["structure"]["root"]
        self.assertEqual(root["bodies"][0]["geometry"]["bottom_left"], [-700, -500, 0])
        self.assertEqual(root["bodies"][0]["geometry"]["top_right"], [700, 500, 0])
        self.assertEqual(root["bodies"][0]["geometry"]["thk"], 340)
        self.assertEqual(len(root["children"]), 4)
        self.assertEqual(
            root["children"][1]["bodies"][0]["geometry"]["bottom_left"][:2],
            [-400, -300],
        )
        core_geometries = [
            child["bodies"][0]["geometry"] for child in root["children"][1:]
        ]
        self.assertEqual(
            [geometry["bottom_left"][2] for geometry in core_geometries],
            [120, 180, 240],
        )
        self.assertEqual(
            [geometry["thk"] for geometry in core_geometries],
            [40, 40, 70],
        )

        materialized = self.client.post(
            "/api/geometry-materializations",
            json={"previewToken": preview["previewToken"]},
        )
        self.assertEqual(materialized.status_code, 200, materialized.text)
        self.assertEqual(materialized.json()["geometryHash"], preview["geometryHash"])
        self.assertEqual(materialized.json()["geometryEntityJson"], entity)

    def test_hbm_single_core_uses_top_thickness_and_allows_zero_top_molding(self):
        response = self.client.post(
            "/api/geometry-generators/hbm/preview",
            json={
                "generatorVersion": 2,
                "parameters": {
                    "hbmThickness": 200,
                    "baseDieThickness": 100,
                    "coreBaseGap": 20,
                    "coreDieThickness": 40,
                    "topCoreDieThickness": 80,
                    "coreDieCount": 1,
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        self.assertEqual(preview["computedParameters"]["topMoldingThickness"], 0)
        root = preview["geometryEntityJson"]["structure"]["root"]
        self.assertEqual(len(root["children"]), 2)
        only_core = root["children"][1]["bodies"][0]["geometry"]
        self.assertEqual(only_core["bottom_left"][2], 120)
        self.assertEqual(only_core["thk"], 80)
        section_view = preview["engineeringPreview"]["views"][1]
        self.assertEqual(
            _dimension_values(section_view)["Core die thickness"],
            80,
        )

    def test_hbm_rejects_thickness_smaller_than_occupied_stack(self):
        response = self.client.post(
            "/api/geometry-generators/hbm/preview",
            json={"generatorVersion": 2, "parameters": {"hbmThickness": 379}},
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertFalse(preview["valid"])
        self.assertIn("hbmThickness", preview["errors"])
        self.assertEqual(preview["computedParameters"], {})
        self.assertIsNone(preview["previewToken"])
        self.assertIsNone(preview["geometryEntityJson"])

    def test_hbm_v1_preview_is_no_longer_available(self):
        response = self.client.post(
            "/api/geometry-generators/hbm/preview",
            json={"generatorVersion": 1, "parameters": {}},
        )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("version 1 is not available", response.json()["message"])

    def test_invalid_preview_returns_field_errors_without_token(self):
        response = self.client.post(
            "/api/geometry-generators/hbm/preview",
            json={"parameters": {"packageX": 0, "coreDieCount": 100}},
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertFalse(preview["valid"])
        self.assertIn("packageX", preview["errors"])
        self.assertIn("coreDieCount", preview["errors"])
        self.assertIsNone(preview["previewToken"])
        self.assertIsNone(preview["geometryEntityJson"])

    def test_dram_preview_preserves_buildup_and_core_stack(self):
        response = self.client.post(
            "/api/geometry-generators/dram/preview",
            json={
                "generatorVersion": 2,
                "parameters": {
                    "dramThickness": 670,
                    "topCoreDieThickness": 70,
                    "topMoldingThickness": 999,
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        root = preview["geometryEntityJson"]["structure"]["root"]
        self.assertEqual(root["key"], "dram")
        self.assertEqual(len(root["children"]), 3)
        self.assertEqual(len(root["circuits"]), 4)
        self.assertEqual(preview["computedParameters"]["sbtThickness"], 340)
        self.assertEqual(preview["computedParameters"]["moldedBodyThickness"], 330)
        self.assertEqual(preview["computedParameters"]["topMoldingThickness"], 100)
        self.assertEqual(preview["computedParameters"]["totalThickness"], 670)
        self.assertNotIn("topMoldingThickness", preview["normalizedParameters"])
        self.assertEqual(
            preview["geometryEntityJson"]["dim"],
            "12000 x 8000 x 670 um",
        )
        self.assertEqual(
            preview["geometryEntityJson"]["generation"]["schemaVersion"], 2
        )
        self.assertNotIn(
            "topMoldingThickness",
            preview["geometryEntityJson"]["generation"]["parameters"],
        )
        molding_geometry = root["bodies"][0]["geometry"]
        self.assertEqual(molding_geometry["bottom_left"][2], 340)
        self.assertEqual(molding_geometry["thk"], 330)
        core_geometries = [child["bodies"][0]["geometry"] for child in root["children"]]
        self.assertEqual(
            [geometry["bottom_left"][2] for geometry in core_geometries],
            [360, 430, 500],
        )
        self.assertEqual(
            [geometry["thk"] for geometry in core_geometries],
            [50, 50, 70],
        )
        top_view, section_view = preview["engineeringPreview"]["views"]
        self.assertEqual(_dimension_values(top_view)["Core die X"], 8000)
        self.assertEqual(_dimension_values(top_view)["Core die Y"], 6000)
        self.assertEqual(
            _dimension_values(section_view)["Core die thickness"],
            50,
        )
        self.assertEqual(_dimension_values(section_view)["Total thickness"], 670)

    def test_dram_single_core_uses_top_thickness_and_allows_zero_top_molding(self):
        response = self.client.post(
            "/api/geometry-generators/dram/preview",
            json={
                "generatorVersion": 2,
                "parameters": {
                    "dramThickness": 410,
                    "coreDieThickness": 40,
                    "topCoreDieThickness": 50,
                    "coreDieCount": 1,
                },
            },
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        self.assertEqual(preview["computedParameters"]["sbtThickness"], 340)
        self.assertEqual(preview["computedParameters"]["topMoldingThickness"], 0)
        root = preview["geometryEntityJson"]["structure"]["root"]
        self.assertEqual(len(root["children"]), 1)
        only_core = root["children"][0]["bodies"][0]["geometry"]
        self.assertEqual(only_core["bottom_left"][2], 360)
        self.assertEqual(only_core["thk"], 50)
        section_view = preview["engineeringPreview"]["views"][1]
        self.assertEqual(
            _dimension_values(section_view)["Core die thickness"],
            50,
        )

    def test_dram_rejects_thickness_smaller_than_substrate_and_die_stack(self):
        response = self.client.post(
            "/api/geometry-generators/dram/preview",
            json={"generatorVersion": 2, "parameters": {"dramThickness": 549}},
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertFalse(preview["valid"])
        self.assertIn("dramThickness", preview["errors"])
        self.assertEqual(preview["computedParameters"], {})
        self.assertIsNone(preview["previewToken"])
        self.assertIsNone(preview["geometryEntityJson"])

    def test_dram_v1_preview_is_no_longer_available(self):
        response = self.client.post(
            "/api/geometry-generators/dram/preview",
            json={"generatorVersion": 1, "parameters": {}},
        )

        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn("version 1 is not available", response.json()["message"])

    def test_unknown_or_expired_generator_resources_return_not_found(self):
        unknown_generator = self.client.post(
            "/api/geometry-generators/not-installed/preview",
            json={"parameters": {}},
        )
        missing_preview = self.client.post(
            "/api/geometry-materializations",
            json={"previewToken": "generator_preview_missing"},
        )

        self.assertEqual(unknown_generator.status_code, 404)
        self.assertEqual(missing_preview.status_code, 404)


def _dimension_values(view):
    return {
        dimension["label"]: dimension["value"]
        for dimension in view["dimensions"]
    }


if __name__ == "__main__":
    unittest.main()
