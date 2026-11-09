#!/usr/bin/env python3
"""Fresh-process many-die/holes benchmark; PYTHONPATH can select a baseline tree."""
from __future__ import annotations

import argparse
import inspect
import json
import os
from pathlib import Path
import resource
import statistics
import subprocess
import sys
import time
from types import ModuleType

from benchmark_preview import digest, polygon_metrics


def worker(args):
    os.environ["PROCESS_FLOW_API_DB_PATH"] = ":memory:"
    os.environ["PROCESS_FLOW_API_ANALYTICS_DB_PATH"] = ":memory:"
    from process_flow_api.schematic_builder import build_schematic
    from process_flow_kernel import (ExecutionPlan, GeometryArtifact, GeometryKernel,
                                     PlannedGeometryInput, PlannedStep)
    from process_flow_kernel.infrastructure.step_cache import MemoryStepExecutionCache
    from process_flow_kernel.utils import polygon

    def body(x, y, size, z, thickness, material):
        return {"material": material, "geometry": {"type": "BoxGeometry",
                "bottom_left": [x, y, z], "top_right": [x+size, y+size, z], "thk": thickness}}

    size = args.side * 12 - 2
    artifact = GeometryArtifact.from_structure({"schemaVersion": "1.0.0", "unitSystem": "um", "root": {
        "bodies": [body(0, 0, size, 0, 2, "base")],
        "children": [{"key": "soc", "bodies": [body(x*12, y*12, 10, 2, 6, "Si")]}
                     for x in range(args.side) for y in range(args.side)],
    }})
    values = {"material": "UF", "thk": 6, "gap": 3}
    # A placement-like predecessor preserves the substrate cursor at Z=2.
    seed_module = ModuleType("process_flow_steps.polygon_benchmark_seed")
    seed_module.EXECUTION_CACHE_VERSION = 1
    seed_module.execute = lambda context: context.state.set_cursor_z(2)
    sys.modules[seed_module.__name__] = seed_module
    seed = PlannedStep("seed", "seed", {"id": "seed", "program": "polygon_benchmark_seed"}, {}, {},
                       {"main_geometry": PlannedGeometryInput(kind="external", flow_input_id="main")}, "result_geometry")
    step = PlannedStep("uf", "uf", {"id": "uf", "program": "uf/under_fill"}, values, values,
                       {"main_geometry": PlannedGeometryInput(kind="stepOutput", step_ref_id="seed", output_port_id="result_geometry")}, "result_geometry")
    plan = ExecutionPlan([seed, step], {"main": artifact}, ["uf"])
    kernel = GeometryKernel(step_cache=None if args.mode == "off" else MemoryStepExecutionCache())
    metrics = polygon_metrics()

    def execute():
        start = time.perf_counter()
        result = kernel.execute(plan)
        output = result.step_artifact("uf")
        kernel_seconds = time.perf_counter() - start
        source = output.geometry()
        start_schematic = time.perf_counter()
        kwargs = ({"polygon_lookup": output.polygons.get}
                  if "polygon_lookup" in inspect.signature(build_schematic).parameters else {})
        schematic = build_schematic(source, **kwargs)
        schematic_seconds = time.perf_counter() - start_schematic
        elapsed = time.perf_counter() - start
        return result, output, schematic, {"total": elapsed, "kernel": kernel_seconds, "schematic": schematic_seconds}

    result, output, schematic, seconds = execute()
    cold_metrics = metrics()
    report = {"side": args.side, "dies": args.side**2, "mode": args.mode, "seconds": seconds,
              "polygonMetrics": cold_metrics, "execution": result.execution_statistics()}
    if args.mode == "warm":
        before = metrics()
        result, output, schematic, warm_seconds = execute()
        after = metrics()
        report["warm"] = {"seconds": warm_seconds, "execution": result.execution_statistics(),
                          "polygonMetrics": {k: after[k]-before[k] for k in before if k != "seconds"}}
    report["peakRssBytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)
    raw = output.geometry()
    report["checks"] = {"geometry": digest(raw), "provenance": digest(result.step_provenance("uf")),
                        "warnings": digest(result.execution_warnings()), "schematic": digest(schematic)}
    from process_flow_kernel.domain.provenance import structure_nodes
    loops = [loop for b in structure_nodes(raw) if b.get("geometry", {}).get("type") == "PolygonGeometry"
             for loop in b["geometry"]["polys"]]
    report["loops"] = len(loops)
    report["vertices"] = sum(map(len, loops))
    # Independent correctness oracle, deliberately outside the timed measurement.
    polygon.validate_polygon_loops(loops)
    if args.capture:
        Path(args.capture).write_text(json.dumps({"geometry": raw, "provenance": result.step_provenance("uf"),
                                                "warnings": result.execution_warnings(), "schematic": schematic}))
    Path(args.output).write_text(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--side", type=int, default=24)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--mode", choices=("off", "cold", "warm"), default="off")
    parser.add_argument("--output", required=True)
    parser.add_argument("--capture")
    parser.add_argument("--compare")
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    if args.worker:
        worker(args)
        return
    reports = []
    for index in range(args.runs):
        path = Path(args.output).with_suffix(f".run-{index+1}.json")
        command = [sys.executable, __file__, "--worker", "--side", str(args.side), "--mode", args.mode, "--output", str(path)]
        if args.capture and index == 0:
            command += ["--capture", args.capture]
        subprocess.run(command, check=True)
        reports.append(json.loads(path.read_text()))
        if reports[-1]["checks"] != reports[0]["checks"]:
            raise RuntimeError("Synthetic output changed between runs")
    report = {"runs": reports, "medianSeconds": {key: statistics.median(r["seconds"][key] for r in reports)
                                                for key in reports[0]["seconds"]}}
    if args.compare:
        baseline = json.loads(Path(args.compare).read_text())
        report["matchesBaseline"] = baseline["runs"][0]["checks"] == reports[0]["checks"]
        if not report["matchesBaseline"]:
            raise RuntimeError("Synthetic output differs from baseline")
    Path(args.output).write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "runs"}), flush=True)


if __name__ == "__main__":
    main()
