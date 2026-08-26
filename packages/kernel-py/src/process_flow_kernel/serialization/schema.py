from __future__ import annotations

import copy
import hashlib
import json
import re

from ..domain.semantic_keys import validate_body_key, validate_container_key

GEOMETRY_SCHEMA_VERSION = "1.0.0"
DEFAULT_UNIT_SYSTEM = "um"


def normalize_geometry_structure(
    payload,
    schema_version=GEOMETRY_SCHEMA_VERSION,
    unit_system=DEFAULT_UNIT_SYSTEM,
):
    copied = _js_number_normalized(deep_copy(payload))
    if _is_structure(copied):
        structure = copied
    else:
        structure = {
            "schemaVersion": schema_version,
            "unitSystem": unit_system,
            "root": copied,
        }

    structure.setdefault("schemaVersion", schema_version)
    structure.setdefault("unitSystem", unit_system)
    assign_container_ids(structure["root"], ["root"])
    return structure


def stable_id(kind, path, payload=None):
    normalized_path = [str(part) for part in path]
    digest_payload = {
        "kind": kind,
        "path": normalized_path,
        "payload": payload,
    }
    digest = hashlib.sha1(_canonical_json(digest_payload).encode("ascii")).hexdigest()
    label = _slug("-".join(normalized_path[-3:]))
    return f"{kind}:{label}:{digest[:12]}"


def deep_copy(value):
    return copy.deepcopy(value)


def assign_container_ids(container, path):
    container.setdefault("bodies", [])
    container.setdefault("vias", [])
    container.setdefault("circuits", [])
    container.setdefault("bumps", [])
    container.setdefault("children", [])

    container_key = None
    if "key" in container:
        if container["key"] is None:
            raise ValueError("container.key must be omitted instead of null")
        container_key = validate_container_key(container["key"])
    container_label = "container" if container_key is None else f"container:{container_key}"
    container_path = [*path, container_label]
    identity_payload = None if container_key is None else {"key": container_key}
    container.setdefault("id", stable_id("container", container_path, identity_payload))

    _assign_feature_ids(container["bodies"], "body", container_path)
    _assign_feature_ids(container["vias"], "via", container_path)
    _assign_feature_ids(container["circuits"], "circuit", container_path)
    _assign_feature_ids(container["bumps"], "bump", container_path)

    for index, child in enumerate(container["children"]):
        child_key = child.get("key")
        child_label = f"child:{index}" if child_key is None else f"child:{index}:{child_key}"
        child_path = [*container_path, child_label]
        assign_container_ids(child, child_path)


def _assign_feature_ids(features, kind, container_path):
    for index, feature in enumerate(features):
        if kind == "body" and "key" in feature:
            if feature["key"] is None:
                raise ValueError("body.key must be omitted instead of null")
            validate_body_key(feature["key"])
        elif kind != "body" and "key" in feature:
            raise ValueError(
                f"{kind}.key is not supported; semantic keys belong only to "
                "containers and bodies"
            )
        if "id" not in feature:
            feature["id"] = stable_id(
                kind,
                [*container_path, f"{kind}:{index}"],
                _feature_identity_payload(feature, kind),
            )


def _feature_identity_payload(feature, kind):
    return _without_id(feature)


def _without_id(value):
    copied = deep_copy(value)
    if isinstance(copied, dict):
        copied.pop("id", None)
    return copied


def _canonical_json(value):
    return json.dumps(
        _sort_for_json(_js_number_normalized(value)),
        ensure_ascii=True,
        separators=(",", ":"),
    )


def _sort_for_json(value):
    if isinstance(value, list):
        return [_sort_for_json(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: _sort_for_json(value[key]) for key in sorted(value.keys())}


def _js_number_normalized(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_js_number_normalized(item) for item in value]
    if isinstance(value, dict):
        return {key: _js_number_normalized(item) for key, item in value.items()}
    return value


def _is_structure(payload):
    return (
        isinstance(payload, dict)
        and "root" in payload
        and ("schemaVersion" in payload or "unitSystem" in payload)
    )


def _slug(value):
    lowered = value.lower()
    slugged = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slugged or "item"
