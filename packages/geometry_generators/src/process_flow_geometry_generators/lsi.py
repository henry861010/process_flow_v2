from __future__ import annotations

import math

from .contracts import GeneratorEvaluation, JsonObject


PACKAGE_X = 8000
PACKAGE_Y = 10000
DEFAULT_PARAMETERS: JsonObject = {
    "generation": "gen1",
    "dafMaterial": "DAF",
    "dafThickness": 10,
    "bsPm0Material": "Mat_MCA7UUU0P1",
    "bsPm0Thickness": 15,
    "bsVia0Material": "Cu",
    "bsVia0Thickness": 15,
    "bsVia0Density": 50,
    "siMaterial": "Si",
    "siThickness": 200,
    "usgMaterial": "usg",
    "usgThickness": 15.5,
    "prePm0Material": "Mat_PIBL301UUU0P1",
    "prePm0Thickness": 15,
    "fsPm0Material": "lsi_top_molding",
    "fsPm0Thickness": 26,
    "fsVia0Material": "Cu",
    "fsVia0Thickness": 26,
    "fsVia0Density": 50,
    "fowMaterial": "Fow",
    "fowThickness": 10,
    "siCarrierMaterial": "Si",
    "siCarrierThickness": 200,
}
LAYER_ORDERS = {
    "gen1": ("si", "usg", "fsPm0"),
    "gen2": (
        "daf", "bsPm0", "si", "usg", "prePm0", "fsPm0", "fow", "siCarrier",
    ),
}
VIA_ORDERS = {"gen1": ("fsVia0",), "gen2": ("fsVia0", "bsVia0")}
# Groups follow the stack from bottom to top, with vias next to their host layers.
FEATURE_DEFINITIONS = (
    ("daf", "DAF", "gen2", False),
    ("bsPm0", "BsPm0", "gen2", False),
    ("bsVia0", "BsVia0", "gen2", True),
    ("si", "Si", None, False),
    ("usg", "USG", None, False),
    ("prePm0", "PrePm0", "gen2", False),
    ("fsPm0", "FsPm0", None, False),
    ("fsVia0", "FsVia0", None, True),
    ("fow", "Fow", "gen2", False),
    ("siCarrier", "Si carrier", "gen2", False),
)
BODY_IDS = {
    "daf": "body:lsi-daf",
    "bsPm0": "body:lsi-bs-pm0",
    "si": "body:lsi-si",
    "usg": "body:lsi-usg",
    "prePm0": "body:lsi-pre-pm0",
    "fsPm0": "body:lsi-fs-pm0",
    "fow": "body:lsi-fow",
    "siCarrier": "body:lsi-si-carrier",
}
LEGACY_PARAMETER_IDS = tuple(
    f"{prefix}{suffix}"
    for prefix in ("layer1", "layer2", "layer3", "layer4", "bsmc", "lsiTopMolding")
    for suffix in ("Material", "Thickness")
)


