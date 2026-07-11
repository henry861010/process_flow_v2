from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Callable

from ..domain.process_geometry_state import ProcessGeometryState

GeometryStateResolver = Callable[[str], ProcessGeometryState | None]


@dataclass(frozen=True, slots=True)
class ProcessStepContext:
    state: ProcessGeometryState
    values: Mapping[str, Any]
    raw_parameter_values: Mapping[str, Any]
    step_ref: Mapping[str, Any]
    step_template: Mapping[str, Any]
    step_configuration: Mapping[str, Any]
    geometry_inputs: Mapping[str, Mapping[str, Any]]
    input_geometry: Mapping[str, Any] | None
    geometry_resolver: GeometryStateResolver = field(repr=False)

    def get_param(self, parameter_id: str, default: Any = None) -> Any:
        return self.values.get(parameter_id, default)

    def require_string(self, parameter_id: str, label: str | None = None) -> str:
        value = self.get_param(parameter_id)
        if not isinstance(value, str) or value.strip() == "":
            raise ValueError(f"{label or parameter_id} must be a non-empty string")
        return value

    def require_finite_number(self, parameter_id: str, label: str | None = None) -> float:
        return _finite_number(self.get_param(parameter_id), label or parameter_id)

    def require_positive_number(self, parameter_id: str, label: str | None = None) -> float:
        number = self.require_finite_number(parameter_id, label)
        if number <= 0:
            raise ValueError(f"{label or parameter_id} must be a positive number")
        return number

    def require_non_negative_number(self, parameter_id: str, label: str | None = None) -> float:
        number = self.require_finite_number(parameter_id, label)
        if number < 0:
            raise ValueError(f"{label or parameter_id} must be a non-negative number")
        return number

    def require_density(self, parameter_id: str, label: str | None = None) -> float:
        number = self.require_finite_number(parameter_id, label)
        if number < 0 or number > 100:
            raise ValueError(f"{label or parameter_id} must be a finite number from 0 to 100")
        return number

    def get_geometry(self, port_id: str) -> ProcessGeometryState | None:
        return self.geometry_resolver(port_id)

    def require_geometry(self, port_id: str) -> ProcessGeometryState:
        geometry = self.get_geometry(port_id)
        if geometry is None:
            raise ValueError(f"{port_id} must resolve to a ProcessGeometryState")
        return geometry


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number
