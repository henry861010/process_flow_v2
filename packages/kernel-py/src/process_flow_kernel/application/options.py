from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class ExecuteOptions:
    output_step_ref_id: str | None = None

    @classmethod
    def from_value(cls, value: "ExecuteOptions | Mapping[str, Any] | None") -> "ExecuteOptions":
        if value is None:
            return cls()
        if isinstance(value, cls):
            return value
        if isinstance(value, Mapping):
            return cls(output_step_ref_id=value.get("output_step_ref_id"))
        raise TypeError("GeometryKernel.execute options must be ExecuteOptions, a mapping, or None")
