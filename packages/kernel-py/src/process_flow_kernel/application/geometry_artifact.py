from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field, replace
from typing import Any
from types import MappingProxyType

from ..utils.polygon import PolygonSnapshot
from ..serialization.polygon_hydration import parse_polygon_structure, polygon_features

from ..serialization.schema import deep_copy, normalize_geometry_structure
from ..domain.process_geometry_state import ProcessGeometryState
from ..domain.provenance import structure_nodes
from ..domain.runtime_snapshot import RuntimeGeometrySnapshot
from ..serialization.immutable import freeze, thaw


JsonObject = dict[str, Any]


@dataclass(frozen=True, slots=True, weakref_slot=True)
class GeometryArtifact(Mapping[str, Any]):
    structure: Mapping[str, Any]
    source_geometry_id: str | None = None
    entity_type: str | None = None
    category: str | None = None
    generation: Mapping[str, Any] | None = None
    adaptation_contract: Mapping[str, Any] | None = None
    runtime_snapshot: RuntimeGeometrySnapshot | None = field(
        default=None,
        repr=False,
        compare=False,
    )
    provenance: Mapping[str, Mapping[str, Any]] = field(default_factory=dict, repr=False, compare=False)

    polygons: Mapping[str, PolygonSnapshot] | None = field(default=None, repr=False, compare=False)

    def __post_init__(self):
        if self.polygons is None:
            structure, polygons = parse_polygon_structure(self.structure)
            object.__setattr__(self, "structure", structure)
        else:
            polygons = dict(self.polygons)
        if any(not isinstance(value, PolygonSnapshot) for value in polygons.values()):
            raise TypeError("Artifact polygons require runtime PolygonSnapshot values")
        object.__setattr__(self, "polygons", MappingProxyType(polygons))
        for name in ("structure", "provenance", "generation", "adaptation_contract"):
            object.__setattr__(self, name, freeze(getattr(self, name)))

    @classmethod
    def from_state(cls, state: ProcessGeometryState, *, source=None):
        snapshot = state.snapshot()
        provenance = snapshot.provenance
        if source is not None:
            inherited = {
                node_id: source.provenance[node_id]
                for node_id, entry in provenance.items()
                if not entry["sources"] and entry["createdBy"] is None and node_id in source.provenance
            }
            if inherited:
                provenance = freeze({**provenance, **inherited})
                snapshot = replace(snapshot, provenance=provenance)
        if source is None:
            return cls(structure=snapshot.structure, runtime_snapshot=snapshot, provenance=provenance, polygons=snapshot.polygons)
        return replace(source, structure=snapshot.structure, runtime_snapshot=snapshot, provenance=provenance, polygons=snapshot.polygons)

    def fork_state(self):
        if self.runtime_snapshot is not None:
            return self.runtime_snapshot.restore(self.provenance)
        return ProcessGeometryState._from_polygon_structure(self.structure, self.polygons, {"provenance": self.provenance, "footprint": {"derive": "largestRootBody"}})

    def geometry(self):
        return thaw(self.structure)

    @classmethod
    def from_entity(
        cls,
        entity: Mapping[str, Any],
        *,
        source_geometry_id: str | None = None,
    ) -> "GeometryArtifact":
        structure = entity.get("structure")
        if not isinstance(structure, Mapping):
            raise ValueError("Geometry entity requires structure")
        return cls(
            structure=structure,
            source_geometry_id=source_geometry_id,
            entity_type=_optional_string(entity.get("entityType")),
            category=_optional_string(entity.get("category")),
            generation=_optional_mapping(entity.get("generation")),
            adaptation_contract=effective_adaptation_contract(entity),
        )

    @classmethod
    def from_structure(cls, structure: Mapping[str, Any]) -> "GeometryArtifact":
        return cls(
            structure=structure,
            adaptation_contract=None,
        )

    def with_structure(
        self,
        structure: Mapping[str, Any],
        *,
        node_id_remap: Mapping[str, str] | None = None,
    ) -> "GeometryArtifact":
        normalized, polygons = parse_polygon_structure(structure)
        node_ids = {node["id"] for node in structure_nodes(normalized)}
        return replace(
            self,
            structure=normalized,
            runtime_snapshot=None,
            polygons=polygons,
            provenance={(node_id_remap or {}).get(node_id, node_id): entry
                        for node_id, entry in self.provenance.items()
                        if (node_id_remap or {}).get(node_id, node_id) in node_ids},
        )

    def _with_material_structure(self, structure, *, node_id_remap):
        """Material preparation owns these ID/material-only changes."""
        normalized = normalize_geometry_structure(structure)
        ids = {node["id"] for node in structure_nodes(normalized)}
        return replace(self, structure=normalized, runtime_snapshot=None,
                       polygons={node_id_remap.get(k, k): v for k, v in self.polygons.items()
                                 if node_id_remap.get(k, k) in ids},
                       provenance={node_id_remap.get(k, k): v for k, v in self.provenance.items()
                                   if node_id_remap.get(k, k) in ids})

    @classmethod
    def _from_generated_structure(cls, structure, *, source=None):
        """Internal adapters own topology of their transformed output."""
        normalized = normalize_geometry_structure(structure)
        polygons = {node["id"]: PolygonSnapshot._from_generated(node["geometry"]["polys"])
                    for node, _ in polygon_features(normalized["root"])}
        if source is None:
            return cls(structure=normalized, polygons=polygons)
        ids = {node["id"] for node in structure_nodes(normalized)}
        return replace(source, structure=normalized, runtime_snapshot=None, polygons=polygons,
                       provenance={k: v for k, v in source.provenance.items() if k in ids})

    def with_provenance(self, provenance: Mapping[str, Mapping[str, Any]]) -> "GeometryArtifact":
        return replace(self, provenance=provenance)

    def descriptor(self) -> JsonObject:
        result: JsonObject = {
            "sourceGeometryId": self.source_geometry_id,
            "entityType": self.entity_type,
            "category": self.category,
            "generation": thaw(self.generation),
            "adaptationContract": thaw(self.adaptation_contract),
        }
        return {key: value for key, value in result.items() if value is not None}

    # Mapping access is read-only; geometry() is the explicit mutable JSON boundary.
    def __getitem__(self, key: str) -> Any:
        return self.structure[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self.structure)

    def __len__(self) -> int:
        return len(self.structure)


def effective_adaptation_contract(entity: Mapping[str, Any]) -> JsonObject | None:
    explicit = entity.get("adaptationContract")
    if isinstance(explicit, Mapping):
        adapter_id = explicit.get("adapterId")
        adapter_version = explicit.get("adapterVersion")
        if not isinstance(adapter_id, str) or adapter_id == "":
            raise ValueError("adaptationContract.adapterId must be a non-empty string")
        if (
            isinstance(adapter_version, bool)
            or not isinstance(adapter_version, int)
            or adapter_version < 1
        ):
            raise ValueError("adaptationContract.adapterVersion must be a positive integer")
        parameters = explicit.get("parameters", {})
        if not isinstance(parameters, Mapping):
            raise ValueError("adaptationContract.parameters must be an object")
        return {
            "adapterId": adapter_id,
            "adapterVersion": adapter_version,
            "parameters": deep_copy(dict(parameters)),
        }

    return None


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _optional_mapping(value: Any) -> Mapping[str, Any] | None:
    return deep_copy(dict(value)) if isinstance(value, Mapping) else None
