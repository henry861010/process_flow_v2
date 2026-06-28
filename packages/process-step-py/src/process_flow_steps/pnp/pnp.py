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
    items = value if isinstance(value, list) else _legacy_repeater_items(value)
    if not isinstance(items, list):
        raise ValueError("PnP.coordinates must be an array of placement coordinates")
    return [_coordinate_item(item, index) for index, item in enumerate(items)]


def _coordinate_item(item: Any, index: int) -> dict[str, float]:
    if isinstance(item, list):
        if len(item) != 2:
            raise ValueError(f"PnP.coordinates[{index}] must be an [x, y] tuple")
        return {
            "x": _finite_number(item[0], f"PnP.coordinates[{index}][0]"),
            "y": _finite_number(item[1], f"PnP.coordinates[{index}][1]"),
        }
    if not isinstance(item, dict):
        raise ValueError(f"PnP.coordinates[{index}] must be an [x, y] tuple or object")
    return {
        "x": _coordinate_object_number(item, "bottemLeftX", "bottomLeftX", index),
        "y": _coordinate_object_number(item, "bottemLeftY", "bottomLeftY", index),
    }


def _legacy_repeater_items(value: Any) -> list[dict[str, Any]] | None:
    if not isinstance(value, dict) or not isinstance(value.get("items"), list):
        return None
    result = []
    for item in value["items"]:
        field_values = item.get("fieldValues", []) if isinstance(item, dict) else []
        result.append(
            {
                "bottemLeftX": _legacy_field_value(field_values, "bottemLeftX", "bottomLeftX"),
                "bottemLeftY": _legacy_field_value(field_values, "bottemLeftY", "bottomLeftY"),
            }
        )
    return result


def _legacy_field_value(field_values: list[dict[str, Any]], primary_field_id: str, fallback_field_id: str) -> Any:
    for field_value in field_values:
        if field_value.get("fieldId") in (primary_field_id, fallback_field_id):
            return field_value.get("value")
    return None


def _coordinate_object_number(item: dict[str, Any], primary_field_id: str, fallback_field_id: str, index: int) -> float:
    value = item.get(primary_field_id, item.get(fallback_field_id))
    if value in (None, ""):
        raise ValueError(f"PnP.coordinates[{index}].{primary_field_id} is required")
    return _finite_number(value, f"PnP.coordinates[{index}].{primary_field_id}")


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number
