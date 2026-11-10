"""External mapping contracts and lossless source normalization for package imports.

Source locations are RFC 6901 JSON Pointers, never expressions. Normalized
lengths use the geometry engine's micrometres and densities use percentages.
"""
from __future__ import annotations

from copy import deepcopy
import math
import re
from typing import Annotated, Any, Literal

from pydantic import Field, field_validator, model_validator

from .models import NonBlankString, PositiveFiniteFloat, StrictModel


def _pointer_tokens(pointer: str) -> list[str]:
    if not isinstance(pointer, str) or (pointer and not pointer.startswith("/")):
        raise ValueError(f"Invalid JSON pointer {pointer!r}: expected an empty string or '/' prefix")
    if re.search(r"~(?:[^01]|$)", pointer):
        raise ValueError(f"Invalid JSON pointer {pointer!r}: only '~0' and '~1' escapes are allowed")
    return [token.replace("~1", "/").replace("~0", "~") for token in pointer.split("/")[1:]]


def _member(document: Any, token: str, pointer: str) -> Any:
    if isinstance(document, dict):
        if token not in document:
            raise ValueError(f"JSON pointer {pointer!r}: object member {token!r} does not exist")
        return document[token]
    if isinstance(document, list):
        if not re.fullmatch(r"0|[1-9][0-9]*", token):
            raise ValueError(f"JSON pointer {pointer!r}: {token!r} is not an array index")
        # Comparing decimal strings avoids Python's integer conversion limit for
        # untrusted, extremely long index tokens.
        largest = str(len(document) - 1)
        if not document or len(token) > len(largest) or (len(token) == len(largest) and token > largest):
            raise ValueError(f"JSON pointer {pointer!r}: array index {token!r} is out of range")
        return document[int(token)]
    raise ValueError(f"JSON pointer {pointer!r}: cannot traverse a scalar value")


def read_pointer(document: Any, pointer: str) -> Any:
    """Read one exact existing JSON location (the empty pointer reads the root)."""
    current = document
    for token in _pointer_tokens(pointer):
        current = _member(current, token, pointer)
    return current


def write_pointer(document: Any, pointer: str, value: Any) -> Any:
    """Replace an existing nested location and return a copy of its former value.

    This intentionally cannot append, create missing members, or replace the
    document root. Callers pass the parameter object as the document root.
    """
    tokens = _pointer_tokens(pointer)
    if not tokens:
        raise ValueError("JSON pointer '': replacing the document root is not supported")
    parent = document
    for token in tokens[:-1]:
        parent = _member(parent, token, pointer)
    previous = deepcopy(_member(parent, tokens[-1], pointer))
    if isinstance(parent, list):
        parent[int(tokens[-1])] = deepcopy(value)
    else:
        parent[tokens[-1]] = deepcopy(value)
    return previous


def _validate_json(value: Any, pointer: str = "") -> None:
    if isinstance(value, dict):
        for key, member in value.items():
            if not isinstance(key, str):
                raise ValueError(f"Source JSON pointer {pointer!r}: object keys must be strings")
            escaped = key.replace("~", "~0").replace("/", "~1")
            _validate_json(member, f"{pointer}/{escaped}")
    elif isinstance(value, list):
        for index, member in enumerate(value):
            _validate_json(member, f"{pointer}/{index}")
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"Source JSON pointer {pointer!r}: non-finite numbers are not allowed")
    elif value is not None and not isinstance(value, (str, int, float, bool)):
        raise ValueError(f"Source JSON pointer {pointer!r}: value must be JSON data")


def _validate_source(source: Any) -> Any:
    if not isinstance(source, (dict, list)):
        raise ValueError("Source JSON pointer '': source must be an object or array")
    _validate_json(source)
    return source


_LENGTH_UNITS = {"nm": 0.001, "um": 1.0, "µm": 1.0, "mm": 1000.0}
_DENSITY_UNITS = {"percent", "fraction"}


class SourceField(StrictModel):
    id: NonBlankString
    object: NonBlankString
    property: NonBlankString
    stage: NonBlankString
    path: str
    kind: Literal["length", "density", "material"]
    unit: str | None = None
    unitPath: str | None = None

    @field_validator("path", "unitPath")
    @classmethod
    def validate_pointer(cls, value: str | None) -> str | None:
        if value is not None:
            _pointer_tokens(value)
        return value

    @model_validator(mode="after")
    def validate_units(self):
        if self.kind == "material":
            if self.unit is not None or self.unitPath is not None:
                raise ValueError(f"Fact {self.id!r} at {self.path!r}: materials cannot specify units")
        else:
            if (self.unit is None) == (self.unitPath is None):
                raise ValueError(f"Fact {self.id!r} at {self.path!r}: specify exactly one of unit or unitPath")
            units = _LENGTH_UNITS if self.kind == "length" else _DENSITY_UNITS
            if self.unit is not None and self.unit not in units:
                raise ValueError(f"Fact {self.id!r} at {self.path!r}: unknown {self.kind} unit {self.unit!r}")
        return self


class InputVerification(StrictModel):
    kind: Literal["body", "bump", "via", "circuit"]
    property: Literal["material", "density", "thickness"]
    key: NonBlankString | None = None


class OutputVerification(InputVerification):
    terminal: bool = False


class ParameterRule(StrictModel):
    id: NonBlankString
    type: Literal["parameter"]
    fact: NonBlankString
    role: NonBlankString
    parameter: NonBlankString
    verify: OutputVerification


