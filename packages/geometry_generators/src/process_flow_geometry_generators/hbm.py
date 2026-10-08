from __future__ import annotations

import math

from .contracts import GeneratorEvaluation, JsonObject
from .die_layers import BOTTOM_DIE_DEFAULT_PARAMETERS, BOTTOM_DIE_LAYERS


MAX_CORE_DIE_COUNT = 64

DEFAULT_PARAMETERS: JsonObject = {
    **BOTTOM_DIE_DEFAULT_PARAMETERS,
    "packageX": 12000,
    "packageY": 8000,
    "moldingMaterial": "EMC",
    "baseDieThickness": 100,
    "coreDieX": 8000,
    "coreDieY": 6000,
    "coreDieThickness": 50,
    "topCoreDieThickness": 50,
    "coreDieCount": 4,
    "coreBaseGap": 20,
    "coreCoreGap": 20,
    "dieMaterial": "Si-HBM",
}


class HbmGenerator:
    def definition(self) -> JsonObject:
        return {
            "schemaVersion": 2,
            "id": "hbm",
            "version": 2,
            "label": "HBM generator",
            "description": "Build an HBM package with Pass2, usg and elk bottom layers, a molding envelope and exposed top core die. Zero thickness omits a bottom layer.",
            "uiPlacements": ["home"],
            "entityType": "die",
            "category": "die.hbm",
            "icon": "die.stack",
            "adaptationContract": {
                "adapterId": "hbm-package",
                "adapterVersion": 1,
            },
            "defaultParameters": dict(DEFAULT_PARAMETERS),
            "parameterDefinitions": [
                _number("packageX", "Package X", positive=True),
                _number("packageY", "Package Y", positive=True),
                _text("moldingMaterial", "Molding material", material=True),
                _number("baseDieThickness", "Base die thickness", minimum=0),
                _number("coreDieX", "Core die X", positive=True),
                _number("coreDieY", "Core die Y", positive=True),
                _number("coreDieThickness", "Core die thickness", minimum=0),
                _number(
                    "topCoreDieThickness", "Top core die thickness", minimum=0
                ),
                _integer(
                    "coreDieCount",
                    "Core die count",
                    minimum=1,
                    maximum=MAX_CORE_DIE_COUNT,
                ),
                _number("coreBaseGap", "Core-base gap", minimum=0),
                _number("coreCoreGap", "Core-core gap", minimum=0),
                _text("dieMaterial", "Die material", material=True),
                *[
                    parameter
                    for layer_id, _ in BOTTOM_DIE_LAYERS
                    for parameter in [
                        {
                            **_number(f"{layer_id}Thickness", "Thickness", minimum=0),
                            "description": "Set to 0 to omit this layer.",
                        },
                        _text(f"{layer_id}Material", "Material", material=True),
                    ]
                ],
            ],
            "parameterGroups": [
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
                *[
                    {
                        "id": f"layer-{layer_id}",
                        "label": label,
                        "parameterIds": [f"{layer_id}Thickness", f"{layer_id}Material"],
                    }
                    for layer_id, label in BOTTOM_DIE_LAYERS
                ],
                {
                    "id": "material",
                    "label": "Material",
                    "parameterIds": ["moldingMaterial", "dieMaterial"],
                },
            ],
            "previewViews": ["top", "cross-section-x"],
        }

    def validate(self, parameters: JsonObject) -> JsonObject:
        errors: JsonObject = {}
        _require_positive(parameters, "packageX", "Package X", errors)
        _require_positive(parameters, "packageY", "Package Y", errors)
        _require_text(parameters, "moldingMaterial", "Molding material", errors)
        _require_non_negative(parameters, "baseDieThickness", "Base die thickness", errors)
        _require_positive(parameters, "coreDieX", "Core die X", errors)
        _require_positive(parameters, "coreDieY", "Core die Y", errors)
        _require_non_negative(parameters, "coreDieThickness", "Core die thickness", errors)
        _require_non_negative(
            parameters, "topCoreDieThickness", "Top core die thickness", errors
        )
        _require_non_negative(parameters, "coreBaseGap", "Core-base gap", errors)
        _require_non_negative(parameters, "coreCoreGap", "Core-core gap", errors)
        _require_text(parameters, "dieMaterial", "Die material", errors)
        for layer_id, label in BOTTOM_DIE_LAYERS:
            _require_non_negative(
                parameters, f"{layer_id}Thickness", f"{label} thickness", errors
            )
            _require_text(
                parameters, f"{layer_id}Material", f"{label} material", errors
            )

        core_count = parameters.get("coreDieCount")
        if (
            isinstance(core_count, bool)
            or not isinstance(core_count, (int, float))
            or not math.isfinite(core_count)
            or int(core_count) != core_count
            or core_count < 1
            or core_count > MAX_CORE_DIE_COUNT
        ):
            errors["coreDieCount"] = (
                f"Core die count must be an integer from 1 to {MAX_CORE_DIE_COUNT}."
            )

        if (
            "coreDieX" not in errors
            and "packageX" not in errors
            and float(parameters["coreDieX"]) > float(parameters["packageX"])
        ):
            errors["coreDieX"] = "Core die X cannot exceed Package X."
        if (
            "coreDieY" not in errors
            and "packageY" not in errors
            and float(parameters["coreDieY"]) > float(parameters["packageY"])
        ):
            errors["coreDieY"] = "Core die Y cannot exceed Package Y."
        thickness_fields = (
            "baseDieThickness",
            "coreBaseGap",
            "coreDieThickness",
            "coreCoreGap",
            "topCoreDieThickness",
            "coreDieCount",
            *(f"{layer_id}Thickness" for layer_id, _ in BOTTOM_DIE_LAYERS),
        )
        if not any(field in errors for field in thickness_fields):
            total_thickness = (
                _occupied_stack_thickness(parameters) + _bottom_layers_thickness(parameters)
            )
            if not math.isfinite(total_thickness):
                errors["elkThickness"] = "Total HBM thickness must be finite."
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        normalized = _normalized_parameters(parameters)
        errors = self.validate(normalized)
        if errors:
            raise ValueError("Cannot build HBM geometry from invalid parameters")
        dimensions = derive_dimensions(normalized)
        return GeneratorEvaluation(
            normalized_parameters=normalized,
            computed_parameters=dimensions,
            geometry_structure=build_geometry(normalized),
        )


