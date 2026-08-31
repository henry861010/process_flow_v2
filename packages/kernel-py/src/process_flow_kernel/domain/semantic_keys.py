from __future__ import annotations


CONTAINER_KEYS = frozenset(
    {
        "carrier",
        "carrier.panel",
        "carrier.wafer",
        "frame",
        "hbm",
        "dram",
        "soc",
        "soic",
        "lsi",
        "cpo",
        "vrm",
    }
)

BODY_KEYS = frozenset(
    {
        "carrier",
        "frame",
        "envelope",
        "molding",
        "daf",
    }
)


def validate_container_key(value):
    return _validate_optional_key(value, CONTAINER_KEYS, "container")


def validate_body_key(value):
    return _validate_optional_key(value, BODY_KEYS, "body")


def validate_geometry_semantic_keys(payload):
    if not isinstance(payload, dict):
        raise ValueError("geometry structure must be an object")
    root = payload.get("root") if "root" in payload else payload
    _validate_container_payload(root, "root")


def container_key_matches(candidate, query, *, family=False):
    validate_container_key(candidate)
    validate_container_key(query)
    if candidate is None or query is None:
        return candidate is query
    if not family:
        return candidate == query
    return candidate == query or candidate.startswith(f"{query}.")


def _validate_optional_key(value, vocabulary, kind):
    if value is None:
        return None
    if not isinstance(value, str) or value == "":
        raise ValueError(f"{kind}.key must be omitted or a non-empty string")
    if value not in vocabulary:
        allowed = ", ".join(sorted(vocabulary))
        raise ValueError(f"Unsupported {kind}.key {value!r}; expected one of: {allowed}")
    return value


def _validate_container_payload(container, path):
    if not isinstance(container, dict):
        raise ValueError(f"{path} container must be an object")
    if "key" in container:
        if container["key"] is None:
            raise ValueError(f"{path}.key must be omitted instead of null")
        validate_container_key(container["key"])

    bodies = container.get("bodies", [])
    if isinstance(bodies, list):
        for index, body in enumerate(bodies):
            if not isinstance(body, dict):
                continue
            if "key" in body:
                if body["key"] is None:
                    raise ValueError(
                        f"{path}.bodies[{index}].key must be omitted instead of null"
                    )
                validate_body_key(body["key"])

    for collection in ("vias", "circuits", "bumps"):
        features = container.get(collection, [])
        if not isinstance(features, list):
            continue
        for index, feature in enumerate(features):
            if isinstance(feature, dict) and "key" in feature:
                raise ValueError(
                    f"{path}.{collection}[{index}].key is not supported; "
                    "semantic keys belong only to containers and bodies"
                )

    children = container.get("children", [])
    if isinstance(children, list):
        for index, child in enumerate(children):
            _validate_container_payload(child, f"{path}.children[{index}]")
