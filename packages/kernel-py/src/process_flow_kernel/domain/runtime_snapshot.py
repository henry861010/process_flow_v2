"""Detached, immutable execution state with a validated runtime restore path."""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import TYPE_CHECKING, Any

from .geometry import PolygonGeometry, PolygonSnapshot
from .provenance import structure_nodes
from ..serialization.immutable import FrozenMap, freeze, thaw
from ..serialization.schema import normalize_geometry_structure


if TYPE_CHECKING:
    from .process_geometry_state import ProcessGeometryState


@dataclass(frozen=True, slots=True)
class RuntimeGeometrySnapshot:
    structure: FrozenMap
    root: FrozenMap
    provenance: FrozenMap
    cursor_z: float
    footprint: FrozenMap | None
    provenance_step: tuple[str, str] | None
    provenance_ordinal: int
    polygons: Mapping[str, PolygonSnapshot]
    footprint_polygon: PolygonSnapshot | None = None

    def __post_init__(self) -> None:
        for name in ("structure", "root", "provenance", "footprint", "provenance_step"):
            object.__setattr__(self, name, freeze(getattr(self, name)))
        if any(not isinstance(polygon, PolygonSnapshot) for polygon in self.polygons.values()):
            raise TypeError("Runtime snapshot polygons must be PolygonSnapshot values")
        object.__setattr__(self, "polygons", MappingProxyType(dict(self.polygons)))

    @classmethod
    def capture(cls, state: ProcessGeometryState) -> RuntimeGeometrySnapshot:
        from .process_geometry_state import _validate_structure_ids

        raw = {
            "schemaVersion": state._schema_version,
            "unitSystem": state._unit_system,
            "root": state._root.tree_json(),
        }
        structure = normalize_geometry_structure(raw)
        _validate_structure_ids(structure["root"])
        provenance, polygons = {}, {}
        for node, payload, normalized in zip(
            state._provenance_nodes(), structure_nodes(raw), structure_nodes(structure), strict=True,
        ):
            state._ensure_node_provenance(node)
            node_id = normalized["id"]
            payload["id"] = node_id
            provenance[node_id] = freeze(node._provenance)
            geometry = getattr(node, "_geometry", None)
            if isinstance(geometry, PolygonGeometry):
                polygons[node_id] = geometry.polygon_snapshot()
        return cls(
            structure=freeze(structure),
            root=freeze(raw["root"]),
            provenance=freeze(provenance),
            cursor_z=state._cursor_z,
            footprint=freeze(state._process_footprint),
            provenance_step=state._provenance_step,
            provenance_ordinal=state._provenance_ordinal,
            polygons=polygons,
            footprint_polygon=getattr(state._process_footprint, "polygon", None),
        )

    def restore(self, provenance: Mapping[str, Any] | None = None) -> ProcessGeometryState:
        from .process_geometry_state import ProcessGeometryState, _PolygonFootprint, _container_from_payload, _geometry_from_payload

        def geometry(payload, node_id):
            if node_id in self.polygons:
                return PolygonGeometry(self.polygons[node_id], payload["thk"])
            return _geometry_from_payload(thaw(payload))

        state = ProcessGeometryState(
            root=_container_from_payload(self.root, geometry_loader=geometry),
            cursor_z=self.cursor_z,
            process_footprint=(_PolygonFootprint(self.footprint_polygon) if self.footprint_polygon is not None else thaw(self.footprint)),
            schema_version=self.structure["schemaVersion"],
            unit_system=self.structure["unitSystem"],
        )
        lineage = self.provenance if provenance is None else provenance
        for node in state._provenance_nodes():
            entry = lineage.get(node._structure_id)
            if entry is not None:
                node._provenance = freeze(entry)
        state._provenance_step = self.provenance_step
        state._provenance_ordinal = self.provenance_ordinal
        return state