def derive_dimensions(parameters: JsonObject) -> JsonObject:
    return {
        "totalThickness": (
            _bottom_layers_thickness(parameters) + _occupied_stack_thickness(parameters)
        ),
        "sideMoldingX": (
            float(parameters["packageX"]) - float(parameters["coreDieX"])
        )
        / 2,
        "sideMoldingY": (
            float(parameters["packageY"]) - float(parameters["coreDieY"])
        )
        / 2,
    }


def build_geometry(parameters: JsonObject) -> JsonObject:
    package_x = float(parameters["packageX"])
    package_y = float(parameters["packageY"])
    core_x = float(parameters["coreDieX"])
    core_y = float(parameters["coreDieY"])
    bottom_layers_thickness = _bottom_layers_thickness(parameters) or 0
    package_bottom_left = [-package_x / 2, -package_y / 2, bottom_layers_thickness]
    package_top_right = [package_x / 2, package_y / 2, bottom_layers_thickness]
    bottom_bodies: list[JsonObject] = []
    cursor_z = 0.0
    for layer_id, _ in BOTTOM_DIE_LAYERS:
        thickness = float(parameters[f"{layer_id}Thickness"])
        if thickness == 0:
            continue
        bottom_bodies.append(
            {
                "id": f"body:hbm-{layer_id}",
                "key": f"hbm.{layer_id}",
                "geometry": {
                    "type": "BoxGeometry",
                    "bottom_left": [-package_x / 2, -package_y / 2, cursor_z],
                    "top_right": [package_x / 2, package_y / 2, cursor_z],
                    "thk": thickness,
                },
                "material": str(parameters[f"{layer_id}Material"]).strip(),
            }
        )
        cursor_z += thickness
    core_bottom_left_xy = [-core_x / 2, -core_y / 2]
    core_top_right_xy = [core_x / 2, core_y / 2]
    children = [
        _body_container(
            "container:hbm-base-die",
            "body:hbm-base-die",
            package_bottom_left,
            package_top_right,
            float(parameters["baseDieThickness"]),
            str(parameters["dieMaterial"]).strip(),
            key="hbm.base_die",
        )
    ]
    regular_core_count = int(parameters["coreDieCount"]) - 1
    for index in range(regular_core_count):
        sequence = str(index + 1).zfill(2)
        bottom_z = (
            bottom_layers_thickness
            + (
                float(parameters["baseDieThickness"])
                + float(parameters["coreBaseGap"])
                + index
                * (
                    float(parameters["coreDieThickness"])
                    + float(parameters["coreCoreGap"])
                )
            )
        )
        children.append(
            _body_container(
                f"container:hbm-core-die-{sequence}",
                f"body:hbm-core-die-{sequence}",
                [core_bottom_left_xy[0], core_bottom_left_xy[1], bottom_z],
                [core_top_right_xy[0], core_top_right_xy[1], bottom_z],
                float(parameters["coreDieThickness"]),
                str(parameters["dieMaterial"]).strip(),
                key=f"hbm.core_die_{index + 1}",
            )
        )
    top_core_bottom_z = (
        bottom_layers_thickness
        + (
            float(parameters["baseDieThickness"])
            + float(parameters["coreBaseGap"])
            + regular_core_count
            * (
                float(parameters["coreDieThickness"])
                + float(parameters["coreCoreGap"])
            )
        )
    )
    children.append(
        _body_container(
            "container:hbm-top-core-die",
            "body:hbm-top-core-die",
            [core_bottom_left_xy[0], core_bottom_left_xy[1], top_core_bottom_z],
            [core_top_right_xy[0], core_top_right_xy[1], top_core_bottom_z],
            float(parameters["topCoreDieThickness"]),
            str(parameters["dieMaterial"]).strip(),
            key="hbm.top_die",
        )
    )
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "id": "container:hbm-root",
            "key": "hbm",
            "bodies": [
                {
                    "id": "body:hbm-molding",
                    "key": "envelope",
                    "geometry": {
                        "type": "BoxGeometry",
                        "bottom_left": package_bottom_left,
                        "top_right": package_top_right,
                        "thk": _occupied_stack_thickness(parameters),
                    },
                    "material": str(parameters["moldingMaterial"]).strip(),
                },
                *bottom_bodies,
            ],
            "vias": [],
            "circuits": [],
            "bumps": [],
            "children": children,
        },
    }


