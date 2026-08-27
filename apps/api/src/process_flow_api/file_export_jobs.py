from __future__ import annotations

import asyncio
import json
import math
import os
import platform
import resource
import sys
import tempfile
import time
import traceback
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any, Literal, cast

from .cad_exporter import cad_worker_error_message, start_cad_worker
from .cdb_exporter import (
    cdb_worker_error_message,
    parse_cdb_worker_stdout,
    start_cdb_worker,
)
from .export_job_logging import (
    ExportJobLogError,
    ExportJobLogger,
    summarize_export_input,
)
from .models import MODEL_TYPES, ModelType

JsonObject = dict[str, Any]
FileExportKind = Literal["cdb", "json", "step"]
FileExportStatus = Literal["queued", "running", "success", "failed", "canceling", "canceled"]
FileExportStage = Literal[
    "preparing",
    "validating",
    "analyzing_geometry",
    "building_2d_mesh",
    "building_3d_mesh",
    "building_cad_model",
    "writing_output",
    "finalizing",
]
FileExportProgressUnit = Literal["features", "layers", "bodies", "records"]

TERMINAL_STATUSES = {"success", "failed", "canceled"}
DEFAULT_RETAINED_JOBS_PER_CLIENT = 20
DEFAULT_MAX_CONCURRENT_EXPORT_JOBS = 1
WORKER_PROGRESS_PREFIX = "PROCESS_FLOW_PROGRESS "
MAX_WORKER_DIAGNOSTIC_TAIL = 16_000


@dataclass
class FileExportProgress:
    stage: FileExportStage
    stage_started_at: datetime
    updated_at: datetime
    current: int | None = None
    total: int | None = None
    unit: FileExportProgressUnit | None = None
    message: str | None = None
    cpu_started: float = field(default_factory=time.process_time, repr=False)

    def public_payload(self) -> JsonObject:
        return {
            "stage": self.stage,
            "current": self.current,
            "total": self.total,
            "unit": self.unit,
            "message": self.message,
            "stageStartedAt": _iso(self.stage_started_at),
            "updatedAt": _iso(self.updated_at),
        }


@dataclass
class FileExportJob:
    job_id: str
    client_id: str
    kind: FileExportKind
    output_path: Path
    temp_output_path: Path
    input_path: Path
    source_label: str | None
    created_at: datetime
    log_path: Path
    logger: ExportJobLogger = field(repr=False)
    element_size: float | None = None
    model_type: ModelType | None = None
    status: FileExportStatus = "queued"
    started_at: datetime | None = None
    finished_at: datetime | None = None
    node_count: int | None = None
    element_count: int | None = None
    component_count: int | None = None
    message: str | None = None
    warning: str | None = None
    progress: FileExportProgress | None = None
    cancel_requested: bool = False
    process: asyncio.subprocess.Process | None = field(default=None, repr=False)

    def public_payload(self, *, queue_position: int | None = None) -> JsonObject:
        return {
            "jobId": self.job_id,
            "clientId": self.client_id,
            "kind": self.kind,
            "status": self.status,
            "sourceLabel": self.source_label,
            "outputPath": str(self.output_path),
            "logPath": str(self.log_path),
            "elementSize": self.element_size,
            "modelType": self.model_type,
            "createdAt": _iso(self.created_at),
            "startedAt": _iso(self.started_at),
            "finishedAt": _iso(self.finished_at),
            "durationSeconds": _duration_seconds(self.started_at, self.finished_at),
            "runElapsedSeconds": _elapsed_seconds(self.started_at, self.finished_at),
            "queuePosition": queue_position if self.status == "queued" else None,
            "progress": self.progress.public_payload() if self.progress is not None else None,
            "nodeCount": self.node_count,
            "elementCount": self.element_count,
            "componentCount": self.component_count,
            "message": self.message,
            "warning": self.warning,
        }


