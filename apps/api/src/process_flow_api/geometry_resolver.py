from __future__ import annotations

from typing import Any

from .repository import SQLiteStore


JsonObject = dict[str, Any]


class StoreGeometryCatalog:
    def __init__(self, store: SQLiteStore):
        self._store = store

    def get_geometry(self, geometry_id: str) -> JsonObject | None:
        return self._store.get_geometry(geometry_id)
