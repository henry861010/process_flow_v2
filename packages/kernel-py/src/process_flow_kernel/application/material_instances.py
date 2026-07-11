from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from ..serialization.geometry_hydration import process_geometry_state_to_geometry_structure
from ..serialization.schema import deep_copy, normalize_geometry_structure

CONTAINER_ITEM_FIELDS = ("bodies", "vias", "circuits", "bumps")
MAIN_GEOMETRY_PORT_ID = "main_geometry"

_DUP_SUFFIX_PATTERN = re.compile(r"(.+)_dup[0-9]+$")
_DUP_SUFFIX_WITH_INDEX_PATTERN = re.compile(r"(.+)_dup([0-9]+)$")


@dataclass(frozen=True, slots=True)
class MaterialInstancePreparation:
    geometry_inputs: dict[str, Any]
    values: dict[str, Any]


def prepare_step_material_instances(
    *,
    geometry_inputs: Mapping[str, Any],
    geometry_input_sources: Mapping[str, str],
    step_template: Mapping[str, Any],
    values: Mapping[str, Any],
) -> MaterialInstancePreparation:
    prepared_geometry_inputs = dict(geometry_inputs)
    parameter_definitions = step_template.get("parameterDefinitions", [])

    main_geometry = prepared_geometry_inputs.get(MAIN_GEOMETRY_PORT_ID)
    if (
        main_geometry is not None
        and geometry_input_sources.get(MAIN_GEOMETRY_PORT_ID) == "external"
    ):
        stripped_main_geometry, _ = rewrite_geometry_materials(main_geometry)
        prepared_geometry_inputs[MAIN_GEOMETRY_PORT_ID] = stripped_main_geometry

    current_material_usage_counts = (
        collect_geometry_material_usage_counts(prepared_geometry_inputs[MAIN_GEOMETRY_PORT_ID])
        if prepared_geometry_inputs.get(MAIN_GEOMETRY_PORT_ID) is not None
        else {}
    )

    sub_geometry_materials: list[str] = []
    for port_id, geometry in list(prepared_geometry_inputs.items()):
        if port_id == MAIN_GEOMETRY_PORT_ID:
            continue
        stripped_geometry, materials = rewrite_geometry_materials(geometry)
        prepared_geometry_inputs[port_id] = stripped_geometry
        sub_geometry_materials.extend(materials)

    material_ref_materials = collect_material_ref_materials(parameter_definitions, values)
    step_material_names = allocate_step_materials(
        [*material_ref_materials, *sub_geometry_materials],
        current_material_usage_counts,
    )
    prepared_values = rewrite_material_ref_values(parameter_definitions, values, step_material_names)

    for port_id, geometry in list(prepared_geometry_inputs.items()):
        if port_id == MAIN_GEOMETRY_PORT_ID:
            continue
        rewritten_geometry, _ = rewrite_geometry_materials(geometry, step_material_names)
        prepared_geometry_inputs[port_id] = rewritten_geometry

    return MaterialInstancePreparation(
        geometry_inputs=prepared_geometry_inputs,
        values=prepared_values,
    )


def strip_material_dup_suffix(material: str) -> str:
    match = _DUP_SUFFIX_PATTERN.fullmatch(material)
    return match.group(1) if match else material


def material_instance_index(material: str) -> int:
    match = _DUP_SUFFIX_WITH_INDEX_PATTERN.fullmatch(material)
    return int(match.group(2)) if match else 1


def allocate_step_materials(
    materials: Sequence[str],
    current_material_usage_counts: Mapping[str, int],
) -> dict[str, str]:
    usage_counts = dict(current_material_usage_counts)
    instance_names: dict[str, str] = {}
    for material in _unique_in_order(materials):
        usage_count = usage_counts.get(material, 0) + 1
        usage_counts[material] = usage_count
        instance_names[material] = material if usage_count == 1 else f"{material}_dup{usage_count}"
    return instance_names


