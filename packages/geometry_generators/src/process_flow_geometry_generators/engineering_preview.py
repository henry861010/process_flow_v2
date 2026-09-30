from __future__ import annotations

from collections.abc import Iterable
from typing import Any


JsonObject = dict[str, Any]


def build_engineering_preview(structure: JsonObject) -> JsonObject:
    unit = str(structure.get("unitSystem") or "um")
    features = list(_walk_features(structure.get("root"), "root"))
    top_entities = [_top_entity(feature, index) for index, feature in enumerate(features)]
    section_entities = [
        _section_entity(feature, index) for index, feature in enumerate(features)
    ]
    top_entities = [entity for entity in top_entities if entity is not None]
    section_entities = [entity for entity in section_entities if entity is not None]
    bounds = _aggregate_bounds(features)
    core_feature = _representative_core_feature(features)
    core_bounds = (
        _geometry_bounds(core_feature["geometry"])
        if core_feature is not None
        else None
    )
    top_dimensions = [
        {
            "id": "overall-x",
            "axis": "u",
            "from": [bounds["xMin"], bounds["yMin"]],
            "to": [bounds["xMax"], bounds["yMin"]],
            "value": bounds["xMax"] - bounds["xMin"],
            "label": "Overall X",
        },
        {
            "id": "overall-y",
            "axis": "v",
            "from": [bounds["xMin"], bounds["yMin"]],
            "to": [bounds["xMin"], bounds["yMax"]],
            "value": bounds["yMax"] - bounds["yMin"],
            "label": "Overall Y",
        },
    ]
    section_dimensions = [
        {
            "id": "overall-z",
            "axis": "v",
            "from": [bounds["xMax"], bounds["zMin"]],
            "to": [bounds["xMax"], bounds["zMax"]],
            "value": bounds["zMax"] - bounds["zMin"],
            "label": "Total thickness",
        }
    ]
    if core_bounds is not None:
        top_dimensions.extend(
            [
                {
                    "id": "core-die-x",
                    "axis": "u",
                    "from": [core_bounds["xMin"], core_bounds["yMin"]],
                    "to": [core_bounds["xMax"], core_bounds["yMin"]],
                    "value": core_bounds["xMax"] - core_bounds["xMin"],
                    "label": "Core die X",
                },
                {
                    "id": "core-die-y",
                    "axis": "v",
                    "from": [core_bounds["xMin"], core_bounds["yMin"]],
                    "to": [core_bounds["xMin"], core_bounds["yMax"]],
                    "value": core_bounds["yMax"] - core_bounds["yMin"],
                    "label": "Core die Y",
                },
            ]
        )
        section_dimensions.append(
            {
                "id": "core-die-thickness",
                "axis": "v",
                "from": [core_bounds["xMax"], core_bounds["zMin"]],
                "to": [core_bounds["xMax"], core_bounds["zMax"]],
                "value": core_bounds["zMax"] - core_bounds["zMin"],
                "label": "Core die thickness",
            }
        )
    return {
        "schemaVersion": 1,
        "unit": unit,
        "views": [
            {
                "id": "top",
                "label": "Top View",
                "projection": "xy",
                "bounds": {
                    "uMin": bounds["xMin"],
                    "uMax": bounds["xMax"],
                    "vMin": bounds["yMin"],
                    "vMax": bounds["yMax"],
                },
                "entities": top_entities,
                "dimensions": top_dimensions,
                "annotations": [],
            },
            {
                "id": "cross-section-x",
                "label": "Cross Section",
                "projection": "xz",
                "bounds": {
                    "uMin": bounds["xMin"],
                    "uMax": bounds["xMax"],
                    "vMin": bounds["zMin"],
                    "vMax": bounds["zMax"],
                },
                "entities": section_entities,
                "dimensions": section_dimensions,
                "annotations": [],
            },
        ],
    }


def _representative_core_feature(features: list[JsonObject]) -> JsonObject | None:
    return next(
        (
            feature
            for feature in features
            if feature.get("kind") == "body"
            and "core-die"
            in str(feature.get("id") or "").lower().replace("_", "-")
        ),
        None,
    )


def _walk_features(container: Any, path: str) -> Iterable[JsonObject]:
    if not isinstance(container, dict):
        return
    container_key = container.get("key")
    feature_groups = (
        ("bodies", "body"),
        ("vias", "via"),
        ("circuits", "circuit"),
        ("bumps", "bump"),
    )
    for collection_name, feature_kind in feature_groups:
        values = container.get(collection_name, [])
        if not isinstance(values, list):
            continue
        for index, feature in enumerate(values):
            if not isinstance(feature, dict) or not isinstance(feature.get("geometry"), dict):
                continue
            feature_id = feature.get("id") or f"{path}.{collection_name}.{index}"
            yield {
                "id": str(feature_id),
                "kind": feature_kind,
                "role": _semantic_role(feature_id, container_key, feature_kind),
                "containerKey": container_key,
                "geometry": feature["geometry"],
            }
    children = container.get("children", [])
    if not isinstance(children, list):
        return
    for index, child in enumerate(children):
        if isinstance(child, dict):
            child_id = child.get("id") or f"{path}.children.{index}"
            yield from _walk_features(child, str(child_id))


