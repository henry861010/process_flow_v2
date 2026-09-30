"use client";

import * as React from "react";

import { previewGeneratedGeometry } from "@/lib/process-flow-api";
import { generatedGeometryId } from "@/lib/process-flow/configuration";
import type { FlowConfiguration, GeometryEntity, GeneratorGeometryBinding } from "@/lib/process-flow/types";

type Resolved = { recipeKey: string; geometry?: GeometryEntity; error?: string };

export function useGeneratorBindingGeometries(configuration: FlowConfiguration) {
  const recipeKey = JSON.stringify(
    Object.entries(configuration.inputBindings)
      .filter((entry): entry is [string, GeneratorGeometryBinding] => entry[1].kind === "generator")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const [resolved, setResolved] = React.useState<Record<string, Resolved>>({});

  React.useEffect(() => {
    const controller = new AbortController();
    const entries = JSON.parse(recipeKey) as Array<[string, GeneratorGeometryBinding]>;
    for (const [flowInputId, binding] of entries) {
      const currentKey = JSON.stringify(binding);
      void previewGeneratedGeometry(
        binding.generatorId,
        binding.generatorVersion,
        binding.parameters,
        controller.signal,
      ).then((preview) => {
        if (controller.signal.aborted) return;
        const entity = preview.geometryEntityJson;
        setResolved((current) => ({
          ...current,
          [flowInputId]: {
            recipeKey: currentKey,
            geometry: preview.valid && entity ? {
              ...entity,
              id: generatedGeometryId(flowInputId),
              category: entity.category ?? "",
              owner: entity.owner ?? "",
              description: entity.description ?? "",
            } : undefined,
            error: preview.valid ? undefined : Object.values(preview.errors).join("; "),
          },
        }));
      }).catch((error) => {
        if (controller.signal.aborted) return;
        setResolved((current) => ({
          ...current,
          [flowInputId]: {
            recipeKey: currentKey,
            error: error instanceof Error ? error.message : "Generator preview failed.",
          },
        }));
      });
    }
    return () => controller.abort();
  }, [recipeKey]);

  const geometries: GeometryEntity[] = [];
  const errors: Record<string, string> = {};
  for (const [flowInputId, binding] of Object.entries(configuration.inputBindings)) {
    if (binding.kind !== "generator") continue;
    const entry = resolved[flowInputId];
    if (entry?.recipeKey !== JSON.stringify(binding)) continue;
    if (entry.geometry) geometries.push(entry.geometry);
    if (entry.error) errors[flowInputId] = entry.error;
  }
  return { geometries, errors };
}
