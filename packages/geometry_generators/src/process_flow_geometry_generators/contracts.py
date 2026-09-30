from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


JsonObject = dict[str, Any]


@dataclass(frozen=True, slots=True)
class GeneratorEvaluation:
    normalized_parameters: JsonObject
    computed_parameters: JsonObject
    geometry_structure: JsonObject


class GeometryGenerator(Protocol):
    def definition(self) -> JsonObject:
        ...

    def validate(self, parameters: JsonObject) -> JsonObject:
        ...

    def evaluate(self, parameters: JsonObject) -> GeneratorEvaluation:
        ...
