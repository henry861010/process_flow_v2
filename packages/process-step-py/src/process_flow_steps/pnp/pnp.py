from typing import Any

from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    die = context.require_geometry("die_geometry")
    placements = _required_coordinates(context.get_param("coordinates"))
    bottom_z = state.cursor_z()
    state.place_geometry_states(
        die,
        [
            {
                "x": placement["x"],
                "y": placement["y"],
                "bottom_z": bottom_z,
                "anchor": "bottomLeft",
                "clone": True,
            }
            for placement in placements
        ],
    )
    return state


def _required_coordinates(value: Any) -> list[dict[str, float]]:
    if not isinstance(value, list):
        raise ValueError("PnP.coordinates must be an array of placement coordinates")
    return [_coordinate_item(item, index) for index, item in enumerate(value)]


def _coordinate_item(item: Any, index: int) -> dict[str, float]:
    if not isinstance(item, list) or len(item) != 2:
        raise ValueError(f"PnP.coordinates[{index}] must be an [x, y] tuple")
    return {
        "x": _finite_number(item[0], f"PnP.coordinates[{index}][0]"),
        "y": _finite_number(item[1], f"PnP.coordinates[{index}][1]"),
    }


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number
