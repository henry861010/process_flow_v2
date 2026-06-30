from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .builder import MeshResult


def write_cdb_text(output_path: str | Path, mesh: MeshResult) -> dict[str, object]:
    """Write a placeholder text CDB containing raw mesh arrays.

    This is intentionally not an ANSYS CDB implementation yet. It preserves the
    mesher output in a stable, line-oriented text format so the real writer can
    replace this function later without changing the API/job plumbing.
    """
    path = Path(output_path)
    with path.open("w", encoding="utf-8", buffering=1024 * 1024) as handle:
        handle.write("# Process Flow placeholder CDB export\n")
        handle.write("# Format: raw numpy array dump for future ANSYS CDB writer replacement\n")
        handle.write(f"node_count={mesh.node_count}\n")
        handle.write(f"element_count={mesh.element_count}\n")
        handle.write(f"component_count={mesh.component_count}\n")

        handle.write("\n*NODES,index,x,y,z\n")
        for node_index, node in enumerate(np.asarray(mesh.nodes)):
            handle.write(
                f"{node_index},{_format_float(node[0])},{_format_float(node[1])},{_format_float(node[2])}\n"
            )

        handle.write("\n*ELEMENTS,index,n0,n1,n2,n3,n4,n5,n6,n7\n")
        for element_index, element in enumerate(np.asarray(mesh.elements)):
            nodes = ",".join(str(int(node_id)) for node_id in element)
            handle.write(f"{element_index},{nodes}\n")

        handle.write("\n*ELEMENT_COMP,index,component_id\n")
        for element_index, component_id in enumerate(np.asarray(mesh.element_comps)):
            handle.write(f"{element_index},{int(component_id)}\n")

        handle.write("\n*COMPS,component_id,name\n")
        for name, component_id in sorted(mesh.comps.items(), key=lambda item: item[1]):
            handle.write(f"{int(component_id)},{json.dumps(str(name), ensure_ascii=False)}\n")

    return {
        "outputPath": str(path),
        "nodeCount": mesh.node_count,
        "elementCount": mesh.element_count,
        "componentCount": mesh.component_count,
    }


def _format_float(value: object) -> str:
    return f"{float(value):.12g}"

