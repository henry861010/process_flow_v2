from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


JsonObject = dict[str, Any]
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
PositiveFiniteFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]
SectionPoint = tuple[FiniteFloat, FiniteFloat]
SectionLoop = Annotated[list[SectionPoint], Field(min_length=4)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def payload(self) -> JsonObject:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


ValueType = Literal[
    "string",
    "integer",
    "float",
    "boolean",
    "materialRef",
    "coordinates",
    "fieldGroupArray",
    "string[]",
    "integer[]",
    "float[]",
    "materialRef[]",
]
ControlType = Literal["text", "number", "checkbox", "select", "repeater", "coordinateList"]


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


class RepeatDefinition(StrictModel):
    itemNameTemplate: str
    indexBase: int
    minItems: int | None = None
    maxItems: int | None = None
    itemParameterDefinitions: list[ParameterDefinition]


class GeometryInputPort(StrictModel):
    portId: str = Field(min_length=1)
    name: str
    description: str = ""
    dataType: Literal["geometry"] = "geometry"
    role: Literal["primary", "auxiliary"]
    required: bool = True


class GeometryOutputPort(StrictModel):
    portId: str = Field(min_length=1)
    name: str
    description: str = ""
    dataType: Literal["geometry"] = "geometry"


class ProcessStepTemplate(StrictModel):
    schemaVersion: Literal[2] = 2
    id: str = Field(min_length=1)
    version: str
    name: str
    category: str
    program: str
    description: str = ""
    owner: str
    inputPorts: list[GeometryInputPort]
    outputPorts: list[GeometryOutputPort]
    parameterDefinitions: list[ParameterDefinition]


class GeometryConstraints(StrictModel):
    entityTypes: list[str] | None = None
    categories: list[str] | None = None
    structureFormats: list[str] | None = None


class FlowInputDefinition(StrictModel):
    flowInputId: str = Field(min_length=1)
    name: str
    description: str = ""
    dataType: Literal["geometry"] = "geometry"
    required: bool = True
    geometryConstraints: GeometryConstraints | None = None


class FlowInputEdgeSource(StrictModel):
    kind: Literal["flowInput"]
    flowInputId: str = Field(min_length=1)


class StepOutputEdgeSource(StrictModel):
    kind: Literal["stepOutput"]
    stepRefId: str = Field(min_length=1)
    outputPortId: str = Field(min_length=1)


FlowEdgeSource = Annotated[
    FlowInputEdgeSource | StepOutputEdgeSource,
    Field(discriminator="kind"),
]


class FlowEdgeTarget(StrictModel):
    stepRefId: str = Field(min_length=1)
    inputPortId: str = Field(min_length=1)


class FlowEdge(StrictModel):
    edgeId: str = Field(min_length=1)
    source: FlowEdgeSource
    target: FlowEdgeTarget


class StepRef(StrictModel):
    stepRefId: str = Field(min_length=1)
    stepLabel: str | None = None
    processStepTemplateId: str = Field(min_length=1)


class ProcessFlowTemplateDraft(StrictModel):
    schemaVersion: Literal[2] = 2
    id: str = ""
    name: str
    version: str
    description: str = ""
    owner: str = ""
    flowInputs: list[FlowInputDefinition]
    stepRefs: list[StepRef]
    flowEdges: list[FlowEdge]


class ProcessFlowTemplate(ProcessFlowTemplateDraft):
    id: str = Field(min_length=1)


class CatalogGeometryBinding(StrictModel):
    kind: Literal["catalog"]
    geometryId: str = Field(min_length=1)


class EmbeddedGeometryBinding(StrictModel):
    kind: Literal["embedded"]
    localId: str = Field(min_length=1)


GeometryBinding = Annotated[
    CatalogGeometryBinding | EmbeddedGeometryBinding,
    Field(discriminator="kind"),
]


class StepConfiguration(StrictModel):
    parameterValues: dict[str, Any] = Field(default_factory=dict)


class GeometryGeneration(StrictModel):
    generatorId: str = Field(min_length=1)
    schemaVersion: int = Field(ge=1)
    parameters: JsonObject


class EmbeddedGeometry(StrictModel):
    name: str
    entityType: str
    category: str | None = None
    version: str | None = None
    owner: str | None = None
    description: str | None = None
    icon: str | None = None
    iconScale: float | None = None
    structureFormat: str = "standard"
    structure: JsonObject
    generation: GeometryGeneration | None = None


class FlowConfiguration(StrictModel):
    inputBindings: dict[str, GeometryBinding] = Field(default_factory=dict)
    stepConfigurations: dict[str, StepConfiguration] = Field(default_factory=dict)
    embeddedGeometries: dict[str, EmbeddedGeometry] = Field(default_factory=dict)


class ProcessFlowInstance(StrictModel):
    schemaVersion: Literal[2] = 2
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    processFlowTemplateId: str = Field(min_length=1)
    inputBindings: dict[str, CatalogGeometryBinding]
    stepConfigurations: dict[str, StepConfiguration]


class ProcessFlowInstanceCreate(FlowConfiguration):
    schemaVersion: Literal[2] = 2
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    processFlowTemplateId: str = Field(min_length=1)


class ProcessFlowWorkspace(FlowConfiguration):
    schemaVersion: Literal[2] = 2
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    processFlowTemplateId: str = Field(min_length=1)
    revision: int = Field(ge=1)
    status: Literal["draft", "committed"] = "draft"
    committedInstanceId: str | None = None
    createdAt: str
    updatedAt: str


class ProcessFlowWorkspaceCreate(FlowConfiguration):
    name: str = Field(min_length=1)
    processFlowTemplateId: str = Field(min_length=1)


class ProcessFlowWorkspaceUpdate(FlowConfiguration):
    name: str = Field(min_length=1)
    revision: int = Field(ge=1)


class WorkspaceCommitRequest(StrictModel):
    instanceId: str = Field(min_length=1)
    instanceName: str = Field(min_length=1)
    revision: int = Field(ge=1)


class GeometryEntity(StrictModel):
    id: str | None = None
    category: str | None = None
    entityType: str
    name: str
    version: str | None = None
    owner: str | None = None
    description: str | None = None
    icon: str | None = None
    iconScale: float | None = None
    structureFormat: str = "standard"
    structure: JsonObject
    generation: GeometryGeneration | None = None


class TemplateInstanceCreateRequest(StrictModel):
    processFlowTemplate: ProcessFlowTemplate
    processFlowInstance: ProcessFlowInstanceCreate


class FlowInputPreviewTarget(StrictModel):
    type: Literal["flowInput"]
    flowInputId: str = Field(min_length=1)


class StepOutputPreviewTarget(StrictModel):
    type: Literal["stepOutput"]
    stepRefId: str = Field(min_length=1)
    outputPortId: str = Field(default="result_geometry", min_length=1)


GeometryPreviewTarget = Annotated[
    FlowInputPreviewTarget | StepOutputPreviewTarget,
    Field(discriminator="type"),
]


class GeometryPreviewRequest(StrictModel):
    target: GeometryPreviewTarget
    sourceLabel: str | None = None
    flowTemplate: ProcessFlowTemplateDraft | None = None
    processFlowTemplateId: str | None = None
    configuration: FlowConfiguration

    @model_validator(mode="after")
    def exactly_one_template_source(self):
        if (self.flowTemplate is None) == (self.processFlowTemplateId is None):
            raise ValueError("Provide exactly one of flowTemplate or processFlowTemplateId")
        return self


class GeometryPreviewStepRequest(StrictModel):
    geometryStructure: JsonObject


class CdbFileExportCreateRequest(StrictModel):
    clientId: str = Field(min_length=1, max_length=160)
    geometryStructure: JsonObject
    elementSize: float
    outputPath: str = Field(min_length=1)
    sourceLabel: str | None = None


class FileExportCreateRequest(StrictModel):
    clientId: str = Field(min_length=1, max_length=160)
    kind: Literal["cdb", "json", "step"]
    outputPath: str = Field(min_length=1)
    sourceLabel: str | None = None
    geometryStructure: JsonObject | None = None
    geometryEntityJson: JsonObject | None = None
    elementSize: float | None = None


class FileExportCancelRequest(StrictModel):
    clientId: str = Field(min_length=1, max_length=160)


class ExecuteInstanceResponse(StrictModel):
    geometryStructure: JsonObject
    stepOutputs: JsonObject
    terminalStepRefIds: list[str]


class GeometryPreviewResponse(StrictModel):
    geometryEntityJson: JsonObject
    glbBase64: str


class PreviewSnapshot(StrictModel):
    snapshotId: str = Field(min_length=1)
    sourceKind: Literal["flowInput", "stepOutput"]
    stepRefId: str | None = None
    label: str = Field(min_length=1)
    order: int = Field(ge=0)
    geometryHash: str = Field(min_length=1)
    geometryEntityJson: JsonObject
    meshUrl: str = Field(min_length=1)
    sectionUrl: str = Field(min_length=1)


class PreviewSessionResponse(StrictModel):
    sessionId: str = Field(min_length=1)
    initialSnapshotId: str = Field(min_length=1)
    snapshots: list[PreviewSnapshot] = Field(min_length=1)


class PreviewSectionRegion(StrictModel):
    bodyId: str = Field(min_length=1)
    sourceIds: list[str]
    containerId: str = Field(min_length=1)
    containerKey: str
    material: str = Field(min_length=1)
    bodyKind: Literal["body", "feature"]
    featureType: str | None = None
    approximationKind: Literal["exact", "envelope"]
    area: PositiveFiniteFloat
    outer: SectionLoop
    holes: list[SectionLoop]

    @model_validator(mode="after")
    def loops_are_closed(self):
        for label, loop in [
            ("outer", self.outer),
            *((f"holes[{index}]", hole) for index, hole in enumerate(self.holes)),
        ]:
            if loop[0] != loop[-1]:
                raise ValueError(f"Preview section {label} loop must be closed")
        return self


class PreviewSectionResponse(StrictModel):
    snapshotId: str = Field(min_length=1)
    geometryHash: str = Field(min_length=1)
    unitSystem: str = Field(min_length=1)
    axis: Literal["x", "y"]
    position: FiniteFloat
    regions: list[PreviewSectionRegion]


class GeometryPreviewStepResponse(StrictModel):
    stepBase64: str


class FileExportJob(StrictModel):
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


class FileExportJobResponse(StrictModel):
    job: FileExportJob


class FileExportJobListResponse(StrictModel):
    jobs: list[FileExportJob]
