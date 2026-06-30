from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

from .builder import build_mesh_from_structure
from .cdb_writer import write_cdb_text


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 3:
        print(
            "Usage: python -m process_flow_mesher.worker "
            "<geometry-structure-json> <element-size> <output-cdb>",
            file=sys.stderr,
        )
        return 2

    input_path, element_size, output_path = args
    try:
        geometry_structure = json.loads(Path(input_path).read_text(encoding="utf-8"))
        mesh = build_mesh_from_structure(
            geometry_structure,
            element_size=float(element_size),
        )
        metadata = write_cdb_text(output_path, mesh)
        print(json.dumps(metadata, separators=(",", ":")), flush=True)
    except Exception:
        print(traceback.format_exc(), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