def rewrite_geometry_materials(
    geometry_input: Any,
    material_names_by_base: Mapping[str, str] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    structure = normalize_geometry_structure(
        process_geometry_state_to_geometry_structure(geometry_input)
    )
    collected_materials: list[str] = []
    _rewrite_container_materials(
        structure["root"],
        material_names_by_base or {},
        collected_materials,
    )
    _clear_feature_ids(structure["root"])
    return normalize_geometry_structure(structure), _unique_in_order(collected_materials)


def collect_material_ref_materials(
    parameter_definitions: Sequence[Mapping[str, Any]],
    values: Mapping[str, Any],
) -> list[str]:
    materials: list[str] = []
    _collect_material_ref_materials(parameter_definitions, values, materials)
    return _unique_in_order(materials)


def collect_geometry_material_usage_counts(geometry_input: Any) -> dict[str, int]:
    structure = normalize_geometry_structure(
        process_geometry_state_to_geometry_structure(geometry_input)
    )
    usage_counts: dict[str, int] = {}
    _collect_container_material_usage_counts(structure["root"], usage_counts)
    return usage_counts


def rewrite_material_ref_values(
    parameter_definitions: Sequence[Mapping[str, Any]],
    values: Mapping[str, Any],
    material_names_by_base: Mapping[str, str],
) -> dict[str, Any]:
    rewritten = deep_copy(dict(values))
    _rewrite_material_ref_fields(parameter_definitions, rewritten, material_names_by_base)
    return rewritten


def _rewrite_container_materials(
    container: Mapping[str, Any],
    material_names_by_base: Mapping[str, str],
    collected_materials: list[str],
) -> None:
    for item_field in CONTAINER_ITEM_FIELDS:
        items = container.get(item_field, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            material = item.get("material")
            if not isinstance(material, str):
                continue
            base_material = strip_material_dup_suffix(material)
            collected_materials.append(base_material)
            item["material"] = material_names_by_base.get(base_material, base_material)

    children = container.get("children", [])
    if not isinstance(children, list):
        return
    for child in children:
        if isinstance(child, dict):
            _rewrite_container_materials(child, material_names_by_base, collected_materials)


def _clear_feature_ids(container: Mapping[str, Any]) -> None:
    for item_field in CONTAINER_ITEM_FIELDS:
        items = container.get(item_field, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                item.pop("id", None)

    children = container.get("children", [])
    if not isinstance(children, list):
        return
    for child in children:
        if isinstance(child, dict):
            _clear_feature_ids(child)


def _collect_container_material_usage_counts(
    container: Mapping[str, Any],
    usage_counts: dict[str, int],
) -> None:
    for item_field in CONTAINER_ITEM_FIELDS:
        items = container.get(item_field, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            material = item.get("material")
            if not isinstance(material, str):
                continue
            base_material = strip_material_dup_suffix(material)
            usage_counts[base_material] = max(
                usage_counts.get(base_material, 0),
                material_instance_index(material),
            )

    children = container.get("children", [])
    if not isinstance(children, list):
        return
    for child in children:
        if isinstance(child, dict):
            _collect_container_material_usage_counts(child, usage_counts)


def _collect_material_ref_materials(
    parameter_definitions: Sequence[Mapping[str, Any]],
    values: Mapping[str, Any],
    materials: list[str],
) -> None:
    for parameter in parameter_definitions:
        parameter_id = parameter.get("id")
        if not isinstance(parameter_id, str):
            continue
        value_type = parameter.get("valueType")
        if _is_material_ref_value_type(value_type):
            _collect_material_value(values.get(parameter_id), materials)
            continue
        if value_type != "fieldGroupArray":
            continue
        child_parameters = parameter.get("repeatDefinition", {}).get("itemParameterDefinitions", [])
        items = values.get(parameter_id)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, Mapping):
                _collect_material_ref_materials(child_parameters, item, materials)


def _collect_material_value(value: Any, materials: list[str]) -> None:
    if isinstance(value, str) and value.strip() != "":
        materials.append(strip_material_dup_suffix(value))
        return
    if isinstance(value, list):
        for item in value:
            _collect_material_value(item, materials)


def _rewrite_material_ref_fields(
    parameter_definitions: Sequence[Mapping[str, Any]],
    values: dict[str, Any],
    material_names_by_base: Mapping[str, str],
) -> None:
    for parameter in parameter_definitions:
        parameter_id = parameter.get("id")
        if not isinstance(parameter_id, str):
            continue
        value_type = parameter.get("valueType")
        if _is_material_ref_value_type(value_type):
            if parameter_id in values:
                values[parameter_id] = _rewrite_material_value(values[parameter_id], material_names_by_base)
            continue
        if value_type != "fieldGroupArray":
            continue
        child_parameters = parameter.get("repeatDefinition", {}).get("itemParameterDefinitions", [])
        items = values.get(parameter_id)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                _rewrite_material_ref_fields(child_parameters, item, material_names_by_base)


def _rewrite_material_value(value: Any, material_names_by_base: Mapping[str, str]) -> Any:
    if isinstance(value, str) and value.strip() != "":
        base_material = strip_material_dup_suffix(value)
        return material_names_by_base.get(base_material, base_material)
    if isinstance(value, list):
        return [_rewrite_material_value(item, material_names_by_base) for item in value]
    return value


def _is_material_ref_value_type(value_type: Any) -> bool:
    return value_type in ("materialRef", "materialRef[]")


def _unique_in_order(values: Sequence[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
