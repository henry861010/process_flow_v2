from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Hashable, Mapping
from dataclasses import dataclass
from typing import Any, Generic, Literal, Protocol, TypeVar, cast

from .geometry_preview_exporter import export_geometry
from .models import GeometryPreviewRequest
from .repository import NotFoundError, SQLiteStore
from .services import (
    PreviewRequestContext,
    PreviewSnapshotGeometry,
    build_geometry_entity_download,
    materialize_preview_snapshots,
    prepare_preview_execution,
    preview_request_identity,
    resolve_preview_request,
)


JsonObject = dict[str, Any]
Axis = Literal["x", "y"]
PREVIEW_CACHE_CONTROL = "private, max-age=31536000, immutable"
PREVIEW_SESSION_CONTRACT_VERSION = 1
MESH_CACHE_VERSION = 1
PREPARED_SECTION_CACHE_VERSION = 1
SECTION_CACHE_VERSION = 3


class PreviewCapacityError(RuntimeError):
    """Raised when bounded preview work queues cannot admit a unique request."""


class MeshExporter(Protocol):
    async def __call__(
        self,
        geometry_structure: JsonObject,
        *,
        format: Literal["glb", "step"],
    ) -> bytes: ...


class SectionGenerator(Protocol):
    def __call__(
        self,
        geometry_structure: JsonObject,
        *,
        axis: Axis,
        position: float,
        tolerance: float,
    ) -> Mapping[str, Any]: ...


class PreparedSectionModel(Protocol):
    def section(
        self,
        *,
        axis: Axis,
        position: float,
        tolerance: float,
    ) -> Mapping[str, Any]: ...


class SectionPreparer(Protocol):
    def __call__(self, geometry_structure: JsonObject) -> PreparedSectionModel: ...


@dataclass(frozen=True, slots=True)
class PreviewSnapshotRecord:
    snapshot_id: str
    source_kind: str
    step_ref_id: str | None
    label: str
    order: int
    geometry_hash: str
    geometry_entity_json: JsonObject
    mesh_url: str
    section_url: str

    @property
    def geometry_structure(self) -> JsonObject:
        structure = self.geometry_entity_json.get("structure")
        if not isinstance(structure, dict):
            raise RuntimeError(f"Snapshot {self.snapshot_id} is missing its geometry structure")
        return structure

    def payload(self) -> JsonObject:
        return {
            "snapshotId": self.snapshot_id,
            "sourceKind": self.source_kind,
            "stepRefId": self.step_ref_id,
            "label": self.label,
            "order": self.order,
            "geometryHash": self.geometry_hash,
            "geometryEntityJson": self.geometry_entity_json,
            "meshUrl": self.mesh_url,
            "sectionUrl": self.section_url,
        }


@dataclass(frozen=True, slots=True)
class PreviewSessionRecord:
    session_id: str
    initial_snapshot_id: str
    snapshots: tuple[PreviewSnapshotRecord, ...]
    cache_weight: int

    def snapshot(self, snapshot_id: str) -> PreviewSnapshotRecord | None:
        return next(
            (snapshot for snapshot in self.snapshots if snapshot.snapshot_id == snapshot_id),
            None,
        )

    def payload(self) -> JsonObject:
        return {
            "sessionId": self.session_id,
            "initialSnapshotId": self.initial_snapshot_id,
            "snapshots": [snapshot.payload() for snapshot in self.snapshots],
        }


@dataclass(frozen=True, slots=True)
class BinaryPreviewAsset:
    content: bytes
    media_type: str
    etag: str
    cache_control: str = PREVIEW_CACHE_CONTROL


@dataclass(frozen=True, slots=True)
class JsonPreviewAsset:
    content: JsonObject
    etag: str
    cache_control: str = PREVIEW_CACHE_CONTROL


@dataclass(frozen=True, slots=True)
class _CachedSection:
    content: JsonObject
    cache_weight: int


@dataclass(frozen=True, slots=True)
class _PreparedSectionEntry:
    model: PreparedSectionModel
    query_lock: asyncio.Lock


