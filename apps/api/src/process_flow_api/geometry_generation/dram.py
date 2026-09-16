from __future__ import annotations

import math
from typing import Any

from .contracts import GeneratorEvaluation, JsonObject


MAX_CORE_DIE_COUNT = 64
MAX_BUILDUP_LAYER_COUNT = 63


def _default_layers(side: str, count: int = 5) -> list[JsonObject]:
    return [
        {
            "id": f"{side}-layer-{str(index + 1).zfill(2)}",
            "thickness": 20,
            "density": 50,
        }
        for index in range(count)
    ]


DEFAULT_PARAMETERS: JsonObject = {
    "packageX": 12000,
    "packageY": 8000,
    "dramThickness": 650,
    "moldingMaterial": "EMC",
    "coreDieX": 8000,
    "coreDieY": 6000,
    "coreDieThickness": 50,
    "topCoreDieThickness": 50,
    "coreDieCount": 3,
    "dieGapThickness": 20,
    "dieMaterial": "Si-DRAM",
    "topSolderMaskThickness": 20,
    "bottomSolderMaskThickness": 20,
    "solderMaskMaterial": "Solder-Mask",
    "sbtCoreLayerThickness": 100,
    "sbtCoreMaterial": "BT-Core",
    "buildupDielectricMaterial": "ABF",
    "buildupConductiveMaterial": "Cu",
    "topBuildupLayers": _default_layers("top"),
    "bottomBuildupLayers": _default_layers("bottom"),
}


