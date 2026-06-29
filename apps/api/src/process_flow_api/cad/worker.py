from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path

from .exporter import CadExportError, export_cad_bytes


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 3:
        print(
            "Usage: python -m process_flow_api.cad.worker "
            "<format> <input-json> <output-file>",
            file=sys.stderr,
        )
        return 2

    export_format, input_path, output_path = args
    try:
        geometry_structure = json.loads(Path(input_path).read_text(encoding="utf-8"))
        output = export_cad_bytes(geometry_structure, format=export_format)
        Path(output_path).write_bytes(output)
    except CadExportError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception:
        print(traceback.format_exc(), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
