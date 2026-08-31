from __future__ import annotations

import copy
import math
from collections.abc import Iterable, Mapping
from typing import Any, Callable

from process_flow_kernel import GeometryArtifact, normalize_geometry_structure


JsonObject = dict[str, Any]
Adapter = Callable[[JsonObject, JsonObject], JsonObject]


def adapt_geometry(
    source: GeometryArtifact,
    target_region: Mapping[str, Any],
) -> JsonObject:
    structure = normalize_geometry_structure(source.structure)
    contract = source.adaptation_contract or {
        "adapterId": _default_adapter_id(structure),
        "adapterVersion": 1,
        "parameters": {},
    }
    adapter_id = contract.get("adapterId")
    adapter_version = contract.get("adapterVersion")
    if not isinstance(adapter_id, str) or adapter_id == "":
        raise ValueError("Geometry adaptation contract requires adapterId")
    if adapter_version != 1:
        raise ValueError(
            f"Geometry adapter {adapter_id} version {adapter_version} is not available"
        )
    adapter = _ADAPTERS.get(adapter_id)
    if adapter is None:
        raise ValueError(f"Geometry adapter is not installed: {adapter_id}@{adapter_version}")
    normalized_region = normalize_target_region(target_region)
    return normalize_geometry_structure(adapter(structure, normalized_region))


def rotate_geometry(
    structure: Mapping[str, Any],
    degrees: float,
    anchor: str,
) -> JsonObject:
    angle = _finite_number(degrees, "rotationZ") % 360
    result = normalize_geometry_structure(structure)
    bounds = _structure_bounds(result)
    pivot = _anchor_point(bounds, anchor)
    radians = math.radians(angle)
    cosine = math.cos(radians)
    sine = math.sin(radians)

    def rotate_point(x: float, y: float) -> tuple[float, float]:
        local_x = x - pivot["x"]
        local_y = y - pivot["y"]
        return (
            local_x * cosine - local_y * sine,
            local_x * sine + local_y * cosine,
        )

    for geometry in _walk_geometries(result["root"]):
        geometry_type = geometry.get("type")
        if geometry_type == "BoxGeometry":
            bottom_left = geometry["bottom_left"]
            top_right = geometry["top_right"]
            z_min = float(bottom_left[2])
            thickness = float(geometry["thk"])
            x_min = min(float(bottom_left[0]), float(top_right[0]))
            x_max = max(float(bottom_left[0]), float(top_right[0]))
            y_min = min(float(bottom_left[1]), float(top_right[1]))
            y_max = max(float(bottom_left[1]), float(top_right[1]))
            points = [
                rotate_point(x_min, y_min),
                rotate_point(x_max, y_min),
                rotate_point(x_max, y_max),
                rotate_point(x_min, y_max),
            ]
            if math.isclose(angle % 90, 0, abs_tol=1e-9):
                geometry["bottom_left"] = [
                    min(point[0] for point in points),
                    min(point[1] for point in points),
                    z_min,
                ]
                geometry["top_right"] = [
                    max(point[0] for point in points),
                    max(point[1] for point in points),
                    z_min,
                ]
            else:
                geometry.clear()
                geometry.update(
                    {
                        "type": "PolygonGeometry",
                        "polys": [
                            [[point[0], point[1], z_min] for point in points]
                        ],
                        "thk": thickness,
                    }
                )
            continue
        if geometry_type == "PolygonGeometry":
            for loop in geometry.get("polys", []):
                for point in loop:
                    point[0], point[1] = rotate_point(
                        float(point[0]), float(point[1])
                    )
            continue
        if geometry_type in {"CylinderGeometry", "ConeGeometry"}:
            center = geometry["center"]
            center[0], center[1] = rotate_point(
                float(center[0]), float(center[1])
            )
            continue
        raise ValueError(f"Unsupported geometry type for rotation: {geometry_type}")
    return normalize_geometry_structure(result)


