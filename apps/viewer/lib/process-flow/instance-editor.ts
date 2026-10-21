import { analyzeFlowDependencies } from "./dependencies";
import { createEmptyFlowConfiguration } from "./configuration";
import type {
  FlowConfiguration,
  ProcessFlowInstance,
  ProcessFlowInstanceCreate,
  ProcessFlowInstanceForNewTemplateCreate,
  ProcessFlowTemplate,
  ProcessStepTemplate,
} from "./types";

export type InstanceIdentityDraft = Pick<
  ProcessFlowInstance,
  "name" | "version" | "owner" | "description"
>;

export function instanceEditorEntry(search: string) {
  const params = new URLSearchParams(search);
  return {
    templateId: params.get("templateId"),
    instanceId: params.get("instanceId"),
  };
}

export function instancesForTemplate(
  instances: ProcessFlowInstance[],
  templateId: string,
) {
  return instances
    .filter((instance) => instance.processFlowTemplateId === templateId)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function configurationFromInstance(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  instance?: ProcessFlowInstance,
): FlowConfiguration {
  if (!instance) {
    const configuration = createEmptyFlowConfiguration(template, stepTemplates);
    const templatesById = new Map(stepTemplates.map((step) => [step.id, step]));
    for (const ref of template.stepRefs) {
      if (templatesById.get(ref.processStepTemplateId)?.program === "pnp/pnp") {
        configuration.stepConfigurations[ref.stepRefId].parameterValues.placements = [];
      }
    }
    return configuration;
  }
  return instanceFlowConfiguration(instance);
}

export function newInstanceIdentity(): InstanceIdentityDraft {
  return { name: "", version: "V0.0.0", owner: "", description: "" };
}

export function validateInstanceIdentity(
  identity: InstanceIdentityDraft,
) {
  if (!identity.name.trim()) return "Instance name is required.";
  if (!identity.version.trim()) return "Version is required.";
  if (!identity.owner.trim()) return "Owner is required.";
  return null;
}

export function buildProcessFlowInstanceCreate(
  templateId: string,
  identity: InstanceIdentityDraft,
  configuration?: FlowConfiguration,
): ProcessFlowInstanceCreate {
  return {
    ...buildProcessFlowInstanceForNewTemplateCreate(identity, configuration),
    processFlowTemplateId: templateId,
  };
}

export function buildProcessFlowInstanceForNewTemplateCreate(
  identity: InstanceIdentityDraft,
  configuration?: FlowConfiguration,
): ProcessFlowInstanceForNewTemplateCreate {
  return {
    schemaVersion: 2,
    name: identity.name.trim(),
    version: identity.version.trim(),
    owner: identity.owner.trim(),
    description: identity.description.trim(),
    ...(configuration ? { initialConfiguration: structuredClone(configuration) } : {}),
  };
}

export function instanceFlowConfiguration(instance: ProcessFlowInstance): FlowConfiguration {
  const configuration: FlowConfiguration = {
    inputBindings: structuredClone(instance.inputBindings), stepConfigurations: {}, embeddedGeometries: {},
  };
  for (const [stepId, station] of Object.entries(instance.stepConfigurations)) {
    const recipe = station.recipes.find((item) => item.id === station.activeRecipeId);
    if (recipe) configuration.stepConfigurations[stepId] = { parameterValues: structuredClone(recipe.parameterValues) };
  }
  return configuration;
}

export function missingActiveRecipeSteps(instance: ProcessFlowInstance, template: ProcessFlowTemplate,
  steps: ProcessStepTemplate[], outputStepRefId?: string) {
  const configuration = instanceFlowConfiguration(instance);
  const dependencies = analyzeFlowDependencies(template, steps, configuration, outputStepRefId);
  return [...dependencies.stepRefIds].filter((id) => !configuration.stepConfigurations[id]);
}
