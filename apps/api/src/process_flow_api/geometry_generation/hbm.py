from __future__ import annotations

import math
from typing import Any

from .contracts import GeneratorEvaluation, JsonObject


MAX_CORE_DIE_COUNT = 64

DEFAULT_PARAMETERS: JsonObject = {
    "packageX": 12000,
    "packageY": 8000,
    "hbmThickness": 480,
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
            "schemaVersion": 1,
            "id": "hbm",
            "version": 2,
            "label": "HBM generator",
            "description": "Build an HBM package from a molding envelope and fixed core stack.",
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
                _number("hbmThickness", "HBM thickness", positive=True),
                _text("moldingMaterial", "Molding material", material=True),
                _number("baseDieThickness", "Base die thickness", positive=True),
                _number("coreDieX", "Core die X", positive=True),
                _number("coreDieY", "Core die Y", positive=True),
                _number("coreDieThickness", "Core die thickness", positive=True),
                _number(
                    "topCoreDieThickness", "Top core die thickness", positive=True
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
            "previewViews": ["top", "cross-section-x"],
        }

    def validate(self, parameters: JsonObject) -> JsonObject:
        errors: JsonObject = {}
        _require_positive(parameters, "packageX", "Package X", errors)
        _require_positive(parameters, "packageY", "Package Y", errors)
        _require_positive(parameters, "hbmThickness", "HBM thickness", errors)
        _require_text(parameters, "moldingMaterial", "Molding material", errors)
        _require_positive(parameters, "baseDieThickness", "Base die thickness", errors)
        _require_positive(parameters, "coreDieX", "Core die X", errors)
        _require_positive(parameters, "coreDieY", "Core die Y", errors)
        _require_positive(parameters, "coreDieThickness", "Core die thickness", errors)
        _require_positive(
            parameters, "topCoreDieThickness", "Top core die thickness", errors
        )
        _require_non_negative(parameters, "coreBaseGap", "Core-base gap", errors)
        _require_non_negative(parameters, "coreCoreGap", "Core-core gap", errors)
        _require_text(parameters, "dieMaterial", "Die material", errors)

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
            "hbmThickness",
            "baseDieThickness",
            "coreDieThickness",
            "topCoreDieThickness",
            "coreBaseGap",
            "coreCoreGap",
            "coreDieCount",
        )
        if all(field not in errors for field in thickness_fields):
            occupied_thickness = _occupied_stack_thickness(parameters)
            if float(parameters["hbmThickness"]) < occupied_thickness:
                errors["hbmThickness"] = (
                    "HBM thickness must be at least the occupied stack thickness "
                    f"of {format(occupied_thickness, '.15g')} um."
                )
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
            geometry_structure=build_geometry(normalized, dimensions),
        )


def derive_dimensions(parameters: JsonObject) -> JsonObject:
    occupied_thickness = _occupied_stack_thickness(parameters)
    return {
        "totalThickness": float(parameters["hbmThickness"]),
        "topMoldingThickness": float(parameters["hbmThickness"])
        - occupied_thickness,
        "sideMoldingX": (
            float(parameters["packageX"]) - float(parameters["coreDieX"])
        )
        / 2,
        "sideMoldingY": (
            float(parameters["packageY"]) - float(parameters["coreDieY"])
        )
        / 2,
    }


def build_geometry(parameters: JsonObject, dimensions: JsonObject | None = None) -> JsonObject:
    values = dimensions or derive_dimensions(parameters)
    package_x = float(parameters["packageX"])
    package_y = float(parameters["packageY"])
    core_x = float(parameters["coreDieX"])
    core_y = float(parameters["coreDieY"])
    package_bottom_left = [-package_x / 2, -package_y / 2, 0]
    package_top_right = [package_x / 2, package_y / 2, 0]
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
        )
    ]
    core_count = int(parameters["coreDieCount"])
    for index in range(core_count):
        sequence = str(index + 1).zfill(2)
        bottom_z = (
            float(parameters["baseDieThickness"])
            + float(parameters["coreBaseGap"])
            + index
            * (
                float(parameters["coreDieThickness"])
                + float(parameters["coreCoreGap"])
            )
        )
        children.append(
            _body_container(
                f"container:hbm-core-die-{sequence}",
                f"body:hbm-core-die-{sequence}",
                [core_bottom_left_xy[0], core_bottom_left_xy[1], bottom_z],
                [core_top_right_xy[0], core_top_right_xy[1], bottom_z],
                float(
                    parameters[
                        "topCoreDieThickness"
                        if index == core_count - 1
                        else "coreDieThickness"
                    ]
                ),
                str(parameters["dieMaterial"]).strip(),
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
                        "thk": values["totalThickness"],
                    },
                    "material": str(parameters["moldingMaterial"]).strip(),
                }
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
) -> JsonObject:
    return {
        "id": container_id,
        "bodies": [
            {
                "id": body_id,
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
        "packageX",
        "packageY",
        "hbmThickness",
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
    core_count = result.get("coreDieCount")
    if isinstance(core_count, (int, float)) and not isinstance(core_count, bool):
        if math.isfinite(core_count) and int(core_count) == core_count:
            result["coreDieCount"] = int(core_count)
    return result


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