def normalize_target_region(value: Mapping[str, Any]) -> JsonObject:
    if not isinstance(value, Mapping):
        raise ValueError("PnP placement targetRegion must be an object")
    region_type = value.get("type")
    if region_type == "rectangle":
        width = _positive_number(value.get("width"), "targetRegion.width")
        height = _positive_number(value.get("height"), "targetRegion.height")
        return {
            "type": "rectangle",
            "width": width,
            "height": height,
            "bounds": {
                "xMin": 0.0,
                "xMax": width,
                "yMin": 0.0,
                "yMax": height,
            },
        }
    if region_type == "polygon":
        points = value.get("points")
        if not isinstance(points, list) or len(points) < 3:
            raise ValueError("PnP polygon targetRegion requires at least three points")
        normalized_points = [
            [
                _finite_number(point[0], f"targetRegion.points[{index}][0]"),
                _finite_number(point[1], f"targetRegion.points[{index}][1]"),
            ]
            for index, point in enumerate(points)
            if isinstance(point, list) and len(point) == 2
        ]
        if len(normalized_points) != len(points):
            raise ValueError("PnP polygon targetRegion points must be [x, y]")
        if len(normalized_points) > 3 and _points_equal(
            normalized_points[0], normalized_points[-1]
        ):
            normalized_points.pop()
        if len(normalized_points) < 3:
            raise ValueError("PnP polygon targetRegion requires at least three points")
        for index, point in enumerate(normalized_points):
            next_point = normalized_points[(index + 1) % len(normalized_points)]
            if _points_equal(point, next_point):
                raise ValueError("PnP polygon targetRegion must not contain zero-length edges")
        if len({(point[0], point[1]) for point in normalized_points}) != len(
            normalized_points
        ):
            raise ValueError("PnP polygon targetRegion points must be unique")
        if _polygon_self_intersects(normalized_points):
            raise ValueError("PnP polygon targetRegion must not self-intersect")
        if abs(_polygon_area(normalized_points)) <= 1e-9:
            raise ValueError("PnP polygon targetRegion must have non-zero area")
        bounds = {
            "xMin": min(point[0] for point in normalized_points),
            "xMax": max(point[0] for point in normalized_points),
            "yMin": min(point[1] for point in normalized_points),
            "yMax": max(point[1] for point in normalized_points),
        }
        if bounds["xMax"] <= bounds["xMin"] or bounds["yMax"] <= bounds["yMin"]:
            raise ValueError("PnP polygon targetRegion must have non-empty XY bounds")
        return {
            "type": "polygon",
            "points": normalized_points,
            "bounds": bounds,
        }
    raise ValueError('PnP targetRegion.type must be "rectangle" or "polygon"')


def _box_rescale(structure: JsonObject, region: JsonObject) -> JsonObject:
    result = copy.deepcopy(structure)
    if region["type"] == "polygon":
        geometries = list(_walk_geometries(result["root"]))
        if len(geometries) != 1 or geometries[0].get("type") != "BoxGeometry":
            raise ValueError(
                "box-rescale polygon target requires exactly one BoxGeometry footprint; "
                "use a specialized adaptationContract for multi-primitive sources"
            )
        _replace_footprint(geometries[0], region, region)
        return result

    source_bounds = _structure_bounds(result)
    delta_x = float(region["width"]) - (source_bounds["xMax"] - source_bounds["xMin"])
    delta_y = float(region["height"]) - (source_bounds["yMax"] - source_bounds["yMin"])
    for geometry in _walk_geometries(result["root"]):
        if geometry.get("type") != "BoxGeometry":
            raise ValueError("PnP XY resize supports only BoxGeometry")
        bottom_left = geometry["bottom_left"]
        top_right = geometry["top_right"]
        resized_x = float(top_right[0]) + delta_x
        resized_y = float(top_right[1]) + delta_y
        if resized_x <= float(bottom_left[0]) or resized_y <= float(bottom_left[1]):
            raise ValueError("BoxGeometry XY resize collapses the footprint")
        top_right[0] = resized_x
        top_right[1] = resized_y
    return result


