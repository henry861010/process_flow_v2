"""Execution lineage stored alongside geometry, never in its serialized payload."""
from __future__ import annotations

from dataclasses import dataclass

from ..serialization.immutable import FrozenMap, FrozenRecord, freeze, thaw
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


@dataclass(frozen=True, slots=True)
class GeometrySourceSnapshot(FrozenRecord):
    """Shared lineage value; fixed fields avoid one dictionary per source ref."""
    kind: Literal["flowInput", "stepOutput"]
    ownerId: str
    outputPortId: str | None
    inputPortId: str
    nodeId: str

    _fields = ("kind", "ownerId", "outputPortId", "inputPortId", "nodeId")


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
        target._provenance = freeze(value)
    return target


def qualify_provenance_snapshot(
    structure: Mapping[str, Any],
    provenance: Mapping[str, Mapping[str, Any]] | None = None,
    *,
    kind: Literal["flowInput", "stepOutput"],
    owner_id: str,
    output_port_id: str | None = None,
    input_port_id: str = "",
) -> FrozenMap:
    """Add an immediate, source-qualified input identity to inherited origins."""
    result = {}
    for node in structure_nodes(structure):
        node_id = node["id"]
        entry = (provenance or {}).get(node_id, {"sources": (), "createdBy": None})
        source = GeometrySourceSnapshot(kind, owner_id, output_port_id, input_port_id, node_id)
        sources = tuple(freeze(item) for item in entry["sources"])
        if source not in sources:
            sources = (*sources, source)
        result[node_id] = freeze({"sources": sources, "createdBy": entry["createdBy"]})
    return freeze(result)


def qualify_provenance(structure, provenance=None, **source) -> GeometryProvenance:
    """Return detached JSON lineage at the public boundary."""
    return thaw(qualify_provenance_snapshot(structure, provenance, **source))
