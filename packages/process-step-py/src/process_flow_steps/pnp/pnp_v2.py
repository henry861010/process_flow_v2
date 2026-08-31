from __future__ import annotations

import math
from typing import Any

from process_flow_kernel import ProcessGeometryState, ProcessStepContext

from .adapters import adapt_geometry, rotate_geometry


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    source = context.require_geometry_artifact("die_geometry")
    placements = _required_placements(context.get_param("placements"))
    bottom_z = state.cursor_z()
    for placement in placements:
        adapted_structure = adapt_geometry(source, placement["targetRegion"])
        adapted_structure = rotate_geometry(
            adapted_structure,
            placement["pose"]["rotationZ"],
        )
        adapted = ProcessGeometryState.from_structure(adapted_structure)
        state.place_geometry_state(
            adapted,
            x=placement["pose"]["x"],
            y=placement["pose"]["y"],
            bottom_z=bottom_z,
            anchor=placement["anchor"],
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
    rotation_z = _finite_number(
        pose.get("rotationZ", 0), f"PnP.placements[{index}].pose.rotationZ"
    )
    anchor = value.get("anchor", "bottomLeft")
    if anchor not in {"bottomLeft", "center", "origin"}:
        raise ValueError(
            f"PnP.placements[{index}].anchor must be bottomLeft, center, or origin"
        )
    return {
        "targetRegion": target_region,
        "pose": {
            "x": _finite_number(pose.get("x"), f"PnP.placements[{index}].pose.x"),
            "y": _finite_number(pose.get("y"), f"PnP.placements[{index}].pose.y"),
            "rotationZ": rotation_z,
        },
        "anchor": anchor,
    }


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if not math.isfinite(number):
        raise ValueError(f"{label} must be a finite number")
    return number
