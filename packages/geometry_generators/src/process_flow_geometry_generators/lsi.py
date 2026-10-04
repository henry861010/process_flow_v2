from __future__ import annotations

import math

from .contracts import GeneratorEvaluation, JsonObject


PACKAGE_X = 8000
PACKAGE_Y = 10000
DEFAULT_PARAMETERS: JsonObject = {
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
}
LAYER_ORDERS = {
    "gen1": ("si", "usg", "lsiTopMolding"),
    "gen2": ("bsmc", "si", "usg", "prePm0"),
}
LAYER_DEFINITIONS = (
    ("bsmc", "bsmc", "gen2"),
    ("si", "si", None),
    ("usg", "usg", None),
    ("lsiTopMolding", "LSI_top_molding", "gen1"),
    ("prePm0", "prePm0", "gen2"),
)
BODY_IDS = {
    "bsmc": "body:lsi-bsmc",
    "si": "body:lsi-si",
    "usg": "body:lsi-usg",
    "lsiTopMolding": "body:lsi-top-molding",
    "prePm0": "body:lsi-pre-pm0",
}
LEGACY_PARAMETER_IDS = tuple(
    f"layer{index}{suffix}"
    for index in range(1, 5)
    for suffix in ("Material", "Thickness")
)


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
        for layer_id, layer_label, generation in LAYER_DEFINITIONS:
            condition = (
                {"visibleWhen": {"parameterId": "generation", "equals": generation}}
                if generation is not None
                else {}
            )
            parameter_definitions.extend(
                [
                    {
                        "id": f"{layer_id}Material",
                        "name": "Material",
                        "description": "",
                        "valueType": "materialRef",
                        "controlType": "text",
                        "required": True,
                        "validation": {"minLength": 1},
                        **condition,
                    },
                    {
                        "id": f"{layer_id}Thickness",
                        "name": "Thickness",
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
                    "id": f"layer-{layer_id}",
                    "label": layer_label,
                    "parameterIds": [
                        f"{layer_id}Material",
                        f"{layer_id}Thickness",
                    ],
                }
            )

        return {
            "schemaVersion": 2,
            "id": "lsi",
            "version": 1,
            "label": "LSI generator",
            "description": "Build a Gen 1 or Gen 2 named-layer LSI die at 8000 x 10000 um.",
            "uiPlacements": ["management", "templateGeometryLibrary", "flowInputPicker"],
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
        if not isinstance(generation, str) or generation not in LAYER_ORDERS:
            errors["generation"] = "Generation must be gen1 or gen2."
            return errors

        for parameter_id in LEGACY_PARAMETER_IDS:
            if parameter_id in parameters:
                errors[parameter_id] = "Legacy LSI layer parameters are not supported."

        total_thickness = 0.0
        for layer_id in LAYER_ORDERS[generation]:
            material_id = f"{layer_id}Material"
            material = parameters.get(material_id)
            if not isinstance(material, str) or not material.strip():
                errors[material_id] = f"{material_id} is required."

            thickness_id = f"{layer_id}Thickness"
            thickness = parameters.get(thickness_id)
            if (
                isinstance(thickness, bool)
                or not isinstance(thickness, (int, float))
                or not math.isfinite(thickness)
                or thickness <= 0
            ):
                errors[thickness_id] = (
                    f"{thickness_id} must be a finite number greater than 0."
                )
            else:
                total_thickness += float(thickness)

        if not math.isfinite(total_thickness):
            errors[f"{LAYER_ORDERS[generation][-1]}Thickness"] = (
                "Total thickness must be finite."
            )
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        if self.validate(parameters):
            raise ValueError("Cannot build LSI geometry from invalid parameters")

        generation = parameters["generation"]
        layer_order = LAYER_ORDERS[generation]
        normalized: JsonObject = {"generation": generation}
        for layer_id in layer_order:
            normalized[f"{layer_id}Material"] = parameters[
                f"{layer_id}Material"
            ].strip()
            normalized[f"{layer_id}Thickness"] = float(
                parameters[f"{layer_id}Thickness"]
            )

        total_thickness = sum(
            normalized[f"{layer_id}Thickness"] for layer_id in layer_order
        )
        cursor_z = -total_thickness / 2
        bodies: list[JsonObject] = []
        for layer_id in layer_order:
            thickness = normalized[f"{layer_id}Thickness"]
            bodies.append(
                {
                    "id": BODY_IDS[layer_id],
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": [-PACKAGE_X / 2, -PACKAGE_Y / 2, cursor_z],
                        "top_right": [PACKAGE_X / 2, PACKAGE_Y / 2, cursor_z],
                        "thk": thickness,
                    },
                    "material": normalized[f"{layer_id}Material"],
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
