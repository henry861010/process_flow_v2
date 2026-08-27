from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO

JsonObject = dict[str, Any]


class ExportJobLogError(RuntimeError):
    pass


class ExportJobLogger:
    """Line-buffered, human-readable writer owned by one export job."""

    LOG_SCHEMA = "process-flow-export-log/v2"

    STAGE_LABELS = {
        "preparing": "Preparing export",
        "validating": "Checking geometry",
        "analyzing_geometry": "Analyzing geometry",
        "building_2d_mesh": "Building 2D mesh",
        "building_3d_mesh": "Building 3D mesh",
        "building_cad_model": "Building CAD model",
        "writing_output": "Writing output",
        "finalizing": "Finalizing files",
    }

    def __init__(
        self,
        *,
        path: Path,
        handle: TextIO,
        job_id: str,
        kind: str,
        created_at: datetime,
    ) -> None:
        self.path = path
        self._handle = handle
        self.job_id = job_id
        self.kind = kind
        self.created_at = created_at
        self.closed = False
        self._last_comment: str | None = None
        self._output_summary: JsonObject = {}

    @classmethod
    def create(
        cls,
        *,
        path: Path,
        job_id: str,
        kind: str,
        created_at: datetime,
    ) -> "ExportJobLogger":
        try:
            handle = path.open("x", encoding="utf-8", buffering=1)
        except Exception as error:
            raise ExportJobLogError(f"Could not create export log {path}: {error}") from error
        return cls(
            path=path,
            handle=handle,
            job_id=job_id,
            kind=kind,
            created_at=created_at,
        )

    def write_header(
        self,
        *,
        source_label: str | None,
        output_path: str,
        log_path: str,
        element_size: float | None,
        model_type: str | None,
        input_summary: JsonObject,
    ) -> None:
        counts = input_summary.get("counts")
        geometry_types = input_summary.get("geometryTypes")
        materials = input_summary.get("materialCounts")
        bounds = input_summary.get("bounds")
        lines = [
            "=== Export Job ===",
            f"Log schema: {self.LOG_SCHEMA}",
            f"Job ID: {self.job_id}",
            f"Type: {self.kind.upper()}",
            f"Created: {self.created_at.isoformat()}",
            f"Source: {_display_value(source_label)}",
            f"Output: {output_path}",
            f"Log: {log_path}",
        ]
        if element_size is not None:
            lines.append(f"Element size: {_format_number(element_size)}")
        if model_type is not None:
            lines.append(f"Model type: {model_type}")
        lines.extend(
            [
                f"Input schema: {_display_value(input_summary.get('schemaVersion'))}",
                f"Input SHA-256: {_display_value(input_summary.get('inputHash'))}",
                f"Input size: {_display_value(input_summary.get('inputBytes'))} bytes",
            ]
        )
        if isinstance(counts, dict):
            lines.append(f"Input counts: {_format_mapping(counts)}")
        if isinstance(geometry_types, dict) and geometry_types:
            lines.append(f"Geometry types: {_format_mapping(geometry_types)}")
        if isinstance(materials, dict) and materials:
            lines.append(f"Materials: {_format_mapping(materials)}")
        if isinstance(bounds, dict):
            lines.append(f"Bounds: {_format_bounds(bounds)}")
        lines.append("--- Timeline (elapsed) ---")
        self._write_text("\n".join(lines) + "\n")

    def write(
        self,
        event: str,
        *,
        level: str = "info",
        stage: str | None = None,
        data: JsonObject | None = None,
    ) -> None:
        if self.closed:
            raise ExportJobLogError(f"Export log is already closed: {self.path}")
        details = data or {}
        if event == "output.summary":
            self._output_summary.update(details)
            return
        if event in {"job.created", "input.summary", "item.completed"}:
            return

        comment = self._event_comment(
            event,
            level=level,
            stage=stage,
            data=details,
        )
        if comment is None or comment == self._last_comment:
            return
        self._last_comment = comment
        self._write_timeline_line(comment)

    def write_summary(
        self,
        *,
        status: str,
        message: str | None,
        data: JsonObject | None = None,
    ) -> None:
        if self.closed:
            raise ExportJobLogError(f"Export log is already closed: {self.path}")
        now = datetime.now(timezone.utc)
        details = data or {}
        output = dict(self._output_summary)
        lines = [
            "--- Summary ---",
            f"Status: {status}",
            f"Finished: {now.isoformat()}",
            f"Total time: {_format_duration_ms(_elapsed_ms(self.created_at, now))}",
        ]
        if message:
            lines.append(f"Result: {_single_line(message)}")
        output_path = output.get("outputPath")
        if output_path:
            lines.append(f"Output: {_single_line(output_path)}")
        output_bytes = output.get("outputBytes")
        if output_bytes is not None:
            lines.append(f"Output size: {_display_value(output_bytes)} bytes")
        mesh_counts = {
            "nodes": output.get("nodeCount"),
            "elements": output.get("elementCount"),
            "components": output.get("componentCount"),
        }
        mesh_counts = {key: value for key, value in mesh_counts.items() if value is not None}
        if mesh_counts:
            lines.append(f"Mesh: {_format_mapping(mesh_counts)}")
        for label, key in (
            ("Exception", "exceptionType"),
            ("Return code", "returnCode"),
            ("Operation", "operation"),
        ):
            if details.get(key) is not None:
                lines.append(f"{label}: {_single_line(details[key])}")
        diagnostic = details.get("diagnosticTail")
        if diagnostic:
            lines.append(f"Diagnostic: {_single_line(diagnostic)}")
        traceback_text = details.get("traceback")
        if traceback_text:
            lines.append("Traceback:")
            lines.extend(f"  {line}" for line in str(traceback_text).rstrip().splitlines())
        self._write_text("\n".join(lines) + "\n")

    def _event_comment(
        self,
        event: str,
        *,
        level: str,
        stage: str | None,
        data: JsonObject,
    ) -> str | None:
        stage_label = self.STAGE_LABELS.get(stage or "", stage or "Export")
        message = _optional_text(data.get("message"))

        if event == "job.queued":
            position = data.get("queuePosition")
            return f"Job queued{f' — position {position}' if position is not None else ''}."
        if event == "job.started":
            wait_ms = data.get("queueWaitMs")
            suffix = (
                f" — queue wait {_format_duration_ms(wait_ms)}"
                if isinstance(wait_ms, (int, float))
                else ""
            )
            return f"Job started{suffix}."
        if event == "stage.started":
            return _join_action(stage_label, message)
        if event == "stage.completed":
            duration = data.get("wallDurationMs")
            suffix = (
                f" — {_format_duration_ms(duration)}"
                if isinstance(duration, (int, float))
                else ""
            )
            return f"{stage_label} completed{suffix}."
        if event == "progress":
            if message:
                return message
            current = data.get("current")
            total = data.get("total")
            unit = data.get("unit")
            if current is not None and total is not None:
                return f"{stage_label} — {current}/{total}{f' {unit}' if unit else ''}."
            return stage_label
        if event == "worker.diagnostic":
            diagnostic = _optional_text(data.get("line"))
            comment = _join_action(message or "Worker diagnostic", diagnostic)
            return _with_level(comment, level)
        if event == "job.cancel_requested":
            reason = _optional_text(data.get("reason"))
            return _join_action("Cancellation requested", reason)
        if event == "cleanup.warning":
            return _with_level(message or "Cleanup was incomplete.", "warning")
        if event.startswith("job."):
            return _join_action(event.removeprefix("job.").replace("_", " ").title(), message)
        return _with_level(_join_action(event.replace(".", " ").title(), message), level)

    def _write_timeline_line(self, comment: str) -> None:
        now = datetime.now(timezone.utc)
        self._write_text(f"{_format_elapsed(_elapsed_ms(self.created_at, now))}: {_single_line(comment)}\n")

    def _write_text(self, text: str) -> None:
        try:
            self._handle.write(text)
            self._handle.flush()
        except Exception as error:
            raise ExportJobLogError(f"Could not write export log {self.path}: {error}") from error

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        try:
            self._handle.close()
        except Exception:
            pass

    def abort(self) -> None:
        self.close()
        try:
            self.path.unlink(missing_ok=True)
        except Exception:
            pass


