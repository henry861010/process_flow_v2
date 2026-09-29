from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from process_flow_kernel import ProcessGeometryState

JsonObject = dict[str, Any]


class MeshControlSetNotApplicable(ValueError):
    """The selected set cannot resolve its rules against this geometry."""


@dataclass(frozen=True, slots=True)
class MeshControlSetResult:
    mesh_control: JsonObject
    details: list[JsonObject]


class MeshControlSet(Protocol):
    def definition(self) -> JsonObject: ...

    def build(self, state: ProcessGeometryState) -> MeshControlSetResult: ...
