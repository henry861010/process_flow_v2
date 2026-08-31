from __future__ import annotations

import copy
import hashlib
import json
import threading
import uuid
from collections import OrderedDict
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
        registered = generators or (HbmGenerator(), DramGenerator())
        self._generators: dict[str, GeometryGenerator] = {}
        for generator in registered:
            definition = generator.definition()
            generator_id = definition.get("id")
            if not isinstance(generator_id, str) or generator_id == "":
                raise ValueError("Geometry generator definition requires id")
            if generator_id in self._generators:
                raise ValueError(f"Duplicate geometry generator: {generator_id}")
            self._generators[generator_id] = generator
        self._preview_capacity = max(1, preview_capacity)
        self._previews: OrderedDict[str, JsonObject] = OrderedDict()
        self._lock = threading.Lock()

    def definitions(self) -> list[JsonObject]:
        return [copy.deepcopy(generator.definition()) for generator in self._generators.values()]

    def definition(self, generator_id: str) -> JsonObject:
        return copy.deepcopy(self._require(generator_id).definition())

    def preview(
        self,
        generator_id: str,
        parameters: JsonObject,
        *,
        generator_version: int | None = None,
    ) -> JsonObject:
        generator = self._require(generator_id)
        definition = generator.definition()
        expected_version = int(definition["version"])
        if generator_version is not None and generator_version != expected_version:
            raise ValueError(
                f"Geometry generator {generator_id} version {generator_version} is not available; "
                f"expected version {expected_version}"
            )
        merged_parameters = copy.deepcopy(definition.get("defaultParameters", {}))
        merged_parameters.update(copy.deepcopy(parameters))
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
        entity = {
            "id": None,
            "name": definition["label"],
            "entityType": definition["entityType"],
            "category": definition.get("category"),
            "icon": definition.get("icon"),
            "structureFormat": "standard",
            "structure": evaluation.geometry_structure,
            "generation": {
                "generatorId": generator_id,
                "schemaVersion": expected_version,
                "parameters": evaluation.normalized_parameters,
            },
            "adaptationContract": copy.deepcopy(definition["adaptationContract"]),
        }
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

    def _require(self, generator_id: str) -> GeometryGenerator:
        generator = self._generators.get(generator_id)
        if generator is None:
            raise KeyError(generator_id)
        return generator


def _geometry_hash(structure: JsonObject) -> str:
    canonical = json.dumps(
        structure,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"