def _elapsed_ms(started_at: datetime, finished_at: datetime) -> int:
    return max(0, int(round((finished_at - started_at).total_seconds() * 1000)))


def _format_elapsed(elapsed_ms: int) -> str:
    total_seconds, milliseconds = divmod(elapsed_ms, 1000)
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def _format_duration_ms(value: Any) -> str:
    try:
        milliseconds = max(0.0, float(value))
    except (TypeError, ValueError):
        return "-"
    return f"{milliseconds / 1000:.3f}s"


def _format_number(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.12g}"
    return str(value)


def _display_value(value: Any) -> str:
    text = _optional_text(value)
    return text if text is not None else "-"


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = _single_line(value)
    return text or None


def _single_line(value: Any) -> str:
    return " ".join(str(value).split())


def _join_action(action: str, comment: str | None) -> str:
    if not comment:
        return action
    normalized_action = action.rstrip(". ")
    normalized_comment = comment.strip()
    if normalized_comment.casefold().rstrip(".") == normalized_action.casefold():
        return normalized_comment
    return f"{normalized_action} — {normalized_comment}"


def _with_level(comment: str, level: str) -> str:
    normalized = level.strip().lower()
    if normalized == "warning":
        return f"Warning — {comment}"
    if normalized == "error":
        return f"Error — {comment}"
    return comment


def _format_mapping(values: JsonObject) -> str:
    return ", ".join(
        f"{key}={_display_value(value)}"
        for key, value in sorted(values.items())
    ) or "-"


