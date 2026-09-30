from __future__ import annotations

import math

from .contracts import GeneratorEvaluation, JsonObject


PACKAGE_X = 8000
PACKAGE_Y = 10000
DEFAULT_PARAMETERS: JsonObject = {"thickness": 150, "material": "Si-SoC"}


class SocGenerator:
    def definition(self) -> JsonObject:
        return {
            "schemaVersion": 2,
            "id": "soc",
            "version": 1,
            "label": "SoC generator",
            "description": "Build a single SoC die box with configurable thickness and material.",
            "uiPlacements": ["templateGeometryLibrary", "flowInputPicker"],
            "entityType": "die",
            "category": "die.soc",
            "icon": "die.piece",
            "adaptationContract": {
                "adapterId": "box-rescale",
                "adapterVersion": 1,
                "parameters": {},
            },
            "defaultParameters": dict(DEFAULT_PARAMETERS),
            "parameterDefinitions": [
                {
                    "id": "thickness",
                    "name": "Thickness",
                    "description": "",
                    "valueType": "float",
                    "controlType": "number",
                    "required": True,
                    "unit": "um",
                    "validation": {"min": 0, "exclusiveMin": True},
                },
                {
                    "id": "material",
                    "name": "Material",
                    "description": "",
                    "valueType": "materialRef",
                    "controlType": "text",
                    "required": True,
                    "validation": {"minLength": 1},
                },
            ],
            "parameterGroups": [],
            "previewViews": ["top", "cross-section-x"],
        }

    def validate(self, parameters: JsonObject) -> JsonObject:
        errors: JsonObject = {}
        thickness = parameters.get("thickness")
        if (
            isinstance(thickness, bool)
            or not isinstance(thickness, (int, float))
            or not math.isfinite(thickness)
            or thickness <= 0
        ):
            errors["thickness"] = "Thickness must be a finite number greater than 0."
        material = parameters.get("material")
        if not isinstance(material, str) or not material.strip():
            errors["material"] = "Material is required."
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        if self.validate(parameters):
            raise ValueError("Cannot build SoC geometry from invalid parameters")
        thickness = float(parameters["thickness"])
        normalized = {
            "thickness": thickness,
            "material": parameters["material"].strip(),
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
                    "id": "container:soc-root",
                    "key": "soc",
                    "bodies": [
                        {
                            "id": "body:soc-envelope",
                            "key": "envelope",
                            "geometry": {
                                "type": "BoxGeometry",
                                "bottom_left": [-PACKAGE_X / 2, -PACKAGE_Y / 2, bottom_z],
                                "top_right": [PACKAGE_X / 2, PACKAGE_Y / 2, bottom_z],
                                "thk": thickness,
                            },
                            "material": normalized["material"],
                        }
                    ],
                    "vias": [],
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                },
            },
        )
