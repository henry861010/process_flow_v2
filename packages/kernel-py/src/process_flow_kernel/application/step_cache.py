"""Execution-cache contract and content identity, independent of HTTP/storage."""
from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from .geometry_artifact import GeometryArtifact
from ..serialization.immutable import freeze

KERNEL_CACHE_VERSION = 2


@dataclass(frozen=True, slots=True)
class StepExecutionRecord:
    artifact: GeometryArtifact
    warnings: tuple[Mapping[str, Any], ...] = ()

    def __post_init__(self):
        object.__setattr__(self, "warnings", freeze(self.warnings))


class CacheInvalidatedError(RuntimeError):
    """The execution's cache generation was reset while work was running."""


class StepExecutionCache(Protocol):
    @property
    def generation(self) -> int: ...

    def get_or_compute(self, key: str, factory: Callable[[], StepExecutionRecord], *,
                       generation: int) -> tuple[StepExecutionRecord, bool]: ...


def content_fingerprint(value) -> str:
    """Typed canonical encoding: booleans, integers and floats never collide."""
    digest = hashlib.sha256()

    def visit(item):
        if item is None:
            digest.update(b'n;')
        elif isinstance(item, bool):
            digest.update(b'b1;' if item else b'b0;')
        elif isinstance(item, int):
            digest.update(f'i{item};'.encode())
        elif isinstance(item, float):
            digest.update(f'f{item.hex()};'.encode())
        elif isinstance(item, str):
            encoded = item.encode('utf-8')
            digest.update(f's{len(encoded)}:'.encode())
            digest.update(encoded)
        elif isinstance(item, Mapping):
            digest.update(b'{')
            for key in sorted(item):
                if not isinstance(key, str):
                    raise TypeError('Execution fingerprint requires string mapping keys')
                visit(key)
                visit(item[key])
            digest.update(b'}')
        elif isinstance(item, (tuple, list)):
            digest.update(b'(' if isinstance(item, tuple) else b'[')
            for child in item:
                visit(child)
            digest.update(b')' if isinstance(item, tuple) else b']')
        else:
            raise TypeError(f'Unsupported execution fingerprint value: {type(item).__name__}')
    visit(value)
    return digest.hexdigest()


def artifact_fingerprint(artifact: GeometryArtifact) -> str:
    runtime = artifact.runtime_snapshot
    return content_fingerprint({
        'structure': artifact.structure, 'provenance': artifact.provenance,
        'descriptor': artifact.descriptor(),
        'runtime': None if runtime is None else {
            'structure': runtime.structure,
            'root': runtime.root, 'cursor': runtime.cursor_z, 'footprint': runtime.footprint,
            'step': runtime.provenance_step, 'ordinal': runtime.provenance_ordinal,
            'provenance': runtime.provenance,
            'polygons': {node_id: polygon.loops for node_id, polygon in runtime.polygons.items()},
        },
    })
