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
from pathlib import Path
import sqlite3
import statistics
import subprocess
import sys
import time


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
    registry = GeometryGeneratorRegistry()
    register_builtin_generators(registry)
    manager = sessions.PreviewSessionManager(geometry_generators=registry)
    request = GeometryPreviewRequest.model_validate({
        "flowId": flow_id,
        "target": {"type": "stepOutput", "stepRefId": args.target,
                   "outputPortId": "result_geometry"},
    })
    try:
        started = time.perf_counter()
        payload = await manager.create_session(store, request)
        elapsed = time.perf_counter() - started
        provenance = {snapshot.step_ref_id: snapshot.provenance for snapshot in captured}
        checks = {
            "geometry": {snapshot["stepRefId"]: snapshot["geometryHash"] for snapshot in payload["snapshots"]},
            "provenance": {key: digest(value) for key, value in provenance.items()},
            "executionWarnings": {snapshot["stepRefId"]: digest(snapshot["executionWarnings"])
                                  for snapshot in payload["snapshots"]},
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
            "seconds": elapsed, "stages": stages, "snapshots": len(payload["snapshots"]),
            "responseBytes": len(encoded), "checks": checks,
            "polygonModule": str(Path(polygon.__file__).resolve()), "polygonCache": cache_info,
        }
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
                   "--target", args.target, "--output", str(run_output)]
        command.extend(["--flow-id", args.flow_id] if args.flow_id else ["--flow-name", args.flow_name])
        if index == 0 and args.capture:
            command.extend(["--capture", args.capture])
        print(f"Cold run {index + 1}/{args.runs}", flush=True)
        subprocess.run(command, check=True)
        reports.append(json.loads(run_output.read_text()))
        if reports[-1]["checks"] != reports[0]["checks"]:
            raise RuntimeError("Correctness hashes differ between cold runs")
    result = {"runs": reports, "medianSeconds": statistics.median(row["seconds"] for row in reports)}
    if args.compare:
        baseline = json.loads(Path(args.compare).read_text())
        first = baseline["runs"][0]
        result["matchesBaseline"] = (first["flowContentHash"] == reports[0]["flowContentHash"]
                                      and first["checks"] == reports[0]["checks"])
        result["speedup"] = baseline["medianSeconds"] / result["medianSeconds"]
        if not result["matchesBaseline"]:
            output.write_text(json.dumps(result, indent=2))
            raise RuntimeError("Flow, geometry, provenance, warnings or schematic differs from baseline")
    output.write_text(json.dumps(result, indent=2))
    print(json.dumps({key: value for key, value in result.items() if key != "runs"}), flush=True)


if __name__ == "__main__":
    main()
