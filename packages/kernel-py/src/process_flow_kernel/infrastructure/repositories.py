from __future__ import annotations

from ..serialization.schema import deep_copy


class InMemoryRepository:
    def __init__(self, items=None, *, id_key="id"):
        self._id_key = id_key
        self._items = {}
        for item in items or []:
            self._items[item[id_key]] = deep_copy(item)

    def get_by_id(self, id_):
        item = self._items.get(id_)
        return None if item is None else deep_copy(item)

    def list(self):
        return [deep_copy(item) for item in self._items.values()]
