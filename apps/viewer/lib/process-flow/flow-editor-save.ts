import { getFlowInputReadiness, isParameterValueComplete } from "./configuration";
import { analyzeFlowDependencies } from "./dependencies";
import { selectedRecipe } from "./recipes";
import type { FlowDefinition, FlowConfiguration, GeometryEntity, ParameterDefinition, ProcessStepTemplate } from "./types";
import { normalizeStepLabel } from "./utils";

export function flowConfigurationIssues(definition: FlowDefinition, steps: ProcessStepTemplate[], configuration: FlowConfiguration, geometries: GeometryEntity[]): string[] {
  const dependencies = analyzeFlowDependencies(definition, steps, configuration);
  const issues: string[] = [];
  for (const input of definition.flowInputs) {
    const readiness = getFlowInputReadiness(definition, steps, configuration, geometries, input.flowInputId, dependencies);
    if (readiness.status === "error" || readiness.status === "incomplete") issues.push(readiness.reason);
  }
  for (const ref of definition.stepRefs) {
    if (!dependencies.stepRefIds.has(ref.stepRefId)) continue;
    const step = steps.find((step) => step.id === ref.processStepTemplateId);
    if (!step) continue;
    const recipe = selectedRecipe(configuration.stepConfigurations[ref.stepRefId]);
    if (!recipe) { issues.push(`${normalizeStepLabel(ref.stepLabel, step.name)}: select a recipe.`); continue; }
    for (const parameter of step.parameterDefinitions) {
      if (!isParameterValueComplete(parameter, recipe.parameterValues[parameter.id])) issues.push(`${normalizeStepLabel(ref.stepLabel, step.name)}: ${parameter.name} is incomplete.`);
    }
  }
  return issues;
}

// Missing values are allowed at authoring time; supplied values still follow the contract.
function validPartial(definition: ParameterDefinition, value: unknown): boolean {
  if (value === undefined) return true;
  if (definition.valueType === "fieldGroupArray") {
    if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items)) return false;
    const children = definition.repeatDefinition?.itemParameterDefinitions ?? [];
    const ids = new Set<string>();
    return value.items.every((item) => {
      if (!item || typeof item.itemId !== "string" || !item.itemId || ids.has(item.itemId) || !Number.isInteger(item.index) || !item.values || typeof item.values !== "object") return false;
      ids.add(item.itemId);
      return Object.entries(item.values).every(([key, child]) => {
        const parameter = children.find((candidate) => candidate.id === key);
        return Boolean(parameter && validPartial(parameter, child));
      });
    });
  }
  if ((definition.valueType === "string" || definition.valueType === "materialRef") && value === "") return true;
  return isParameterValueComplete({ ...definition, required: true }, value);
}
export function flowAuthoringIssues(definition: FlowDefinition, steps: ProcessStepTemplate[], configuration: FlowConfiguration): string[] {
  const issues: string[] = [];
  for (const [refId, config] of Object.entries(configuration.stepConfigurations)) {
    const ref = definition.stepRefs.find((ref) => ref.stepRefId === refId);
    const step = steps.find((step) => step.id === ref?.processStepTemplateId);
    if (!step) { issues.push(`Unknown step configuration: ${refId}`); continue; }
    const ids = new Set<string>();
    for (const recipe of config.recipeCandidates) {
      if (!recipe.recipeId || ids.has(recipe.recipeId) || !recipe.name.trim()) issues.push(`${refId}: recipe IDs must be unique and names are required.`);
      ids.add(recipe.recipeId);
      for (const [key, value] of Object.entries(recipe.parameterValues)) {
        const parameter = step.parameterDefinitions.find((item) => item.id === key);
        if (!parameter || !validPartial(parameter, value)) issues.push(`${refId} / ${recipe.name}: invalid value for ${parameter?.name ?? key}.`);
      }
    }
    if (config.selectedRecipeId !== null && !ids.has(config.selectedRecipeId)) issues.push(`${refId}: adopted recipe is missing.`);
  }
  return issues;
}