def _semantic_role(feature_id: Any, container_key: Any, feature_kind: str) -> str:
    semantic_text = f"{feature_id or ''} {container_key or ''}".lower()
    normalized_text = semantic_text.replace("_", "-")
    if "mold" in semantic_text:
        return "mold"
    if "solder" in semantic_text or "mask" in semantic_text:
        return "solderMask"
    if feature_kind == "circuit" or "circuit" in semantic_text:
        return "circuit"
    if feature_kind == "via":
        return "via"
    if feature_kind == "bump":
        return "bump"
    if "core-die" in normalized_text or "base-die" in normalized_text:
        return "die"
    return "body"


def _top_entity(feature: JsonObject, index: int) -> JsonObject | None:
    geometry = feature["geometry"]
    geometry_type = geometry.get("type")
    base = {
        "id": f"top:{feature['id']}:{index}",
        "sourceId": feature["id"],
        "role": feature["role"],
        "semanticKey": feature.get("containerKey"),
    }
    if geometry_type == "BoxGeometry":
        bounds = _geometry_bounds(geometry)
        return {
            **base,
            "kind": "rectangle",
            "uMin": bounds["xMin"],
            "uMax": bounds["xMax"],
            "vMin": bounds["yMin"],
            "vMax": bounds["yMax"],
        }
    if geometry_type == "PolygonGeometry":
        loops = geometry.get("polys")
        if not isinstance(loops, list):
            return None
        return {
            **base,
            "kind": "polygon",
            "loops": [
                [[float(point[0]), float(point[1])] for point in loop]
                for loop in loops
                if isinstance(loop, list)
            ],
        }
    if geometry_type in {"CylinderGeometry", "ConeGeometry"}:
        center = geometry.get("center")
        if not isinstance(center, list) or len(center) < 2:
            return None
        radius = max(
            float(geometry.get("bottom_radius") or 0),
            float(geometry.get("top_radius") or 0),
        )
        return {
            **base,
            "kind": "circle",
            "center": [float(center[0]), float(center[1])],
            "radius": radius,
        }
    return None


def _section_entity(feature: JsonObject, index: int) -> JsonObject | None:
    geometry = feature["geometry"]
    try:
        bounds = _geometry_bounds(geometry)
    except ValueError:
        return None
    return {
        "id": f"section:{feature['id']}:{index}",
        "sourceId": feature["id"],
        "role": feature["role"],
        "semanticKey": feature.get("containerKey"),
        "kind": "rectangle",
        "uMin": bounds["xMin"],
        "uMax": bounds["xMax"],
        "vMin": bounds["zMin"],
        "vMax": bounds["zMax"],
    }


def _aggregate_bounds(features: list[JsonObject]) -> JsonObject:
    if len(features) == 0:
        return {"xMin": 0.0, "xMax": 0.0, "yMin": 0.0, "yMax": 0.0, "zMin": 0.0, "zMax": 0.0}
    bounds = [_geometry_bounds(feature["geometry"]) for feature in features]
    return {
        "xMin": min(value["xMin"] for value in bounds),
        "xMax": max(value["xMax"] for value in bounds),
        "yMin": min(value["yMin"] for value in bounds),
        "yMax": max(value["yMax"] for value in bounds),
        "zMin": min(value["zMin"] for value in bounds),
        "zMax": max(value["zMax"] for value in bounds),
    }


def _geometry_bounds(geometry: JsonObject) -> JsonObject:
    geometry_type = geometry.get("type")
    thickness = float(geometry.get("thk") or 0)
    if geometry_type == "BoxGeometry":
        bottom_left = geometry.get("bottom_left")
        top_right = geometry.get("top_right")
        if not isinstance(bottom_left, list) or not isinstance(top_right, list):
            raise ValueError("BoxGeometry requires bottom_left and top_right")
        z_min = min(float(bottom_left[2]), float(top_right[2]))
        return {
            "xMin": min(float(bottom_left[0]), float(top_right[0])),
            "xMax": max(float(bottom_left[0]), float(top_right[0])),
            "yMin": min(float(bottom_left[1]), float(top_right[1])),
            "yMax": max(float(bottom_left[1]), float(top_right[1])),
            "zMin": z_min,
            "zMax": z_min + thickness,
        }
    if geometry_type == "PolygonGeometry":
        loops = geometry.get("polys")
        points = [point for loop in loops or [] for point in loop]
        if len(points) == 0:
            raise ValueError("PolygonGeometry requires points")
        z_min = min(float(point[2]) for point in points)
        return {
            "xMin": min(float(point[0]) for point in points),
            "xMax": max(float(point[0]) for point in points),
            "yMin": min(float(point[1]) for point in points),
            "yMax": max(float(point[1]) for point in points),
            "zMin": z_min,
            "zMax": z_min + thickness,
        }
    if geometry_type in {"CylinderGeometry", "ConeGeometry"}:
        center = geometry.get("center")
        if not isinstance(center, list):
            raise ValueError(f"{geometry_type} requires center")
        radius = max(
            float(geometry.get("bottom_radius") or 0),
            float(geometry.get("top_radius") or 0),
        )
        z_min = float(center[2])
        return {
            "xMin": float(center[0]) - radius,
            "xMax": float(center[0]) + radius,
            "yMin": float(center[1]) - radius,
            "yMax": float(center[1]) + radius,
            "zMin": z_min,
            "zMax": z_min + thickness,
        }
    raise ValueError(f"Unsupported geometry type: {geometry_type}")
