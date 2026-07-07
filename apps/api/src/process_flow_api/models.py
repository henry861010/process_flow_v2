from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


JsonObject = dict[str, Any]


class FlexibleModel(BaseModel):
    model_config = ConfigDict(extra="allow")

    def payload(self) -> JsonObject:
        return self.model_dump(mode="json", by_alias=True)


class FieldValue(FlexibleModel):
    fieldId: str
    value: Any = None


class FieldDefinition(FlexibleModel):
    id: str
    name: str | None = None
    scope: str | None = None
    valueType: str
    controlType: str | None = None
    selectionMode: str | None = None
    unit: str | None = None


class ProcessStepTemplate(FlexibleModel):
    id: str
    version: str
    name: str
    category: str
    program: str
    description: str = ""
    owner: str
    fieldDefinitions: list[FieldDefinition]


class FlowEdgeSource(FlexibleModel):
    sourceType: Literal["geometryRef", "stepOutput"]
    stepRefId: str | None = None


class FlowEdgeTarget(FlexibleModel):
    stepRefId: str
    targetFieldId: str


class FlowEdge(FlexibleModel):
    edgeId: str
    source: FlowEdgeSource
    target: FlowEdgeTarget


class StepRef(FlexibleModel):
    stepRefId: str
    stepLabel: str | None = None
    processStepTemplateId: str


class ProcessFlowTemplate(FlexibleModel):
    id: str
    name: str
    version: str
    description: str = ""
    owner: str = ""
    stepRefs: list[StepRef]
    flowEdges: list[FlowEdge]


class StepValueSet(FlexibleModel):
    stepRefId: str
    processStepTemplateId: str
    fieldValues: list[FieldValue]


class ProcessFlowInstance(FlexibleModel):
    id: str
    name: str
    processFlowTemplateId: str
    stepValueSets: list[StepValueSet]


class GeometryEntity(FlexibleModel):
    id: str | None = None
    category: str | None = None
    entityType: str
    name: str
    version: str | None = None
    owner: str | None = None
    description: str | None = None
    structureFormat: str = "standard"
    structure: JsonObject


class TemplateInstanceCreateRequest(BaseModel):
    processFlowTemplate: ProcessFlowTemplate
    processFlowInstance: ProcessFlowInstance


class GeometryPreviewTarget(FlexibleModel):
    type: Literal["edge", "stepOutput"]
    previewEdgeId: str | None = None
    stepRefId: str | None = None

    @field_validator("previewEdgeId")
    @classmethod
    def preview_edge_required_for_edge(cls, value: str | None, info):
        if info.data.get("type") == "edge" and not value:
            raise ValueError("previewEdgeId is required for edge preview")
        return value


class GeometryPreviewRequest(BaseModel):
    target: GeometryPreviewTarget
    sourceLabel: str | None = None
    flowTemplate: ProcessFlowTemplate
    draftInstance: ProcessFlowInstance
    geometries: list[GeometryEntity] | None = None
    processStepTemplates: list[ProcessStepTemplate] | None = None


class GeometryPreviewStepRequest(BaseModel):
    geometryStructure: JsonObject


class CdbFileExportCreateRequest(BaseModel):
    clientId: str = Field(min_length=1, max_length=160)
    geometryStructure: JsonObject
    elementSize: float
    outputPath: str = Field(min_length=1)
    sourceLabel: str | None = None


class FileExportCreateRequest(BaseModel):
    clientId: str = Field(min_length=1, max_length=160)
    kind: Literal["cdb", "json", "step"]
    outputPath: str = Field(min_length=1)
    sourceLabel: str | None = None
    geometryStructure: JsonObject | None = None
    geometryEntityJson: JsonObject | None = None
    elementSize: float | None = None


class FileExportCancelRequest(BaseModel):
    clientId: str = Field(min_length=1, max_length=160)


class ExecuteInstanceResponse(BaseModel):
    geometryStructure: JsonObject
    stepOutputs: JsonObject
    terminalStepRefIds: list[str]


class GeometryPreviewResponse(BaseModel):
    geometryEntityJson: JsonObject
    glbBase64: str


class GeometryPreviewStepResponse(BaseModel):
    stepBase64: str


class FileExportJob(BaseModel):
    jobId: str
    clientId: str
    kind: Literal["cdb", "json", "step"]
    status: Literal["queued", "running", "success", "failed", "canceling", "canceled"]
    sourceLabel: str | None = None
    outputPath: str
    elementSize: float | None = None
    createdAt: str
    startedAt: str | None = None
    finishedAt: str | None = None
    durationSeconds: float | None = None
    nodeCount: int | None = None
    elementCount: int | None = None
    componentCount: int | None = None
    message: str | None = None
    warning: str | None = None


class FileExportJobResponse(BaseModel):
    job: FileExportJob


class FileExportJobListResponse(BaseModel):
    jobs: list[FileExportJob]
