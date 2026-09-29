from __future__ import annotations

import copy

from process_flow_kernel import ProcessGeometryState

from .contracts import MeshControlSet, MeshControlSetResult
from .sets.hbm_example import HbmExampleSet


class MeshControlSetRegistry:
    def __init__(self, sets: tuple[MeshControlSet, ...] | None = None):
        registered = sets if sets is not None else (HbmExampleSet(),)
        self._sets: dict[str, MeshControlSet] = {}
        for control_set in registered:
            definition = control_set.definition()
            set_id = definition.get("id")
            if not isinstance(set_id, str) or not set_id:
                raise ValueError("Mesh control set definition requires id")
            for field in ("version", "label", "description"):
                if not isinstance(definition.get(field), str) or not definition[field]:
                    raise ValueError(f"Mesh control set {set_id} requires {field}")
            if set_id in self._sets:
                raise ValueError(f"Duplicate mesh control set: {set_id}")
            self._sets[set_id] = control_set

    def definitions(self) -> list[dict]:
        return [_public_definition(item.definition()) for item in self._sets.values()]

    def definition(self, set_id: str) -> dict:
        return _public_definition(self._sets[set_id].definition())

    def apply(self, set_id: str, state: ProcessGeometryState) -> tuple[dict, MeshControlSetResult]:
        control_set = self._sets[set_id]
        before = state.to_geometry_structure()
        before_inspection = state.inspect()
        result = control_set.build(state)
        if state.to_geometry_structure() != before or state.inspect() != before_inspection:
            raise ValueError(f"Mesh control set {set_id} modified its input geometry")
        return self.definition(set_id), result


def _public_definition(definition: dict) -> dict:
    return copy.deepcopy({
        field: definition[field] for field in ("id", "version", "label", "description")
    })
