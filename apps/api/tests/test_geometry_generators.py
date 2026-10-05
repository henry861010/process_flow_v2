from __future__ import annotations

import copy
import unittest

from fastapi.testclient import TestClient

from process_flow_api.main import create_app
from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators
from process_flow_geometry_generators.hbm import HbmGenerator
from process_flow_kernel import GeometryArtifact
from process_flow_steps.pnp.adapters import adapt_geometry


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
            "vrm": ["templateGeometryLibrary", "flowInputPicker"],
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
        self.assertEqual([item["id"] for item in definitions], ["hbm", "dram", "soc", "vrm", "lsi"])
        hbm = definitions[0]
        self.assertEqual(hbm["version"], 2)
        self.assertEqual(hbm["adaptationContract"]["adapterId"], "hbm-package")
        hbm_parameter_ids = [item["id"] for item in hbm["parameterDefinitions"]]
        self.assertIn("coreDieCount", hbm_parameter_ids)
        self.assertNotIn("hbmThickness", hbm_parameter_ids)
        self.assertIn("topCoreDieThickness", hbm_parameter_ids)
        self.assertNotIn("topMoldingThickness", hbm_parameter_ids)
        self.assertNotIn("hbmThickness", hbm["defaultParameters"])
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
        self.assertEqual(soc["defaultParameters"], {
            "pass2Thickness": 5.625, "pass2Material": "pass2",
            "usgThickness": 2.89, "usgMaterial": "usg",
            "elkThickness": 1.315, "elkMaterial": "elk",
            "siThickness": 200, "siMaterial": "si",
        })
        self.assertEqual(
            [item["id"] for item in soc["parameterDefinitions"]],
            [
                f"{layer}{suffix}"
                for layer in ("pass2", "usg", "elk", "si")
                for suffix in ("Thickness", "Material")
            ],
        )
        self.assertEqual(
            [group["label"] for group in soc["parameterGroups"]],
            ["Pass2", "usg", "elk", "si"],
        )
        for parameter in soc["parameterDefinitions"]:
            if parameter["id"].endswith("Thickness"):
                self.assertEqual(parameter["validation"]["min"], 0)
                self.assertFalse(parameter["validation"]["exclusiveMin"])
        self.assertEqual(soc["previewViews"], ["top", "cross-section-x"])

        vrm = definitions[3]
        self.assertEqual(vrm["version"], 1)
        self.assertEqual(vrm["entityType"], "die")
        self.assertEqual(vrm["category"], "die.vrm")
        self.assertEqual(vrm["adaptationContract"], soc["adaptationContract"])
        self.assertEqual(vrm["defaultParameters"], {"thickness": 150, "material": "Si-VRM"})
        self.assertEqual(
            [parameter["id"] for parameter in vrm["parameterDefinitions"]],
            ["thickness", "material"],
        )
        self.assertEqual(vrm["parameterGroups"], [])
        self.assertEqual(vrm["previewViews"], soc["previewViews"])

        lsi = definitions[4]
        self.assertEqual(lsi["version"], 1)
        self.assertEqual(lsi["category"], "die.lsi")
        self.assertEqual(
            lsi["defaultParameters"],
            {
                "generation": "gen1",
                "bsmcMaterial": "Mat_MCA7UUU0P1",
                "bsmcThickness": 15,
                "siMaterial": "Si",
                "siThickness": 200,
                "usgMaterial": "usg",
                "usgThickness": 15.5,
                "lsiTopMoldingMaterial": "lsi_top_molding",
                "lsiTopMoldingThickness": 26,
                "prePm0Material": "Mat_PIBL301UUU0P1",
                "prePm0Thickness": 15,
            },
        )
        self.assertEqual(lsi["adaptationContract"]["adapterId"], "box-rescale")
        self.assertEqual(
            [item["id"] for item in lsi["parameterDefinitions"]],
            [
                "generation",
                "bsmcMaterial",
                "bsmcThickness",
                "siMaterial",
                "siThickness",
                "usgMaterial",
                "usgThickness",
                "lsiTopMoldingMaterial",
                "lsiTopMoldingThickness",
                "prePm0Material",
                "prePm0Thickness",
            ],
        )
        self.assertEqual(
            {
                item["id"]: item.get("visibleWhen")
                for item in lsi["parameterDefinitions"]
            },
            {
                "generation": None,
                "bsmcMaterial": {"parameterId": "generation", "equals": "gen2"},
                "bsmcThickness": {"parameterId": "generation", "equals": "gen2"},
                "siMaterial": None,
                "siThickness": None,
                "usgMaterial": None,
                "usgThickness": None,
                "lsiTopMoldingMaterial": {
                    "parameterId": "generation",
                    "equals": "gen1",
                },
                "lsiTopMoldingThickness": {
                    "parameterId": "generation",
                    "equals": "gen1",
                },
                "prePm0Material": {"parameterId": "generation", "equals": "gen2"},
                "prePm0Thickness": {"parameterId": "generation", "equals": "gen2"},
            },
        )
        self.assertEqual(
            [(group["id"], group["label"]) for group in lsi["parameterGroups"]],
            [
                ("generation", "Generation"),
                ("layer-bsmc", "bsmc"),
                ("layer-si", "si"),
                ("layer-usg", "usg"),
                ("layer-lsiTopMolding", "LSI_top_molding"),
                ("layer-prePm0", "prePm0"),
            ],
        )
        self.assertEqual(lsi["previewViews"], ["top", "cross-section-x"])

    def test_lsi_defaults_preview_both_generations(self):
        initial = self.app.state.geometry_generators.preview("lsi", {}, generator_version=1)
        self.assertTrue(initial["valid"])
        self.assertEqual(initial["computedParameters"]["totalThickness"], 241.5)
        gen2_default = self.app.state.geometry_generators.preview(
            "lsi", {"generation": "gen2"}, generator_version=1
        )
        self.assertTrue(gen2_default["valid"])
        self.assertEqual(gen2_default["computedParameters"]["totalThickness"], 245.5)

    def test_lsi_gen1_stacks_named_layers_and_ignores_gen2_values(self):
        response = self.client.post(
            "/api/geometry-generators/lsi/preview",
            json={
                "generatorVersion": 1,
                "parameters": {
                    "generation": "gen1",
                    "siMaterial": "  Si  ",
                    "siThickness": 100,
                    "usgMaterial": "  USG  ",
                    "lsiTopMoldingMaterial": "  Mold  ",
                    "bsmcMaterial": "",
                    "bsmcThickness": -10,
                    "prePm0Material": "",
                    "prePm0Thickness": -10,
                },
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        self.assertEqual(
            preview["normalizedParameters"],
            {
                "generation": "gen1",
                "siMaterial": "Si",
                "siThickness": 100,
                "usgMaterial": "USG",
                "usgThickness": 15.5,
                "lsiTopMoldingMaterial": "Mold",
                "lsiTopMoldingThickness": 26,
            },
        )
        self.assertEqual(
            preview["computedParameters"],
            {"packageX": 8000, "packageY": 10000, "totalThickness": 141.5},
        )
        entity = preview["geometryEntityJson"]
        self.assertEqual(entity["dim"], "8000 x 10000 x 141.5 um")
        self.assertEqual(entity["generation"]["parameters"], preview["normalizedParameters"])
        self.assertEqual(entity["structure"]["root"]["key"], "lsi")
        bodies = entity["structure"]["root"]["bodies"]
        self.assertEqual(
            [body["id"] for body in bodies],
            ["body:lsi-si", "body:lsi-usg", "body:lsi-top-molding"],
        )
        self.assertEqual([body["material"] for body in bodies], ["Si", "USG", "Mold"])
        self.assertEqual([body["geometry"]["thk"] for body in bodies], [100, 15.5, 26])
        self.assertEqual(
            [body["geometry"]["bottom_left"][2] for body in bodies],
            [-70.75, 29.25, 44.75],
        )

    def test_lsi_gen2_stacks_named_layers_and_materializes(self):
        parameters = {
            "generation": "gen2",
            "siMaterial": "  Si  ",
            "siThickness": 10,
            "usgMaterial": "USG",
        }
        response = self.client.post(
            "/api/geometry-generators/lsi/preview",
            json={"generatorVersion": 1, "parameters": parameters},
        )
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        self.assertEqual(preview["normalizedParameters"]["siMaterial"], "Si")
        self.assertEqual(preview["computedParameters"]["totalThickness"], 55.5)
        self.assertEqual(preview["geometryEntityJson"]["dim"], "8000 x 10000 x 55.5 um")
        self.assertEqual(
            _dimension_values(preview["engineeringPreview"]["views"][1]),
            {"Total thickness": 55.5},
        )
        bodies = preview["geometryEntityJson"]["structure"]["root"]["bodies"]
        self.assertEqual(len(bodies), 4)
        self.assertEqual(
            [body["id"] for body in bodies],
            [
                "body:lsi-bsmc",
                "body:lsi-si",
                "body:lsi-usg",
                "body:lsi-pre-pm0",
            ],
        )
        self.assertEqual(
            [body["material"] for body in bodies],
            ["Mat_MCA7UUU0P1", "Si", "USG", "Mat_PIBL301UUU0P1"],
        )
        self.assertEqual(
            [body["geometry"]["bottom_left"][2] for body in bodies],
            [-27.75, -12.75, -2.75, 12.75],
        )
        self.assertEqual(
            [body["geometry"]["thk"] for body in bodies],
            [15, 10, 15.5, 15],
        )
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
            json={**materialized.json()["geometryEntityJson"], "name": "Gen 2 LSI", "owner": "test"},
        )
        self.assertEqual(saved.status_code, 201, saved.text)
        self.assertEqual(saved.json()["generation"]["parameters"], preview["normalizedParameters"])

        customized = self.app.state.geometry_generators.preview(
            "lsi",
            {
                **parameters,
                "bsmcMaterial": "Custom-BSMC",
                "bsmcThickness": 12,
                "prePm0Material": "Custom-PrePm0",
                "prePm0Thickness": 17,
            },
            generator_version=1,
        )
        self.assertTrue(customized["valid"])
        customized_bodies = customized["geometryEntityJson"]["structure"]["root"]["bodies"]
        self.assertEqual(
            [customized_bodies[index]["material"] for index in (0, 3)],
            ["Custom-BSMC", "Custom-PrePm0"],
        )
        self.assertEqual(
            [customized_bodies[index]["geometry"]["thk"] for index in (0, 3)],
            [12, 17],
        )

    def test_lsi_rejects_invalid_generation_and_active_layers(self):
        registry = self.app.state.geometry_generators
        invalid_generation = registry.preview("lsi", {"generation": "gen3"}, generator_version=1)
        self.assertEqual(set(invalid_generation["errors"]), {"generation"})

        legacy_recipe = registry.preview(
            "lsi",
            {
                "generation": "gen1",
                "layer1Material": "Si-LSI",
                "layer1Thickness": 150,
            },
            generator_version=1,
        )
        self.assertEqual(
            set(legacy_recipe["errors"]),
            {"layer1Material", "layer1Thickness"},
        )

        invalid_gen2 = registry.preview(
            "lsi",
            {
                "generation": "gen2",
                "siMaterial": "Si",
                "siThickness": 10,
                "usgMaterial": " ",
                "usgThickness": 0,
                "bsmcThickness": True,
                "lsiTopMoldingMaterial": "",
                "lsiTopMoldingThickness": -1,
            },
            generator_version=1,
        )
        self.assertEqual(
            set(invalid_gen2["errors"]),
            {"bsmcThickness", "usgMaterial", "usgThickness"},
        )
        self.assertFalse(invalid_gen2["valid"])

    def test_soc_preview_has_four_contiguous_layers(self):
        default = self.app.state.geometry_generators.preview(
            "soc", {}, generator_version=1
        )
        self.assertTrue(default["valid"])
        self.assertAlmostEqual(default["computedParameters"]["totalThickness"], 209.83)
        bodies = default["geometryEntityJson"]["structure"]["root"]["bodies"]
        self.assertEqual([body["key"] for body in bodies], ["soc.pass2", "soc.usg", "soc.elk", "soc.si"])
        self.assertEqual([body["material"] for body in bodies], ["pass2", "usg", "elk", "si"])
        self.assertEqual([body["geometry"]["thk"] for body in bodies], [5.625, 2.89, 1.315, 200])
        self.assertAlmostEqual(bodies[0]["geometry"]["bottom_left"][2], -104.915)
        for lower, upper in zip(bodies, bodies[1:]):
            self.assertAlmostEqual(
                lower["geometry"]["bottom_left"][2] + lower["geometry"]["thk"],
                upper["geometry"]["bottom_left"][2],
            )
        self.assertAlmostEqual(bodies[-1]["geometry"]["bottom_left"][2] + 200, 104.915)
        self.assertEqual(default["geometryEntityJson"]["dim"], "8000 x 10000 x 209.83 um")

        parameters = {
            "pass2Thickness": 10, "pass2Material": "  Pass2-Custom  ",
            "usgThickness": 20, "usgMaterial": "  usg-Custom  ",
            "elkThickness": 30, "elkMaterial": "  elk-Custom  ",
            "siThickness": 40, "siMaterial": "  si-Custom  ",
        }
        response = self.client.post(
            "/api/geometry-generators/soc/preview",
            json={"generatorVersion": 1, "parameters": parameters},
        )
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertTrue(preview["valid"])
        normalized = {key: value.strip() if isinstance(value, str) else value
                      for key, value in parameters.items()}
        self.assertEqual(preview["normalizedParameters"], normalized)
        self.assertEqual(preview["computedParameters"], {
            "packageX": 8000, "packageY": 10000, "totalThickness": 100,
        })
        top, section = preview["engineeringPreview"]["views"]
        self.assertEqual(_dimension_values(top), {"Overall X": 8000, "Overall Y": 10000})
        self.assertEqual(_dimension_values(section), {"Total thickness": 100})
        entity = preview["geometryEntityJson"]
        self.assertEqual(entity["generation"], {
            "generatorId": "soc", "schemaVersion": 1, "parameters": normalized,
        })
        self.assertEqual(entity["adaptationContract"], {
            "adapterId": "box-rescale", "adapterVersion": 1, "parameters": {},
        })
        self.assertEqual(entity["structure"]["root"]["children"], [])
        bodies = entity["structure"]["root"]["bodies"]
        for body, layer, bottom_z, thickness in zip(
            bodies, ("pass2", "usg", "elk", "si"), (-50, -40, -20, 10), (10, 20, 30, 40)
        ):
            self.assertEqual(body["id"], f"body:soc-{layer}")
            self.assertEqual(body["key"], f"soc.{layer}")
            self.assertEqual(body["material"], normalized[f"{layer}Material"])
            self.assertEqual(body["geometry"], {
                "type": "BoxGeometry", "bottom_left": [-4000, -5000, bottom_z],
                "top_right": [4000, 5000, bottom_z], "thk": thickness,
            })
        materialized = self.client.post(
            "/api/geometry-materializations", json={"previewToken": preview["previewToken"]}
        )
        self.assertEqual(materialized.status_code, 200, materialized.text)
        self.assertEqual(materialized.json()["geometryEntityJson"], entity)

    def test_soc_zero_thickness_omits_any_combination_of_layers(self):
        layers = ("pass2", "usg", "elk", "si")
        registry = self.app.state.geometry_generators
        for mask in range(1, 16):
            with self.subTest(mask=mask):
                parameters = {f"{layer}Thickness": 10 if mask & (1 << index) else 0
                              for index, layer in enumerate(layers)}
                preview = registry.preview("soc", parameters, generator_version=1)
                self.assertTrue(preview["valid"], preview["errors"])
                entity = preview["geometryEntityJson"]
                bodies = entity["structure"]["root"]["bodies"]
                expected_layers = [layer for layer in layers if parameters[f"{layer}Thickness"] > 0]
                self.assertEqual([body["key"] for body in bodies], [f"soc.{layer}" for layer in expected_layers])
                total = 10 * len(expected_layers)
                self.assertEqual(preview["computedParameters"]["totalThickness"], total)
                for index, body in enumerate(bodies):
                    self.assertEqual(body["geometry"]["bottom_left"][2], -total / 2 + index * 10)
                    self.assertEqual(body["geometry"]["thk"], 10)
                for key, value in parameters.items():
                    self.assertEqual(entity["generation"]["parameters"][key], value)
                section = preview["engineeringPreview"]["views"][1]
                self.assertEqual(_dimension_values(section), {"Total thickness": total})
                self.assertEqual(registry.generate("soc", 1, parameters), entity)
                self.assertEqual(registry.materialize(preview["previewToken"])["geometryEntityJson"], entity)

    def test_soc_legacy_parameters_reset_to_four_layer_defaults(self):
        registry = self.app.state.geometry_generators
        defaults = registry.generate("soc", 1, {})
        legacy = registry.generate("soc", 1, {"thickness": 220, "material": "Si-Custom"})
        self.assertEqual(legacy, defaults)
        mixed = registry.generate("soc", 1, {
            "thickness": 220, "material": "Si-Custom", "elkThickness": 0,
            "siMaterial": "  si-New  ",
        })
        self.assertEqual(mixed["generation"]["parameters"]["elkThickness"], 0)
        self.assertEqual(mixed["generation"]["parameters"]["siMaterial"], "si-New")
        self.assertNotIn("thickness", mixed["generation"]["parameters"])
        self.assertNotIn("material", mixed["generation"]["parameters"])

    def test_soc_layers_adapt_to_rectangle_and_polygon_footprints(self):
        registry = self.app.state.geometry_generators
        for parameters in ({}, {"elkThickness": 0}):
            entity = registry.generate("soc", 1, parameters)
            original = copy.deepcopy(entity["structure"])
            for region in (
                {"type": "rectangle", "width": 100, "height": 80},
                {"type": "polygon", "points": [[0, 0], [100, 0], [80, 80], [0, 80]]},
            ):
                with self.subTest(parameters=parameters, region=region):
                    adapted = adapt_geometry(GeometryArtifact.from_entity(entity), region)
                    bodies = adapted["root"]["bodies"]
                    self.assertEqual(len(bodies), len(original["root"]["bodies"]))
                    for source, body in zip(original["root"]["bodies"], bodies):
                        self.assertEqual(body["key"], source["key"])
                        self.assertEqual(body["material"], source["material"])
                        self.assertEqual(body["geometry"]["thk"], source["geometry"]["thk"])
                        if region["type"] == "rectangle":
                            box = body["geometry"]
                            self.assertEqual(box["bottom_left"][2], source["geometry"]["bottom_left"][2])
                            self.assertEqual(box["top_right"][0] - box["bottom_left"][0], 100)
                            self.assertEqual(box["top_right"][1] - box["bottom_left"][1], 80)
                        else:
                            polygon = body["geometry"]
                            self.assertEqual(polygon["type"], "PolygonGeometry")
                            self.assertEqual([point[:2] for point in polygon["polys"][0]], region["points"])
                            self.assertTrue(all(
                                point[2] == source["geometry"]["bottom_left"][2]
                                for point in polygon["polys"][0]
                            ))
                    self.assertEqual(entity["structure"], original)

    def test_soc_rejects_invalid_thickness_material_and_empty_stack(self):
        registry = self.app.state.geometry_generators
        for layer in ("pass2", "usg", "elk", "si"):
            thickness_id = f"{layer}Thickness"
            for thickness in (-1, True, "150", None, float("nan"), float("inf")):
                with self.subTest(layer=layer, thickness=thickness):
                    preview = registry.preview("soc", {thickness_id: thickness}, generator_version=1)
                    self.assertFalse(preview["valid"])
                    self.assertIn(thickness_id, preview["errors"])
                    self.assertIsNone(preview["geometryEntityJson"])
                    self.assertIsNone(preview["previewToken"])
            material_id = f"{layer}Material"
            for material in ("", "  ", None):
                with self.subTest(layer=layer, material=material):
                    preview = registry.preview("soc", {material_id: material}, generator_version=1)
                    self.assertFalse(preview["valid"])
                    self.assertIn(material_id, preview["errors"])
        for parameters in (
            {f"{layer}Thickness": 0 for layer in ("pass2", "usg", "elk", "si")},
            {"pass2Thickness": 1e308, "usgThickness": 1e308},
        ):
            preview = registry.preview("soc", parameters, generator_version=1)
            self.assertFalse(preview["valid"])
            self.assertIn("siThickness", preview["errors"])
            self.assertIsNone(preview["geometryEntityJson"])
            with self.assertRaises(ValueError):
                registry.generate("soc", 1, parameters)

    def test_vrm_preview_preserves_single_box_shape_and_identity(self):
        default = self.app.state.geometry_generators.preview(
            "vrm", {}, generator_version=1
        )
        self.assertEqual(
            default["normalizedParameters"],
            {"thickness": 150, "material": "Si-VRM"},
        )
        response = self.client.post(
            "/api/geometry-generators/vrm/preview",
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
        entity = preview["geometryEntityJson"]
        self.assertEqual(entity["category"], "die.vrm")
        self.assertEqual(entity["generation"], {
            "generatorId": "vrm",
            "schemaVersion": 1,
            "parameters": {"thickness": 220, "material": "Si-Custom"},
        })
        root = entity["structure"]["root"]
        self.assertEqual(root["id"], "container:vrm-root")
        self.assertEqual(root["key"], "vrm")
        self.assertEqual(len(root["bodies"]), 1)
        self.assertEqual(root["bodies"][0]["id"], "body:vrm-envelope")
        self.assertEqual(root["bodies"][0]["key"], "envelope")
        self.assertEqual(root["bodies"][0]["geometry"], {
            "type": "BoxGeometry",
            "bottom_left": [-4000, -5000, -110],
            "top_right": [4000, 5000, -110],
            "thk": 220,
        })

        invalid = self.app.state.geometry_generators.preview(
            "vrm", {"thickness": 0, "material": " "}, generator_version=1
        )
        self.assertEqual(set(invalid["errors"]), {"thickness", "material"})

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

    def test_v2_default_structure_hashes_are_pinned(self):
        registry = GeometryGeneratorRegistry()
        register_builtin_generators(registry)
        self.assertEqual(
            registry.preview("hbm", {}, generator_version=2)["geometryHash"],
            "sha256:ac806d0526b8c7c6cf9eddad2fe6d505e266d2f5586aa6bec42ccf04524abd53",
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
                    "hbmThickness": 999,
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
        self.assertEqual(_dimension_values(section_view)["Total thickness"], 310)
        self.assertEqual(preview["computedParameters"]["totalThickness"], 310)
        self.assertNotIn("topMoldingThickness", preview["computedParameters"])
        self.assertNotIn("hbmThickness", preview["normalizedParameters"])
        self.assertNotIn("topMoldingThickness", preview["normalizedParameters"])
        entity = preview["geometryEntityJson"]
        self.assertEqual(entity["adaptationContract"]["adapterId"], "hbm-package")
        self.assertEqual(entity["dim"], "1400 x 1000 x 310 um")
        self.assertEqual(entity["generation"]["schemaVersion"], 2)
        self.assertNotIn(
            "topMoldingThickness", entity["generation"]["parameters"]
        )
        self.assertNotIn("hbmThickness", entity["generation"]["parameters"])
        self.assertNotIn("vendor", entity)
        root = entity["structure"]["root"]
        self.assertEqual(root["bodies"][0]["geometry"]["bottom_left"], [-700, -500, 0])
        self.assertEqual(root["bodies"][0]["geometry"]["top_right"], [700, 500, 0])
        self.assertEqual(root["bodies"][0]["geometry"]["thk"], 310)
        self.assertEqual(len(root["children"]), 4)
        self.assertEqual(
            [child["id"] for child in root["children"]],
            [
                "container:hbm-base-die",
                "container:hbm-core-die-01",
                "container:hbm-core-die-02",
                "container:hbm-top-core-die",
            ],
        )
        self.assertEqual(
            [child["bodies"][0]["key"] for child in root["children"]],
            [
                "hbm.base_die",
                "hbm.core_die_1",
                "hbm.core_die_2",
                "hbm.top_die",
            ],
        )
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
        self.assertEqual(
            root["children"][-1]["bodies"][0]["id"],
            "body:hbm-top-core-die",
        )
        self.assertEqual(
            core_geometries[-1]["bottom_left"][2] + core_geometries[-1]["thk"],
            root["bodies"][0]["geometry"]["thk"],
        )

        materialized = self.client.post(
            "/api/geometry-materializations",
            json={"previewToken": preview["previewToken"]},
        )
        self.assertEqual(materialized.status_code, 200, materialized.text)
        self.assertEqual(materialized.json()["geometryHash"], preview["geometryHash"])
        self.assertEqual(materialized.json()["geometryEntityJson"], entity)

    def test_hbm_single_core_uses_top_identity_and_derived_total_thickness(self):
        response = self.client.post(
            "/api/geometry-generators/hbm/preview",
            json={
                "generatorVersion": 2,
                "parameters": {
                    "hbmThickness": 999,
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
        self.assertEqual(preview["computedParameters"]["totalThickness"], 200)
        self.assertNotIn("topMoldingThickness", preview["computedParameters"])
        self.assertNotIn("hbmThickness", preview["normalizedParameters"])
        root = preview["geometryEntityJson"]["structure"]["root"]
        self.assertEqual(len(root["children"]), 2)
        self.assertEqual(root["children"][1]["id"], "container:hbm-top-core-die")
        self.assertEqual(
            [child["bodies"][0]["key"] for child in root["children"]],
            ["hbm.base_die", "hbm.top_die"],
        )
        only_core = root["children"][1]["bodies"][0]["geometry"]
        self.assertEqual(only_core["bottom_left"][2], 120)
        self.assertEqual(only_core["thk"], 80)
        section_view = preview["engineeringPreview"]["views"][1]
        self.assertEqual(
            _dimension_values(section_view)["Core die thickness"],
            80,
        )

    def test_hbm_rejects_invalid_top_core_die_thickness(self):
        response = self.client.post(
            "/api/geometry-generators/hbm/preview",
            json={"generatorVersion": 2, "parameters": {"topCoreDieThickness": 0}},
        )

        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertFalse(preview["valid"])
        self.assertIn("topCoreDieThickness", preview["errors"])
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
