"""Execution lineage stored alongside geometry, never in its serialized payload."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal, Mapping, TypedDict


class GeometrySourceRef(TypedDict):
    kind: Literal["flowInput", "stepOutput"]
    ownerId: str
    outputPortId: str | None
    inputPortId: str
    nodeId: str


class GeometryCreation(TypedDict):
    stepRefId: str
    program: str
    operation: str
    ordinal: int


class GeometryNodeProvenance(TypedDict):
    sources: list[GeometrySourceRef]
    createdBy: GeometryCreation | None


GeometryProvenance = dict[str, GeometryNodeProvenance]


def structure_nodes(structure: Mapping[str, Any]):
    def visit(container):
        yield container
        for collection in ("bodies", "vias", "circuits", "bumps"):
            yield from container.get(collection, ())
        for child in container.get("children", ()):
            yield from visit(child)

    yield from visit(structure["root"])


def copy_node_provenance(source, target):
    """Keep lineage across a geometry object's copy/replacement operation."""
    value = getattr(source, "_provenance", None)
    if value is not None:
        target._provenance = deepcopy(value)
    return target


def qualify_provenance(
    structure: Mapping[str, Any],
    provenance: Mapping[str, GeometryNodeProvenance] | None = None,
    *,
    kind: Literal["flowInput", "stepOutput"],
    owner_id: str,
    output_port_id: str | None = None,
    input_port_id: str = "",
) -> GeometryProvenance:
    """Add an immediate, source-qualified input identity to inherited origins."""
    result: GeometryProvenance = {}
    for node in structure_nodes(structure):
        node_id = node["id"]
        entry = deepcopy((provenance or {}).get(node_id, {"sources": [], "createdBy": None}))
        source: GeometrySourceRef = {
            "kind": kind,
            "ownerId": owner_id,
            "outputPortId": output_port_id,
            "inputPortId": input_port_id,
            "nodeId": node_id,
        }
        if source not in entry["sources"]:
            entry["sources"].append(source)
        result[node_id] = entry
    return result
