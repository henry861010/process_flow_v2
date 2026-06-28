from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Callable

from ..domain.process_geometry_state import ProcessGeometryState

GeometryStateResolver = Callable[[str], ProcessGeometryState | None]


@dataclass(frozen=True, slots=True)
class ProcessStepContext:
    kernel: Any
    state: ProcessGeometryState
    values: Mapping[str, Any]
    raw_field_values: Sequence[Mapping[str, Any]]
    step_ref: Mapping[str, Any]
    step_template: Mapping[str, Any]
    step_value_set: Mapping[str, Any]
    process_flow_template: Mapping[str, Any]
    process_flow_instance: Mapping[str, Any]
    geometry_inputs: Mapping[str, Mapping[str, Any]]
    input_geometry: Mapping[str, Any] | None
    geometry_resolver: GeometryStateResolver = field(repr=False)

    def get_param(self, field_id: str, default: Any = None) -> Any:
        return self.values.get(field_id, default)

    def require_string(self, field_id: str, label: str | None = None) -> str:
        value = self.get_param(field_id)
        if not isinstance(value, str) or value.strip() == "":
            raise ValueError(f"{label or field_id} must be a non-empty string")
        return value

    def require_finite_number(self, field_id: str, label: str | None = None) -> float:
        return _finite_number(self.get_param(field_id), label or field_id)

    def require_positive_number(self, field_id: str, label: str | None = None) -> float:
        number = self.require_finite_number(field_id, label)
        if number <= 0:
            raise ValueError(f"{label or field_id} must be a positive number")
        return number

    def require_non_negative_number(self, field_id: str, label: str | None = None) -> float:
        number = self.require_finite_number(field_id, label)
        if number < 0:
            raise ValueError(f"{label or field_id} must be a non-negative number")
        return number

    def require_density(self, field_id: str, label: str | None = None) -> float:
        number = self.require_finite_number(field_id, label)
        if number < 0 or number > 100:
            raise ValueError(f"{label or field_id} must be a finite number from 0 to 100")
        return number

    def get_geometry(self, field_id: str) -> ProcessGeometryState | None:
        return self.geometry_resolver(field_id)

    def require_geometry(self, field_id: str) -> ProcessGeometryState:
        geometry = self.get_geometry(field_id)
        if geometry is None:
            raise ValueError(f"{field_id} must resolve to a ProcessGeometryState")
        return geometry


def _finite_number(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a finite number") from None
    if number in (float("inf"), float("-inf")) or number != number:
        raise ValueError(f"{label} must be a finite number")
    return number
