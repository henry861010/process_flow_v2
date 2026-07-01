from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import tempfile
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from .cdb_exporter import (
    cdb_worker_error_message,
    parse_cdb_worker_stdout,
    start_cdb_worker,
)

JsonObject = dict[str, Any]
ExportJobKind = Literal["cdb", "json", "step"]
JobStatus = Literal["queued", "running", "success", "failed", "canceling", "canceled"]

TERMINAL_STATUSES = {"success", "failed", "canceled"}
DEFAULT_RETAINED_JOBS_PER_CLIENT = 20
DEFAULT_MAX_CONCURRENT_EXPORT_JOBS = 1


@dataclass
class ExportJob:
    job_id: str
    client_id: str
    kind: ExportJobKind
    output_path: Path
    temp_output_path: Path
    input_path: Path
    source_label: str | None
    created_at: datetime
    element_size: float | None = None
    status: JobStatus = "queued"
    started_at: datetime | None = None
    finished_at: datetime | None = None
    node_count: int | None = None
    element_count: int | None = None
    component_count: int | None = None
    message: str | None = None
    warning: str | None = None
    cancel_requested: bool = False
    process: asyncio.subprocess.Process | None = field(default=None, repr=False)

    def public_payload(self) -> JsonObject:
        return {
            "jobId": self.job_id,
            "clientId": self.client_id,
            "kind": self.kind,
            "status": self.status,
            "sourceLabel": self.source_label,
            "outputPath": str(self.output_path),
            "elementSize": self.element_size,
            "createdAt": _iso(self.created_at),
            "startedAt": _iso(self.started_at),
            "finishedAt": _iso(self.finished_at),
            "durationSeconds": _duration_seconds(self.started_at, self.finished_at),
            "nodeCount": self.node_count,
            "elementCount": self.element_count,
            "componentCount": self.component_count,
            "message": self.message,
            "warning": self.warning,
        }


