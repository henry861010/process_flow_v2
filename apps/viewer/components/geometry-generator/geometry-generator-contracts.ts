import type {
  EmbeddedGeometry,
  GeometryAdaptationContract,
  ParameterDefinition,
  ParameterDefinitionGroup,
} from "@/lib/process-flow/types";

export type GeometryGeneratorDefinition = {
  schemaVersion: 1;
  id: string;
  version: number;
  label: string;
  description: string;
  entityType: string;
  category?: string | null;
  icon?: string | null;
  adaptationContract: GeometryAdaptationContract;
  defaultParameters: Record<string, unknown>;
  parameterDefinitions: ParameterDefinition[];
  parameterGroups: ParameterDefinitionGroup[];
  previewViews: string[];
};

export type EngineeringPreviewBounds = {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
};

export type EngineeringPreviewEntity = {
  id: string;
  sourceId: string;
  role: string;
  semanticKey?: string | null;
  kind: "rectangle" | "polygon" | "circle";
  uMin?: number;
  uMax?: number;
  vMin?: number;
  vMax?: number;
  center?: [number, number];
  radius?: number;
  loops?: Array<Array<[number, number]>>;
};

export type EngineeringPreviewDimension = {
  id: string;
  axis: "u" | "v";
  from: [number, number];
  to: [number, number];
  value: number;
  label: string;
};

export type EngineeringPreviewView = {
  id: string;
  label: string;
  projection: "xy" | "xz" | "yz";
  bounds: EngineeringPreviewBounds;
  entities: EngineeringPreviewEntity[];
  dimensions: EngineeringPreviewDimension[];
  annotations: Array<Record<string, unknown>>;
};

export type EngineeringPreviewDocument = {
  schemaVersion: 1;
  unit: string;
  views: EngineeringPreviewView[];
};

export type GeometryGeneratorPreview = {
  generatorId: string;
  generatorVersion: number;
  valid: boolean;
  errors: Record<string, string>;
  normalizedParameters: Record<string, unknown>;
  computedParameters: Record<string, unknown>;
  engineeringPreview: EngineeringPreviewDocument | null;
  geometryHash: string | null;
  previewToken: string | null;
  geometryEntityJson: (EmbeddedGeometry & { id?: string | null }) | null;
};

export type GeometryMaterialization = {
  geometryHash: string;
  geometryEntityJson: EmbeddedGeometry & { id?: string | null };
};
