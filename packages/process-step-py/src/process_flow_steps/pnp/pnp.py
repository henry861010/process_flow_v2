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
                "top_right_x": placement["top_right_x"],
                "top_right_y": placement["top_right_y"],
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
    if (
        not isinstance(item, list)
        or len(item) != 2
        or not all(isinstance(point, list) and len(point) == 2 for point in item)
    ):
        raise ValueError(
            f"PnP.coordinates[{index}] must be a [[xMin, yMin], [xMax, yMax]] rectangle"
        )
    bottom_left, top_right = item
    return {
        "x": _finite_number(bottom_left[0], f"PnP.coordinates[{index}][0][0]"),
        "y": _finite_number(bottom_left[1], f"PnP.coordinates[{index}][0][1]"),
        "top_right_x": _finite_number(
            top_right[0], f"PnP.coordinates[{index}][1][0]"
        ),
        "top_right_y": _finite_number(
            top_right[1], f"PnP.coordinates[{index}][1][1]"
        ),
    }


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number