def _polygon_rescale(structure: JsonObject, region: JsonObject) -> JsonObject:
    result = copy.deepcopy(structure)
    geometries = list(_walk_geometries(result["root"]))
    if len(geometries) != 1 or geometries[0].get("type") != "PolygonGeometry":
        raise ValueError(
            "polygon-rescale requires exactly one PolygonGeometry and no other geometry"
        )
    geometry = geometries[0]
    loops = geometry.get("polys")
    if not isinstance(loops, list) or len(loops) != 1:
        raise ValueError("polygon-rescale supports exactly one polygon loop without holes")
    z_min, thickness = _geometry_z(geometry)
    if region["type"] == "rectangle":
        width = float(region["width"])
        height = float(region["height"])
        points = [[0.0, 0.0], [width, 0.0], [width, height], [0.0, height]]
    else:
        points = region["points"]
    geometry.clear()
    geometry.update(
        {
            "type": "PolygonGeometry",
            "polys": [[[float(point[0]), float(point[1]), z_min] for point in points]],
            "thk": thickness,
        }
    )
    return result


def _rigid(structure: JsonObject, _region: JsonObject) -> JsonObject:
    return copy.deepcopy(structure)


def _hbm_package(structure: JsonObject, region: JsonObject) -> JsonObject:
    result = copy.deepcopy(structure)
    source_bounds = _structure_bounds(result)
    target = _region_in_source_frame(region, source_bounds)
    root = result["root"]
    envelope = _envelope_body(root)
    _replace_footprint(envelope["geometry"], target, region)

    children = root.get("children", [])
    base_children = [
        child
        for child in children
        if isinstance(child, dict) and "hbm-base-die" in str(child.get("id") or "")
    ]
    for child in base_children:
        for geometry in _walk_geometries(child):
            _replace_footprint(geometry, target, region)

    fixed_children = [child for child in children if child not in base_children]
    root_fixed_geometries = [
        feature["geometry"]
        for collection in ("bodies", "vias", "circuits", "bumps")
        for feature in root.get(collection, [])
        if isinstance(feature, dict)
        and feature is not envelope
        and isinstance(feature.get("geometry"), dict)
    ]
    fixed_geometries = [
        *root_fixed_geometries,
        *[
            geometry
            for child in fixed_children
            if isinstance(child, dict)
            for geometry in _walk_geometries(child)
        ],
    ]
    _require_geometries_inside_region(
        fixed_geometries,
        target,
        "HBM fixed core geometry",
    )
    return result


def _dram_package(structure: JsonObject, region: JsonObject) -> JsonObject:
    result = copy.deepcopy(structure)
    source_bounds = _structure_bounds(result)
    target = _region_in_source_frame(region, source_bounds)
    root = result["root"]
    for collection in ("bodies", "vias", "circuits", "bumps"):
        for feature in root.get(collection, []):
            geometry = feature.get("geometry") if isinstance(feature, dict) else None
            if isinstance(geometry, dict):
                _replace_footprint(geometry, target, region)
    _require_features_inside_region(
        root.get("children", []),
        target,
        "DRAM fixed core geometry",
    )
    return result


def _region_in_source_frame(region: JsonObject, source_bounds: JsonObject) -> JsonObject:
    source_center_x = (source_bounds["xMin"] + source_bounds["xMax"]) / 2
    source_center_y = (source_bounds["yMin"] + source_bounds["yMax"]) / 2
    bounds = region["bounds"]
    region_center_x = (bounds["xMin"] + bounds["xMax"]) / 2
    region_center_y = (bounds["yMin"] + bounds["yMax"]) / 2
    shift_x = source_center_x - region_center_x
    shift_y = source_center_y - region_center_y
    return {
        "bounds": {
            "xMin": bounds["xMin"] + shift_x,
            "xMax": bounds["xMax"] + shift_x,
            "yMin": bounds["yMin"] + shift_y,
            "yMax": bounds["yMax"] + shift_y,
        },
        "points": [
            [point[0] + shift_x, point[1] + shift_y]
            for point in region.get("points", [])
        ],
    }


