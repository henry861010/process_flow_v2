"""Text CDB writer for mesher-owned mesh arrays."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping

import numpy as np

ELEMENT_LEN = 8
NODE_LEN = 3


def write_cdb_text(
    output_path: str | Path,
    *,
    nodes: object,
    elements: object,
    element_comps: object,
    comps: Mapping[str, int],
) -> dict[str, object]:
    """Write mesh arrays to a deterministic line-oriented CDB text artifact."""
    path = Path(output_path)
    node_array = _normalize_nodes(nodes)
    element_array = _normalize_elements(elements)
    element_comp_array = _normalize_element_comps(element_comps, len(element_array))

    with path.open("w", encoding="utf-8", buffering=1024 * 1024) as handle:
        handle.write("# Process Flow CDB text export\n")
        handle.write("# Format: raw mesh array sections\n")
        handle.write(f"node_count={len(node_array)}\n")
        handle.write(f"element_count={len(element_array)}\n")
        handle.write(f"component_count={len(comps)}\n")

        handle.write("\n*NODES,index,x,y,z\n")
        for node_index, node in enumerate(node_array):
            handle.write(
                f"{node_index},{_format_float(node[0])},{_format_float(node[1])},{_format_float(node[2])}\n"
            )

        handle.write("\n*ELEMENTS,index,n0,n1,n2,n3,n4,n5,n6,n7\n")
        for element_index, element in enumerate(element_array):
            node_ids = ",".join(str(int(node_id)) for node_id in element)
            handle.write(f"{element_index},{node_ids}\n")

        handle.write("\n*ELEMENT_COMP,index,component_id\n")
        for element_index, component_id in enumerate(element_comp_array):
            handle.write(f"{element_index},{int(component_id)}\n")

        handle.write("\n*COMPS,component_id,name\n")
        for name, component_id in sorted(comps.items(), key=lambda item: item[1]):
            encoded_name = json.dumps(str(name), ensure_ascii=False)
            handle.write(f"{int(component_id)},{encoded_name}\n")

    return {
        "outputPath": str(path),
        "nodeCount": int(len(node_array)),
        "elementCount": int(len(element_array)),
        "componentCount": int(len(comps)),
    }


def _normalize_nodes(nodes: object) -> np.ndarray:
    node_array = np.asarray(nodes, dtype=np.float64)
    if node_array.ndim != 2 or node_array.shape[1] < NODE_LEN:
        raise ValueError("nodes must have shape (n, 3+) for CDB export.")
    return node_array[:, :NODE_LEN]


def _normalize_elements(elements: object) -> np.ndarray:
    element_array = np.asarray(elements, dtype=np.int32)
    if element_array.ndim != 2 or element_array.shape[1] != ELEMENT_LEN:
        raise ValueError("elements must have shape (m, 8) for CDB export.")
    return element_array


def _normalize_element_comps(element_comps: object, element_count: int) -> np.ndarray:
    element_comp_array = np.asarray(element_comps, dtype=np.int32)
    if element_comp_array.ndim != 1:
        raise ValueError("element_comps must have shape (m,) for CDB export.")
    if len(element_comp_array) != element_count:
        raise ValueError(
            "element_comps length must match element count for CDB export."
        )
    return element_comp_array


def _format_float(value: object) -> str:
    return f"{float(value):.12g}"