def _format_bounds(bounds: JsonObject) -> str:
    axes = []
    for axis in ("x", "y", "z"):
        lower = bounds.get(f"{axis}Min")
        upper = bounds.get(f"{axis}Max")
        if lower is not None and upper is not None:
            axes.append(f"{axis}=[{_format_number(lower)}, {_format_number(upper)}]")
    return ", ".join(axes) or "-"


def summarize_export_input(payload: JsonObject) -> JsonObject:
    canonical = json.dumps(
        payload,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    structure = payload.get("structure") if isinstance(payload.get("structure"), dict) else payload
    root = structure.get("root") if isinstance(structure, dict) else None
    summary: JsonObject = {
        "inputHash": hashlib.sha256(canonical).hexdigest(),
        "inputBytes": len(canonical),
        "unitSystem": structure.get("unitSystem") if isinstance(structure, dict) else None,
        "schemaVersion": structure.get("schemaVersion") if isinstance(structure, dict) else None,
        "counts": {
            "containers": 0,
            "bodies": 0,
            "vias": 0,
            "circuits": 0,
            "bumps": 0,
        },
        "geometryTypes": {},
        "materialCounts": {},
        "bounds": None,
    }
    if not isinstance(root, dict):
        return summary

    counts = Counter[str]()
    geometry_types = Counter[str]()
    materials = Counter[str]()
    bounds: list[tuple[float, float, float, float, float, float]] = []

    def visit(container: JsonObject) -> None:
        counts["containers"] += 1
        for field in ("bodies", "vias", "circuits", "bumps"):
            items = container.get(field, [])
            if not isinstance(items, list):
                continue
            counts[field] += len(items)
            for item in items:
                if not isinstance(item, dict):
                    continue
                geometry = item.get("geometry")
                if isinstance(geometry, dict):
                    geometry_types[str(geometry.get("type") or "unknown")] += 1
                    geometry_bounds = _geometry_bounds(geometry)
                    if geometry_bounds is not None:
                        bounds.append(geometry_bounds)
                material = str(item.get("material") or "generic").strip() or "generic"
                materials[material] += 1
        children = container.get("children", [])
        if isinstance(children, list):
            for child in children:
                if isinstance(child, dict):
                    visit(child)

    visit(root)
    summary["counts"] = {
        name: counts[name]
        for name in ("containers", "bodies", "vias", "circuits", "bumps")
    }
    summary["geometryTypes"] = dict(sorted(geometry_types.items()))
    summary["materialCounts"] = dict(sorted(materials.items()))
    if bounds:
        summary["bounds"] = {
            "xMin": min(item[0] for item in bounds),
            "yMin": min(item[1] for item in bounds),
            "zMin": min(item[2] for item in bounds),
            "xMax": max(item[3] for item in bounds),
            "yMax": max(item[4] for item in bounds),
            "zMax": max(item[5] for item in bounds),
        }
    return summary


def _geometry_bounds(
    geometry: JsonObject,
) -> tuple[float, float, float, float, float, float] | None:
    geometry_type = geometry.get("type")
    thickness = _finite(geometry.get("thk"))
    if thickness is None:
        return None

    if geometry_type == "BoxGeometry":
        bottom_left = _point3(geometry.get("bottom_left"))
        top_right = _point3(geometry.get("top_right"))
        if bottom_left is None or top_right is None:
            return None
        z_min = min(bottom_left[2], top_right[2])
        return (
            min(bottom_left[0], top_right[0]),
            min(bottom_left[1], top_right[1]),
            z_min,
            max(bottom_left[0], top_right[0]),
            max(bottom_left[1], top_right[1]),
            z_min + thickness,
        )

    if geometry_type in {"CylinderGeometry", "ConeGeometry"}:
        center = _point3(geometry.get("center"))
        radii = [
            value
            for value in (
                _finite(geometry.get("bottom_radius")),
                _finite(geometry.get("top_radius")),
            )
            if value is not None
        ]
        if center is None or not radii:
            return None
        radius = max(radii)
        return (
            center[0] - radius,
            center[1] - radius,
            center[2],
            center[0] + radius,
            center[1] + radius,
            center[2] + thickness,
        )

    if geometry_type == "PolygonGeometry":
        polygons = geometry.get("polys")
        if not isinstance(polygons, list):
            return None
        points = [
            point
            for polygon in polygons
            if isinstance(polygon, list)
            for raw_point in polygon
            if (point := _point3(raw_point)) is not None
        ]
        if not points:
            return None
        z_min = min(point[2] for point in points)
        return (
            min(point[0] for point in points),
            min(point[1] for point in points),
            z_min,
            max(point[0] for point in points),
            max(point[1] for point in points),
            z_min + thickness,
        )
    return None


def _point3(value: Any) -> tuple[float, float, float] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return None
    coordinates = tuple(_finite(value[index]) for index in range(3))
    if any(coordinate is None for coordinate in coordinates):
        return None
    return coordinates  # type: ignore[return-value]


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None
