from __future__ import annotations

from ..serialization.schema import deep_copy, normalize_geometry_structure


class GeometryKernelExecutionResult:
    def __init__(self, *, geometry_structure, step_outputs=None, terminal_step_ref_ids=None,
                 execution_warnings=None, step_execution_warnings=None, step_provenance=None):
        self._geometry_structure = normalize_geometry_structure(geometry_structure)
        self._step_outputs = dict(step_outputs or {})
        self._terminal_step_ref_ids = list(terminal_step_ref_ids or [])
        self._execution_warnings = deep_copy(list(execution_warnings or []))
        self._step_execution_warnings = deep_copy(dict(step_execution_warnings or {}))
        self._step_provenance = deep_copy(dict(step_provenance or {}))

    def geometry(self):
        return deep_copy(self._geometry_structure)

    def step_output(self, step_ref_id):
        output = self._step_outputs.get(step_ref_id)
        return None if output is None else deep_copy(output)

    def step_outputs(self):
        return deep_copy(self._step_outputs)

    def step_provenance(self, step_ref_id):
        """Qualified physical node origins, separate from geometry JSON."""
        return deep_copy(self._step_provenance.get(step_ref_id, {}))

    def terminal_step_ref_ids(self):
        return list(self._terminal_step_ref_ids)

    def execution_warnings(self):
        return deep_copy(self._execution_warnings)

    def step_execution_warnings(self, step_ref_id):
        """Warnings from this output's actual dependencies, followed by its own."""
        return deep_copy(self._step_execution_warnings.get(step_ref_id, []))
