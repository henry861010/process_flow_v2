from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from process_flow_kernel import ProcessGeometryState

JsonObject = dict[str, Any]


class MeshControlSetNotApplicable(ValueError):
    """The selected set cannot resolve its rules against this geometry."""


@dataclass(frozen=True, slots=True)
class MeshControlSetResult:
    """Canonical mesh-control JSON and resolved rule details, with distances in um."""

    mesh_control: JsonObject
    details: list[JsonObject]


class MeshControlSet(Protocol):
    """Interface for independently authored, read-only geometry rule sets."""

    def definition(self) -> JsonObject:
        """Return nonempty id, version, label and description strings."""
        ...

    def build(self, state: ProcessGeometryState) -> MeshControlSetResult:
        """Return controls/details in um without modifying geometry/process state.

        Raise MeshControlSetNotApplicable when required geometry is unsuitable.
        """
        ...
