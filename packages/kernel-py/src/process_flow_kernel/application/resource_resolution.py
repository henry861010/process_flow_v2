from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol


class GeometryCatalogResolver(Protocol):
    def get_geometry(self, geometry_id: str) -> Mapping[str, Any] | None:
        ...


class InMemoryGeometryCatalog:
    def __init__(self, geometries=()):
        self._geometries = {
            geometry["id"]: geometry
            for geometry in geometries
        }

    def get_geometry(self, geometry_id: str) -> Mapping[str, Any] | None:
        return self._geometries.get(geometry_id)
