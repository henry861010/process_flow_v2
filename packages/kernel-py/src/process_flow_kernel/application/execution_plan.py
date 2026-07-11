from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class PlannedGeometryInput:
    kind: Literal["external", "stepOutput"]
    flow_input_id: str | None = None
    step_ref_id: str | None = None
    output_port_id: str | None = None


@dataclass(frozen=True, slots=True)
class PlannedStep:
    step_ref_id: str
    step_label: str
    step_template: Mapping[str, Any]
    raw_parameter_values: Mapping[str, Any]
    parameter_values: Mapping[str, Any]
    geometry_inputs: Mapping[str, PlannedGeometryInput]
    output_port_id: str


@dataclass(frozen=True, slots=True)
class ExecutionPlan:
    steps: Sequence[PlannedStep]
    external_geometries: Mapping[str, Mapping[str, Any]]
    terminal_step_ref_ids: Sequence[str]

    def step(self, step_ref_id: str) -> PlannedStep:
        for planned_step in self.steps:
            if planned_step.step_ref_id == step_ref_id:
                return planned_step
        raise KeyError(step_ref_id)