def _body_container(
    container_id: str,
    body_id: str,
    bottom_left: list[float],
    top_right: list[float],
    thickness: float,
    material: str,
    *,
    key: str,
) -> JsonObject:
    return {
        "id": container_id,
        "bodies": [
            {
                "id": body_id,
                "key": key,
                "geometry": {
                    "type": "BoxGeometry",
                    "bottom_left": list(bottom_left),
                    "top_right": list(top_right),
                    "thk": thickness,
                },
                "material": material,
            }
        ],
        "vias": [],
        "circuits": [],
        "bumps": [],
        "children": [],
    }


def _normalized_parameters(parameters: JsonObject) -> JsonObject:
    result = {
        field: parameters.get(field, default)
        for field, default in DEFAULT_PARAMETERS.items()
    }
    numeric_fields = {
        *(f"{layer_id}Thickness" for layer_id, _ in BOTTOM_DIE_LAYERS),
        "packageX",
        "packageY",
        "baseDieThickness",
        "coreDieX",
        "coreDieY",
        "coreDieThickness",
        "topCoreDieThickness",
        "coreBaseGap",
        "coreCoreGap",
    }
    for field in numeric_fields:
        value = result.get(field)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            result[field] = float(value)
    for layer_id, _ in BOTTOM_DIE_LAYERS:
        material = result.get(f"{layer_id}Material")
        if isinstance(material, str):
            result[f"{layer_id}Material"] = material.strip()
    core_count = result.get("coreDieCount")
    if isinstance(core_count, (int, float)) and not isinstance(core_count, bool):
        if math.isfinite(core_count) and int(core_count) == core_count:
            result["coreDieCount"] = int(core_count)
    return result


def _bottom_layers_thickness(parameters: JsonObject) -> float:
    return sum(
        float(parameters[f"{layer_id}Thickness"]) for layer_id, _ in BOTTOM_DIE_LAYERS
    )


def _occupied_stack_thickness(parameters: JsonObject) -> float:
    core_count = int(parameters["coreDieCount"])
    regular_core_count = max(0, core_count - 1)
    return (
        float(parameters["baseDieThickness"])
        + float(parameters["coreBaseGap"])
        + regular_core_count * float(parameters["coreDieThickness"])
        + float(parameters["topCoreDieThickness"])
        + regular_core_count * float(parameters["coreCoreGap"])
    )


def _number(
    id_: str,
    name: str,
    *,
    positive: bool = False,
    minimum: float | None = None,
) -> JsonObject:
    validation: JsonObject = {}
    if positive:
        validation["min"] = 0
        validation["exclusiveMin"] = True
    if minimum is not None:
        validation["min"] = minimum
    return {
        "id": id_,
        "name": name,
        "description": "",
        "valueType": "float",
        "controlType": "number",
        "required": True,
        "unit": "um",
        "validation": validation,
    }


def _integer(id_: str, name: str, *, minimum: int, maximum: int) -> JsonObject:
    return {
        "id": id_,
        "name": name,
        "description": "",
        "valueType": "integer",
        "controlType": "number",
        "required": True,
        "validation": {"min": minimum, "max": maximum},
    }


def _text(id_: str, name: str, *, material: bool = False) -> JsonObject:
    return {
        "id": id_,
        "name": name,
        "description": "",
        "valueType": "materialRef" if material else "string",
        "controlType": "text",
        "required": True,
        "validation": {"minLength": 1},
    }


def _require_positive(
    parameters: JsonObject, key: str, label: str, errors: JsonObject
) -> None:
    value = parameters.get(key)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value <= 0
    ):
        errors[key] = f"{label} must be greater than 0."


def _require_non_negative(
    parameters: JsonObject, key: str, label: str, errors: JsonObject
) -> None:
    value = parameters.get(key)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < 0
    ):
        errors[key] = f"{label} must be 0 or greater."


def _require_text(
    parameters: JsonObject, key: str, label: str, errors: JsonObject
) -> None:
    value = parameters.get(key)
    if not isinstance(value, str) or value.strip() == "":
        errors[key] = f"{label} is required."
