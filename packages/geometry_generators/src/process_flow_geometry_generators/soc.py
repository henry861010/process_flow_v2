from __future__ import annotations

import math

from .contracts import GeneratorEvaluation, JsonObject


PACKAGE_X = 8000
PACKAGE_Y = 10000
LAYERS = (("pass2", "Pass2"), ("usg", "usg"), ("elk", "elk"), ("si", "si"))
DEFAULT_PARAMETERS: JsonObject = {
    "pass2Thickness": 5.625,
    "pass2Material": "pass2",
    "usgThickness": 2.89,
    "usgMaterial": "usg",
    "elkThickness": 1.315,
    "elkMaterial": "elk",
    "siThickness": 200,
    "siMaterial": "si",
}


class SocGenerator:
    def definition(self) -> JsonObject:
        return {
            "schemaVersion": 2,
            "id": "soc",
            "version": 1,
            "label": "SoC generator",
            "description": "Build a SoC die with Pass2, usg, elk and si layers from bottom to top. Zero thickness omits a layer.",
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
                parameter
                for layer_id, _ in LAYERS
                for parameter in [
                    {
                        "id": f"{layer_id}Thickness",
                        "name": "Thickness",
                        "description": "Set to 0 to omit this layer.",
                        "valueType": "float",
                        "controlType": "number",
                        "required": True,
                        "unit": "um",
                        "validation": {"min": 0},
                    },
                    {
                        "id": f"{layer_id}Material",
                        "name": "Material",
                        "description": "",
                        "valueType": "materialRef",
                        "controlType": "text",
                        "required": True,
                        "validation": {"minLength": 1},
                    },
                ]
            ],
            "parameterGroups": [
                {
                    "id": f"layer-{layer_id}",
                    "label": label,
                    "parameterIds": [f"{layer_id}Thickness", f"{layer_id}Material"],
                }
                for layer_id, label in LAYERS
            ],
            "previewViews": ["top", "cross-section-x"],
        }

    def validate(self, parameters: JsonObject) -> JsonObject:
        errors: JsonObject = {}
        total_thickness = 0.0
        for layer_id, label in LAYERS:
            thickness_id = f"{layer_id}Thickness"
            thickness = parameters.get(thickness_id)
            if (
                isinstance(thickness, bool)
                or not isinstance(thickness, (int, float))
                or not math.isfinite(thickness)
                or thickness < 0
            ):
                errors[thickness_id] = (
                    f"{label} thickness must be a finite number greater than or equal to 0."
                )
            else:
                total_thickness += float(thickness)
            material_id = f"{layer_id}Material"
            material = parameters.get(material_id)
            if not isinstance(material, str) or not material.strip():
                errors[material_id] = f"{label} material is required."
        if not any(f"{layer_id}Thickness" in errors for layer_id, _ in LAYERS):
            if not math.isfinite(total_thickness) or total_thickness <= 0:
                errors["siThickness"] = "Total thickness must be finite and greater than 0."
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        if self.validate(parameters):
            raise ValueError("Cannot build SoC geometry from invalid parameters")
        normalized: JsonObject = {}
        for layer_id, _ in LAYERS:
            normalized[f"{layer_id}Thickness"] = float(parameters[f"{layer_id}Thickness"])
            normalized[f"{layer_id}Material"] = parameters[f"{layer_id}Material"].strip()
        total_thickness = sum(normalized[f"{layer_id}Thickness"] for layer_id, _ in LAYERS)
        cursor_z = -total_thickness / 2
        bodies: list[JsonObject] = []
        for layer_id, _ in LAYERS:
            thickness = normalized[f"{layer_id}Thickness"]
            if thickness == 0:
                continue
            bodies.append(
                {
                    "id": f"body:soc-{layer_id}",
                    "key": f"soc.{layer_id}",
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
                    "id": "container:soc-root",
                    "key": "soc",
                    "bodies": bodies,
                    "vias": [],
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                },
            },
        )