K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class _BoundedLru(Generic[K, V]):
    """Entry- and byte-bounded LRU; one oversized newest item remains addressable."""

    def __init__(
        self,
        *,
        max_entries: int,
        max_weight: int,
        weigh: Callable[[V], int],
    ) -> None:
        if max_entries < 1 or max_weight < 1:
            raise ValueError("Preview cache bounds must be positive")
        self._max_entries = max_entries
        self._max_weight = max_weight
        self._weigh = weigh
        self._items: OrderedDict[K, tuple[V, int]] = OrderedDict()
        self._weight = 0

    def get(self, key: K) -> V | None:
        entry = self._items.pop(key, None)
        if entry is None:
            return None
        self._items[key] = entry
        return entry[0]

    def put(self, key: K, value: V) -> None:
        previous = self._items.pop(key, None)
        if previous is not None:
            self._weight -= previous[1]
        weight = max(1, self._weigh(value))
        self._items[key] = (value, weight)
        self._weight += weight
        while len(self._items) > 1 and (
            len(self._items) > self._max_entries or self._weight > self._max_weight
        ):
            _, (_, evicted_weight) = self._items.popitem(last=False)
            self._weight -= evicted_weight

    def clear(self) -> None:
        self._items.clear()
        self._weight = 0


class PreviewSessionManager:
    """Builds content-addressed timelines and lazily materializes CAD assets."""

    def __init__(
        self,
        *,
        mesh_exporter: MeshExporter | None = None,
        section_generator: SectionGenerator | None = None,
        section_preparer: SectionPreparer | None = None,
        max_sessions: int = 16,
        max_session_bytes: int = 128 * 1024 * 1024,
        max_meshes: int = 64,
        max_mesh_bytes: int = 256 * 1024 * 1024,
        max_sections: int = 256,
        max_section_bytes: int = 64 * 1024 * 1024,
        max_prepared_sections: int = 16,
        max_concurrent_session_builds: int = 2,
        max_concurrent_mesh_builds: int = 2,
        max_concurrent_section_builds: int = 2,
        max_session_inflight: int = 32,
        max_mesh_inflight: int = 32,
        max_section_inflight: int = 64,
        max_prepared_section_inflight: int = 16,
    ) -> None:
        if min(
            max_prepared_sections,
            max_concurrent_session_builds,
            max_concurrent_mesh_builds,
            max_concurrent_section_builds,
            max_session_inflight,
            max_mesh_inflight,
            max_section_inflight,
            max_prepared_section_inflight,
        ) < 1:
            raise ValueError("Preview cache and concurrency limits must be positive")
        self._mesh_exporter = mesh_exporter or export_geometry
        # A directly injected generator is retained for tests/custom adapters.
        # Production uses the prepare-once path when this value is None.
        self._section_generator = section_generator
        self._section_preparer = section_preparer or _prepare_section
        self._max_session_inflight = max_session_inflight
        self._max_mesh_inflight = max_mesh_inflight
        self._max_section_inflight = max_section_inflight
        self._max_prepared_section_inflight = max_prepared_section_inflight
        self._lock = asyncio.Lock()
        self._session_slots = asyncio.Semaphore(max_concurrent_session_builds)
        self._mesh_slots = asyncio.Semaphore(max_concurrent_mesh_builds)
        self._section_slots = asyncio.Semaphore(max_concurrent_section_builds)
        self._sessions = _BoundedLru[str, PreviewSessionRecord](
            max_entries=max_sessions,
            max_weight=max_session_bytes,
            weigh=lambda value: value.cache_weight,
        )
        self._meshes = _BoundedLru[tuple[str, int], bytes](
            max_entries=max_meshes,
            max_weight=max_mesh_bytes,
            weigh=len,
        )
        self._sections = _BoundedLru[
            tuple[str, str, str, str, int], _CachedSection
        ](
            max_entries=max_sections,
            max_weight=max_section_bytes,
            weigh=lambda value: value.cache_weight,
        )
        self._prepared_sections = _BoundedLru[
            tuple[str, int], _PreparedSectionEntry
        ](
            max_entries=max_prepared_sections,
            max_weight=max_prepared_sections,
            weigh=lambda _: 1,
        )
        self._session_tasks: dict[str, asyncio.Task[PreviewSessionRecord]] = {}
        self._mesh_tasks: dict[tuple[str, int], asyncio.Task[bytes]] = {}
        self._section_tasks: dict[
            tuple[str, str, str, str, int], asyncio.Task[_CachedSection]
        ] = {}
        self._prepared_section_tasks: dict[
            tuple[str, int], asyncio.Task[_PreparedSectionEntry]
        ] = {}

    @classmethod
    def from_environment(cls) -> PreviewSessionManager:
        return cls(
            max_sessions=_positive_env_int("PREVIEW_SESSION_CACHE_ENTRIES", 16),
            max_session_bytes=_positive_env_int(
                "PREVIEW_SESSION_CACHE_BYTES", 128 * 1024 * 1024
            ),
            max_meshes=_positive_env_int("PREVIEW_MESH_CACHE_ENTRIES", 64),
            max_mesh_bytes=_positive_env_int(
                "PREVIEW_MESH_CACHE_BYTES", 256 * 1024 * 1024
            ),
            max_sections=_positive_env_int("PREVIEW_SECTION_CACHE_ENTRIES", 256),
            max_section_bytes=_positive_env_int(
                "PREVIEW_SECTION_CACHE_BYTES", 64 * 1024 * 1024
            ),
            max_prepared_sections=_positive_env_int(
                "PREVIEW_PREPARED_SECTION_CACHE_ENTRIES", 16
            ),
            max_concurrent_session_builds=_positive_env_int(
                "PREVIEW_SESSION_BUILD_CONCURRENCY", 2
            ),
            max_concurrent_mesh_builds=_positive_env_int(
                "PREVIEW_MESH_BUILD_CONCURRENCY", 2
            ),
            max_concurrent_section_builds=_positive_env_int(
                "PREVIEW_SECTION_BUILD_CONCURRENCY", 2
            ),
            max_session_inflight=_positive_env_int(
                "PREVIEW_SESSION_INFLIGHT_LIMIT", 32
            ),
            max_mesh_inflight=_positive_env_int(
                "PREVIEW_MESH_INFLIGHT_LIMIT", 32
            ),
            max_section_inflight=_positive_env_int(
                "PREVIEW_SECTION_INFLIGHT_LIMIT", 64
            ),
            max_prepared_section_inflight=_positive_env_int(
                "PREVIEW_PREPARED_SECTION_INFLIGHT_LIMIT", 16
            ),
        )

    async def create_session(
        self,
        store: SQLiteStore,
        body: GeometryPreviewRequest,
    ) -> JsonObject:
        context = resolve_preview_request(store, body)
        request_hash = await asyncio.to_thread(
            content_hash,
            preview_request_identity(context),
        )
        session_id = f"preview_{request_hash}"

        async def build() -> PreviewSessionRecord:
            return await self._build_session(context, session_id, request_hash)

        session = await self._get_or_compute(
            cache=self._sessions,
            tasks=self._session_tasks,
            key=session_id,
            factory=build,
            max_inflight=self._max_session_inflight,
            registry_label="preview session",
        )
        return session.payload()

    async def mesh_asset(
        self,
        session_id: str,
        snapshot_id: str,
    ) -> BinaryPreviewAsset:
        snapshot = await self._snapshot(session_id, snapshot_id)

        async def build() -> bytes:
            async with self._mesh_slots:
                content = await self._mesh_exporter(
                    snapshot.geometry_structure,
                    format="glb",
                )
            if not isinstance(content, bytes) or not content:
                raise RuntimeError("Geometry GLB exporter returned an empty binary asset")
            return content

        content = await self._get_or_compute(
            cache=self._meshes,
            tasks=self._mesh_tasks,
            key=(snapshot.geometry_hash, MESH_CACHE_VERSION),
            factory=build,
            max_inflight=self._max_mesh_inflight,
            registry_label="preview mesh",
        )
        return BinaryPreviewAsset(
            content=content,
            media_type="model/gltf-binary",
            etag=_etag(f"geometry-{snapshot.geometry_hash}-v{MESH_CACHE_VERSION}"),
        )

    async def section_asset(
        self,
        session_id: str,
        snapshot_id: str,
        *,
        axis: Axis,
        position: float,
        tolerance: float,
    ) -> JsonPreviewAsset:
        axis, position, tolerance = _validate_section_request(axis, position, tolerance)
        snapshot = await self._snapshot(session_id, snapshot_id)
        cache_key = (
            snapshot.geometry_hash,
            axis,
            position.hex(),
            tolerance.hex(),
            SECTION_CACHE_VERSION,
        )

        async def build() -> _CachedSection:
            generated = await self._generate_section(
                snapshot,
                axis=axis,
                position=position,
                tolerance=tolerance,
            )
            if not isinstance(generated, Mapping):
                raise RuntimeError("CAD section generator returned a non-object response")
            unit_system = generated.get("unitSystem")
            regions = generated.get("regions")
            if not isinstance(unit_system, str) or not unit_system:
                raise RuntimeError("CAD section generator response is missing unitSystem")
            if not isinstance(regions, list):
                raise RuntimeError("CAD section generator response is missing regions")
            generated_position = float(generated.get("position", position))
            if not math.isfinite(generated_position):
                raise RuntimeError("CAD section generator returned a non-finite position")
            content = {
                "unitSystem": unit_system,
                "axis": axis,
                "position": generated_position,
                "regions": regions,
            }
            cache_weight = await asyncio.to_thread(
                lambda: len(_canonical_json_bytes(content))
            )
            return _CachedSection(content=content, cache_weight=cache_weight)

        section = await self._get_or_compute(
            cache=self._sections,
            tasks=self._section_tasks,
            key=cache_key,
            factory=build,
            max_inflight=self._max_section_inflight,
            registry_label="preview section",
        )
        payload = {
            "snapshotId": snapshot.snapshot_id,
            "geometryHash": snapshot.geometry_hash,
            **section.content,
        }
        return JsonPreviewAsset(
            content=payload,
            etag=_etag(
                f"section-{content_hash((snapshot.snapshot_id, cache_key))}"
            ),
        )

    async def _generate_section(
        self,
        snapshot: PreviewSnapshotRecord,
        *,
        axis: Axis,
        position: float,
        tolerance: float,
    ) -> Mapping[str, Any]:
        generator = self._section_generator
        if generator is not None:
            async with self._section_slots:
                return await asyncio.to_thread(
                    generator,
                    snapshot.geometry_structure,
                    axis=axis,
                    position=position,
                    tolerance=tolerance,
                )

        prepared = await self._prepared_section(snapshot)
        # OpenCascade objects are reused only within this entry. Serializing
        # its queries prevents unsafe concurrent access, while another
        # geometryHash can acquire a different entry and run in parallel.
        async with prepared.query_lock:
            async with self._section_slots:
                return await asyncio.to_thread(
                    prepared.model.section,
                    axis=axis,
                    position=position,
                    tolerance=tolerance,
                )

    async def _prepared_section(
        self,
        snapshot: PreviewSnapshotRecord,
    ) -> _PreparedSectionEntry:
        cache_key = (snapshot.geometry_hash, PREPARED_SECTION_CACHE_VERSION)

        async def build() -> _PreparedSectionEntry:
            async with self._section_slots:
                model = await asyncio.to_thread(
                    self._section_preparer,
                    snapshot.geometry_structure,
                )
            section_method = getattr(model, "section", None)
            if not callable(section_method):
                raise RuntimeError("CAD section preparer returned an invalid model")
            return _PreparedSectionEntry(model=model, query_lock=asyncio.Lock())

        return await self._get_or_compute(
            cache=self._prepared_sections,
            tasks=self._prepared_section_tasks,
            key=cache_key,
            factory=build,
            max_inflight=self._max_prepared_section_inflight,
            registry_label="prepared CAD section",
        )

    async def clear(self) -> None:
        async with self._lock:
            tasks = [
                *self._session_tasks.values(),
                *self._mesh_tasks.values(),
                *self._section_tasks.values(),
                *self._prepared_section_tasks.values(),
            ]
            self._session_tasks.clear()
            self._mesh_tasks.clear()
            self._section_tasks.clear()
            self._prepared_section_tasks.clear()
            self._sessions.clear()
            self._meshes.clear()
            self._sections.clear()
            self._prepared_sections.clear()
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def shutdown(self) -> None:
        await self.clear()

    async def _build_session(
        self,
        context: PreviewRequestContext,
        session_id: str,
        request_hash: str,
    ) -> PreviewSessionRecord:
        async with self._session_slots:
            prepared = await asyncio.to_thread(prepare_preview_execution, context)
            snapshot_geometries = await materialize_preview_snapshots(prepared)
            return await asyncio.to_thread(
                self._assemble_session,
                session_id,
                request_hash,
                snapshot_geometries,
            )

    def _assemble_session(
        self,
        session_id: str,
        request_hash: str,
        snapshot_geometries: tuple[PreviewSnapshotGeometry, ...],
    ) -> PreviewSessionRecord:
        snapshots = tuple(
            self._snapshot_record(session_id, request_hash, snapshot)
            for snapshot in snapshot_geometries
        )
        if not snapshots:
            raise RuntimeError("Preview session did not produce any snapshots")
        payload = {
            "sessionId": session_id,
            "initialSnapshotId": snapshots[-1].snapshot_id,
            "snapshots": [snapshot.payload() for snapshot in snapshots],
        }
        return PreviewSessionRecord(
            session_id=session_id,
            initial_snapshot_id=snapshots[-1].snapshot_id,
            snapshots=snapshots,
            cache_weight=len(_canonical_json_bytes(payload)),
        )

    def _snapshot_record(
        self,
        session_id: str,
        request_hash: str,
        source: PreviewSnapshotGeometry,
    ) -> PreviewSnapshotRecord:
        geometry_hash = content_hash(source.geometry_structure)
        snapshot_hash = content_hash(
            {
                "contractVersion": PREVIEW_SESSION_CONTRACT_VERSION,
                "sessionHash": request_hash,
                "sourceKind": source.source_kind,
                "stepRefId": source.step_ref_id,
                "label": source.label,
                "order": source.order,
                "geometryHash": geometry_hash,
                "meshVersion": MESH_CACHE_VERSION,
                "sectionVersion": SECTION_CACHE_VERSION,
            }
        )
        snapshot_id = f"snapshot_{snapshot_hash}"
        base_url = f"/api/preview-sessions/{session_id}/snapshots/{snapshot_id}"
        geometry_entity_json = build_geometry_entity_download(
            geometry_structure=source.geometry_structure,
            target=source.target,
            source_kind=source.source_kind,
            output_step_ref_id=source.step_ref_id,
            source_label=source.label,
        )
        return PreviewSnapshotRecord(
            snapshot_id=snapshot_id,
            source_kind=source.source_kind,
            step_ref_id=source.step_ref_id,
            label=source.label,
            order=source.order,
            geometry_hash=geometry_hash,
            geometry_entity_json=geometry_entity_json,
            mesh_url=f"{base_url}/mesh",
            section_url=f"{base_url}/section",
        )

    async def _snapshot(
        self,
        session_id: str,
        snapshot_id: str,
    ) -> PreviewSnapshotRecord:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise NotFoundError(f"preview session {session_id}")
            snapshot = session.snapshot(snapshot_id)
            if snapshot is None:
                raise NotFoundError(f"preview snapshot {snapshot_id}")
            return snapshot

    async def _get_or_compute(
        self,
        *,
        cache: _BoundedLru[Any, V],
        tasks: dict[Any, asyncio.Task[V]],
        key: Any,
        factory: Callable[[], Awaitable[V]],
        max_inflight: int,
        registry_label: str,
    ) -> V:
        async with self._lock:
            cached = cache.get(key)
            if cached is not None:
                return cached
            task = tasks.get(key)
            if task is None:
                if len(tasks) >= max_inflight:
                    raise PreviewCapacityError(
                        f"{registry_label.capitalize()} work queue is full; retry later"
                    )
                task = asyncio.create_task(
                    self._compute_and_store(cache, tasks, key, factory)
                )
                task.add_done_callback(_consume_task_exception)
                tasks[key] = task
        return await asyncio.shield(task)

    async def _compute_and_store(
        self,
        cache: _BoundedLru[Any, V],
        tasks: dict[Any, asyncio.Task[V]],
        key: Any,
        factory: Callable[[], Awaitable[V]],
    ) -> V:
        current = cast(asyncio.Task[V], asyncio.current_task())
        try:
            value = await factory()
            async with self._lock:
                cache.put(key, value)
            return value
        finally:
            async with self._lock:
                if tasks.get(key) is current:
                    tasks.pop(key, None)


