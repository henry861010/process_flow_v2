import type {
  GeometryGeneratorDefinition,
  GeometryGeneratorUiPlacement,
} from "./geometry-generator-contracts";
import { geometryMatchesFlowInput } from "../../lib/process-flow/configuration";
import type { FlowInputDefinition, GeometryBinding } from "../../lib/process-flow/types";

export function generatorAvailableIn(
  definition: GeometryGeneratorDefinition,
  placement: GeometryGeneratorUiPlacement,
): boolean {
  return definition.uiPlacements.includes(placement);
}

export function generatorsForPlacement(
  definitions: GeometryGeneratorDefinition[],
  placement: GeometryGeneratorUiPlacement,
): GeometryGeneratorDefinition[] {
  return definitions.filter((definition) => generatorAvailableIn(definition, placement));
}

export function generatorsForFlowInput(
  definitions: GeometryGeneratorDefinition[],
  flowInput: FlowInputDefinition,
): GeometryGeneratorDefinition[] {
  return generatorsForPlacement(definitions, "flowInputPicker").filter((definition) =>
    geometryMatchesFlowInput({
      entityType: definition.entityType,
      category: definition.category,
      structureFormat: "standard",
    }, flowInput),
  );
}

export function canEditGeneratorBinding(
  definitions: GeometryGeneratorDefinition[],
  binding: GeometryBinding | undefined,
): boolean {
  return binding?.kind === "generator" && definitions.some((definition) =>
    definition.id === binding.generatorId && generatorAvailableIn(definition, "flowInputPicker"),
  );
}

export function generatorsForFlowInputPicker(
  definitions: GeometryGeneratorDefinition[],
  flowInput: FlowInputDefinition,
  binding: GeometryBinding | undefined,
): GeometryGeneratorDefinition[] {
  const matchingIds = new Set(generatorsForFlowInput(definitions, flowInput).map((definition) => definition.id));
  if (binding?.kind === "generator" && canEditGeneratorBinding(definitions, binding)) {
    matchingIds.add(binding.generatorId);
  }
  const seen = new Set<string>();
  return generatorsForPlacement(definitions, "flowInputPicker").filter((definition) => {
    if (!matchingIds.has(definition.id) || seen.has(definition.id)) return false;
    seen.add(definition.id);
    return true;
  });
}

export function catalogGeneratorHref(definition: GeometryGeneratorDefinition): string {
  return `/geometry-generator?generatorId=${encodeURIComponent(definition.id)}`;
}

export function generatorDisplayName(definition: GeometryGeneratorDefinition): string {
  return definition.label.replace(/\s+generator$/i, "");
}