def _finite_number(value: object) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _box(z: float, thickness: float) -> JsonObject:
    return {
        "type": "BoxGeometry",
        "bottom_left": [-PACKAGE_X / 2, -PACKAGE_Y / 2, z],
        "top_right": [PACKAGE_X / 2, PACKAGE_Y / 2, z],
        "thk": thickness,
    }


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
        for feature_id, label, generation, is_via in FEATURE_DEFINITIONS:
            condition = (
                {"visibleWhen": {"parameterId": "generation", "equals": generation}}
                if generation is not None
                else {}
            )
            fields: list[JsonObject] = [
                {
                    "id": f"{feature_id}Material",
                    "name": "Material",
                    "description": "",
                    "valueType": "materialRef",
                    "controlType": "text",
                    "required": True,
                    "validation": {"minLength": 1},
                    **condition,
                },
                {
                    "id": f"{feature_id}Thickness",
                    "name": "Height" if is_via else "Thickness",
                    "description": "Must remain within the host layers." if is_via else "",
                    "valueType": "float",
                    "controlType": "number",
                    "required": True,
                    "unit": "um",
                    "validation": {"min": 0},
                    **condition,
                },
            ]
            if is_via:
                fields.append(
                    {
                        "id": f"{feature_id}Density",
                        "name": "Density",
                        "description": "",
                        "valueType": "float",
                        "controlType": "number",
                        "required": True,
                        "unit": "%",
                        "validation": {"min": 0, "max": 100},
                        **condition,
                    }
                )
            parameter_definitions.extend(fields)
            parameter_groups.append(
                {
                    "id": f"{'via' if is_via else 'layer'}-{feature_id}",
                    "label": label,
                    "parameterIds": [field["id"] for field in fields],
                }
            )

        return {
            "schemaVersion": 2,
            "id": "lsi",
            "version": 1,
            "label": "LSI generator",
            "description": (
                "Build a Gen 1 or Gen 2 layered LSI die with density vias "
                "at 8000 x 10000 um."
            ),
            "uiPlacements": ["management", "templateGeometryLibrary", "flowInputPicker"],
            "entityType": "die",
            "category": "die.lsi",
            "icon": "die.piece",
            "adaptationContract": {
                "adapterId": "box-rescale", "adapterVersion": 1, "parameters": {},
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
            return {"generation": "Generation must be gen1 or gen2."}

        for parameter_id in LEGACY_PARAMETER_IDS:
            if parameter_id in parameters:
                errors[parameter_id] = "Legacy LSI layer parameters are not supported."

        for feature_id in (*LAYER_ORDERS[generation], *VIA_ORDERS[generation]):
            material_id = f"{feature_id}Material"
            material = parameters.get(material_id)
            if not isinstance(material, str) or not material.strip():
                errors[material_id] = f"{material_id} is required."
            thickness_id = f"{feature_id}Thickness"
            thickness = parameters.get(thickness_id)
            if not _finite_number(thickness) or thickness < 0:
                errors[thickness_id] = (
                    f"{thickness_id} must be a finite number greater than or equal to 0."
                )

        layer_thickness_ids = [f"{layer}Thickness" for layer in LAYER_ORDERS[generation]]
        if not any(key in errors for key in layer_thickness_ids):
            if not math.isfinite(sum(float(parameters[key]) for key in layer_thickness_ids)):
                errors[layer_thickness_ids[-1]] = "Total thickness must be finite."

        for via in VIA_ORDERS[generation]:
            density_id = f"{via}Density"
            density = parameters.get(density_id)
            if not _finite_number(density) or not 0 <= density <= 100:
                errors[density_id] = f"{density_id} must be a finite number from 0 to 100."
            if via == "bsVia0":
                host_layers = ("bsPm0",)
            elif generation == "gen1":
                host_layers = ("fsPm0",)
            else:
                host_layers = ("prePm0", "fsPm0")
            thickness_id = f"{via}Thickness"
            host_ids = [f"{layer}Thickness" for layer in host_layers]
            if not any(key in errors for key in (thickness_id, *host_ids)):
                if parameters[thickness_id] > sum(float(parameters[key]) for key in host_ids):
                    errors[thickness_id] = (
                        "Height must not exceed the thickness of "
                        f"{' + '.join(host_layers)}."
                    )
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        if self.validate(parameters):
            raise ValueError("Cannot build LSI geometry from invalid parameters")
        generation = parameters["generation"]
        normalized: JsonObject = {"generation": generation}
        for feature_id in (*LAYER_ORDERS[generation], *VIA_ORDERS[generation]):
            normalized[f"{feature_id}Material"] = parameters[f"{feature_id}Material"].strip()
            normalized[f"{feature_id}Thickness"] = float(parameters[f"{feature_id}Thickness"])
            if feature_id in VIA_ORDERS[generation]:
                normalized[f"{feature_id}Density"] = float(parameters[f"{feature_id}Density"])

        total_thickness = sum(
            normalized[f"{layer}Thickness"] for layer in LAYER_ORDERS[generation]
        )
        cursor_z = -total_thickness / 2
        bodies: list[JsonObject] = []
        layer_bottoms: dict[str, float] = {}
        for layer in LAYER_ORDERS[generation]:
            layer_bottoms[layer] = cursor_z
            thickness = normalized[f"{layer}Thickness"]
            body: JsonObject = {
                "id": BODY_IDS[layer],
                "geometry": _box(cursor_z, thickness),
                "material": normalized[f"{layer}Material"],
            }
            if layer in ("daf", "siCarrier"):
                body["key"] = "daf" if layer == "daf" else "carrier"
            bodies.append(body)
            cursor_z += thickness

        vias: list[JsonObject] = []
        for via in VIA_ORDERS[generation]:
            thickness = normalized[f"{via}Thickness"]
            if via == "bsVia0":
                z = layer_bottoms["si"] - thickness
                via_id, direction = "via:lsi-bs-via0", "-z"
            else:
                z = layer_bottoms["usg"] + normalized["usgThickness"]
                via_id, direction = "via:lsi-fs-via0", "+z"
            vias.append(
                {
                    "id": via_id,
                    "geometry": _box(z, thickness),
                    "material": normalized[f"{via}Material"],
                    "density": normalized[f"{via}Density"],
                    "direction": direction,
                    "koz": 0,
                }
            )

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
                    "vias": vias,
                    "circuits": [],
                    "bumps": [],
                    "children": [],
                },
            },
        )