def content_hash(value: Any) -> str:
    return hashlib.sha256(_canonical_json_bytes(value)).hexdigest()


def etag_matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match:
        return False
    expected = _weak_etag_value(etag)
    for candidate in if_none_match.split(","):
        candidate = candidate.strip()
        if candidate == "*" or _weak_etag_value(candidate) == expected:
            return True
    return False


def _canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _etag(value: str) -> str:
    return f'"{value}"'


def _weak_etag_value(value: str) -> str:
    stripped = value.strip()
    if stripped[:2].lower() == "w/":
        stripped = stripped[2:].strip()
    return stripped


def _validate_section_request(
    axis: str,
    position: float,
    tolerance: float,
) -> tuple[Axis, float, float]:
    if axis not in {"x", "y"}:
        raise ValueError("Section axis must be 'x' or 'y'")
    normalized_position = float(position)
    normalized_tolerance = float(tolerance)
    if not math.isfinite(normalized_position):
        raise ValueError("Section position must be finite")
    if not math.isfinite(normalized_tolerance) or normalized_tolerance <= 0:
        raise ValueError("Section tolerance must be finite and greater than zero")
    if normalized_position == 0:
        normalized_position = 0.0
    return cast(Axis, axis), normalized_position, normalized_tolerance


def _prepare_section(geometry_structure: JsonObject) -> PreparedSectionModel:
    # Kept lazy so API startup and non-section routes do not initialize CadQuery.
    from process_flow_cad import prepare_section_geometry

    return prepare_section_geometry(geometry_structure)


def _positive_env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be a positive integer") from None
    if value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


def _consume_task_exception(task: asyncio.Task[Any]) -> None:
    if task.cancelled():
        return
    task.exception()
