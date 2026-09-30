from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from process_flow_kernel import validate_geometry_semantic_keys

from .identifiers import generated_geometry_id


JsonObject = dict[str, Any]


def materialize_embedded_bindings(
    configuration: JsonObject,
) -> tuple[list[JsonObject], dict[str, JsonObject]]:
    """Convert embedded bindings to immutable catalog records and bindings.

    This function is intentionally independent of a particular editor or
    generator.  Workspace commit and direct instance creation share it so the
    persistence contract remains identical at both entry points.
    """

    embedded = configuration.get("embeddedGeometries", {})
    generated_by_local_id: dict[str, JsonObject] = {}
    persisted_bindings: dict[str, JsonObject] = {}

    for flow_input_id, binding in configuration.get("inputBindings", {}).items():
        if binding.get("kind") == "catalog":
            persisted_bindings[flow_input_id] = binding
            continue
        if binding.get("kind") == "generator":
            persisted_bindings[flow_input_id] = binding
            continue

        local_id = binding["localId"]
        geometry = embedded[local_id]
        _validate_persisted_metadata(local_id, geometry)
        if local_id not in generated_by_local_id:
            payload = {**geometry}
            payload["id"] = generated_geometry_id(payload)
            generated_by_local_id[local_id] = payload
        persisted_bindings[flow_input_id] = {
            "kind": "catalog",
            "geometryId": generated_by_local_id[local_id]["id"],
        }

    return list(generated_by_local_id.values()), persisted_bindings


def canonicalize_generator_bindings(configuration: JsonObject, execution_plan) -> JsonObject:
    """Snapshot complete validated generator parameters from the compiled artifacts."""
    bindings = {}
    for flow_input_id, binding in configuration.get("inputBindings", {}).items():
        if binding.get("kind") != "generator":
            bindings[flow_input_id] = binding
            continue
        artifact = execution_plan.external_geometries.get(flow_input_id)
        generation = artifact.generation if artifact is not None else None
        if not isinstance(generation, Mapping):
            raise ValueError(f"Generator input {flow_input_id} was not resolved")
        bindings[flow_input_id] = {
            "kind": "generator",
            "generatorId": generation["generatorId"],
            "generatorVersion": generation["schemaVersion"],
            "parameters": dict(generation["parameters"]),
        }
    return {**configuration, "inputBindings": bindings}


def _validate_persisted_metadata(local_id: str, geometry: JsonObject) -> None:
    for field in ("name", "owner"):
        value = geometry.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(
                f"Embedded geometry {local_id} requires {field} before instance save"
            )
    structure = geometry.get("structure")
    if not isinstance(structure, dict):
        raise ValueError(f"Embedded geometry {local_id} requires structure")
    validate_geometry_semantic_keys(structure)
