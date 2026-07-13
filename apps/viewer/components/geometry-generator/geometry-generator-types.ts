import type {
  EmbeddedGeometry,
  GeometryGeneration,
} from "@/lib/process-flow/types";

export type GeometryGeneratorMode = "catalog" | "flowInput";

export type GeometryGeneratorDefineResult = {
  geometry: EmbeddedGeometry;
  suggestedFlowInputName: string;
};

export type GeometryGeneratorDialogBaseProps = {
  mode?: GeometryGeneratorMode;
  initialParameters?: Record<string, unknown>;
  onClose: () => void;
  onDefine?: (result: GeometryGeneratorDefineResult) => void;
};

export function geometryGeneration(
  generatorId: string,
  schemaVersion: number,
  parameters: Record<string, unknown>,
): GeometryGeneration {
  return {
    generatorId,
    schemaVersion,
    parameters: structuredClone(parameters),
  };
}

export function generatedGeometryDraft(
  geometry: Omit<EmbeddedGeometry, "version" | "owner" | "description">,
): EmbeddedGeometry {
  return {
    ...geometry,
    version: "v0.0.0",
    owner: null,
    description: null,
  };
}
