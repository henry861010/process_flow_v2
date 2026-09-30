from __future__ import annotations

import math

from .contracts import GeneratorEvaluation, JsonObject


PACKAGE_X = 8000
PACKAGE_Y = 10000
DEFAULT_PARAMETERS: JsonObject = {
    "generation": "gen1",
    "layer1Material": "Si-LSI",
    "layer1Thickness": 150,
    "layer2Material": "SiO2",
    "layer2Thickness": 20,
    "layer3Material": "Cu",
    "layer3Thickness": 10,
    "layer4Material": "SiN",
    "layer4Thickness": 20,
}
LAYER_COUNTS = {"gen1": 1, "gen2": 4}


class LsiGenerator:
    def definition(self) -> JsonObject:
        parameter_definitions: list[JsonObject] = [
            {
                "id": "generation",
                "name": "Generation",
                "description": "Select the LSI layer structure.",
                "valueType": "string",
                "controlType": "select",
                "selectionMode": "single",
                "required": True,
                "optionSource": {
                    "type": "static",
                    "options": [
                        {"value": "gen1", "name": "Gen 1"},
                        {"value": "gen2", "name": "Gen 2"},
                    ],
                },
            }
        ]
        parameter_groups: list[JsonObject] = [
            {"id": "generation", "label": "Generation", "parameterIds": ["generation"]}
        ]
        for index in range(1, 5):
            condition = (
                {"visibleWhen": {"parameterId": "generation", "equals": "gen2"}}
                if index > 1
                else {}
            )
            parameter_definitions.extend(
                [
                    {
                        "id": f"layer{index}Material",
                        "name": f"Layer {index} material",
                        "description": "",
                        "valueType": "materialRef",
                        "controlType": "text",
                        "required": True,
                        "validation": {"minLength": 1},
                        **condition,
                    },
                    {
                        "id": f"layer{index}Thickness",
                        "name": f"Layer {index} thickness",
                        "description": "",
                        "valueType": "float",
                        "controlType": "number",
                        "required": True,
                        "unit": "um",
                        "validation": {"min": 0, "exclusiveMin": True},
                        **condition,
                    },
                ]
            )
            parameter_groups.append(
                {
                    "id": f"layer-{index}",
                    "label": f"Layer {index}",
                    "parameterIds": [
                        f"layer{index}Material",
                        f"layer{index}Thickness",
                    ],
                }
            )

        return {
            "schemaVersion": 1,
            "id": "lsi",
            "version": 1,
            "label": "LSI generator",
            "description": "Build a one-layer or four-layer LSI die at 8000 x 10000 um.",
            "entityType": "die",
            "category": "die.lsi",
            "icon": "die.piece",
            "adaptationContract": {
                "adapterId": "box-rescale",
                "adapterVersion": 1,
                "parameters": {},
            },
            "defaultParameters": dict(DEFAULT_PARAMETERS),
            "parameterDefinitions": parameter_definitions,
            "parameterGroups": parameter_groups,
            "previewViews": ["top", "cross-section-x"],
        }

    def validate(self, parameters: JsonObject) -> JsonObject:
        errors: JsonObject = {}
        generation = parameters.get("generation")
        if not isinstance(generation, str) or generation not in LAYER_COUNTS:
            errors["generation"] = "Generation must be gen1 or gen2."
            return errors

        total_thickness = 0.0
        for index in range(1, LAYER_COUNTS[generation] + 1):
            material_id = f"layer{index}Material"
            material = parameters.get(material_id)
            if not isinstance(material, str) or not material.strip():
                errors[material_id] = f"Layer {index} material is required."

            thickness_id = f"layer{index}Thickness"
            thickness = parameters.get(thickness_id)
            if (
                isinstance(thickness, bool)
                or not isinstance(thickness, (int, float))
                or not math.isfinite(thickness)
                or thickness <= 0
            ):
                errors[thickness_id] = (
                    f"Layer {index} thickness must be a finite number greater than 0."
                )
            else:
                total_thickness += float(thickness)

        if not math.isfinite(total_thickness):
            errors[f"layer{LAYER_COUNTS[generation]}Thickness"] = (
                "Total thickness must be finite."
            )
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        if self.validate(parameters):
            raise ValueError("Cannot build LSI geometry from invalid parameters")

        generation = parameters["generation"]
        layer_count = LAYER_COUNTS[generation]
        normalized: JsonObject = {"generation": generation}
        for index in range(1, layer_count + 1):
            normalized[f"layer{index}Material"] = parameters[
                f"layer{index}Material"
            ].strip()
            normalized[f"layer{index}Thickness"] = float(
                parameters[f"layer{index}Thickness"]
            )

        total_thickness = sum(
            normalized[f"layer{index}Thickness"]
            for index in range(1, layer_count + 1)
        )
        cursor_z = -total_thickness / 2
        bodies: list[JsonObject] = []
        for index in range(1, layer_count + 1):
            thickness = normalized[f"layer{index}Thickness"]
            bodies.append(
                {
                    "id": f"body:lsi-layer-{index}",
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-PACKAGE_X / 2, -PACKAGE_Y / 2, cursor_z],
                        "top_right": [PACKAGE_X / 2, PACKAGE_Y / 2, cursor_z],
                        "thk": thickness,
                    },
                    "material": normalized[f"layer{index}Material"],
                }
            )
            cursor_z += thickness

        return GeneratorEvaluation(
            normalized_parameters=normalized,
            computed_parameters={
                "packageX": PACKAGE_X,
                "packageY": PACKAGE_Y,
                "totalThickness": total_thickness,
            },
            geometry_structure={
                "schemaVersion": "1.0.0",
                "unitSystem": "um",
                "root": {
                    "id": "container:lsi-root",
                    "key": "lsi",
                    "bodies": bodies,
                    "vias": [],
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                },
            },
        )
