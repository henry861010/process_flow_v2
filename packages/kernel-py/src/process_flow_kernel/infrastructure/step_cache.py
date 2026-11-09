"""Bounded, thread-safe execution LRU with one producer per key/generation."""
from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable, Mapping
from concurrent.futures import Future
from dataclasses import fields, is_dataclass
from sys import getsizeof
from threading import Lock

from ..application.step_cache import CacheInvalidatedError, StepExecutionRecord
from ..serialization.immutable import FrozenMap
from ..utils.polygon import PolygonSnapshot


def retained_size(value) -> int:
    """Conservatively weigh the entire owned graph, including runtime lineage."""
    seen = set()

    def visit(item):
        if id(item) in seen:
            return 0
        seen.add(id(item))
        size = getsizeof(item)
        if isinstance(item, PolygonSnapshot):
            return size + visit(item.loops) + max(visit(item._regions), 256 + 160 * len(item.loops))
        if isinstance(item, FrozenMap):
            size += getsizeof(item._values) + getsizeof(dict(item))
            return size + sum(visit(k) + visit(v) for k, v in item.items())
        # Artifacts implement Mapping for geometry access, but also retain runtime
        # snapshots and provenance. Dataclass ownership takes precedence.
        if is_dataclass(item) and not isinstance(item, type):
            return size + sum(visit(getattr(item, field.name)) for field in fields(item))
        if isinstance(item, Mapping):
            # Mapping proxies retain an underlying mapping as well.
            size += getsizeof(dict(item))
            return size + sum(visit(k) + visit(v) for k, v in item.items())
        if isinstance(item, (tuple, list)):
            return size + sum(visit(child) for child in item)
        return size
    return visit(value)


class MemoryStepExecutionCache:
    def __init__(self, *, max_entries=256, max_bytes=256 * 1024 * 1024, max_inflight=32):
        if min(max_entries, max_bytes, max_inflight) < 1:
            raise ValueError("Step cache bounds must be positive")
        self._max_entries, self._max_bytes, self._max_inflight = max_entries, max_bytes, max_inflight
        self._entries: OrderedDict[str, tuple[StepExecutionRecord, int]] = OrderedDict()
        self._inflight: dict[tuple[int, str], Future[StepExecutionRecord]] = {}
        self._bytes = 0
        self._generation = 0
        self._lock = Lock()
        self._hits = self._misses = self._waits = self._evictions = self._bypasses = 0

    @property
    def generation(self) -> int:
        with self._lock:
            return self._generation

    def clear(self) -> None:
        with self._lock:
            self._generation += 1
            self._entries.clear()
            self._inflight.clear()
            self._bytes = 0

    def info(self) -> dict[str, int]:
        with self._lock:
            return dict(generation=self._generation, entries=len(self._entries), bytes=self._bytes,
                        inflight=len(self._inflight), hits=self._hits, misses=self._misses,
                        waits=self._waits, evictions=self._evictions, bypasses=self._bypasses)

    def _check_generation(self, generation: int) -> None:
        if generation != self._generation:
            raise CacheInvalidatedError("Step execution cache was reset")

    def get_or_compute(
        self, key: str, factory: Callable[[], StepExecutionRecord], *, generation: int,
    ) -> tuple[StepExecutionRecord, bool]:
        with self._lock:
            self._check_generation(generation)
            entry = self._entries.get(key)
            if entry is not None:
                self._entries.move_to_end(key)
                self._hits += 1
                return entry[0], True
            token = (generation, key)
            future = self._inflight.get(token)
            owner = future is None
            if not owner:
                self._waits += 1
            elif len(self._inflight) < self._max_inflight:
                future = Future()
                self._inflight[token] = future
            else:
                self._bypasses += 1
            if owner:
                self._misses += 1
        if not owner:
            return future.result(), True
        try:
            value = factory()
            # Include the key, entry tuple, and a conservative OrderedDict slot allowance.
            weight = retained_size((key, value)) + 128 if future is not None else 0
            with self._lock:
                self._check_generation(generation)
                if future is not None:
                    self._inflight.pop(token, None)
                    if weight <= self._max_bytes:
                        self._entries[key] = (value, weight)
                        self._bytes += weight
                        while len(self._entries) > self._max_entries or self._bytes > self._max_bytes:
                            _, (_, removed) = self._entries.popitem(last=False)
                            self._bytes -= removed
                            self._evictions += 1
                    else:
                        self._bypasses += 1
            if future is not None:
                future.set_result(value)
            return value, False
        except BaseException as error:
            with self._lock:
                self._inflight.pop(token, None)
            if future is not None:
                future.set_exception(error)
            raise
