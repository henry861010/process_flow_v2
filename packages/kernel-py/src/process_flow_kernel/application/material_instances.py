from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from ..serialization.geometry_hydration import process_geometry_state_to_geometry_structure
from ..serialization.schema import deep_copy, normalize_geometry_structure

CONTAINER_ITEM_FIELDS = ("bodies", "vias", "circuits", "bumps")
MAIN_GEOMETRY_FIELD_ID = "main_geometry"

_DUP_SUFFIX_PATTERN = re.compile(r"(.+)_dup[0-9]+$")


@dataclass(frozen=True, slots=True)
class MaterialInstancePreparation:
    geometry_inputs: dict[str, Any]
    values: dict[str, Any]


class MaterialInstanceTracker:
    def __init__(self):
        self._usage_counts: dict[str, int] = {}

    def seed_initial_materials(self, materials: Sequence[str]) -> None:
        for material in _unique_in_order(materials):
            self._usage_counts.setdefault(material, 1)

    def allocate_step_materials(self, materials: Sequence[str]) -> dict[str, str]:
        instance_names: dict[str, str] = {}
        for material in _unique_in_order(materials):
            usage_count = self._usage_counts.get(material, 0) + 1
            self._usage_counts[material] = usage_count
            instance_names[material] = material if usage_count == 1 else f"{material}_dup{usage_count}"
        return instance_names


def prepare_step_material_instances(
    *,
    geometry_inputs: Mapping[str, Any],
    geometry_input_sources: Mapping[str, str],
    step_template: Mapping[str, Any],
    values: Mapping[str, Any],
    tracker: MaterialInstanceTracker,
) -> MaterialInstancePreparation:
    prepared_geometry_inputs = dict(geometry_inputs)
    field_definitions = step_template.get("fieldDefinitions", [])

    main_geometry = prepared_geometry_inputs.get(MAIN_GEOMETRY_FIELD_ID)
    if (
        main_geometry is not None
        and geometry_input_sources.get(MAIN_GEOMETRY_FIELD_ID) == "geometryRef"
    ):
        stripped_main_geometry, main_materials = rewrite_geometry_materials(main_geometry)
        prepared_geometry_inputs[MAIN_GEOMETRY_FIELD_ID] = stripped_main_geometry
        tracker.seed_initial_materials(main_materials)

    sub_geometry_materials: list[str] = []
    for field_id, geometry in list(prepared_geometry_inputs.items()):
        if field_id == MAIN_GEOMETRY_FIELD_ID:
            continue
        stripped_geometry, materials = rewrite_geometry_materials(geometry)
        prepared_geometry_inputs[field_id] = stripped_geometry
        sub_geometry_materials.extend(materials)

    material_ref_materials = collect_material_ref_materials(field_definitions, values)
    step_material_names = tracker.allocate_step_materials(
        [*material_ref_materials, *sub_geometry_materials]
    )
    prepared_values = rewrite_material_ref_values(field_definitions, values, step_material_names)

    for field_id, geometry in list(prepared_geometry_inputs.items()):
        if field_id == MAIN_GEOMETRY_FIELD_ID:
            continue
        rewritten_geometry, _ = rewrite_geometry_materials(geometry, step_material_names)
        prepared_geometry_inputs[field_id] = rewritten_geometry

    return MaterialInstancePreparation(
        geometry_inputs=prepared_geometry_inputs,
        values=prepared_values,
    )


def strip_material_dup_suffix(material: str) -> str:
    match = _DUP_SUFFIX_PATTERN.fullmatch(material)
    return match.group(1) if match else material


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
    field_definitions: Sequence[Mapping[str, Any]],
    values: Mapping[str, Any],
) -> list[str]:
    materials: list[str] = []
    _collect_material_ref_materials(field_definitions, values, materials)
    return _unique_in_order(materials)


def rewrite_material_ref_values(
    field_definitions: Sequence[Mapping[str, Any]],
    values: Mapping[str, Any],
    material_names_by_base: Mapping[str, str],
) -> dict[str, Any]:
    rewritten = deep_copy(dict(values))
    _rewrite_material_ref_fields(field_definitions, rewritten, material_names_by_base)
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


def _collect_material_ref_materials(
    field_definitions: Sequence[Mapping[str, Any]],
    values: Mapping[str, Any],
    materials: list[str],
) -> None:
    for field in field_definitions:
        field_id = field.get("id")
        if not isinstance(field_id, str):
            continue
        value_type = field.get("valueType")
        if _is_material_ref_value_type(value_type):
            _collect_material_value(values.get(field_id), materials)
            continue
        if value_type != "fieldGroupArray":
            continue
        child_fields = field.get("repeatDefinition", {}).get("itemFieldDefinitions", [])
        items = values.get(field_id)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, Mapping):
                _collect_material_ref_materials(child_fields, item, materials)


def _collect_material_value(value: Any, materials: list[str]) -> None:
    if isinstance(value, str) and value.strip() != "":
        materials.append(strip_material_dup_suffix(value))
        return
    if isinstance(value, list):
        for item in value:
            _collect_material_value(item, materials)


def _rewrite_material_ref_fields(
    field_definitions: Sequence[Mapping[str, Any]],
    values: dict[str, Any],
    material_names_by_base: Mapping[str, str],
) -> None:
    for field in field_definitions:
        field_id = field.get("id")
        if not isinstance(field_id, str):
            continue
        value_type = field.get("valueType")
        if _is_material_ref_value_type(value_type):
            if field_id in values:
                values[field_id] = _rewrite_material_value(values[field_id], material_names_by_base)
            continue
        if value_type != "fieldGroupArray":
            continue
        child_fields = field.get("repeatDefinition", {}).get("itemFieldDefinitions", [])
        items = values.get(field_id)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                _rewrite_material_ref_fields(child_fields, item, material_names_by_base)


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