def _replace_footprint(
    geometry: JsonObject,
    target: JsonObject,
    region: JsonObject,
) -> None:
    z_min, thickness = _geometry_z(geometry)
    if region["type"] == "rectangle":
        bounds = target["bounds"]
        geometry.clear()
        geometry.update(
            {
                "type": "BoxGeometry",
                "bottom_left": [bounds["xMin"], bounds["yMin"], z_min],
                "top_right": [bounds["xMax"], bounds["yMax"], z_min],
                "thk": thickness,
            }
        )
        return
    geometry.clear()
    geometry.update(
        {
            "type": "PolygonGeometry",
            "polys": [[[point[0], point[1], z_min] for point in target["points"]]],
            "thk": thickness,
        }
    )


def _require_features_inside_region(
    containers: Iterable[Any],
    target: JsonObject,
    label: str,
) -> None:
    geometries = [
        geometry
        for container in containers
        if isinstance(container, dict)
        for geometry in _walk_geometries(container)
    ]
    _require_geometries_inside_region(geometries, target, label)


def _require_geometries_inside_region(
    geometries: list[JsonObject],
    target: JsonObject,
    label: str,
) -> None:
    if not geometries:
        return
    bounds = _aggregate_geometry_bounds(geometries)
    target_bounds = target["bounds"]
    if (
        bounds["xMin"] < target_bounds["xMin"] - 1e-9
        or bounds["xMax"] > target_bounds["xMax"] + 1e-9
        or bounds["yMin"] < target_bounds["yMin"] - 1e-9
        or bounds["yMax"] > target_bounds["yMax"] + 1e-9
    ):
        raise ValueError(f"{label} does not fit inside the target region")
    target_points = target.get("points", [])
    if target_points and any(
        not _geometry_inside_polygon(geometry, target_points)
        for geometry in geometries
    ):
        raise ValueError(f"{label} does not fit inside the target region")


def _geometry_inside_polygon(
    geometry: JsonObject,
    polygon: list[list[float]],
) -> bool:
    geometry_type = geometry.get("type")
    if geometry_type == "BoxGeometry":
        bounds = _geometry_bounds(geometry)
        return _loop_inside_polygon(
            [
                [bounds["xMin"], bounds["yMin"]],
                [bounds["xMax"], bounds["yMin"]],
                [bounds["xMax"], bounds["yMax"]],
                [bounds["xMin"], bounds["yMax"]],
            ],
            polygon,
        )
    if geometry_type == "PolygonGeometry":
        return all(
            _loop_inside_polygon(
                [[float(point[0]), float(point[1])] for point in loop],
                polygon,
            )
            for loop in geometry.get("polys", [])
        )
    if geometry_type in {"CylinderGeometry", "ConeGeometry"}:
        center = [float(geometry["center"][0]), float(geometry["center"][1])]
        radius = max(
            float(geometry.get("bottom_radius") or 0),
            float(geometry.get("top_radius") or 0),
        )
        return _point_in_polygon(center, polygon) and all(
            _point_segment_distance(center, polygon[index], polygon[(index + 1) % len(polygon)])
            + 1e-9
            >= radius
            for index in range(len(polygon))
        )
    return False


def _loop_inside_polygon(
    loop: list[list[float]],
    polygon: list[list[float]],
) -> bool:
    if not loop:
        return False
    points = loop[:-1] if len(loop) > 1 and _points_equal(loop[0], loop[-1]) else loop
    if not all(_point_in_polygon(point, polygon) for point in points):
        return False
    for index, start in enumerate(points):
        end = points[(index + 1) % len(points)]
        midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
        if not _point_in_polygon(midpoint, polygon):
            return False
        if any(
            _segments_properly_intersect(
                start,
                end,
                polygon[edge_index],
                polygon[(edge_index + 1) % len(polygon)],
            )
            for edge_index in range(len(polygon))
        ):
            return False
    return True


