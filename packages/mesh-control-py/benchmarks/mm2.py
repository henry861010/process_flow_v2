"""Run from the repository root with venv/bin/python and report MM2 timings."""
from __future__ import annotations

import argparse
import json
import math
import time
from unittest.mock import patch

from process_flow_kernel import ProcessGeometryState
from process_flow_mesh_control import MeshControlSetRegistry, validate_mesh_control


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--containers", type=int, default=662, help="Total containers including root")
    parser.add_argument("--targets", type=int, default=75)
    parser.add_argument("--polygon-vertices", type=int, default=0, help="Vertices in one extra root polygon")
    args = parser.parse_args()
    if not 0 <= args.targets < args.containers or (args.polygon_vertices != 0 and args.polygon_vertices < 3):
        parser.error("require 0 <= targets < containers and polygon-vertices either 0 or >= 3")
    children = [{
        "id": f"c{i}", **({"key": "hbm"} if i < args.targets else {}),
        "bodies": [{"id": f"b{i}", "material": "Si", "geometry": {
            "type": "BoxGeometry", "bottom_left": [i * 100, 0, 0],
            "top_right": [i * 100 + 40, 40, 0], "thk": 300,
        }}],
    } for i in range(args.containers - 1)]
    root = {"id": "root", "children": children}
    if args.polygon_vertices:
        root["bodies"] = [{"id": "polygon", "material": "Si", "geometry": {
            "type": "PolygonGeometry", "polys": [[
                [100 * math.cos(2 * math.pi * i / args.polygon_vertices),
                 100 * math.sin(2 * math.pi * i / args.polygon_vertices), 0]
                for i in range(args.polygon_vertices)
            ]], "thk": 10,
        }}]
    started = time.perf_counter()
    state = ProcessGeometryState.from_structure({"schemaVersion": "1.0.0", "unitSystem": "um", "root": root})
    restore_seconds = time.perf_counter() - started
    with patch.object(state, "find_geometry", wraps=state.find_geometry) as query:
        started = time.perf_counter()
        _, result = MeshControlSetRegistry().apply("meshModel2", state)
        build_seconds = time.perf_counter() - started
        build_queries = query.call_count
        started = time.perf_counter()
        validate_mesh_control(result.mesh_control, state=state)
        validation_seconds = time.perf_counter() - started
        validation_queries = query.call_count - build_queries
    print(json.dumps({
        "containers": args.containers, "targets": args.targets, "polygon_vertices": args.polygon_vertices,
        "regions": sum(c["method"] == "3D_REGION" for c in result.mesh_control["controls"]),
        "restore_seconds": restore_seconds, "build_seconds": build_seconds,
        "validation_seconds": validation_seconds, "build_and_validation_seconds": build_seconds + validation_seconds,
        "build_queries": build_queries, "validation_queries": validation_queries,
    }, indent=2))


if __name__ == "__main__":
    main()
