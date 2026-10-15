from __future__ import annotations

import unittest

from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators


CASES = [
    ("wafer-carrier", "carrier.wafer", "wafer", "carrier", "carrier", "rigid",
     {"diameter": 300000, "carrierThickness": 775, "carrierMaterial": "Si"}),
    ("panel-carrier", "carrier.panel", "panel", "carrier", "carrier", "box-rescale",
     {"packageX": 510000, "packageY": 515000, "carrierThickness": 700, "carrierMaterial": "glass"}),
    ("frame", "frame", "frame", "frame", "tape", "rigid",
     {"diameter": 350000, "tapeThickness": 80, "tapeMaterial": "tape"}),
]


class SupportGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.registry = GeometryGeneratorRegistry()
        register_builtin_generators(self.registry)

    def test_definitions_defaults_keys_and_engineering_previews(self):
        for generator_id, category, entity_type, body_key, layer, adapter, defaults in CASES:
            with self.subTest(generator=generator_id):
                definition = self.registry.definition(generator_id, 1)
                self.assertEqual(definition["defaultParameters"], defaults)
                self.assertEqual(definition["category"], category)
                self.assertEqual(definition["entityType"], entity_type)
                self.assertEqual(definition["icon"], category)
                self.assertEqual(definition["uiPlacements"], ["templateGeometryLibrary", "flowInputPicker"])
                self.assertEqual(definition["adaptationContract"], {
                    "adapterId": adapter, "adapterVersion": 1, "parameters": {},
                })
                fields = definition["parameterDefinitions"]
                size_ids = [key for key in defaults if key not in (f"{layer}Thickness", f"{layer}Material")]
                self.assertEqual([field["id"] for field in fields], list(defaults))
                self.assertEqual(definition["parameterGroups"], [
                    {"id": "size", "label": "Size", "parameterIds": size_ids},
                    {"id": layer, "label": layer.capitalize(),
                     "parameterIds": [f"{layer}Thickness", f"{layer}Material"]},
                ])
                for field in fields:
                    if field["id"] in size_ids:
                        self.assertEqual(field["validation"], {"min": 0, "exclusiveMin": True})
                preview = self.registry.preview(generator_id, {}, generator_version=1)
                self.assertTrue(preview["valid"], preview["errors"])
                self.assertEqual(preview["normalizedParameters"], defaults)
                entity = preview["geometryEntityJson"]
                root = entity["structure"]["root"]
                self.assertEqual(root["key"], category)
                self.assertEqual(len(root["bodies"]), 1)
                body = root["bodies"][0]
                self.assertEqual(body["key"], body_key)
                self.assertEqual(body["material"], defaults[f"{layer}Material"])
                for collection in ("vias", "circuits", "bumps", "children"):
                    self.assertEqual(root[collection], [])
                thickness = defaults[f"{layer}Thickness"]
                x = defaults.get("diameter", defaults.get("packageX"))
                y = defaults.get("diameter", defaults.get("packageY"))
                self.assertEqual(preview["computedParameters"], {
                    "packageX": x, "packageY": y, "totalThickness": thickness,
                })
                self.assertEqual(entity["dim"], f"{x} x {y} x {thickness} um")
                self.assertEqual(body["geometry"], self._geometry(defaults, thickness))
                top, section = preview["engineeringPreview"]["views"]
                self.assertEqual([top["id"], section["id"]], definition["previewViews"])
                self.assertEqual(top["bounds"], {"uMin": -x / 2, "uMax": x / 2, "vMin": -y / 2, "vMax": y / 2})
                self.assertEqual(top["entities"][0]["kind"], "circle" if "diameter" in defaults else "rectangle")
                self.assertEqual(section["bounds"], {
                    "uMin": -x / 2, "uMax": x / 2, "vMin": -thickness / 2, "vMax": thickness / 2,
                })
                self.assertEqual(section["dimensions"][0]["value"], thickness)

    @staticmethod
    def _geometry(parameters, thickness):
        if "diameter" in parameters:
            return {"type": "CylinderGeometry", "center": [0, 0, -thickness / 2],
                    "bottom_radius": parameters["diameter"] / 2, "thk": thickness}
        x, y = parameters["packageX"], parameters["packageY"]
        return {"type": "BoxGeometry", "bottom_left": [-x / 2, -y / 2, -thickness / 2],
                "top_right": [x / 2, y / 2, -thickness / 2], "thk": thickness}

    def test_custom_sizes_material_trimming_and_zero_thickness_materialize(self):
        for generator_id, _, _, _, layer, _, defaults in CASES:
            for thickness in (0, 42.5):
                with self.subTest(generator=generator_id, thickness=thickness):
                    parameters = {
                        key: value / 2 for key, value in defaults.items()
                        if key not in (f"{layer}Thickness", f"{layer}Material")
                    }
                    parameters.update({f"{layer}Thickness": thickness, f"{layer}Material": "  Custom  "})
                    preview = self.registry.preview(generator_id, parameters)
                    self.assertTrue(preview["valid"], preview["errors"])
                    normalized = {**parameters, f"{layer}Material": "Custom"}
                    self.assertEqual(preview["normalizedParameters"], normalized)
                    entity = preview["geometryEntityJson"]
                    self.assertEqual(entity["generation"], {
                        "generatorId": generator_id, "schemaVersion": 1, "parameters": normalized,
                    })
                    self.assertEqual(entity["structure"]["root"]["bodies"][0]["geometry"], self._geometry(parameters, thickness))
                    self.assertEqual(self.registry.generate(generator_id, 1, normalized), entity)
                    self.assertEqual(self.registry.materialize(preview["previewToken"]), preview)

    def test_invalid_sizes_thickness_and_material_return_field_errors(self):
        for generator_id, _, _, _, layer, _, defaults in CASES:
            for field in defaults:
                if field.endswith("Material"):
                    invalid_values = ("", "  ", None, 12, True)
                else:
                    invalid_values = (-1, True, False, "200", None, float("nan"), float("inf"), -float("inf"))
                    if field != f"{layer}Thickness":
                        invalid_values += (0,)
                for value in invalid_values:
                    with self.subTest(generator=generator_id, field=field, value=value):
                        preview = self.registry.preview(generator_id, {field: value})
                        self.assertFalse(preview["valid"])
                        self.assertIn(field, preview["errors"])
                        self.assertIsNone(preview["previewToken"])
                        self.assertIsNone(preview["geometryEntityJson"])
                        with self.assertRaises(ValueError):
                            self.registry.generate(generator_id, 1, {field: value})


if __name__ == "__main__":
    unittest.main()