class ExportJobManager:
    def __init__(
        self,
        *,
        max_concurrent_jobs: int | None = None,
        retained_jobs_per_client: int = DEFAULT_RETAINED_JOBS_PER_CLIENT,
    ) -> None:
        configured_concurrency = max_concurrent_jobs
        if configured_concurrency is None:
            configured_concurrency = int(
                os.environ.get(
                    "EXPORT_MAX_CONCURRENT_JOBS",
                    os.environ.get(
                        "CDB_EXPORT_MAX_CONCURRENT_JOBS",
                        DEFAULT_MAX_CONCURRENT_EXPORT_JOBS,
                    ),
                )
            )
        self.max_concurrent_jobs = max(1, configured_concurrency)
        self.retained_jobs_per_client = retained_jobs_per_client
        self._jobs: OrderedDict[str, ExportJob] = OrderedDict()
        self._lock = asyncio.Lock()

    async def create_export_job(
        self,
        *,
        client_id: str,
        kind: str,
        output_path: str,
        source_label: str | None,
        geometry_structure: JsonObject | None = None,
        geometry_entity_json: JsonObject | None = None,
        element_size: float | None = None,
    ) -> JsonObject:
        normalized_kind = _normalize_job_kind(kind)
        normalized_client_id = _normalize_client_id(client_id)
        final_output_path = _normalize_output_path(output_path, normalized_kind)
        temp_output_path = final_output_path.with_name(
            f"{final_output_path.name}.__job_{uuid.uuid4().hex}.tmp"
        )

        normalized_element_size: float | None = None
        if normalized_kind == "cdb":
            normalized_element_size = _positive_number(element_size, "elementSize")
            input_payload = _required_json_object(geometry_structure, "geometryStructure")
            input_path = _write_job_input(input_payload, normalized_kind)
        elif normalized_kind == "step":
            input_payload = _required_json_object(geometry_structure, "geometryStructure")
            input_path = _write_job_input(input_payload, normalized_kind)
        else:
            input_payload = _required_json_object(geometry_entity_json, "geometryEntityJson")
            input_path = _write_job_input(input_payload, normalized_kind, pretty=True)

        job = ExportJob(
            job_id=f"{normalized_kind}_{uuid.uuid4().hex}",
            client_id=normalized_client_id,
            kind=normalized_kind,
            output_path=final_output_path,
            temp_output_path=temp_output_path,
            input_path=input_path,
            element_size=normalized_element_size,
            source_label=source_label,
            created_at=_now(),
        )

        async with self._lock:
            self._jobs[job.job_id] = job
            self._prune_locked()

        await self._schedule_queued_jobs()
        return job.public_payload()

    async def create_cdb_job(
        self,
        *,
        client_id: str,
        geometry_structure: JsonObject,
        element_size: float,
        output_path: str,
        source_label: str | None,
    ) -> JsonObject:
        return await self.create_export_job(
            client_id=client_id,
            kind="cdb",
            geometry_structure=geometry_structure,
            element_size=element_size,
            output_path=output_path,
            source_label=source_label,
        )

    async def list_jobs(self, *, client_id: str) -> list[JsonObject]:
        normalized_client_id = _normalize_client_id(client_id)
        async with self._lock:
            jobs = [
                job.public_payload()
                for job in reversed(self._jobs.values())
                if job.client_id == normalized_client_id
            ]
        return jobs[: self.retained_jobs_per_client]

    async def get_job(self, *, job_id: str, client_id: str) -> JsonObject | None:
        normalized_client_id = _normalize_client_id(client_id)
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.client_id != normalized_client_id:
                return None
            return job.public_payload()

    async def cancel_job(self, *, job_id: str, client_id: str) -> JsonObject | None:
        normalized_client_id = _normalize_client_id(client_id)
        process: asyncio.subprocess.Process | None = None
        payload: JsonObject | None = None
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.client_id != normalized_client_id:
                return None
            if job.status == "queued":
                job.cancel_requested = True
                job.status = "canceled"
                job.finished_at = _now()
                job.message = "Canceled before export started."
                job.warning = _cleanup_paths(job.input_path, job.temp_output_path)
                self._prune_locked()
                return job.public_payload()
            if job.status == "running":
                job.cancel_requested = True
                job.status = "canceling"
                job.message = "Cancel requested."
                process = job.process
            elif job.status == "canceling":
                process = job.process
            payload = job.public_payload()

        _terminate_process(process)
        return payload

    async def shutdown(self) -> None:
        async with self._lock:
            processes = [
                job.process
                for job in self._jobs.values()
                if job.process is not None and job.status in {"running", "canceling"}
            ]
            for job in self._jobs.values():
                if job.status == "queued":
                    job.cancel_requested = True
                    job.status = "canceled"
                    job.finished_at = _now()
                    job.message = "Canceled during API shutdown."
                    job.warning = _cleanup_paths(job.input_path, job.temp_output_path)
                elif job.status in {"running", "canceling"}:
                    job.cancel_requested = True
                    job.status = "canceling"
        for process in processes:
            _terminate_process(process)

    async def _schedule_queued_jobs(self) -> None:
        jobs_to_start: list[ExportJob] = []
        async with self._lock:
            running_count = sum(
                1 for job in self._jobs.values() if job.status in {"running", "canceling"}
            )
            available_slots = max(0, self.max_concurrent_jobs - running_count)
            if available_slots == 0:
                return
            for job in self._jobs.values():
                if available_slots <= 0:
                    break
                if job.status != "queued":
                    continue
                job.status = "running"
                job.started_at = _now()
                jobs_to_start.append(job)
                available_slots -= 1

        for job in jobs_to_start:
            asyncio.create_task(self._run_job(job.job_id))

    async def _run_job(self, job_id: str) -> None:
        try:
            async with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                cancel_requested = job.cancel_requested
            if cancel_requested:
                await self._mark_canceled(job_id, "Canceled before export started.")
                return

            await self._prepare_final_path(job_id)

            async with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                cancel_requested = job.cancel_requested
                kind = job.kind
                input_path = job.input_path
                element_size = job.element_size
                temp_output_path = job.temp_output_path

            if cancel_requested:
                await self._mark_canceled(job_id, "Canceled before export started.")
                return

            if kind == "json":
                _write_json_export(input_path, temp_output_path)
                await self._mark_success(job_id, {})
                return

            if kind == "cdb":
                process = await start_cdb_worker(
                    input_path=input_path,
                    element_size=_positive_number(element_size, "elementSize"),
                    output_path=temp_output_path,
                )
            else:
                process = await _start_cad_worker(
                    input_path=input_path,
                    output_path=temp_output_path,
                )

            async with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    _terminate_process(process)
                    return
                job.process = process
                if job.status == "canceling" or job.cancel_requested:
                    _terminate_process(process)

            stdout, stderr = await process.communicate()

            async with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                job.process = None
                was_canceled = job.cancel_requested or job.status == "canceling"

            if was_canceled:
                await self._mark_canceled(job_id, "Canceled during export.")
                return

            if process.returncode != 0:
                message = (
                    cdb_worker_error_message(process.returncode, stdout, stderr)
                    if kind == "cdb"
                    else _cad_worker_error_message(process.returncode, stdout, stderr)
                )
                await self._mark_failed(job_id, message)
                return

            metadata = parse_cdb_worker_stdout(stdout) if kind == "cdb" else {}
            await self._mark_success(job_id, metadata)
        except Exception as error:
            await self._mark_failed(job_id, str(error))
        finally:
            await self._schedule_queued_jobs()

    async def _prepare_final_path(self, job_id: str) -> None:
        async with self._lock:
            job = self._jobs[job_id]
            output_path = job.output_path

        if output_path.exists() and output_path.is_dir():
            raise ValueError(f"Output path is a directory: {output_path}")
        if output_path.exists():
            output_path.unlink()

    async def _mark_success(self, job_id: str, metadata: JsonObject) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            if job.cancel_requested or job.status == "canceling":
                job.status = "canceled"
                job.finished_at = _now()
                job.process = None
                job.message = "Canceled during export."
                job.warning = _cleanup_paths(job.input_path, job.temp_output_path)
                self._prune_locked()
                return
            try:
                job.temp_output_path.replace(job.output_path)
            except Exception as error:
                job.status = "failed"
                job.finished_at = _now()
                job.message = f"{_kind_label(job.kind)} export failed while moving temp file: {error}"
                job.warning = _cleanup_paths(job.input_path, job.temp_output_path)
                self._prune_locked()
                return

            job.status = "success"
            job.finished_at = _now()
            if job.kind == "cdb":
                job.node_count = _optional_int(metadata.get("nodeCount"))
                job.element_count = _optional_int(metadata.get("elementCount"))
                job.component_count = _optional_int(metadata.get("componentCount"))
            job.message = f"{_kind_label(job.kind)} export completed."
            job.warning = _cleanup_paths(job.input_path)
            self._prune_locked()

    async def _mark_failed(self, job_id: str, message: str) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL_STATUSES:
                return
            job.status = "failed"
            job.finished_at = _now()
            job.process = None
            job.message = message
            job.warning = _cleanup_paths(job.input_path, job.temp_output_path)
            self._prune_locked()

    async def _mark_canceled(self, job_id: str, message: str) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL_STATUSES:
                return
            job.status = "canceled"
            job.finished_at = _now()
            job.process = None
            job.message = message
            job.warning = _cleanup_paths(job.input_path, job.temp_output_path)
            self._prune_locked()

    def _prune_locked(self) -> None:
        client_ids = {job.client_id for job in self._jobs.values()}
        for client_id in client_ids:
            terminal_jobs = [
                job
                for job in self._jobs.values()
                if job.client_id == client_id and job.status in TERMINAL_STATUSES
            ]
            overflow = len(terminal_jobs) - self.retained_jobs_per_client
            for job in terminal_jobs[: max(0, overflow)]:
                self._jobs.pop(job.job_id, None)


