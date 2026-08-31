from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from ..serialization.schema import deep_copy, normalize_geometry_structure
from ..domain.process_geometry_state import ProcessGeometryState


JsonObject = dict[str, Any]


@dataclass(frozen=True, slots=True)
class GeometryArtifact(Mapping[str, Any]):
    structure: Mapping[str, Any]
    source_geometry_id: str | None = None
    entity_type: str | None = None
    category: str | None = None
    generation: Mapping[str, Any] | None = None
    adaptation_contract: Mapping[str, Any] | None = None
    runtime_state: ProcessGeometryState | None = field(
        default=None,
        repr=False,
        compare=False,
    )

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
            structure=normalize_geometry_structure(structure),
            source_geometry_id=source_geometry_id,
            entity_type=_optional_string(entity.get("entityType")),
            category=_optional_string(entity.get("category")),
            generation=_optional_mapping(entity.get("generation")),
            adaptation_contract=effective_adaptation_contract(entity),
        )

    @classmethod
    def from_structure(cls, structure: Mapping[str, Any]) -> "GeometryArtifact":
        return cls(
            structure=normalize_geometry_structure(structure),
            adaptation_contract=legacy_adaptation_contract(),
        )

    def with_structure(
        self,
        structure: Mapping[str, Any],
        *,
        preserve_runtime_state: bool = False,
    ) -> "GeometryArtifact":
        return replace(
            self,
            structure=normalize_geometry_structure(structure),
            runtime_state=self.runtime_state if preserve_runtime_state else None,
        )

    def with_runtime_state(self, state: ProcessGeometryState) -> "GeometryArtifact":
        return replace(self, runtime_state=state.clone())

    def descriptor(self) -> JsonObject:
        result: JsonObject = {
            "sourceGeometryId": self.source_geometry_id,
            "entityType": self.entity_type,
            "category": self.category,
            "generation": deep_copy(self.generation),
            "adaptationContract": deep_copy(self.adaptation_contract),
        }
        return {key: value for key, value in result.items() if value is not None}

    # Preserve the old ExecutionPlan convenience where callers index an external
    # geometry as if it were the normalized GeometryStructure.
    def __getitem__(self, key: str) -> Any:
        return self.structure[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self.structure)

    def __len__(self) -> int:
        return len(self.structure)


def effective_adaptation_contract(entity: Mapping[str, Any]) -> JsonObject:
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

    generation = entity.get("generation")
    generator_id = generation.get("generatorId") if isinstance(generation, Mapping) else None
    if generator_id == "hbm":
        return {
            "adapterId": "hbm-package",
            "adapterVersion": 1,
            "parameters": {},
        }
    if generator_id == "dram":
        return {
            "adapterId": "dram-package",
            "adapterVersion": 1,
            "parameters": {},
        }
    category = entity.get("category")
    if isinstance(category, str):
        if category == "die.hbm" or category.startswith("die.hbm."):
            return {
                "adapterId": "hbm-package",
                "adapterVersion": 1,
                "parameters": {},
            }
        if category == "die.dram" or category.startswith("die.dram."):
            return {
                "adapterId": "dram-package",
                "adapterVersion": 1,
                "parameters": {},
            }
        if category == "die.vrm" or category.startswith("die.vrm."):
            return {
                "adapterId": "rigid",
                "adapterVersion": 1,
                "parameters": {},
            }
    return legacy_adaptation_contract()


def legacy_adaptation_contract() -> JsonObject:
    return {
        "adapterId": "legacy-box-stretch",
        "adapterVersion": 1,
        "parameters": {},
    }


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _optional_mapping(value: Any) -> Mapping[str, Any] | None:
    return deep_copy(dict(value)) if isinstance(value, Mapping) else None
