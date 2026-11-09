#!/usr/bin/env python3
"""Compare cold semantic preview builds without modifying the source database.

Each run uses a fresh Python process (including fresh polygon/session caches).
PYTHONPATH may point at an archived checkout to measure a baseline. Timings
exclude correctness capture, gzip output, and interpreter/import startup.
"""
from __future__ import annotations

import argparse
import asyncio
import functools
import gzip
import hashlib
import inspect
import json
import os
import resource
from pathlib import Path
import sqlite3
import statistics
import subprocess
import sys
import time


def polygon_metrics():
    """Instrument actual topology work as well as callers (including cache hits)."""
    from process_flow_kernel.utils import polygon
    from process_flow_kernel.domain import geometry, process_geometry_state
    counters = {"validationCalls": 0, "fullValidations": 0, "loops": 0, "vertices": 0}
    durations = {}

    def wrap(owner, name, label):
        original = getattr(owner, name)
        @functools.wraps(original)
        def measured(*a, **kw):
            started = time.perf_counter()
            try:
                return original(*a, **kw)
            finally:
                durations[label] = durations.get(label, 0) + time.perf_counter() - started
        setattr(owner, name, measured)
        return original, measured

    original = polygon._validate_loop_boundaries_do_not_cross
    def boundaries(loops):
        counters["fullValidations"] += 1
        counters["loops"] += len(loops)
        counters["vertices"] += sum(map(len, loops))
        return original(loops)
    polygon._validate_loop_boundaries_do_not_cross = boundaries
    validate = polygon.validate_polygon_loops
    def validation(*a, **kw):
        counters["validationCalls"] += 1
        started = time.perf_counter()
        try:
            return validate(*a, **kw)
        finally:
            durations["validation"] = durations.get("validation", 0) + time.perf_counter() - started
    for module in tuple(sys.modules.values()):
        if module is not None and getattr(module, "__name__", "").startswith("process_flow"):
            for name, value in tuple(vars(module).items()):
                if value is validate:
                    setattr(module, name, validation)
    wrap(process_geometry_state, "_underfill_gap_polygons", "underfillRegion")
    wrap(process_geometry_state.ProcessGeometryState, "apply_under_fill", "underfill")
    wrap(geometry.PolygonGeometry, "__init__", "polygonConstruction")
    wrap(process_geometry_state.ProcessGeometryState, "snapshot", "snapshot")
    return lambda: {**counters, "seconds": dict(durations)}


def digest(value):
    encoder = json.JSONEncoder(sort_keys=True, separators=(",", ":"), allow_nan=False)
    result = hashlib.sha256()
    for chunk in encoder.iterencode(value):
        result.update(chunk.encode())
    return result.hexdigest()


