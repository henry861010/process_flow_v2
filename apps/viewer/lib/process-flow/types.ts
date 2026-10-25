export type ValueType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "materialRef"
  | "placements"
  | "fieldGroupArray"
  | "string[]"
  | "integer[]"
  | "float[]"
  | "materialRef[]";

export type ControlType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "repeater"
  | "placementList"
  | null;

export type SelectionMode = "single" | "multiple" | null;

export type StaticOption = {
  value: string | number;
  name: string;
  description?: string;
};

export type OptionSource = {
  type: "static";
  options: StaticOption[];
};

export type ValidationRule = {
  regex?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
};

export type RepeatDefinition = {
  itemNameTemplate: string;
  indexBase: number;
  minItems?: number;
  maxItems?: number;
  itemParameterDefinitions: ParameterDefinition[];
};

export type ParameterDefinition = {
  id: string;
  name: string;
  description?: string;
  valueType: ValueType;
  controlType?: ControlType;
  selectionMode?: SelectionMode;
  required?: boolean;
  unit?: string | null;
  optionSource?: OptionSource;
  validation?: ValidationRule;
  repeatDefinition?: RepeatDefinition;
  defaultValue?: unknown;
};

export type ParameterDefinitionGroup = {
  id: string;
  label: string;
  parameterIds: string[];
};

export type RepeatableGroupValue = {
  items: Array<{
    itemId: string;
    index: number;
    values: Record<string, unknown>;
  }>;
};

export type GeometryInputPort = {
  portId: string;
  name: string;
  description?: string;
  dataType: "geometry";
  role: "primary" | "auxiliary";
  required: boolean;
};

export type GeometryOutputPort = {
  portId: string;
  name: string;
  description?: string;
  dataType: "geometry";
};

export type TemplateStatus = "enabled" | "disabled";

export type ProcessStepTemplate = {
  schemaVersion: 2;
  status: TemplateStatus;
  id: string;
  version: string;
  name: string;
  category: string;
  program: string;
  description: string;
  owner: string;
  inputPorts: GeometryInputPort[];
  outputPorts: GeometryOutputPort[];
  parameterDefinitions: ParameterDefinition[];
};

export type GeometryConstraints = {
  entityTypes?: string[];
  categories?: string[];
  structureFormats?: string[];
};

export type FlowInputDefinition = {
  flowInputId: string;
  name: string;
  description?: string;
  dataType: "geometry";
  required: boolean;
  geometryConstraints?: GeometryConstraints;
};

export type FlowEdgeSource =
  | { kind: "flowInput"; flowInputId: string }
  | { kind: "stepOutput"; stepRefId: string; outputPortId: string };

export type SavedFlowEdge = {
  edgeId: string;
  source: FlowEdgeSource;
  target: {
    stepRefId: string;
    inputPortId: string;
  };
};

export type StepRef = {
  stepRefId: string;
  stepLabel?: string;
  processStepTemplateId: string;
};

export type FlowDefinition = {
  flowInputs: FlowInputDefinition[];
  stepRefs: StepRef[];
  flowEdges: SavedFlowEdge[];
};
export type FlowOrigin = { flowId: string; revision: number };
export type FlowContent = { definition: FlowDefinition; configuration: FlowConfiguration };
export type ProcessFlow = FlowContent & {
  schemaVersion: 3; id: string; name: string; version: string; owner: string;
  description: string; revision: number; origin?: FlowOrigin;
};
export type ProcessFlowCreate = Omit<ProcessFlow, "id" | "revision">;
export type ProcessFlowUpdate = ProcessFlowCreate & { revision: number };

export type CatalogGeometryBinding = {
  kind: "catalog";
  geometryId: string;
};

export type GeneratorGeometryBinding = {
  kind: "generator";
  generatorId: string;
  generatorVersion: number;
  parameters: Record<string, unknown>;
};

export type GeometryBinding =
  | CatalogGeometryBinding
  | GeneratorGeometryBinding;

export type RecipeCandidate = {
  recipeId: string; name: string; description: string; parameterValues: Record<string, unknown>;
};
export type StepConfiguration = {
  recipeCandidates: RecipeCandidate[];
  selectedRecipeId: string | null;
};

export type GeometryGeneration = {
  generatorId: string;
  schemaVersion: number;
  parameters: Record<string, unknown>;
};

export type GeometryAdaptationContract = {
  adapterId: string;
  adapterVersion: number;
  parameters?: Record<string, unknown>;
};

export type GeometryDocument = {
  name: string;
  entityType: string;
  category?: string | null;
  dim: string;
  vendor?: string | null;
  type1?: string | null;
  type2?: string | null;
  owner?: string | null;
  description?: string | null;
  icon?: string;
  iconScale?: number;
  structureFormat: string;
  structure: unknown;
  generation?: GeometryGeneration;
  adaptationContract?: GeometryAdaptationContract;
};

export type FlowConfiguration = {
  inputBindings: Record<string, GeometryBinding>;
  stepConfigurations: Record<string, StepConfiguration>;
};

export type GeometryEntity = {
  id: string;
  category?: string | null;
  name: string;
  dim: string;
  vendor?: string | null;
  type1?: string | null;
  type2?: string | null;
  owner: string;
  description: string;
  entityType: string;
  icon?: string;
  iconScale?: number;
  structureFormat: string;
  structure?: unknown;
  generation?: GeometryGeneration;
  adaptationContract?: GeometryAdaptationContract;
};

export type GeometryEntityCreate = Omit<GeometryEntity, "id" | "structure" | "category" | "owner" | "description"> & {
  id?: null;
  structure: Record<string, unknown>;
  category?: string;
  owner?: string;
  description?: string;
};

export type StepCompletion = {
  complete: boolean;
  blockingParameterName: string | null;
};

export type LayoutPosition = {
  x: number;
  y: number;
};

export type TemplateLayout = {
  stepPositions: Map<string, LayoutPosition>;
  flowInputPositions: Map<string, LayoutPosition>;
};

export type EditorMetadata = { name: string; version: string; owner: string; description: string };
export type FlowDraftNode =
  | { id: string; kind: "flowInput"; position: { x: number; y: number }; definition: FlowInputDefinition }
  | { id: string; kind: "processStep"; position: { x: number; y: number }; stepRef: StepRef };
export type FlowDraftState = {
  metadata: EditorMetadata; configuration: FlowConfiguration;
  nodes: FlowDraftNode[];
  edges: Array<{ id: string; source: string; target: string; sourceHandle: string | null; targetHandle: string | null }>;
  viewport: { x: number; y: number; zoom: number };
  editingRecipeIds: Record<string, string>;
};
export type FlowDraft = {
  schemaVersion: 2; id: string; user: string; name: string; revision: number;
  createdAt: string; updatedAt: string; state: FlowDraftState;
  target?: FlowOrigin; origin?: FlowOrigin;
};
export type FlowDraftSummary = Omit<FlowDraft, "state">;
export type FlowDraftCreate = Pick<FlowDraft, "schemaVersion" | "user" | "name" | "state" | "target" | "origin">;