def _point_in_polygon(point: list[float], polygon: list[list[float]]) -> bool:
    inside = False
    x, y = point
    for index, start in enumerate(polygon):
        end = polygon[(index + 1) % len(polygon)]
        if _point_on_segment(point, start, end):
            return True
        if (start[1] > y) != (end[1] > y):
            crossing_x = (
                (end[0] - start[0]) * (y - start[1]) / (end[1] - start[1])
                + start[0]
            )
            if x < crossing_x:
                inside = not inside
    return inside


def _point_on_segment(
    point: list[float],
    start: list[float],
    end: list[float],
) -> bool:
    cross = _orientation(start, end, point)
    return abs(cross) <= 1e-9 and (
        min(start[0], end[0]) - 1e-9 <= point[0] <= max(start[0], end[0]) + 1e-9
        and min(start[1], end[1]) - 1e-9 <= point[1] <= max(start[1], end[1]) + 1e-9
    )


def _segments_properly_intersect(a, b, c, d) -> bool:
    first = _orientation(a, b, c)
    second = _orientation(a, b, d)
    third = _orientation(c, d, a)
    fourth = _orientation(c, d, b)
    return first * second < -1e-9 and third * fourth < -1e-9


def _polygon_self_intersects(points: list[list[float]]) -> bool:
    count = len(points)
    for left in range(count):
        left_end = (left + 1) % count
        for right in range(left + 1, count):
            right_end = (right + 1) % count
            if left in {right, right_end} or left_end in {right, right_end}:
                continue
            if _segments_intersect(
                points[left],
                points[left_end],
                points[right],
                points[right_end],
            ):
                return True
    return False


def _segments_intersect(a, b, c, d) -> bool:
    if _segments_properly_intersect(a, b, c, d):
        return True
    return any(
        _point_on_segment(point, start, end)
        for point, start, end in (
            (a, c, d),
            (b, c, d),
            (c, a, b),
            (d, a, b),
        )
    )


def _polygon_area(points: list[list[float]]) -> float:
    return sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    ) / 2


def _orientation(a, b, c) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _points_equal(left, right) -> bool:
    return math.isclose(left[0], right[0], abs_tol=1e-9) and math.isclose(
        left[1], right[1], abs_tol=1e-9
    )


def _point_segment_distance(point, start, end) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if math.isclose(dx, 0, abs_tol=1e-12) and math.isclose(dy, 0, abs_tol=1e-12):
        return math.hypot(point[0] - start[0], point[1] - start[1])
    ratio = max(
        0.0,
        min(
            1.0,
            ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy)
            / (dx * dx + dy * dy),
        ),
    )
    projection = [start[0] + ratio * dx, start[1] + ratio * dy]
    return math.hypot(point[0] - projection[0], point[1] - projection[1])


def _envelope_body(root: JsonObject) -> JsonObject:
    bodies = root.get("bodies", [])
    for body in bodies:
        if isinstance(body, dict) and body.get("key") == "envelope":
            return body
    if len(bodies) > 0 and isinstance(bodies[0], dict):
        return bodies[0]
    raise ValueError("Package adapter requires a root envelope body")


def _walk_geometries(container: JsonObject) -> Iterable[JsonObject]:
    for collection in ("bodies", "vias", "circuits", "bumps"):
        for feature in container.get(collection, []):
            if isinstance(feature, dict) and isinstance(feature.get("geometry"), dict):
                yield feature["geometry"]
    for child in container.get("children", []):
        if isinstance(child, dict):
            yield from _walk_geometries(child)


def _structure_bounds(structure: JsonObject) -> JsonObject:
    geometries = list(_walk_geometries(structure["root"]))
    if not geometries:
        raise ValueError("PnP adaptation requires non-empty source geometry bounds")
    return _aggregate_geometry_bounds(geometries)


