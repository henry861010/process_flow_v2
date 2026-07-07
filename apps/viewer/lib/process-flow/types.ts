export type FieldScope = "inputState" | "outputState" | "processParameter";

export type ValueType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "materialRef"
  | "geometryRef"
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
  itemFieldDefinitions: FieldDefinition[];
};

export type FieldDefinition = {
  id: string;
  name: string;
  description?: string;
  scope: FieldScope;
  valueType: ValueType;
  controlType?: ControlType;
  selectionMode?: SelectionMode;
  unit?: string | null;
  optionSource?: OptionSource;
  validation?: ValidationRule;
  repeatDefinition?: RepeatDefinition;
};

export type RepeatableGroupValue = {
  items: Array<{
    itemId: string;
    index: number;
    fieldValues: FieldValue[];
  }>;
};

export type FieldValue = {
  fieldId: string;
  value: unknown;
};

export type ProcessStepTemplate = {
  id: string;
  version: string;
  name: string;
  category: string;
  program: string;
  description: string;
  owner: string;
  fieldDefinitions: FieldDefinition[];
};

export type SavedFlowEdge = {
  edgeId: string;
  source:
    | { sourceType: "geometryRef" }
    | { sourceType: "stepOutput"; stepRefId: string };
  target: {
    stepRefId: string;
    targetFieldId: string;
  };
};

export type ProcessFlowTemplate = {
  id: string;
  name: string;
  version: string;
  description?: string;
  owner?: string;
  stepRefs: Array<{
    stepRefId: string;
    stepLabel?: string;
    processStepTemplateId: string;
  }>;
  flowEdges: SavedFlowEdge[];
};

export type StepValueSet = {
  stepRefId: string;
  processStepTemplateId: string;
  fieldValues: FieldValue[];
};

export type ProcessFlowInstance = {
  id: string;
  name: string;
  processFlowTemplateId: string;
  stepValueSets: StepValueSet[];
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
  blockingFieldName: string | null;
};

export type LayoutPosition = {
  x: number;
  y: number;
};

export type TemplateLayout = {
  stepPositions: Map<string, LayoutPosition>;
  initialPositions: Map<string, LayoutPosition>;
};
