"""Definition-aware normalization of recipe parameter values on the wire."""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any


def normalize_parameter_values_for_storage(
    definitions: Sequence[Mapping[str, Any]], values: Mapping[str, Any],
) -> dict[str, Any]:
    """Represent omitted recipe parameters by absent keys, without validating them.

    Historical null and empty-string parameter values mean missing. Only declared
    parameters and fieldGroupArray item.values are traversed: unknown keys, invalid
    values, collection elements, and group structure remain available to validators.
    The input is never mutated. Drafts may retain their original, unnormalized input.
    """
    if not isinstance(values, Mapping):
        raise ValueError("parameterValues must be an object")
    normalized = dict(values)
    for definition in definitions:
        parameter_id = definition["id"]
        if parameter_id not in normalized:
            continue
        value = normalized[parameter_id]
        if value is None or (isinstance(value, str) and value == ""):
            del normalized[parameter_id]
            continue
        if definition.get("valueType") != "fieldGroupArray" or not isinstance(value, Mapping):
            continue
        items = value.get("items")
        if not isinstance(items, list):
            continue
        item_definitions = definition.get("repeatDefinition", {}).get("itemParameterDefinitions", [])
        normalized_items = []
        for item in items:
            if not isinstance(item, Mapping) or not isinstance(item.get("values"), Mapping):
                normalized_items.append(item)
                continue
            normalized_items.append({
                **item,
                "values": normalize_parameter_values_for_storage(item_definitions, item["values"]),
            })
        normalized[parameter_id] = {**value, "items": normalized_items}
    return normalized
