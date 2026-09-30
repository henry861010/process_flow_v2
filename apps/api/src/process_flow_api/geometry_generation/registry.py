from __future__ import annotations

import copy
import hashlib
import json
import threading
import uuid
from collections import OrderedDict
from collections.abc import Mapping
from typing import Any

from .contracts import GeometryGenerator, JsonObject
from .dram import DramGenerator
from .engineering_preview import build_engineering_preview
from .hbm import HbmGenerator


class GeometryGeneratorRegistry:
    def __init__(
        self,
        generators: tuple[GeometryGenerator, ...] | None = None,
        *,
        preview_capacity: int = 128,
    ):
        registered = generators if generators is not None else (HbmGenerator(), DramGenerator())
        self._generators: dict[tuple[str, int], GeometryGenerator] = {}
        self._latest_versions: dict[str, int] = {}
        for generator in registered:
            definition = generator.definition()
            generator_id = definition.get("id")
            if not isinstance(generator_id, str) or generator_id == "":
                raise ValueError("Geometry generator definition requires id")
            version = definition.get("version")
            if isinstance(version, bool) or not isinstance(version, int) or version < 1:
                raise ValueError(f"Geometry generator {generator_id} requires a positive version")
            key = (generator_id, version)
            if key in self._generators:
                raise ValueError(f"Duplicate geometry generator: {generator_id} v{version}")
            self._generators[key] = generator
            self._latest_versions[generator_id] = max(
                version, self._latest_versions.get(generator_id, 0)
            )
        self._preview_capacity = max(1, preview_capacity)
        self._previews: OrderedDict[str, JsonObject] = OrderedDict()
        self._lock = threading.Lock()

    def definitions(self) -> list[JsonObject]:
        return [self.definition(generator_id) for generator_id in self._latest_versions]

    def definition(self, generator_id: str, generator_version: int | None = None) -> JsonObject:
        return copy.deepcopy(self._require(generator_id, generator_version).definition())

    def generate(
        self,
        generator_id: str,
        generator_version: int,
        parameters: Mapping[str, Any],
    ) -> JsonObject:
        generator = self._require(generator_id, generator_version)
        definition = generator.definition()
        merged = self._merged_parameters(definition, parameters)
        errors = generator.validate(merged)
        if errors:
            raise ValueError(f"Invalid geometry generator {generator_id} parameters: {errors}")
        evaluation = generator.evaluate(merged)
        return self._geometry_entity(definition, evaluation)

    def preview(
        self,
        generator_id: str,
        parameters: JsonObject,
        *,
        generator_version: int | None = None,
    ) -> JsonObject:
        try:
            generator = self._require(generator_id, generator_version)
        except KeyError:
            if generator_id not in self._latest_versions:
                raise
            raise ValueError(
                f"Geometry generator {generator_id} version {generator_version} is not available; "
                f"expected version {self._latest_versions[generator_id]}"
            ) from None
        definition = generator.definition()
        expected_version = int(definition["version"])
        merged_parameters = self._merged_parameters(definition, parameters)
        errors = generator.validate(merged_parameters)
        if errors:
            return {
                "generatorId": generator_id,
                "generatorVersion": expected_version,
                "valid": False,
                "errors": errors,
                "normalizedParameters": merged_parameters,
                "computedParameters": {},
                "engineeringPreview": None,
                "geometryHash": None,
                "previewToken": None,
                "geometryEntityJson": None,
            }

        evaluation = generator.evaluate(merged_parameters)
        geometry_hash = _geometry_hash(evaluation.geometry_structure)
        entity = self._geometry_entity(definition, evaluation)
        token = f"generator_preview_{uuid.uuid4().hex}"
        result = {
            "generatorId": generator_id,
            "generatorVersion": expected_version,
            "valid": True,
            "errors": {},
            "normalizedParameters": evaluation.normalized_parameters,
            "computedParameters": evaluation.computed_parameters,
            "engineeringPreview": build_engineering_preview(
                evaluation.geometry_structure
            ),
            "geometryHash": geometry_hash,
            "previewToken": token,
            "geometryEntityJson": entity,
        }
        with self._lock:
            self._previews[token] = copy.deepcopy(result)
            self._previews.move_to_end(token)
            while len(self._previews) > self._preview_capacity:
                self._previews.popitem(last=False)
        return result

    def materialize(self, preview_token: str) -> JsonObject:
        with self._lock:
            result = self._previews.get(preview_token)
            if result is None:
                raise KeyError(preview_token)
            self._previews.move_to_end(preview_token)
            return copy.deepcopy(result)

    def clear(self) -> None:
        with self._lock:
            self._previews.clear()

    def _require(self, generator_id: str, generator_version: int | None = None) -> GeometryGenerator:
        version = generator_version if generator_version is not None else self._latest_versions.get(generator_id)
        generator = self._generators.get((generator_id, version))
        if generator is None:
            raise KeyError((generator_id, generator_version))
        return generator

    @staticmethod
    def _merged_parameters(definition: JsonObject, parameters: Mapping[str, Any]) -> JsonObject:
        merged = copy.deepcopy(definition.get("defaultParameters", {}))
        merged.update(copy.deepcopy(dict(parameters)))
        return merged

    @staticmethod
    def _geometry_entity(definition: JsonObject, evaluation) -> JsonObject:
        return {
            "id": None,
            "name": definition["label"],
            "entityType": definition["entityType"],
            "category": definition.get("category"),
            "dim": _dimension_label(
                evaluation.normalized_parameters, evaluation.computed_parameters
            ),
            "icon": definition.get("icon"),
            "structureFormat": "standard",
            "structure": evaluation.geometry_structure,
            "generation": {
                "generatorId": definition["id"],
                "schemaVersion": definition["version"],
                "parameters": evaluation.normalized_parameters,
            },
            "adaptationContract": copy.deepcopy(definition["adaptationContract"]),
        }


def _geometry_hash(structure: JsonObject) -> str:
    canonical = json.dumps(
        structure,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _dimension_label(parameters: JsonObject, computed: JsonObject) -> str:
    values = (
        parameters.get("packageX"),
        parameters.get("packageY"),
        computed.get("totalThickness"),
    )
    if not all(
        isinstance(value, (int, float)) and not isinstance(value, bool)
        for value in values
    ):
        return ""
    return " x ".join(format(float(value), ".15g") for value in values) + " um"
