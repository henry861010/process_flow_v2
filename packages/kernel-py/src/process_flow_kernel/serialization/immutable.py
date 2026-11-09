"""Owned immutable JSON values and explicit mutable boundary conversion."""
from __future__ import annotations

from collections.abc import Mapping, Iterator
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, ClassVar


@dataclass(frozen=True, slots=True, eq=False)
class FrozenRecord(Mapping[str, Any]):
    """Mapping view for compact, frozen dataclasses with a fixed JSON schema."""
    _fields: ClassVar[tuple[str, ...]] = ()

    def __post_init__(self):
        for name in self._fields:
            object.__setattr__(self, name, freeze(getattr(self, name)))

    def __getitem__(self, key):
        if key not in self._fields:
            raise KeyError(key)
        return getattr(self, key)

    def __iter__(self):
        return iter(self._fields)

    def __len__(self):
        return len(self._fields)

    def __deepcopy__(self, memo):
        return self


@dataclass(frozen=True, slots=True, eq=False)
class FrozenMap(Mapping[str, Any]):
    _values: Mapping[str, Any]

    def __post_init__(self):
        object.__setattr__(self, "_values", MappingProxyType(
            {key: freeze(value) for key, value in self._values.items()}))

    def __getitem__(self, key):
        return self._values[key]

    def __iter__(self) -> Iterator:
        return iter(self._values)

    def __len__(self):
        return len(self._values)

    def __deepcopy__(self, memo):
        return self


def freeze(value: Any) -> Any:
    if type(value) in (str, int, float, bool, type(None)) or isinstance(value, (FrozenMap, FrozenRecord)):
        return value
    if isinstance(value, Mapping):
        return FrozenMap(value)
    if isinstance(value, (list, tuple)):
        return tuple(freeze(item) for item in value)
    raise TypeError(f"Unsupported immutable value: {type(value).__name__}")


def thaw(value: Any) -> Any:
    """Return independent dict/list data; never preserve mutable aliases."""
    if type(value) in (str, int, float, bool, type(None)):
        return value
    if isinstance(value, Mapping):
        return {key: thaw(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [thaw(item) for item in value]
    raise TypeError(f"Unsupported JSON value: {type(value).__name__}")