def _aggregate_geometry_bounds(geometries: list[JsonObject]) -> JsonObject:
    bounds = [_geometry_bounds(geometry) for geometry in geometries]
    return {
        "xMin": min(value["xMin"] for value in bounds),
        "xMax": max(value["xMax"] for value in bounds),
        "yMin": min(value["yMin"] for value in bounds),
        "yMax": max(value["yMax"] for value in bounds),
    }


def _geometry_bounds(geometry: JsonObject) -> JsonObject:
    geometry_type = geometry.get("type")
    if geometry_type == "BoxGeometry":
        bottom_left = geometry["bottom_left"]
        top_right = geometry["top_right"]
        return {
            "xMin": min(float(bottom_left[0]), float(top_right[0])),
            "xMax": max(float(bottom_left[0]), float(top_right[0])),
            "yMin": min(float(bottom_left[1]), float(top_right[1])),
            "yMax": max(float(bottom_left[1]), float(top_right[1])),
        }
    if geometry_type == "PolygonGeometry":
        points = [point for loop in geometry.get("polys", []) for point in loop]
        if not points:
            raise ValueError("PolygonGeometry requires points")
        return {
            "xMin": min(float(point[0]) for point in points),
            "xMax": max(float(point[0]) for point in points),
            "yMin": min(float(point[1]) for point in points),
            "yMax": max(float(point[1]) for point in points),
        }
    if geometry_type in {"CylinderGeometry", "ConeGeometry"}:
        center = geometry["center"]
        radius = max(
            float(geometry.get("bottom_radius") or 0),
            float(geometry.get("top_radius") or 0),
        )
        return {
            "xMin": float(center[0]) - radius,
            "xMax": float(center[0]) + radius,
            "yMin": float(center[1]) - radius,
            "yMax": float(center[1]) + radius,
        }
    raise ValueError(f"Unsupported geometry type: {geometry_type}")


def _geometry_z(geometry: JsonObject) -> tuple[float, float]:
    geometry_type = geometry.get("type")
    if geometry_type == "BoxGeometry":
        return float(geometry["bottom_left"][2]), float(geometry["thk"])
    if geometry_type == "PolygonGeometry":
        return float(geometry["polys"][0][0][2]), float(geometry["thk"])
    if geometry_type in {"CylinderGeometry", "ConeGeometry"}:
        return float(geometry["center"][2]), float(geometry["thk"])
    raise ValueError(f"Unsupported geometry type: {geometry_type}")


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number


def _positive_number(value: Any, label: str) -> float:
    number = _finite_number(value, label)
    if number <= 0:
        raise ValueError(f"{label} must be greater than 0")
    return number


def _anchor_point(bounds: JsonObject, anchor: str) -> JsonObject:
    if anchor == "bottomLeft":
        return {"x": bounds["xMin"], "y": bounds["yMin"]}
    if anchor == "center":
        return {
            "x": (bounds["xMin"] + bounds["xMax"]) / 2,
            "y": (bounds["yMin"] + bounds["yMax"]) / 2,
        }
    if anchor == "origin":
        return {"x": 0.0, "y": 0.0}
    raise ValueError("PnP anchor must be bottomLeft, center, or origin")


def _default_adapter_id(structure: JsonObject) -> str:
    geometries = list(_walk_geometries(structure["root"]))
    if geometries and all(
        geometry.get("type") == "BoxGeometry" for geometry in geometries
    ):
        return "box-rescale"
    if len(geometries) == 1 and geometries[0].get("type") == "PolygonGeometry":
        loops = geometries[0].get("polys")
        if isinstance(loops, list) and len(loops) == 1:
            return "polygon-rescale"
        raise ValueError(
            "PnP default polygon adaptation requires exactly one loop without holes"
        )
    raise ValueError(
        "PnP source geometry requires an explicit adaptationContract for mixed, empty, or unsupported primitives"
    )


_ADAPTERS: dict[str, Adapter] = {
    "box-rescale": _box_rescale,
    "polygon-rescale": _polygon_rescale,
    "rigid": _rigid,
    "hbm-package": _hbm_package,
    "dram-package": _dram_package,
}