def _normalize_client_id(value: str) -> str:
    client_id = str(value).strip()
    if not client_id:
        raise ValueError("clientId is required.")
    if len(client_id) > 160:
        raise ValueError("clientId must be 160 characters or fewer.")
    return client_id


def _normalize_job_kind(value: str) -> ExportJobKind:
    normalized = str(value).strip().lower()
    if normalized in {"cdb", "json", "step"}:
        return normalized  # type: ignore[return-value]
    raise ValueError("Export job kind must be one of: cdb, json, step.")


def _normalize_output_path(value: str, kind: ExportJobKind) -> Path:
    raw = str(value).strip()
    if not raw:
        raise ValueError("outputPath is required.")
    path = Path(raw)
    suffix = f".{kind}"
    label = _kind_label(kind)
    if not path.is_absolute():
        raise ValueError(f"{label} output path must be absolute.")
    if path.suffix.lower() != suffix:
        raise ValueError(f"{label} output path must use a {suffix} file extension.")
    if path.suffix != suffix:
        path = path.with_suffix(suffix)
    parent = path.parent
    if not parent.exists():
        raise ValueError(f"{label} output folder does not exist: {parent}")
    if not parent.is_dir():
        raise ValueError(f"{label} output folder is not a directory: {parent}")
    return path


def _required_json_object(value: JsonObject | None, name: str) -> JsonObject:
    if not isinstance(value, dict):
        raise ValueError(f"{name} is required.")
    return value


def _write_job_input(payload: JsonObject, kind: ExportJobKind, *, pretty: bool = False) -> Path:
    fd, raw_path = tempfile.mkstemp(prefix=f"process-flow-{kind}-input-", suffix=".json")
    path = Path(raw_path)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            if pretty:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            else:
                json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return path


def _write_json_export(input_path: Path, output_path: Path) -> None:
    output_path.write_text(input_path.read_text(encoding="utf-8"), encoding="utf-8")


async def _start_cad_worker(
    *,
    input_path: Path,
    output_path: Path,
) -> asyncio.subprocess.Process:
    return await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "process_flow_cad.worker",
        "step",
        str(input_path),
        str(output_path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


def _cad_worker_error_message(returncode: int | None, stdout: bytes, stderr: bytes) -> str:
    details = (stderr or stdout).decode("utf-8", errors="replace").strip()
    if details:
        return f"STEP export failed: {details[-4000:]}"
    return f"STEP export failed with exit code {returncode}"


def _cleanup_paths(*paths: Path) -> str | None:
    warnings: list[str] = []
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except Exception as error:
            warnings.append(f"Could not remove temp file {path}: {error}")
    return "; ".join(warnings) if warnings else None


def _terminate_process(process: asyncio.subprocess.Process | None) -> None:
    if process is None or process.returncode is not None:
        return
    try:
        process.terminate()
    except ProcessLookupError:
        return


def _positive_number(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a finite number.") from exc
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number.")
    if number <= 0:
        raise ValueError(f"{name} must be greater than 0.")
    return number


def _optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _kind_label(kind: ExportJobKind) -> str:
    return kind.upper()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _duration_seconds(start: datetime | None, end: datetime | None) -> float | None:
    if start is None or end is None:
        return None
    return round((end - start).total_seconds(), 3)


CdbExportJob = ExportJob
CdbExportJobManager = ExportJobManager