class ReadOnlyStore:
    def __init__(self, database):
        self.connection = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)

    def get(self, table, key):
        row = self.connection.execute(f"SELECT payload FROM {table} WHERE id=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def get_process_flow(self, key):
        return self.get("process_flows", key)

    def get_process_step_template(self, key):
        return self.get("process_step_templates", key)

    def get_geometry(self, key):
        return self.get("geometries", key)


async def worker(args):
    # Importing process_flow_api constructs its default application. Keep that
    # incidental application isolated from the user's databases.
    os.environ["PROCESS_FLOW_API_DB_PATH"] = ":memory:"
    os.environ["PROCESS_FLOW_API_ANALYTICS_DB_PATH"] = ":memory:"
    from process_flow_api import preview_sessions as sessions
    from process_flow_api.models import GeometryPreviewRequest
    from process_flow_geometry_generators import GeometryGeneratorRegistry, register_builtin_generators
    from process_flow_kernel.utils import polygon
    from process_flow_kernel import GeometryKernel
    from process_flow_kernel.serialization.immutable import thaw
    metrics = polygon_metrics()

    store = ReadOnlyStore(args.db)
    if args.flow_id:
        flow_id = args.flow_id
    else:
        candidates = store.connection.execute(
            "SELECT id FROM process_flows WHERE name=?", (args.flow_name,)
        ).fetchall()
        if len(candidates) != 1:
            raise ValueError("--flow-name must identify exactly one flow; otherwise use --flow-id")
        flow_id = candidates[0][0]
    flow = store.get_process_flow(flow_id)
    if flow is None:
        raise ValueError(f"Unknown flow: {flow_id}")
    stages = {}
    captured = []
    executions = []
    execute = GeometryKernel.execute

    @functools.wraps(execute)
    def measured_execute(self, *a, **kw):
        started = time.perf_counter()
        result = execute(self, *a, **kw)
        stages["kernel"] = time.perf_counter() - started
        executions.append(result.execution_statistics())
        return result

    GeometryKernel.execute = measured_execute

    def instrument(name):
        original = getattr(sessions, name)
        if inspect.iscoroutinefunction(original):
            @functools.wraps(original)
            async def wrapped(*a, **kw):
                started = time.perf_counter()
                result = await original(*a, **kw)
                stages[name] = time.perf_counter() - started
                if name == "materialize_preview_snapshots":
                    captured.extend(result)
                print(f"{name}: {stages[name]:.3f}s", flush=True)
                return result
        else:
            @functools.wraps(original)
            def wrapped(*a, **kw):
                started = time.perf_counter()
                result = original(*a, **kw)
                stages[name] = time.perf_counter() - started
                print(f"{name}: {stages[name]:.3f}s", flush=True)
                return result
        setattr(sessions, name, wrapped)

    for name in ("prepare_preview_execution", "materialize_preview_snapshots",
                 "plan_flow_schematic", "bind_schematic_snapshots", "build_schematic"):
        instrument(name)
    payload_original = sessions.PreviewSessionRecord.payload
    @functools.wraps(payload_original)
    def payload_record(self):
        started = time.perf_counter()
        try:
            return payload_original(self)
        finally:
            stages["payloadDeepcopy"] = time.perf_counter() - started
    sessions.PreviewSessionRecord.payload = payload_record
    registry = GeometryGeneratorRegistry()
    register_builtin_generators(registry)
    manager = sessions.PreviewSessionManager(geometry_generators=registry,
                                            step_cache_enabled=args.step_cache != "off")
    request = GeometryPreviewRequest.model_validate({
        "flowId": flow_id,
        "target": {"type": "stepOutput", "stepRefId": args.target,
                   "outputPortId": "result_geometry"},
    })
    try:
        started = time.perf_counter()
        payload = await manager.create_session(store, request)
        elapsed = time.perf_counter() - started
        provenance = {snapshot.step_ref_id: thaw(snapshot.provenance) for snapshot in captured}
        checks = {
            "geometry": {snapshot.step_ref_id: sessions.content_hash(snapshot.geometry_structure) for snapshot in captured},
            "provenance": {key: digest(value) for key, value in provenance.items()},
            "executionWarnings": {snapshot.step_ref_id: digest(snapshot.execution_warnings)
                                  for snapshot in captured},
            "schematic": {snapshot["stepRefId"]: digest(snapshot["schematic"])
                          for snapshot in payload["snapshots"]},
            "schematicWarnings": {snapshot["stepRefId"]: digest(snapshot["schematicWarnings"])
                                  for snapshot in payload["snapshots"]},
        }
        if args.capture:
            with gzip.open(args.capture, "wt", encoding="utf-8") as output:
                json.dump({"session": payload, "provenance": provenance}, output,
                          sort_keys=True, separators=(",", ":"), allow_nan=False)
        encoded = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode()
        info = getattr(polygon, "_polygon_cache_info", None)
        cache_info = info() if info is not None else None
        if hasattr(cache_info, "_asdict"):
            cache_info = cache_info._asdict()
        result = {
            "flowId": flow_id, "flowName": flow["name"], "target": args.target,
            "flowContentHash": digest({key: flow[key] for key in ("definition", "configuration")}),
            "seconds": elapsed, "stages": dict(stages), "snapshots": len(payload["snapshots"]),
            "responseBytes": len(encoded), "checks": checks, "executionSnapshots": len(captured),
            "polygonModule": str(Path(polygon.__file__).resolve()), "polygonCache": cache_info,
            "stepCacheMode": args.step_cache, "execution": executions[-1],
            "snapshotMaterializationSeconds": stages["materialize_preview_snapshots"] - stages["kernel"],
            "polygonMetrics": metrics(),
            "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024),
        }
        if len(payload["snapshots"]) != 1 or payload["snapshots"][0]["stepRefId"] != args.target:
            raise RuntimeError("HTTP preview must contain only the selected target snapshot")
        stages.clear()
        cached_started = time.perf_counter()
        repeated = await manager.create_session(store, request)
        result["sessionCacheHit"] = {"seconds": time.perf_counter()-cached_started, "stages": dict(stages)}
        if repeated != payload:
            raise RuntimeError("Session cache changed the response")
        if args.step_cache == "warm":
            targets = (args.warm_targets.split(",") if args.warm_targets else
                       [snapshot.step_ref_id for snapshot in captured[-6:-1]])
            if len(set(targets)) < 5 or args.target in targets:
                raise ValueError("Warm measurement requires at least five distinct upstream targets")
            warm = []
            for target in targets:
                captured.clear()
                stages.clear()
                before_metrics = metrics()
                request = GeometryPreviewRequest.model_validate({"flowId": flow_id, "target": {
                    "type": "stepOutput", "stepRefId": target, "outputPortId": "result_geometry"}})
                started = time.perf_counter()
                warm_payload = await manager.create_session(store, request)
                duration = time.perf_counter() - started
                if executions[-1]["executedSteps"] != 0 or "kernel" not in stages:
                    raise RuntimeError("Warm target must reuse every required step through the kernel")
                for source in captured:
                    key = source.step_ref_id
                    if (sessions.content_hash(source.geometry_structure) != checks["geometry"][key] or
                        digest(thaw(source.provenance)) != checks["provenance"][key] or
                        digest(source.execution_warnings) != checks["executionWarnings"][key]):
                        raise RuntimeError(f"Warm output differs at {key}")
                if len(warm_payload["snapshots"]) != 1 or warm_payload["snapshots"][0]["stepRefId"] != target:
                    raise RuntimeError("Warm response must contain only the requested target")
                warm.append({"target": target, "seconds": duration, "stages": dict(stages),
                             "execution": executions[-1],
                             "responseBytes": len(json.dumps(warm_payload, separators=(",", ":")).encode()),
                             "snapshots": len(warm_payload["snapshots"]),
                             "polygonMetrics": {
                                 **{key: metrics()[key] - before_metrics[key]
                                    for key in before_metrics if key != "seconds"},
                                 "seconds": {key: value - before_metrics["seconds"].get(key, 0)
                                             for key, value in metrics()["seconds"].items()},
                             },
                             "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024),
                             "targetSchematicHash": digest(warm_payload["snapshots"][-1]["schematic"]),
                             "targetSchematicWarningsHash": digest(warm_payload["snapshots"][-1]["schematicWarnings"])})
            result["warm"] = warm
            result["warmKernelMedianSeconds"] = statistics.median(row["stages"]["kernel"] for row in warm)
        result["stepCache"] = manager.step_cache_info()
        Path(args.output).write_text(json.dumps(result, indent=2))
        print(f"RESULT {flow['name']}: {elapsed:.3f}s; {len(payload['snapshots'])} snapshots", flush=True)
    finally:
        await manager.shutdown()
        store.connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True)
    flow = parser.add_mutually_exclusive_group(required=True)
    flow.add_argument("--flow-id")
    flow.add_argument("--flow-name")
    parser.add_argument("--target", required=True)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--output", required=True, help="JSON report path; parent must exist")
    parser.add_argument("--capture", help="First-run full session/provenance capture, .json.gz")
    parser.add_argument("--compare", help="Prior report whose complete correctness hashes must match")
    parser.add_argument("--step-cache", choices=("off", "cold", "warm"), default="off")
    parser.add_argument("--warm-targets", help="Comma-separated distinct upstream targets (at least five)")
    parser.add_argument("--compare-execution-only", action="store_true",
                        help="Allow intentional schematic/transport changes; still compare every execution output")
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    if args.worker:
        asyncio.run(worker(args))
        return
    reports = []
    output = Path(args.output)
    for index in range(args.runs):
        run_output = output.with_name(f"{output.stem}.run-{index + 1}.json")
        command = [sys.executable, str(Path(__file__).resolve()), "--worker", "--db", args.db,
                   "--target", args.target, "--output", str(run_output), "--step-cache", args.step_cache]
        if args.warm_targets:
            command.extend(["--warm-targets", args.warm_targets])
        command.extend(["--flow-id", args.flow_id] if args.flow_id else ["--flow-name", args.flow_name])
        if index == 0 and args.capture:
            command.extend(["--capture", args.capture])
        print(f"Cold run {index + 1}/{args.runs}", flush=True)
        subprocess.run(command, check=True)
        reports.append(json.loads(run_output.read_text()))
        if reports[-1]["checks"] != reports[0]["checks"]:
            raise RuntimeError("Correctness hashes differ between cold runs")
    result = {"runs": reports, "medianSeconds": statistics.median(row["seconds"] for row in reports)}
    result["kernelMedianSeconds"] = statistics.median(row["stages"]["kernel"] for row in reports)
    if args.compare:
        baseline = json.loads(Path(args.compare).read_text())
        first = baseline["runs"][0]
        check_keys = ("geometry", "provenance", "executionWarnings") if args.compare_execution_only else tuple(first["checks"])
        result["comparisonScope"] = "execution" if args.compare_execution_only else "full"
        result["matchesBaseline"] = (first["flowContentHash"] == reports[0]["flowContentHash"]
                                      and all(first["checks"][key] == reports[0]["checks"][key] for key in check_keys))
        result["speedup"] = baseline["medianSeconds"] / result["medianSeconds"]
        if all("kernel" in row["stages"] for row in baseline["runs"]):
            result["kernelSpeedup"] = statistics.median(
                row["stages"]["kernel"] for row in baseline["runs"]
            ) / result["kernelMedianSeconds"]
        if not result["matchesBaseline"]:
            output.write_text(json.dumps(result, indent=2))
            raise RuntimeError("Flow, geometry, provenance, warnings or schematic differs from baseline")
    output.write_text(json.dumps(result, indent=2))
    print(json.dumps({key: value for key, value in result.items() if key != "runs"}), flush=True)


if __name__ == "__main__":
    main()