class DramGenerator:
    def definition(self) -> JsonObject:
        return {
            "schemaVersion": 1,
            "id": "dram",
            "version": 2,
            "label": "DRAM generator",
            "description": "Build a molded DRAM stack on a configurable SBT buildup.",
            "entityType": "die",
            "category": "die.dram",
            "icon": "layers",
            "adaptationContract": {
                "adapterId": "dram-package",
                "adapterVersion": 1,
            },
            "defaultParameters": _copy_parameters(DEFAULT_PARAMETERS),
            "parameterDefinitions": [
                _number("packageX", "Package X", positive=True),
                _number("packageY", "Package Y", positive=True),
                _number("dramThickness", "DRAM thickness", positive=True),
                _text("moldingMaterial", "Molding material"),
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
                _number("dieGapThickness", "Die gap thickness", minimum=0),
                _text("dieMaterial", "Die material"),
                _number("topSolderMaskThickness", "Top solder mask thickness", positive=True),
                _number(
                    "bottomSolderMaskThickness",
                    "Bottom solder mask thickness",
                    positive=True,
                ),
                _text("solderMaskMaterial", "Solder mask material"),
                _number("sbtCoreLayerThickness", "SBT core layer thickness", positive=True),
                _text("sbtCoreMaterial", "SBT core material"),
                _text("buildupDielectricMaterial", "Buildup dielectric material"),
                _text("buildupConductiveMaterial", "Buildup conductive material"),
                _layer_definition("topBuildupLayers", "Top buildup layers", "top"),
                _layer_definition(
                    "bottomBuildupLayers", "Bottom buildup layers", "bottom"
                ),
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
            "previewViews": ["top", "cross-section-x"],
        }

    def validate(self, parameters: JsonObject) -> JsonObject:
        errors: JsonObject = {}
        positive_fields = (
            ("packageX", "Package X"),
            ("packageY", "Package Y"),
            ("dramThickness", "DRAM thickness"),
            ("coreDieX", "Core die X"),
            ("coreDieY", "Core die Y"),
            ("coreDieThickness", "Core die thickness"),
            ("topCoreDieThickness", "Top core die thickness"),
            ("topSolderMaskThickness", "Top solder mask thickness"),
            ("bottomSolderMaskThickness", "Bottom solder mask thickness"),
            ("sbtCoreLayerThickness", "SBT core layer thickness"),
        )
        for key, label in positive_fields:
            _require_positive(parameters, key, label, errors)
        _require_non_negative(parameters, "dieGapThickness", "Die gap thickness", errors)
        for key, label in (
            ("moldingMaterial", "Molding material"),
            ("dieMaterial", "Die material"),
            ("solderMaskMaterial", "Solder mask material"),
            ("sbtCoreMaterial", "SBT core material"),
            ("buildupDielectricMaterial", "Buildup dielectric material"),
            ("buildupConductiveMaterial", "Buildup conductive material"),
        ):
            _require_text(parameters, key, label, errors)

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

        _validate_layers("top", parameters.get("topBuildupLayers"), errors)
        _validate_layers("bottom", parameters.get("bottomBuildupLayers"), errors)
        thickness_fields = (
            "dramThickness",
            "coreDieThickness",
            "topCoreDieThickness",
            "coreDieCount",
            "dieGapThickness",
            "topSolderMaskThickness",
            "bottomSolderMaskThickness",
            "sbtCoreLayerThickness",
        )
        layer_errors = any(
            key.startswith(("topBuildupLayers", "bottomBuildupLayers"))
            for key in errors
        )
        if not layer_errors and all(field not in errors for field in thickness_fields):
            minimum_thickness = _sbt_thickness(parameters) + _occupied_molded_thickness(
                parameters
            )
            if float(parameters["dramThickness"]) < minimum_thickness:
                errors["dramThickness"] = (
                    "DRAM thickness must be at least the substrate and occupied "
                    "molded stack thickness "
                    f"of {format(minimum_thickness, '.15g')} um."
                )
        return errors

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        normalized = _normalized_parameters(parameters)
        errors = self.validate(normalized)
        if errors:
            raise ValueError("Cannot build DRAM geometry from invalid parameters")
        dimensions = derive_dimensions(normalized)
        return GeneratorEvaluation(
            normalized_parameters=normalized,
            computed_parameters=dimensions,
            geometry_structure=build_geometry(normalized, dimensions),
        )


def derive_dimensions(parameters: JsonObject) -> JsonObject:
    top_buildup = _sum_layer_thickness(parameters["topBuildupLayers"])
    bottom_buildup = _sum_layer_thickness(parameters["bottomBuildupLayers"])
    sbt_thickness = _sbt_thickness(parameters)
    molded_body = float(parameters["dramThickness"]) - sbt_thickness
    occupied_molded = _occupied_molded_thickness(parameters)
    return {
        "topBuildupThickness": top_buildup,
        "bottomBuildupThickness": bottom_buildup,
        "sbtThickness": sbt_thickness,
        "moldedBodyThickness": molded_body,
        "topMoldingThickness": molded_body - occupied_molded,
        "totalThickness": float(parameters["dramThickness"]),
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
    package_bounds = _bounds(
        float(parameters["packageX"]), float(parameters["packageY"])
    )
    core_bounds = _bounds(
        float(parameters["coreDieX"]), float(parameters["coreDieY"])
    )
    sbt_layers: list[JsonObject] = []
    cursor_z = 0.0
    sbt_layers.append(
        _body_container(
            "bottom-solder-mask",
            package_bounds,
            cursor_z,
            float(parameters["bottomSolderMaskThickness"]),
            str(parameters["solderMaskMaterial"]),
        )
    )
    cursor_z += float(parameters["bottomSolderMaskThickness"])

    bottom_layers = parameters["bottomBuildupLayers"]
    bottom_layer_z: dict[int, float] = {}
    for index in range(len(bottom_layers) - 1, -1, -1):
        bottom_layer_z[index] = cursor_z
        cursor_z += float(bottom_layers[index]["thickness"])
    for index, layer in enumerate(bottom_layers):
        sbt_layers.append(
            _buildup_layer(
                "bottom",
                index,
                layer,
                package_bounds,
                bottom_layer_z[index],
                str(parameters["buildupDielectricMaterial"]),
                str(parameters["buildupConductiveMaterial"]),
            )
        )

    sbt_layers.append(
        _body_container(
            "sbt-core-layer",
            package_bounds,
            cursor_z,
            float(parameters["sbtCoreLayerThickness"]),
            str(parameters["sbtCoreMaterial"]),
        )
    )
    cursor_z += float(parameters["sbtCoreLayerThickness"])

    for index, layer in enumerate(parameters["topBuildupLayers"]):
        sbt_layers.append(
            _buildup_layer(
                "top",
                index,
                layer,
                package_bounds,
                cursor_z,
                str(parameters["buildupDielectricMaterial"]),
                str(parameters["buildupConductiveMaterial"]),
            )
        )
        cursor_z += float(layer["thickness"])

    sbt_layers.append(
        _body_container(
            "top-solder-mask",
            package_bounds,
            cursor_z,
            float(parameters["topSolderMaskThickness"]),
            str(parameters["solderMaskMaterial"]),
        )
    )

    root_bodies = [body for layer in sbt_layers for body in layer["bodies"]]
    root_circuits = [
        circuit for layer in sbt_layers for circuit in layer["circuits"]
    ]
    children = []
    core_count = int(parameters["coreDieCount"])
    for index in range(core_count):
        sequence = str(index + 1).zfill(2)
        bottom_z = (
            float(values["sbtThickness"])
            + float(parameters["dieGapThickness"])
            + index
            * (
                float(parameters["coreDieThickness"])
                + float(parameters["dieGapThickness"])
            )
        )
        children.append(
            _body_container(
                f"core-die-{sequence}",
                core_bounds,
                bottom_z,
                float(
                    parameters[
                        "topCoreDieThickness"
                        if index == core_count - 1
                        else "coreDieThickness"
                    ]
                ),
                str(parameters["dieMaterial"]),
            )
        )
    return {
        "schemaVersion": "1.0.0",
        "unitSystem": "um",
        "root": {
            "id": "container:dram-root",
            "key": "dram",
            "bodies": [
                {
                    "id": "body:dram-molding",
                    "key": "envelope",
                    "geometry": _box(
                        package_bounds,
                        float(values["sbtThickness"]),
                        float(values["moldedBodyThickness"]),
                    ),
                    "material": str(parameters["moldingMaterial"]).strip(),
                },
                *root_bodies,
            ],
            "vias": [],
            "circuits": root_circuits,
            "bumps": [],
            "children": children,
        },
    }


def _buildup_layer(
    side: str,
    index: int,
    layer: JsonObject,
    bounds: tuple[float, float, float, float],
    bottom_z: float,
    dielectric_material: str,
    conductive_material: str,
) -> JsonObject:
    number = index + 1
    sequence = str(number).zfill(2)
    id_segment = f"{side}-buildup-layer-{sequence}"
    geometry = _box(bounds, bottom_z, float(layer["thickness"]))
    return {
        "id": f"container:dram-{id_segment}",
        "bodies": [
            {
                "id": f"body:dram-{id_segment}-dielectric",
                "geometry": geometry,
                "material": dielectric_material.strip(),
            }
        ],
        "vias": [],
        "circuits": (
            [
                {
                    "id": f"circuit:dram-{id_segment}",
                    "geometry": dict(geometry),
                    "material": conductive_material.strip(),
                    "density": float(layer["density"]),
                    "koz": 0,
                }
            ]
            if number % 2 == 0
            else []
        ),
        "bumps": [],
        "children": [],
    }


def _body_container(
    id_segment: str,
    bounds: tuple[float, float, float, float],
    bottom_z: float,
    thickness: float,
    material: str,
) -> JsonObject:
    return {
        "id": f"container:dram-{id_segment}",
        "bodies": [
            {
                "id": f"body:dram-{id_segment}",
                "geometry": _box(bounds, bottom_z, thickness),
                "material": material.strip(),
            }
        ],
        "vias": [],
        "circuits": [],
        "bumps": [],
        "children": [],
    }


def _bounds(x: float, y: float) -> tuple[float, float, float, float]:
    return (-x / 2, -y / 2, x / 2, y / 2)


def _box(
    bounds: tuple[float, float, float, float], bottom_z: float, thickness: float
) -> JsonObject:
    return {
        "type": "BoxGeometry",
        "bottom_left": [bounds[0], bounds[1], bottom_z],
        "top_right": [bounds[2], bounds[3], bottom_z],
        "thk": thickness,
    }


def _normalized_parameters(parameters: JsonObject) -> JsonObject:
    result = _copy_parameters(DEFAULT_PARAMETERS)
    for key in DEFAULT_PARAMETERS:
        if key in parameters:
            result[key] = parameters[key]
    for key, value in list(result.items()):
        if key in {"topBuildupLayers", "bottomBuildupLayers"}:
            continue
        if key == "coreDieCount":
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                and int(value) == value
            ):
                result[key] = int(value)
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            result[key] = float(value)
    for side in ("top", "bottom"):
        key = f"{side}BuildupLayers"
        layers = result.get(key)
        if isinstance(layers, list):
            result[key] = [
                {
                    "id": str(layer.get("id") or f"{side}-layer-{str(index + 1).zfill(2)}"),
                    "thickness": _number_or_value(layer.get("thickness")),
                    "density": _number_or_value(layer.get("density")),
                }
                if isinstance(layer, dict)
                else layer
                for index, layer in enumerate(layers)
            ]
    return result


def _sbt_thickness(parameters: JsonObject) -> float:
    return (
        float(parameters["bottomSolderMaskThickness"])
        + _sum_layer_thickness(parameters["bottomBuildupLayers"])
        + float(parameters["sbtCoreLayerThickness"])
        + _sum_layer_thickness(parameters["topBuildupLayers"])
        + float(parameters["topSolderMaskThickness"])
    )


def _occupied_molded_thickness(parameters: JsonObject) -> float:
    core_count = int(parameters["coreDieCount"])
    regular_core_count = max(0, core_count - 1)
    return (
        regular_core_count * float(parameters["coreDieThickness"])
        + float(parameters["topCoreDieThickness"])
        + core_count * float(parameters["dieGapThickness"])
    )


def _copy_parameters(parameters: JsonObject) -> JsonObject:
    result = dict(parameters)
    for key in ("topBuildupLayers", "bottomBuildupLayers"):
        result[key] = [dict(layer) for layer in parameters[key]]
    return result


def _number_or_value(value: Any) -> Any:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return value


def _validate_layers(side: str, value: Any, errors: JsonObject) -> None:
    label = "Top" if side == "top" else "Bottom"
    key = f"{side}BuildupLayers"
    if not isinstance(value, list):
        errors[key] = f"{label} buildup layers must be an array."
        return
    if len(value) < 1 or len(value) > MAX_BUILDUP_LAYER_COUNT or len(value) % 2 == 0:
        errors[key] = (
            f"{label} buildup layer count must be an odd integer from 1 to "
            f"{MAX_BUILDUP_LAYER_COUNT}."
        )
    for index, layer in enumerate(value):
        if not isinstance(layer, dict):
            errors[f"{key}.{index}"] = f"{label} layer {index + 1} must be an object."
            continue
        thickness = layer.get("thickness")
        if not _positive_number(thickness):
            errors[f"{key}.{index}.thickness"] = (
                f"{label} layer {index + 1} thickness must be greater than 0."
            )
        if (index + 1) % 2 == 0:
            density = layer.get("density")
            if not _finite_number(density) or float(density) < 0 or float(density) > 100:
                errors[f"{key}.{index}.density"] = (
                    f"{label} layer {index + 1} circuit density must be from 0 to 100."
                )


def _sum_layer_thickness(layers: list[JsonObject]) -> float:
    return sum(float(layer["thickness"]) for layer in layers)


def _layer_definition(id_: str, name: str, side: str) -> JsonObject:
    return {
        "id": id_,
        "name": name,
        "description": "Odd-numbered dielectric layers with circuits on even positions.",
        "valueType": "fieldGroupArray",
        "controlType": "repeater",
        "required": True,
        "repeatDefinition": {
            "itemNameTemplate": f"{side.title()} layer {{{{index}}}}",
            "indexBase": 1,
            "minItems": 1,
            "maxItems": MAX_BUILDUP_LAYER_COUNT,
            "itemParameterDefinitions": [
                _number("thickness", "Thickness", positive=True),
                {
                    "id": "density",
                    "name": "Circuit density",
                    "description": "Used by conductive layers.",
                    "valueType": "float",
                    "controlType": "number",
                    "required": True,
                    "unit": "%",
                    "validation": {"min": 0, "max": 100},
                },
            ],
        },
    }


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


def _text(id_: str, name: str) -> JsonObject:
    return {
        "id": id_,
        "name": name,
        "description": "",
        "valueType": "materialRef",
        "controlType": "text",
        "required": True,
        "validation": {"minLength": 1},
    }


def _finite_number(value: Any) -> bool:
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(value)
    )


def _positive_number(value: Any) -> bool:
    return _finite_number(value) and float(value) > 0


def _require_positive(
    parameters: JsonObject, key: str, label: str, errors: JsonObject
) -> None:
    if not _positive_number(parameters.get(key)):
        errors[key] = f"{label} must be greater than 0."


def _require_non_negative(
    parameters: JsonObject, key: str, label: str, errors: JsonObject
) -> None:
    value = parameters.get(key)
    if not _finite_number(value) or float(value) < 0:
        errors[key] = f"{label} must be 0 or greater."


def _require_text(
    parameters: JsonObject, key: str, label: str, errors: JsonObject
) -> None:
    value = parameters.get(key)
    if not isinstance(value, str) or value.strip() == "":
        errors[key] = f"{label} is required."
