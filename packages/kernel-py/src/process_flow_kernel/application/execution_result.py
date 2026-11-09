from __future__ import annotations

from collections.abc import Mapping, Sequence
from types import MappingProxyType
from typing import Any

from .geometry_artifact import GeometryArtifact
from ..serialization.immutable import freeze, thaw


class GeometryKernelExecutionResult:
    """Immutable outputs internally, detached JSON at public boundaries."""

    def __init__(
        self, *, step_outputs: Mapping[str, GeometryArtifact], selected_step_ref_id: str,
        terminal_step_ref_ids: Sequence[str] = (),
        execution_warnings: Sequence[Mapping[str, Any]] = (),
        step_execution_warnings: Mapping[str, Sequence[Mapping[str, Any]]] | None = None,
        statistics: Mapping[str, int | float] | None = None,
    ):
        self._outputs = MappingProxyType(dict(step_outputs))
        self._selected = selected_step_ref_id
        self._terminals = tuple(terminal_step_ref_ids)
        self._warnings = freeze(execution_warnings)
        self._step_warnings = freeze(step_execution_warnings or {})
        self._statistics = freeze(statistics or {})

    def step_artifact(self, step_ref_id: str) -> GeometryArtifact | None:
        return self._outputs.get(step_ref_id)

    def geometry(self) -> dict[str, Any]:
        return self._outputs[self._selected].geometry()

    def step_output(self, step_ref_id: str) -> dict[str, Any] | None:
        artifact = self.step_artifact(step_ref_id)
        return None if artifact is None else artifact.geometry()

    def step_outputs(self) -> dict[str, dict[str, Any]]:
        return {step: artifact.geometry() for step, artifact in self._outputs.items()}

    def step_provenance(self, step_ref_id: str) -> dict[str, Any]:
        artifact = self.step_artifact(step_ref_id)
        return {} if artifact is None else thaw(artifact.provenance)

    def terminal_step_ref_ids(self) -> list[str]:
        return list(self._terminals)

    def execution_warnings(self) -> list[dict[str, Any]]:
        return thaw(self._warnings)

    def step_execution_warnings(self, step_ref_id: str) -> list[dict[str, Any]]:
        return thaw(self._step_warnings.get(step_ref_id, ()))

    def execution_statistics(self) -> dict[str, int | float]:
        return thaw(self._statistics)
