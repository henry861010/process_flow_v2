export type ValueType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "materialRef"
  | "coordinates"
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
  | "coordinateList"
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

export type ProcessStepTemplate = {
  schemaVersion: 2;
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

export type ProcessFlowTemplate = {
  schemaVersion: 2;
  id: string;
  name: string;
  version: string;
  description?: string;
  owner?: string;
  flowInputs: FlowInputDefinition[];
  stepRefs: StepRef[];
  flowEdges: SavedFlowEdge[];
};

export type CatalogGeometryBinding = {
  kind: "catalog";
  geometryId: string;
};

export type EmbeddedGeometryBinding = {
  kind: "embedded";
  localId: string;
};

export type GeometryBinding = CatalogGeometryBinding | EmbeddedGeometryBinding;

export type StepConfiguration = {
  parameterValues: Record<string, unknown>;
};

export type EmbeddedGeometry = {
  name: string;
  entityType: string;
  category?: string | null;
  version?: string | null;
  owner?: string | null;
  description?: string | null;
  icon?: string;
  iconScale?: number;
  structureFormat: string;
  structure: unknown;
};

export type FlowConfiguration = {
  inputBindings: Record<string, GeometryBinding>;
  stepConfigurations: Record<string, StepConfiguration>;
  embeddedGeometries: Record<string, EmbeddedGeometry>;
};

export type ProcessFlowWorkspace = FlowConfiguration & {
  schemaVersion: 2;
  id: string;
  name: string;
  processFlowTemplateId: string;
  revision: number;
  status: "draft" | "committed";
  committedInstanceId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProcessFlowInstance = {
  schemaVersion: 2;
  id: string;
  name: string;
  processFlowTemplateId: string;
  inputBindings: Record<string, CatalogGeometryBinding>;
  stepConfigurations: Record<string, StepConfiguration>;
};

export type GeometryEntity = {
  id: string;
  category: string;
  name: string;
  version: string;
  owner: string;
  description: string;
  entityType: string;
  icon?: string;
  iconScale?: number;
  structureFormat: string;
  structure?: unknown;
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
