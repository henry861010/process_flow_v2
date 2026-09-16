from __future__ import annotations

import unittest

from fastapi.testclient import TestClient

from process_flow_api.main import create_app


class GeometryGeneratorApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app(db_path=":memory:")
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.app.state.store.close()

    def test_generator_catalog_is_backend_driven(self):
        response = self.client.get("/api/geometry-generators")

        self.assertEqual(response.status_code, 200, response.text)
        definitions = response.json()
        self.assertEqual([item["id"] for item in definitions], ["hbm", "dram"])
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
