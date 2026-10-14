import { getFlowInputReadiness, isParameterValueComplete } from "./configuration";
import { analyzeFlowDependencies } from "./dependencies";
import { buildProcessFlowInstanceForNewTemplateCreate } from "./instance-editor";
import type {
  EditorMetadata,
  FlowConfiguration,
  GeometryEntity,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  TemplateInstanceCreateRequest,
} from "./types";
import { normalizeStepLabel } from "./utils";

export function instanceMetadataForTemplate(
  template: EditorMetadata,
  overrides: Partial<EditorMetadata>,
): EditorMetadata {
  return { ...template, ...overrides };
}

export function buildTemplateInstanceCreate(
  template: ProcessFlowTemplate,
  identity: EditorMetadata,
  configuration: FlowConfiguration,
): TemplateInstanceCreateRequest {
  const { id: _temporaryId, ...processFlowTemplate } = structuredClone(template);
  return {
    processFlowTemplate,
    processFlowInstance: buildProcessFlowInstanceForNewTemplateCreate(identity, configuration),
  };
}

export function templateInstanceConfigurationIssues(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  configuration: FlowConfiguration,
  geometries: GeometryEntity[],
): string[] {
  const dependencies = analyzeFlowDependencies(template, stepTemplates, configuration);
  const issues: string[] = [];
  for (const input of template.flowInputs) {
    const readiness = getFlowInputReadiness(
      template, stepTemplates, configuration, geometries, input.flowInputId, dependencies,
    );
    if (readiness.status === "error" || readiness.status === "incomplete") {
      issues.push(readiness.reason);
    }
  }
  const templatesById = new Map(stepTemplates.map((step) => [step.id, step]));
  for (const ref of template.stepRefs) {
    if (!dependencies.stepRefIds.has(ref.stepRefId)) continue;
    const step = templatesById.get(ref.processStepTemplateId);
    if (!step) continue;
    const values = configuration.stepConfigurations[ref.stepRefId]?.parameterValues ?? {};
    for (const parameter of step.parameterDefinitions) {
      if (!isParameterValueComplete(parameter, values[parameter.id])) {
        issues.push(`${normalizeStepLabel(ref.stepLabel, step.name)}: ${parameter.name} is incomplete.`);
      }
    }
  }
  return issues;
}
