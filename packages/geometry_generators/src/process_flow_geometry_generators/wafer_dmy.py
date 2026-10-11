from __future__ import annotations

import math

from .contracts import GeneratorEvaluation, JsonObject


PACKAGE_X = 8000
PACKAGE_Y = 10000
DEFAULT_PARAMETERS: JsonObject = {"siThickness": 200, "siMaterial": "si"}


class WaferDmyGenerator:
    def definition(self) -> JsonObject:
        return {
            "schemaVersion": 2,
            "id": "wafer-dmy",
            "version": 1,
            "label": "wafer dmy generator",
            "description": "Build a single Si dummy die for placement at the wafer edge to control warpage.",
            "uiPlacements": ["templateGeometryLibrary", "flowInputPicker"],
            "entityType": "die",
            "category": "die.wafer-dmy",
            "icon": "die.piece",
            "adaptationContract": {
                "adapterId": "box-rescale",
                "adapterVersion": 1,
                "parameters": {},
            },
            "defaultParameters": dict(DEFAULT_PARAMETERS),
            "parameterDefinitions": [
                {
                    "id": "siThickness",
                    "name": "Thickness",
                    "description": "",
                    "valueType": "float",
                    "controlType": "number",
                    "required": True,
                    "unit": "um",
                    "validation": {"min": 0},
                },
                {
                    "id": "siMaterial",
                    "name": "Material",
                    "description": "",
                    "valueType": "materialRef",
                    "controlType": "text",
                    "required": True,
                    "validation": {"minLength": 1},
                },
            ],
            "parameterGroups": [
                {
                    "id": "layer-si",
                    "label": "si",
                    "parameterIds": ["siThickness", "siMaterial"],
                }
            ],
            "previewViews": ["top", "cross-section-x"],
        }

    def validate(self, parameters: JsonObject) -> JsonObject:
        errors: JsonObject = {}
        thickness = parameters.get("siThickness")
        if (
            isinstance(thickness, bool)
            or not isinstance(thickness, (int, float))
            or not math.isfinite(thickness)
            or thickness < 0
        ):
            errors["siThickness"] = "Si thickness must be a finite number greater than or equal to 0."
        material = parameters.get("siMaterial")
        if not isinstance(material, str) or not material.strip():
            errors["siMaterial"] = "Si material is required."
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        if self.validate(parameters):
            raise ValueError("Cannot build wafer dmy geometry from invalid parameters")
        thickness = float(parameters["siThickness"])
        normalized = {
            "siThickness": thickness,
            "siMaterial": parameters["siMaterial"].strip(),
        }
        bottom_z = -thickness / 2
        return GeneratorEvaluation(
            normalized_parameters=normalized,
            computed_parameters={
                "packageX": PACKAGE_X,
                "packageY": PACKAGE_Y,
                "totalThickness": thickness,
            },
            geometry_structure={
                "schemaVersion": "1.0.0",
                "unitSystem": "um",
                "root": {
                    "id": "container:wafer-dmy-root",
                    "key": "wafer-dmy",
                    "bodies": [
                        {
                            "id": "body:wafer-dmy-si",
                            "key": "wafer-dmy.si",
                            "geometry": {
                                "type": "BoxGeometry",
                                "bottom_left": [-PACKAGE_X / 2, -PACKAGE_Y / 2, bottom_z],
                                "top_right": [PACKAGE_X / 2, PACKAGE_Y / 2, bottom_z],
                                "thk": thickness,
                            },
                            "material": normalized["siMaterial"],
                        }
                    ],
                    "vias": [],
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                },
            },
        )
