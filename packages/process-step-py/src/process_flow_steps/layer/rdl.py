from typing import Any

from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    state = context.state
    layers = _required_layers(context.get_param("layers"))

    for index, layer in enumerate(layers):
        layer_number = index + 1
        if layer_number % 2 == 0:
            state.add_circuit_at_cursor(
                material=layer["conductivity"],
                density=layer["density"],
                thickness=layer["thk"],
            )
            state.deposit_layer(material=layer["dielectric"], thickness=layer["thk"])
            continue

        state.deposit_layer(material=layer["dielectric"], thickness=layer["thk"])
        state.add_via_below_cursor(
            material=layer["conductivity"],
            density=layer["density"],
            thickness=layer["thk"],
            direction="-z",
        )
    return state


def _required_layers(value: Any) -> list[dict[str, float | str]]:
    if not isinstance(value, list) or len(value) == 0:
        raise ValueError("RDL.layers must include at least one layer")
    layers = []
    for index, item in enumerate(value):
        layers.append(
            {
                "dielectric": _required_string(item.get("Dielectric"), f"RDL.layers[{index}].Dielectric"),
                "conductivity": _required_string(item.get("Conductivity"), f"RDL.layers[{index}].Conductivity"),
                "thk": _required_positive_number(item.get("thk"), f"RDL.layers[{index}].thk"),
                "density": _required_density(item.get("density"), f"RDL.layers[{index}].density"),
            }
        )
    return layers


def _required_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _required_positive_number(value: Any, label: str) -> float:
    number = _finite_number(value, label)
    if number <= 0:
        raise ValueError(f"{label} must be a positive number")
    return number


def _required_density(value: Any, label: str) -> float:
    number = _finite_number(value, label)
    if number < 0 or number > 100:
        raise ValueError(f"{label} must be a finite number from 0 to 100")
    return number


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number
