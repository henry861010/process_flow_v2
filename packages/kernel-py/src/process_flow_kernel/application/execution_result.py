from __future__ import annotations

from ..serialization.schema import deep_copy, normalize_geometry_structure


class GeometryKernelExecutionResult:
    def __init__(self, *, geometry_structure, step_outputs=None, terminal_step_ref_ids=None):
        self._geometry_structure = normalize_geometry_structure(geometry_structure)
        self._step_outputs = dict(step_outputs or {})
        self._terminal_step_ref_ids = list(terminal_step_ref_ids or [])

    def geometry(self):
        return deep_copy(self._geometry_structure)

    def step_output(self, step_ref_id):
        output = self._step_outputs.get(step_ref_id)
        return None if output is None else deep_copy(output)

    def step_outputs(self):
        return deep_copy(self._step_outputs)

    def terminal_step_ref_ids(self):
        return list(self._terminal_step_ref_ids)
