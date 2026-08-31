"use client";

import { Boxes, Layers3 } from "lucide-react";

import { BackendGeometryGeneratorDialog } from "@/components/geometry-generator/backend-geometry-generator-dialog";
import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import type { GeometryGeneratorDefineResult } from "@/components/geometry-generator/geometry-generator-types";

export type GeometryGeneratorId = string;
export type { GeometryGeneratorDefinition };

export function GeometryGeneratorIcon({ definition }: { definition: GeometryGeneratorDefinition }) {
  if (definition.icon === "layers") {
    return <Layers3 />;
  }
  return <Boxes />;
}

export function GeometryGeneratorDialogLauncher({
  definition,
  initialParameters,
  onClose,
  onDefine,
}: {
  definition: GeometryGeneratorDefinition;
  initialParameters?: Record<string, unknown>;
  onClose: () => void;
  onDefine: (result: GeometryGeneratorDefineResult) => void;
}) {
  return (
    <BackendGeometryGeneratorDialog
      definition={definition}
      mode="flowInput"
      initialParameters={initialParameters}
      onClose={onClose}
      onDefine={onDefine}
    />
  );
}

export function GeometryGeneratorCatalogDialogLauncher({
  definition,
  onClose,
}: {
  definition: GeometryGeneratorDefinition;
  onClose: () => void;
}) {
  return (
    <BackendGeometryGeneratorDialog
      definition={definition}
      mode="catalog"
      onClose={onClose}
    />
  );
}

export function geometryGenerator(
  definitions: GeometryGeneratorDefinition[],
  generatorId: GeometryGeneratorId,
) {
  const generator = definitions.find((candidate) => candidate.id === generatorId);
  if (!generator) throw new Error(`Unknown geometry generator: ${generatorId}`);
  return generator;
}
