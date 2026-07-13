from __future__ import annotations

from typing import Any

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
    catalog_bindings: dict[str, JsonObject] = {}

    for flow_input_id, binding in configuration.get("inputBindings", {}).items():
        if binding.get("kind") == "catalog":
            catalog_bindings[flow_input_id] = binding
            continue

        local_id = binding["localId"]
        geometry = embedded[local_id]
        _validate_persisted_metadata(local_id, geometry)
        if local_id not in generated_by_local_id:
            payload = {**geometry}
            payload["id"] = generated_geometry_id(payload)
            generated_by_local_id[local_id] = payload
        catalog_bindings[flow_input_id] = {
            "kind": "catalog",
            "geometryId": generated_by_local_id[local_id]["id"],
        }

    return list(generated_by_local_id.values()), catalog_bindings


def _validate_persisted_metadata(local_id: str, geometry: JsonObject) -> None:
    for field in ("name", "version", "owner"):
        value = geometry.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(
                f"Embedded geometry {local_id} requires {field} before instance save"
            )
