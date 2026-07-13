"use client";

import type * as React from "react";
import { Boxes, Layers3, type LucideIcon } from "lucide-react";

import { DramGeneratorDialog } from "@/components/dram-generator/dram-generator-dialog";
import type {
  GeometryGeneratorDefineResult,
  GeometryGeneratorDialogBaseProps,
} from "@/components/geometry-generator/geometry-generator-types";
import { HbmGeneratorDialog } from "@/components/hbm-generator/hbm-generator-dialog";
import {
  validateDramParameters,
  type DramGeneratorParameters,
} from "@/lib/dram-generator";
import {
  validateHbmParameters,
  type HbmGeneratorParameters,
} from "@/lib/hbm-generator";

export type GeometryGeneratorId = "hbm" | "dram";

export type GeometryGeneratorDefinition = {
  id: GeometryGeneratorId;
  label: string;
  Icon: LucideIcon;
  renderDialog: (
    props: GeometryGeneratorDialogBaseProps,
  ) => React.ReactElement;
};

export const GEOMETRY_GENERATORS: readonly GeometryGeneratorDefinition[] = [
  {
    id: "hbm",
    label: "HBM generator",
    Icon: Boxes,
    renderDialog: (props) => (
      <HbmGeneratorDialog
        {...props}
        initialParameters={validHbmParameters(props.initialParameters)}
      />
    ),
  },
  {
    id: "dram",
    label: "DRAM generator",
    Icon: Layers3,
    renderDialog: (props) => (
      <DramGeneratorDialog
        {...props}
        initialParameters={validDramParameters(props.initialParameters)}
      />
    ),
  },
] as const;

export function GeometryGeneratorDialogLauncher({
  generatorId,
  initialParameters,
  onClose,
  onDefine,
}: {
  generatorId: GeometryGeneratorId;
  initialParameters?: Record<string, unknown>;
  onClose: () => void;
  onDefine: (result: GeometryGeneratorDefineResult) => void;
}) {
  const generator = geometryGenerator(generatorId);
  return generator.renderDialog({
    mode: "flowInput",
    initialParameters,
    onClose,
    onDefine,
  });
}

export function GeometryGeneratorCatalogDialogLauncher({
  generatorId,
  onClose,
}: {
  generatorId: GeometryGeneratorId;
  onClose: () => void;
}) {
  return geometryGenerator(generatorId).renderDialog({ mode: "catalog", onClose });
}

export function geometryGenerator(generatorId: GeometryGeneratorId) {
  const generator = GEOMETRY_GENERATORS.find((candidate) => candidate.id === generatorId);
  if (!generator) throw new Error(`Unknown geometry generator: ${generatorId}`);
  return generator;
}

function validHbmParameters(
  value: Record<string, unknown> | undefined,
): HbmGeneratorParameters | undefined {
  if (!value) return undefined;
  try {
    const parameters = value as unknown as HbmGeneratorParameters;
    return Object.keys(validateHbmParameters(parameters)).length === 0
      ? structuredClone(parameters)
      : undefined;
  } catch {
    return undefined;
  }
}

function validDramParameters(
  value: Record<string, unknown> | undefined,
): DramGeneratorParameters | undefined {
  if (!value) return undefined;
  try {
    const parameters = value as unknown as DramGeneratorParameters;
    return Object.keys(validateDramParameters(parameters)).length === 0
      ? structuredClone(parameters)
      : undefined;
  } catch {
    return undefined;
  }
}
