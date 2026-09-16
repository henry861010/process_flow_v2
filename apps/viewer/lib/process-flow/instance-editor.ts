import { createEmptyFlowConfiguration } from "./configuration";
import type {
  FlowConfiguration,
  ProcessFlowInstance,
  ProcessFlowInstanceCreate,
  ProcessFlowTemplate,
  ProcessStepTemplate,
} from "./types";

export type InstanceIdentityDraft = Pick<
  ProcessFlowInstance,
  "id" | "name" | "version" | "owner" | "description"
>;

export function instanceEditorEntry(search: string) {
  const params = new URLSearchParams(search);
  return {
    templateId: params.get("templateId"),
    workspaceUnsupported: params.has("workspaceId"),
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
  if (!instance) return createEmptyFlowConfiguration(template, stepTemplates);
  return {
    inputBindings: structuredClone(instance.inputBindings),
    stepConfigurations: structuredClone(instance.stepConfigurations),
    embeddedGeometries: {},
  };
}

export function newInstanceIdentity(): InstanceIdentityDraft {
  return { id: "", name: "", version: "V0.0.0", owner: "", description: "" };
}

export function validateInstanceIdentity(
  identity: InstanceIdentityDraft,
  instances: ProcessFlowInstance[],
) {
  if (!identity.name.trim()) return "Instance name is required.";
  if (!identity.id.trim()) return "Instance id is required.";
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(identity.id.trim())) {
    return "Instance id must start with a letter and use only letters, numbers, _, -, or .";
  }
  if (instances.some((instance) => instance.id === identity.id.trim())) {
    return "Instance id already exists.";
  }
  if (!identity.version.trim()) return "Version is required.";
  if (!identity.owner.trim()) return "Owner is required.";
  return null;
}

export function buildProcessFlowInstanceCreate(
  templateId: string,
  identity: InstanceIdentityDraft,
  configuration: FlowConfiguration,
): ProcessFlowInstanceCreate {
  return {
    schemaVersion: 2,
    id: identity.id.trim(),
    name: identity.name.trim(),
    version: identity.version.trim(),
    owner: identity.owner.trim(),
    description: identity.description.trim(),
    processFlowTemplateId: templateId,
    inputBindings: structuredClone(configuration.inputBindings),
    stepConfigurations: structuredClone(configuration.stepConfigurations),
    embeddedGeometries: {},
  };
}
