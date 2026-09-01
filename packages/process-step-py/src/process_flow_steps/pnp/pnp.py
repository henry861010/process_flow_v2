from __future__ import annotations

import math
from typing import Any

from process_flow_kernel import ProcessGeometryState, ProcessStepContext

from .adapters import adapt_geometry_for_placement, rotate_geometry


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    source = context.require_geometry_artifact("die_geometry")
    placements = _required_placements(context.get_param("placements"))
    bottom_z = state.cursor_z()

    # Materialize and validate the complete batch before mutating the destination.
    prepared: list[tuple[ProcessGeometryState, float, float]] = []
    for placement in placements:
        local_target, center_x, center_y = _local_target_region(
            placement["targetRegion"]
        )
        adapted_structure, anchor_bounds = adapt_geometry_for_placement(
            source,
            local_target,
        )
        transformed_structure = rotate_geometry(
            adapted_structure,
            0,
            "center",
            anchor_bounds,
        )
        prepared.append(
            (
                ProcessGeometryState.from_structure(transformed_structure),
                center_x,
                center_y,
            )
        )

    for adapted, center_x, center_y in prepared:
        state.place_geometry_state(
            adapted,
            x=center_x,
            y=center_y,
            bottom_z=bottom_z,
            anchor="origin",
            clone=False,
        )
    return state


def _required_placements(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise ValueError("PnP.placements must be an array")
    return [_placement(item, index) for index, item in enumerate(value)]


def _placement(value: Any, index: int) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"PnP.placements[{index}] must be an object")
    target_region = value.get("targetRegion")
    if not isinstance(target_region, dict):
        raise ValueError(f"PnP.placements[{index}].targetRegion must be an object")
    pose = value.get("pose")
    if not isinstance(pose, dict):
        raise ValueError(f"PnP.placements[{index}].pose must be an object")
    if "rotationZ" not in pose:
        raise ValueError(f"PnP.placements[{index}].pose.rotationZ is required")
    anchor = value.get("anchor")
    if anchor != "center":
        raise ValueError(
            f"PnP.placements[{index}].anchor must be center for absolute targets"
        )
    pose_x = _finite_number(pose.get("x"), f"PnP.placements[{index}].pose.x")
    pose_y = _finite_number(pose.get("y"), f"PnP.placements[{index}].pose.y")
    rotation_z = _finite_number(
        pose.get("rotationZ"), f"PnP.placements[{index}].pose.rotationZ"
    )
    if pose_x != 0 or pose_y != 0 or rotation_z != 0:
        raise ValueError(
            f"PnP.placements[{index}] pose x, y, and rotationZ must be zero for absolute targets"
        )
    return {
        "targetRegion": target_region,
        "pose": {
            "x": pose_x,
            "y": pose_y,
            "rotationZ": rotation_z,
        },
        "anchor": anchor,
    }


def _local_target_region(
    target_region: dict[str, Any],
) -> tuple[dict[str, Any], float, float]:
    region_type = target_region.get("type")
    if region_type == "rectangle":
        x_min = _finite_number(
            target_region.get("bottomLeftX"), "targetRegion.bottomLeftX"
        )
        y_min = _finite_number(
            target_region.get("bottomLeftY"), "targetRegion.bottomLeftY"
        )
        x_max = _finite_number(
            target_region.get("topRightX"), "targetRegion.topRightX"
        )
        y_max = _finite_number(
            target_region.get("topRightY"), "targetRegion.topRightY"
        )
        if x_max <= x_min:
            raise ValueError(
                "PnP rectangle target topRightX must be greater than bottomLeftX"
            )
        if y_max <= y_min:
            raise ValueError(
                "PnP rectangle target topRightY must be greater than bottomLeftY"
            )
        return (
            {
                "type": "rectangle",
                "width": x_max - x_min,
                "height": y_max - y_min,
            },
            (x_min + x_max) / 2,
            (y_min + y_max) / 2,
        )
    if region_type == "polygon":
        points = target_region.get("points")
        if not isinstance(points, list) or len(points) < 3:
            raise ValueError("PnP polygon targetRegion requires at least three points")
        normalized_points: list[list[float]] = []
        for point_index, point in enumerate(points):
            if not isinstance(point, list) or len(point) != 2:
                raise ValueError(
                    f"PnP polygon targetRegion point {point_index} must be [x, y]"
                )
            normalized_points.append(
                [
                    _finite_number(
                        point[0], f"targetRegion.points[{point_index}][0]"
                    ),
                    _finite_number(
                        point[1], f"targetRegion.points[{point_index}][1]"
                    ),
                ]
            )
        x_min = min(point[0] for point in normalized_points)
        x_max = max(point[0] for point in normalized_points)
        y_min = min(point[1] for point in normalized_points)
        y_max = max(point[1] for point in normalized_points)
        center_x = (x_min + x_max) / 2
        center_y = (y_min + y_max) / 2
        return (
            {
                "type": "polygon",
                "points": [
                    [point[0] - x_min, point[1] - y_min]
                    for point in normalized_points
                ],
            },
            center_x,
            center_y,
        )
    raise ValueError('PnP targetRegion.type must be "rectangle" or "polygon"')


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number