class MoldingThicknessRule(StrictModel):
    id: NonBlankString
    type: Literal["molding_final_thickness"]
    fact: NonBlankString
    moldingRole: NonBlankString
    grindingRole: NonBlankString
    terminal: bool = True


class GeneratorParameterRule(StrictModel):
    id: NonBlankString
    type: Literal["generator_parameter"]
    fact: NonBlankString
    inputRole: NonBlankString
    parameterPath: str
    verify: InputVerification

    @field_validator("parameterPath")
    @classmethod
    def validate_parameter_path(cls, value: str) -> str:
        if not _pointer_tokens(value):
            raise ValueError("parameterPath must point to an existing nested generator parameter")
        return value


Rule = Annotated[ParameterRule | MoldingThicknessRule | GeneratorParameterRule, Field(discriminator="type")]


class ConversionProfile(StrictModel):
    schemaVersion: Literal[1] = 1
    id: NonBlankString
    version: NonBlankString
    fields: list[SourceField]
    rules: list[Rule]
    materialMap: dict[NonBlankString, NonBlankString] = Field(default_factory=dict)
    lengthTolerance: PositiveFiniteFloat = 1e-5

    @model_validator(mode="after")
    def validate_fact_references(self):
        fields = {field.id: field for field in self.fields}
        if len(fields) != len(self.fields):
            raise ValueError("Duplicate source field id")
        if len({rule.id for rule in self.rules}) != len(self.rules):
            raise ValueError("Duplicate conversion rule id")
        used = set()
        expected_property = {"length": "thickness", "density": "density", "material": "material"}
        for rule in self.rules:
            field = fields.get(rule.fact)
            if field is None:
                raise ValueError(f"Rule {rule.id!r} references unknown fact {rule.fact!r}")
            used.add(rule.fact)
            if isinstance(rule, MoldingThicknessRule):
                if field.kind != "length":
                    raise ValueError(f"Rule {rule.id!r}: fact {rule.fact!r} at {field.path!r} must be a length")
            elif rule.verify.property != expected_property[field.kind]:
                raise ValueError(f"Rule {rule.id!r}: fact {rule.fact!r} at {field.path!r} requires verification property {expected_property[field.kind]!r}")
        unused = fields.keys() - used
        if unused:
            raise ValueError(f"Source fields have no conversion rule: {', '.join(sorted(unused))}")
        return self


class ConversionBindings(StrictModel):
    roles: dict[NonBlankString, NonBlankString] = Field(default_factory=dict)
    inputs: dict[NonBlankString, NonBlankString] = Field(default_factory=dict)


class ConversionMetadata(StrictModel):
    name: NonBlankString
    version: NonBlankString
    owner: NonBlankString
    description: str = ""


class ConversionRequest(StrictModel):
    source: Any
    profile: ConversionProfile
    bindings: ConversionBindings
    baseFlowId: NonBlankString
    baseRevision: int = Field(ge=1, strict=True)
    metadata: ConversionMetadata

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: Any) -> Any:
        return _validate_source(value)


def _numeric(value: Any, location: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{location}: expected a finite JSON number")
    try:
        result = float(value)
    except (ValueError, OverflowError):
        raise ValueError(f"{location}: expected a finite JSON number") from None
    if not math.isfinite(result):
        raise ValueError(f"{location}: expected a finite JSON number")
    return result


def normalize_source(source: Any, profile: ConversionProfile) -> list[dict[str, Any]]:
    """Resolve configured facts, preserving source values and their exact paths."""
    _validate_source(source)
    facts = []
    for field in profile.fields:
        location = f"Fact {field.id!r} at source pointer {field.path!r}"
        try:
            original = read_pointer(source, field.path)
            unit = read_pointer(source, field.unitPath) if field.unitPath is not None else field.unit
        except ValueError as exc:
            raise ValueError(f"{location}: {exc}") from exc
        if field.kind == "material":
            if not isinstance(original, str) or not original.strip():
                raise ValueError(f"{location}: expected a nonblank material name")
            material = original.strip()
            if profile.materialMap and material not in profile.materialMap:
                raise ValueError(f"{location}: unknown material {material!r}; add it to materialMap")
            value = profile.materialMap.get(material, material)
            normalized_unit = None
        else:
            unit_location = f" at source pointer {field.unitPath!r}" if field.unitPath is not None else ""
            known_units = _LENGTH_UNITS if field.kind == "length" else _DENSITY_UNITS
            if not isinstance(unit, str) or unit not in known_units:
                raise ValueError(f"{location}: unknown {field.kind} unit {unit!r}{unit_location}")
            number = _numeric(original, location)
            if field.kind == "length":
                value = number * _LENGTH_UNITS[unit]
                if not math.isfinite(value) or value < 0:
                    raise ValueError(f"{location}: length must be nonnegative and finite after conversion")
                normalized_unit = "um"
            else:
                value = number * (100 if unit == "fraction" else 1)
                if not 0 <= value <= 100:
                    raise ValueError(f"{location}: density must be within 0..100 percent")
                normalized_unit = "percent"
        fact = {"id": field.id, "object": field.object, "property": field.property,
                "stage": field.stage, "sourcePath": field.path,
                "sourceValue": deepcopy(original), "value": value, "unit": normalized_unit}
        if field.unitPath is not None:
            fact["unitSourcePath"] = field.unitPath
        facts.append(fact)
    return facts
