"""The versioned manifest contract for registered geometry generators."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .contracts import JsonObject


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def payload(self) -> JsonObject:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


ValueType = Literal[
    "string", "integer", "float", "boolean", "materialRef", "placements",
    "fieldGroupArray", "string[]", "integer[]", "float[]", "materialRef[]",
]
ControlType = Literal[
    "text", "number", "checkbox", "select", "repeater", "placementList",
]


class StaticOption(StrictModel):
    value: str | int | float
    name: str
    description: str | None = None


class OptionSource(StrictModel):
    type: Literal["static"] = "static"
    options: list[StaticOption]


class ValidationRule(StrictModel):
    regex: str | None = None
    minLength: int | None = None
    maxLength: int | None = None
    min: float | None = None
    max: float | None = None
    exclusiveMin: bool | None = None
    exclusiveMax: bool | None = None


class ParameterDefinition(StrictModel):
    id: str = Field(min_length=1)
    name: str
    description: str = ""
    valueType: ValueType
    controlType: ControlType | None = None
    selectionMode: Literal["single", "multiple"] | None = None
    required: bool = True
    unit: str | None = None
    optionSource: OptionSource | None = None
    validation: ValidationRule | None = None
    repeatDefinition: RepeatDefinition | None = None
    defaultValue: Any = None

    @model_validator(mode="before")
    @classmethod
    def reject_null_default_value(cls, data):
        if isinstance(data, dict) and "defaultValue" in data and data["defaultValue"] is None:
            raise ValueError("defaultValue cannot be null; omit it when no default exists")
        return data


class RepeatDefinition(StrictModel):
    itemNameTemplate: str
    indexBase: int
    minItems: int | None = None
    maxItems: int | None = None
    itemParameterDefinitions: list[ParameterDefinition]


class GeometryGeneratorParameterGroup(StrictModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    parameterIds: list[str] = Field(min_length=1)


class GeneratorParameterVisibility(StrictModel):
    parameterId: str = Field(min_length=1)
    equals: str | int | float | bool


class GeometryGeneratorParameterDefinition(ParameterDefinition):
    visibleWhen: GeneratorParameterVisibility | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


GeometryGeneratorUiPlacement = Literal[
    "home", "management", "templateGeometryLibrary", "flowInputPicker"
]


class GeneratorAdaptationContract(StrictModel):
    adapterId: str = Field(min_length=1)
    adapterVersion: int = Field(ge=1)
    parameters: JsonObject = Field(default_factory=dict)


class GeometryGeneratorDefinition(StrictModel):
    schemaVersion: Literal[2]
    id: str = Field(min_length=1)
    version: int = Field(ge=1)
    label: str = Field(min_length=1)
    description: str = ""
    uiPlacements: list[GeometryGeneratorUiPlacement]
    entityType: str = Field(min_length=1)
    category: str | None = None
    icon: str | None = None
    adaptationContract: GeneratorAdaptationContract
    defaultParameters: JsonObject
    parameterDefinitions: list[GeometryGeneratorParameterDefinition]
    parameterGroups: list[GeometryGeneratorParameterGroup] = Field(default_factory=list)
    previewViews: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def reject_duplicate_ui_placements(self):
        if len(self.uiPlacements) != len(set(self.uiPlacements)):
            raise ValueError("uiPlacements cannot contain duplicates")
        return self
