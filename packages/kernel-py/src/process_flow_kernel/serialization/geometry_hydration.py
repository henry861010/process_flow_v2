from __future__ import annotations

from .schema import normalize_geometry_structure
from ..domain.process_geometry_state import ProcessGeometryState


def geometry_structure_to_process_geometry_state(payload, options=None):
    merged = {"footprint": {"derive": "largestRootBody"}}
    if options:
        merged.update(options)
    return ProcessGeometryState.from_structure(payload, merged)


def process_geometry_state_to_geometry_structure(value):
    if isinstance(value, ProcessGeometryState):
        return value.to_geometry_structure()
    if hasattr(value, "to_geometry_structure") and callable(value.to_geometry_structure):
        return value.to_geometry_structure()
    return normalize_geometry_structure(value)