class FileExportJobManager:
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
        self._jobs: OrderedDict[str, FileExportJob] = OrderedDict()
        self._lock = asyncio.Lock()
        self._tasks: set[asyncio.Task[None]] = set()

    async def create_file_export_job(
        self,
        *,
        client_id: str,
        kind: str,
        output_path: str,
        source_label: str | None,
        geometry_structure: JsonObject | None = None,
        geometry_entity_json: JsonObject | None = None,
        element_size: float | None = None,
        model_type: str | None = None,
    ) -> JsonObject:
        normalized_kind = _normalize_file_export_kind(kind)
        normalized_client_id = _normalize_client_id(client_id)
        final_output_path = _normalize_output_path(output_path, normalized_kind)

        normalized_element_size: float | None = None
        normalized_model_type: ModelType | None = None
        if normalized_kind == "cdb":
            normalized_element_size = _positive_number(element_size, "elementSize")
            normalized_model_type = _normalize_model_type(model_type)
            input_payload = _required_json_object(geometry_structure, "geometryStructure")
            input_path = _write_job_input(input_payload, normalized_kind)
        elif normalized_kind == "step":
            input_payload = _required_json_object(geometry_structure, "geometryStructure")
            input_path = _write_job_input(input_payload, normalized_kind)
        else:
            input_payload = _required_json_object(geometry_entity_json, "geometryEntityJson")
            input_path = _write_job_input(input_payload, normalized_kind, pretty=True)

        job_id = f"{normalized_kind}_{uuid.uuid4().hex}"
        created_at = _now()
        temp_output_path = final_output_path.with_name(
            f"{final_output_path.name}.__job_{job_id}.tmp"
        )
        log_path = final_output_path.parent / f"{job_id}.log"
        try:
            logger = ExportJobLogger.create(
                path=log_path,
                job_id=job_id,
                kind=normalized_kind,
                created_at=created_at,
            )
            logger.write_header(
                source_label=source_label,
                output_path=str(final_output_path),
                log_path=str(log_path),
                element_size=normalized_element_size,
                model_type=normalized_model_type,
                input_summary=summarize_export_input(input_payload),
            )
        except Exception as error:
            _cleanup_paths(input_path, temp_output_path)
            if "logger" in locals():
                logger.abort()
            if isinstance(error, ExportJobLogError):
                raise ValueError(str(error)) from error
            raise

        job = FileExportJob(
            job_id=job_id,
            client_id=normalized_client_id,
            kind=normalized_kind,
            output_path=final_output_path,
            temp_output_path=temp_output_path,
            input_path=input_path,
            log_path=log_path,
            logger=logger,
            element_size=normalized_element_size,
            model_type=normalized_model_type,
            source_label=source_label,
            created_at=created_at,
        )

        async with self._lock:
            self._jobs[job.job_id] = job
            try:
                job.logger.write(
                    "job.queued",
                    data={"queuePosition": self._queue_position_locked(job)},
                )
            except Exception as error:
                self._jobs.pop(job.job_id, None)
                job.logger.abort()
                _cleanup_paths(job.input_path, job.temp_output_path)
                if isinstance(error, ExportJobLogError):
                    raise ValueError(str(error)) from error
                raise
            self._prune_locked()

        await self._schedule_queued_jobs()
        async with self._lock:
            return job.public_payload(queue_position=self._queue_position_locked(job))

    async def create_cdb_file_export(
        self,
        *,
        client_id: str,
        geometry_structure: JsonObject,
        element_size: float,
        model_type: str = "Full_Model",
        output_path: str,
        source_label: str | None,
    ) -> JsonObject:
        return await self.create_file_export_job(
            client_id=client_id,
            kind="cdb",
            geometry_structure=geometry_structure,
            element_size=element_size,
            model_type=model_type,
            output_path=output_path,
            source_label=source_label,
        )

    async def list_jobs(self, *, client_id: str) -> list[JsonObject]:
        normalized_client_id = _normalize_client_id(client_id)
        async with self._lock:
            jobs = [
                job.public_payload(queue_position=self._queue_position_locked(job))
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
            return job.public_payload(queue_position=self._queue_position_locked(job))

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
                self._record_event_locked(job, "job.cancel_requested")
                self._record_terminal_event_locked(job, "job.canceled")
                self._prune_locked()
                return job.public_payload()
            if job.status == "running":
                job.cancel_requested = True
                job.status = "canceling"
                job.message = "Cancel requested."
                self._record_event_locked(
                    job,
                    "job.cancel_requested",
                    stage=job.progress.stage if job.progress is not None else None,
                )
                process = job.process
            elif job.status == "canceling":
                process = job.process
            payload = job.public_payload(queue_position=self._queue_position_locked(job))

        _terminate_process(process)
        return payload

    async def shutdown(self) -> None:
        async with self._lock:
            tasks = list(self._tasks)
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
                    self._record_event_locked(
                        job,
                        "job.cancel_requested",
                        data={"reason": "api_shutdown"},
                    )
                    self._record_terminal_event_locked(job, "job.canceled")
                elif job.status in {"running", "canceling"}:
                    job.cancel_requested = True
                    job.status = "canceling"
                    self._record_event_locked(
                        job,
                        "job.cancel_requested",
                        stage=job.progress.stage if job.progress is not None else None,
                        data={"reason": "api_shutdown"},
                    )
        for process in processes:
            _terminate_process(process)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        async with self._lock:
            for job in self._jobs.values():
                job.logger.close()

    async def _schedule_queued_jobs(self) -> None:
        jobs_to_start: list[FileExportJob] = []
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
            task = asyncio.create_task(self._run_job(job.job_id))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _run_job(self, job_id: str) -> None:
        try:
            async with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                cancel_requested = job.cancel_requested
                self._record_event_locked(
                    job,
                    "job.started",
                    data={
                        "queueWaitMs": _milliseconds(job.created_at, job.started_at),
                        "pythonVersion": platform.python_version(),
                        "platform": platform.system(),
                        "platformRelease": platform.release(),
                        "cpuCount": os.cpu_count(),
                        "packageVersions": _package_versions(),
                    },
                )
            if cancel_requested:
                await self._mark_canceled(job_id, "Canceled before export started.")
                return

            await self._start_stage(job_id, "preparing", message="Preparing export files.")
            await self._prepare_final_path(job_id)
            await self._complete_stage(job_id, "preparing")

            async with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                cancel_requested = job.cancel_requested
                kind = job.kind
                input_path = job.input_path
                element_size = job.element_size
                model_type = job.model_type
                temp_output_path = job.temp_output_path

            if cancel_requested:
                await self._mark_canceled(job_id, "Canceled before export started.")
                return

            if kind == "json":
                await self._start_stage(
                    job_id,
                    "writing_output",
                    current=0,
                    total=1,
                    unit="records",
                    message="Writing JSON document.",
                )
                _write_json_export(input_path, temp_output_path)
                await self._update_progress(
                    job_id,
                    current=1,
                    total=1,
                    unit="records",
                    message="JSON document written.",
                )
                await self._complete_stage(
                    job_id,
                    "writing_output",
                    data={"recordsWritten": 1, "outputBytes": temp_output_path.stat().st_size},
                )
                await self._start_stage(job_id, "finalizing", message="Finalizing output file.")
                await self._mark_success(job_id, {})
                return

            if kind == "cdb":
                process = await start_cdb_worker(
                    input_path=input_path,
                    element_size=_positive_number(element_size, "elementSize"),
                    model_type=_normalize_model_type(model_type),
                    output_path=temp_output_path,
                )
            else:
                process = await start_cad_worker(
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

            stdout, stderr = await self._communicate_worker(job_id, process)

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
                    else cad_worker_error_message(
                        format="step",
                        returncode=process.returncode,
                        stdout=stdout,
                        stderr=stderr,
                    )
                )
                await self._mark_failed(
                    job_id,
                    message,
                    details={
                        "returnCode": process.returncode,
                        "diagnosticTail": stderr.decode("utf-8", errors="replace")[-4000:],
                    },
                )
                return

            metadata = parse_cdb_worker_stdout(stdout) if kind == "cdb" else {}
            await self._start_stage(job_id, "finalizing", message="Finalizing output file.")
            await self._mark_success(job_id, metadata)
        except Exception as error:
            await self._mark_failed(
                job_id,
                str(error),
                details={
                    "exceptionType": type(error).__name__,
                    "traceback": traceback.format_exc(),
                },
            )
        finally:
            await self._schedule_queued_jobs()

    async def _communicate_worker(
        self,
        job_id: str,
        process: asyncio.subprocess.Process,
    ) -> tuple[bytes, bytes]:
        if process.stdout is None or process.stderr is None:
            raise RuntimeError("Export worker pipes are unavailable.")

        stderr_tail = bytearray()

        async def read_stdout() -> bytes:
            return await process.stdout.read()

        async def read_stderr() -> None:
            while True:
                raw_line = await process.stderr.readline()
                if not raw_line:
                    return
                line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")
                if line.startswith(WORKER_PROGRESS_PREFIX):
                    payload_text = line[len(WORKER_PROGRESS_PREFIX) :]
                    try:
                        payload = json.loads(payload_text)
                    except json.JSONDecodeError:
                        await self._record_worker_diagnostic(
                            job_id,
                            line,
                            level="warning",
                            message="Malformed worker progress event.",
                        )
                        continue
                    if isinstance(payload, dict):
                        await self._handle_worker_event(job_id, payload)
                    else:
                        await self._record_worker_diagnostic(
                            job_id,
                            line,
                            level="warning",
                            message="Worker progress event must be an object.",
                        )
                    continue

                encoded = (line + "\n").encode("utf-8", errors="replace")
                stderr_tail.extend(encoded)
                if len(stderr_tail) > MAX_WORKER_DIAGNOSTIC_TAIL:
                    del stderr_tail[:-MAX_WORKER_DIAGNOSTIC_TAIL]
                await self._record_worker_diagnostic(job_id, line)

        stdout_task = asyncio.create_task(read_stdout())
        stderr_task = asyncio.create_task(read_stderr())
        try:
            stdout, _, _ = await asyncio.gather(
                stdout_task,
                stderr_task,
                process.wait(),
            )
        except Exception:
            _terminate_process(process)
            await asyncio.gather(stdout_task, stderr_task, return_exceptions=True)
            raise
        return stdout, bytes(stderr_tail)

    async def _handle_worker_event(self, job_id: str, payload: JsonObject) -> None:
        event = str(payload.get("event") or "").strip()
        stage = _optional_stage(payload.get("stage"))
        current = _optional_non_negative_int(payload.get("current"))
        total = _optional_non_negative_int(payload.get("total"))
        unit = _optional_progress_unit(payload.get("unit"))
        message = _optional_message(payload.get("message"))
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}

        if event == "stage.started":
            if stage is None:
                await self._record_worker_diagnostic(
                    job_id,
                    json.dumps(payload, ensure_ascii=False),
                    level="warning",
                    message="Worker stage.started event omitted a valid stage.",
                )
                return
            await self._start_stage(
                job_id,
                stage,
                current=current,
                total=total,
                unit=unit,
                message=message,
                data=data,
            )
            return
        if event == "stage.completed":
            if stage is None:
                await self._record_worker_diagnostic(
                    job_id,
                    json.dumps(payload, ensure_ascii=False),
                    level="warning",
                    message="Worker stage.completed event omitted a valid stage.",
                )
                return
            await self._complete_stage(job_id, stage, data=data)
            return
        if event == "progress":
            await self._update_progress(
                job_id,
                current=current,
                total=total,
                unit=unit,
                message=message,
                data=data,
            )
            return
        if event in {"input.summary", "item.completed", "output.summary"}:
            async with self._lock:
                job = self._jobs.get(job_id)
                if job is None:
                    return
                self._record_event_locked(job, event, stage=stage, data=data)
            return

        await self._record_worker_diagnostic(
            job_id,
            json.dumps(payload, ensure_ascii=False),
            level="warning",
            message=f"Unknown worker progress event: {event or '-'}.",
        )

    async def _start_stage(
        self,
        job_id: str,
        stage: FileExportStage,
        *,
        current: int | None = None,
        total: int | None = None,
        unit: FileExportProgressUnit | None = None,
        message: str | None = None,
        data: JsonObject | None = None,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL_STATUSES:
                return
            now = _now()
            job.progress = FileExportProgress(
                stage=stage,
                stage_started_at=now,
                updated_at=now,
                current=current,
                total=total,
                unit=unit,
                message=message,
                cpu_started=time.process_time(),
            )
            event_data = dict(data or {})
            event_data.update(
                {
                    "current": current,
                    "total": total,
                    "unit": unit,
                    "message": message,
                }
            )
            self._record_event_locked(job, "stage.started", stage=stage, data=event_data)

    async def _update_progress(
        self,
        job_id: str,
        *,
        current: int | None = None,
        total: int | None = None,
        unit: FileExportProgressUnit | None = None,
        message: str | None = None,
        data: JsonObject | None = None,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.progress is None or job.status in TERMINAL_STATUSES:
                return
            job.progress.updated_at = _now()
            if current is not None:
                job.progress.current = current
            if total is not None:
                job.progress.total = total
            if unit is not None:
                job.progress.unit = unit
            if message is not None:
                job.progress.message = message
            event_data = dict(data or {})
            event_data.update(
                {
                    "current": job.progress.current,
                    "total": job.progress.total,
                    "unit": job.progress.unit,
                    "message": job.progress.message,
                }
            )
            self._record_event_locked(
                job,
                "progress",
                stage=job.progress.stage,
                data=event_data,
            )

    async def _complete_stage(
        self,
        job_id: str,
        stage: FileExportStage,
        *,
        data: JsonObject | None = None,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL_STATUSES:
                return
            now = _now()
            event_data = dict(data or {})
            if job.progress is not None and job.progress.stage == stage:
                job.progress.updated_at = now
                event_data.setdefault(
                    "wallDurationMs",
                    _milliseconds(job.progress.stage_started_at, now),
                )
                event_data.setdefault(
                    "cpuDurationMs",
                    int(round((time.process_time() - job.progress.cpu_started) * 1000)),
                )
                event_data.setdefault("peakRssBytes", _peak_rss_bytes())
                event_data.setdefault("current", job.progress.current)
                event_data.setdefault("total", job.progress.total)
                event_data.setdefault("unit", job.progress.unit)
            self._record_event_locked(job, "stage.completed", stage=stage, data=event_data)

    async def _record_worker_diagnostic(
        self,
        job_id: str,
        line: str,
        *,
        level: str = "info",
        message: str | None = None,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL_STATUSES:
                return
            data: JsonObject = {"line": line[:16_000]}
            if message is not None:
                data["message"] = message
            self._record_event_locked(
                job,
                "worker.diagnostic",
                level=level,
                stage=job.progress.stage if job.progress is not None else None,
                data=data,
            )

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
                self._record_terminal_event_locked(job, "job.canceled")
                self._prune_locked()
                return
            try:
                job.temp_output_path.replace(job.output_path)
            except Exception as error:
                job.status = "failed"
                job.finished_at = _now()
                job.message = f"{_kind_label(job.kind)} export failed while moving temp file: {error}"
                job.warning = _cleanup_paths(job.input_path, job.temp_output_path)
                self._record_terminal_event_locked(
                    job,
                    "job.failed",
                    data={
                        "exceptionType": type(error).__name__,
                        "message": str(error),
                        "operation": "finalize_output",
                    },
                )
                self._prune_locked()
                return

            now = _now()
            if job.progress is not None and job.progress.stage == "finalizing":
                job.progress.updated_at = now
                self._record_event_locked(
                    job,
                    "stage.completed",
                    stage="finalizing",
                    data={
                        "wallDurationMs": _milliseconds(job.progress.stage_started_at, now),
                        "cpuDurationMs": int(
                            round((time.process_time() - job.progress.cpu_started) * 1000)
                        ),
                        "peakRssBytes": _peak_rss_bytes(),
                        "outputBytes": job.output_path.stat().st_size,
                    },
                )
            job.status = "success"
            job.finished_at = now
            if job.kind == "cdb":
                job.node_count = _optional_int(metadata.get("nodeCount"))
                job.element_count = _optional_int(metadata.get("elementCount"))
                job.component_count = _optional_int(metadata.get("componentCount"))
            job.message = f"{_kind_label(job.kind)} export completed."
            job.warning = _cleanup_paths(job.input_path)
            try:
                self._record_event_locked(
                    job,
                    "output.summary",
                    stage="finalizing",
                    data={
                        "outputPath": str(job.output_path),
                        "outputBytes": job.output_path.stat().st_size,
                        "nodeCount": job.node_count,
                        "elementCount": job.element_count,
                        "componentCount": job.component_count,
                    },
                )
                self._record_terminal_event_locked(job, "job.succeeded")
            except ExportJobLogError as log_error:
                job.status = "failed"
                job.message = f"Export log failed while finalizing output: {log_error}"
                job.output_path.unlink(missing_ok=True)
                job.logger.close()
            self._prune_locked()

    async def _mark_failed(
        self,
        job_id: str,
        message: str,
        *,
        details: JsonObject | None = None,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status in TERMINAL_STATUSES:
                return
            job.status = "failed"
            job.finished_at = _now()
            job.process = None
            job.message = _concise_error_message(job.kind, message)
            job.warning = _cleanup_paths(job.input_path, job.temp_output_path)
            failure_data = dict(details or {})
            failure_data.setdefault("message", message)
            try:
                self._record_terminal_event_locked(job, "job.failed", data=failure_data)
            except ExportJobLogError as log_error:
                job.message = f"{job.message} Export log failed: {log_error}"
                job.logger.close()
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
            self._record_terminal_event_locked(job, "job.canceled")
            self._prune_locked()

    def _queue_position_locked(self, target: FileExportJob) -> int | None:
        if target.status != "queued":
            return None
        position = 0
        for job in self._jobs.values():
            if job.status != "queued":
                continue
            position += 1
            if job.job_id == target.job_id:
                return position
        return None

    def _record_event_locked(
        self,
        job: FileExportJob,
        event: str,
        *,
        level: str = "info",
        stage: FileExportStage | None = None,
        data: JsonObject | None = None,
    ) -> None:
        job.logger.write(event, level=level, stage=stage, data=data)

    def _record_terminal_event_locked(
        self,
        job: FileExportJob,
        event: str,
        *,
        data: JsonObject | None = None,
    ) -> None:
        terminal_data = dict(data or {})
        terminal_data.setdefault("status", job.status)
        terminal_data.setdefault("message", job.message)
        terminal_data.setdefault(
            "runDurationMs",
            _milliseconds(job.started_at, job.finished_at),
        )
        try:
            if job.warning:
                job.logger.write(
                    "cleanup.warning",
                    level="warning",
                    stage=job.progress.stage if job.progress is not None else None,
                    data={"message": job.warning},
                )
            job.logger.write_summary(
                status=job.status,
                message=job.message,
                data=terminal_data,
            )
        finally:
            job.logger.close()

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


def _normalize_file_export_kind(value: str) -> FileExportKind:
    normalized = str(value).strip().lower()
    if normalized in {"cdb", "json", "step"}:
        return normalized  # type: ignore[return-value]
    raise ValueError("Export job kind must be one of: cdb, json, step.")


def _normalize_model_type(value: str | None) -> ModelType:
    normalized = "Full_Model" if value is None else str(value).strip()
    if normalized not in MODEL_TYPES:
        allowed = ", ".join(MODEL_TYPES)
        raise ValueError(f"modelType must be one of: {allowed}.")
    return cast(ModelType, normalized)


def _normalize_output_path(value: str, kind: FileExportKind) -> Path:
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


def _write_job_input(payload: JsonObject, kind: FileExportKind, *, pretty: bool = False) -> Path:
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


def _optional_non_negative_int(value: Any) -> int | None:
    parsed = _optional_int(value)
    return parsed if parsed is not None and parsed >= 0 else None


def _optional_stage(value: Any) -> FileExportStage | None:
    if value in {
        "preparing",
        "validating",
        "analyzing_geometry",
        "building_2d_mesh",
        "building_3d_mesh",
        "building_cad_model",
        "writing_output",
        "finalizing",
    }:
        return cast(FileExportStage, value)
    return None


def _optional_progress_unit(value: Any) -> FileExportProgressUnit | None:
    if value in {"features", "layers", "bodies", "records"}:
        return cast(FileExportProgressUnit, value)
    return None


def _optional_message(value: Any) -> str | None:
    if value is None:
        return None
    message = str(value).strip()
    return message[:1000] if message else None


def _kind_label(kind: FileExportKind) -> str:
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


def _elapsed_seconds(start: datetime | None, end: datetime | None) -> float | None:
    if start is None:
        return None
    return round(((end or _now()) - start).total_seconds(), 3)


def _milliseconds(start: datetime | None, end: datetime | None) -> int | None:
    if start is None or end is None:
        return None
    return max(0, int(round((end - start).total_seconds() * 1000)))


def _concise_error_message(kind: FileExportKind, message: str) -> str:
    lines = [line.strip() for line in str(message).splitlines() if line.strip()]
    detail = lines[-1] if lines else "Unknown error."
    prefix = f"{_kind_label(kind)} export failed:"
    if detail.lower().startswith(prefix.lower()):
        concise = detail
    else:
        concise = f"{prefix} {detail}"
    return concise[:1000]


def _peak_rss_bytes() -> int:
    peak = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return peak if sys.platform == "darwin" else peak * 1024


def _package_versions() -> JsonObject:
    versions: JsonObject = {}
    for package in (
        "process-flow-api",
        "process-flow-kernel",
        "process-flow-cad",
        "process-flow-mesher",
    ):
        try:
            versions[package] = importlib_metadata.version(package)
        except importlib_metadata.PackageNotFoundError:
            versions[package] = None
    return versions
