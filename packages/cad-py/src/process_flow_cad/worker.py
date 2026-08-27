from __future__ import annotations

import json
import resource
import sys
import time
import traceback
from pathlib import Path

from .exporter import CadExportError, export_cad_bytes

PROGRESS_PREFIX = "PROCESS_FLOW_PROGRESS "


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 3:
        print(
            "Usage: python -m process_flow_cad.worker "
            "<format> <input-json> <output-file>",
            file=sys.stderr,
        )
        return 2

    export_format, input_path, output_path = args
    try:
        timer = _start_stage("validating", "Checking geometry input.")
        input_text = Path(input_path).read_text(encoding="utf-8")
        geometry_structure = json.loads(input_text)
        _complete_stage(
            "validating",
            timer,
            data={"inputBytes": len(input_text.encode("utf-8"))},
        )

        timer = _start_stage("analyzing_geometry", "Analyzing CAD geometry.")
        counts = _geometry_counts(geometry_structure)
        _complete_stage("analyzing_geometry", timer, data=counts)

        body_total = counts["bodyCount"] + counts["featureCount"]
        timer = _start_stage(
            "building_cad_model",
            "Building CAD model.",
            current=0,
            total=body_total,
            unit="bodies",
        )
        output = export_cad_bytes(
            geometry_structure,
            format=export_format,
            progress=_emit_progress,
        )
        _complete_stage(
            "building_cad_model",
            timer,
            data={**counts, "outputBytes": len(output)},
        )

        timer = _start_stage(
            "writing_output",
            "Writing STEP output.",
            current=0,
            total=1,
            unit="records",
        )
        Path(output_path).write_bytes(output)
        _emit_progress(
            {
                "event": "progress",
                "current": 1,
                "total": 1,
                "unit": "records",
                "message": "STEP output written.",
                "data": {},
            }
        )
        _complete_stage(
            "writing_output",
            timer,
            data={"recordsWritten": 1, "outputBytes": len(output)},
        )
        _emit_progress(
            {
                "event": "output.summary",
                "stage": "writing_output",
                "data": {"outputBytes": len(output), **counts},
            }
        )
    except CadExportError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print(traceback.format_exc(), file=sys.stderr)
        return 1
    return 0


def _emit_progress(payload: dict[str, object]) -> None:
    print(
        PROGRESS_PREFIX + json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        file=sys.stderr,
        flush=True,
    )


def _start_stage(
    stage: str,
    message: str,
    *,
    current: int | None = None,
    total: int | None = None,
    unit: str | None = None,
) -> tuple[float, float]:
    _emit_progress(
        {
            "event": "stage.started",
            "stage": stage,
            "current": current,
            "total": total,
            "unit": unit,
            "message": message,
            "data": {},
        }
    )
    return time.perf_counter(), time.process_time()


def _complete_stage(
    stage: str,
    timer: tuple[float, float],
    *,
    data: dict[str, object],
) -> None:
    wall_started, cpu_started = timer
    metrics = dict(data)
    metrics.update(
        {
            "wallDurationMs": int(round((time.perf_counter() - wall_started) * 1000)),
            "cpuDurationMs": int(round((time.process_time() - cpu_started) * 1000)),
            "peakRssBytes": _peak_rss_bytes(),
        }
    )
    _emit_progress(
        {
            "event": "stage.completed",
            "stage": stage,
            "data": metrics,
        }
    )


def _geometry_counts(structure: object) -> dict[str, int]:
    root = structure.get("root") if isinstance(structure, dict) else None
    counts = {"containerCount": 0, "bodyCount": 0, "featureCount": 0}

    def visit(container: object) -> None:
        if not isinstance(container, dict):
            return
        counts["containerCount"] += 1
        bodies = container.get("bodies", [])
        counts["bodyCount"] += len(bodies) if isinstance(bodies, list) else 0
        for field in ("vias", "circuits", "bumps"):
            items = container.get(field, [])
            counts["featureCount"] += len(items) if isinstance(items, list) else 0
        children = container.get("children", [])
        if isinstance(children, list):
            for child in children:
                visit(child)

    visit(root)
    return counts


def _peak_rss_bytes() -> int:
    peak = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    return peak if sys.platform == "darwin" else peak * 1024


if __name__ == "__main__":
    raise SystemExit(main())
