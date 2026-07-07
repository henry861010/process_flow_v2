from __future__ import annotations

GEOMETRY_VALUE_TYPES = frozenset({"geometryRef", "geometry"})


def is_geometry_value_type(value: object) -> bool:
    return value in GEOMETRY_VALUE_TYPES
