import type {
  FlowConfiguration,
  GeometryConstraints,
  GeometryEntity,
  ParameterDefinition,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  StepConfiguration,
} from "./types";
import { resolveFlowParameterDefaults } from "./parameter-values";
import { isPlacementValid } from "./placement-validation";
import { analyzeFlowDependencies, type FlowDependencies } from "./dependencies";

export function geometryCategoryConstraints(
  geometry: Pick<GeometryEntity, "category">,
): GeometryConstraints | null {
  const category = geometry.category;
  return category.trim() ? { categories: [category] } : null;
}

export function createEmptyFlowConfiguration(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
): FlowConfiguration {
  const templatesById = new Map(stepTemplates.map((item) => [item.id, item]));
  const stepConfigurations: Record<string, StepConfiguration> = {};
  template.stepRefs.forEach((stepRef) => {
    const stepTemplate = templatesById.get(stepRef.processStepTemplateId);
    stepConfigurations[stepRef.stepRefId] = {
      parameterValues: resolveFlowParameterDefaults(
        stepRef,
        stepTemplate?.parameterDefinitions ?? [],
      ),
    };
  });
  return {
    inputBindings: {},
    stepConfigurations,
    embeddedGeometries: {},
  };
}

export function geometryForFlowInput(
  configuration: FlowConfiguration,
  flowInputId: string,
  geometries: GeometryEntity[],
) {
  const binding = configuration.inputBindings[flowInputId];
  if (!binding) return null;
  if (binding.kind === "catalog") {
    return geometries.find((geometry) => geometry.id === binding.geometryId) ?? null;
  }
  if (binding.kind === "generator") {
    return geometries.find((geometry) => geometry.id === generatedGeometryId(flowInputId)) ?? null;
  }
  const embedded = configuration.embeddedGeometries[binding.localId];
  return embedded ? { ...embedded, id: binding.localId } : null;
}

export function generatedGeometryId(flowInputId: string) {
  return `generator:${flowInputId}`;
}

export type ConfigurationReadinessStatus =
  | "neutral"
  | "ready"
  | "incomplete"
  | "error";

export type ConfigurationReadinessCode =
  | "ready"
  | "optional-unbound"
  | "unused-dependency"
  | "unbound-geometry"
  | "unresolved-geometry"
  | "geometry-constraint"
  | "missing-input-edge"
  | "missing-step-template"
  | "incomplete-parameter"
  | "cycle";

export type ConfigurationReadiness = {
  status: ConfigurationReadinessStatus;
  code: ConfigurationReadinessCode;
  reason: string;
  flowInputId?: string;
  stepRefId?: string;
};

export function getFlowInputReadiness(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  configuration: FlowConfiguration,
  geometries: GeometryEntity[],
  flowInputId: string,
  dependencies = analyzeFlowDependencies(template, stepTemplates, configuration),
): ConfigurationReadiness {
  const input = template.flowInputs.find(
    (candidate) => candidate.flowInputId === flowInputId,
  );
  if (!input) {
    return {
      status: "error",
      code: "unresolved-geometry",
      reason: `Geometry Input ${flowInputId} is missing from the template.`,
      flowInputId,
    };
  }

  if (template.stepRefs.length > 0 && !dependencies.flowInputIds.has(flowInputId)) {
    return {
      status: "neutral", code: "unused-dependency",
      reason: `${input.name} is unused in this configuration.`, flowInputId,
    };
  }
  const binding = configuration.inputBindings[flowInputId];
  if (!binding) {
    const required = isFlowInputBindingRequired(
      template,
      stepTemplates,
      flowInputId,
      dependencies,
    );
    return required
      ? {
          status: "incomplete",
          code: "unbound-geometry",
          reason: `${input.name} needs a geometry binding.`,
          flowInputId,
        }
      : {
          status: "neutral",
          code: "optional-unbound",
          reason: `${input.name} is optional and unbound.`,
          flowInputId,
        };
  }

  const geometry = geometryForFlowInput(configuration, flowInputId, geometries);
  if (!geometry) {
    return {
      status: "error",
      code: "unresolved-geometry",
      reason: `${input.name} references a geometry that cannot be resolved.`,
      flowInputId,
    };
  }
  if (!geometryMatchesFlowInput(geometry, input)) {
    return {
      status: "error",
      code: "geometry-constraint",
      reason: `${geometry.name} does not satisfy ${input.name} constraints.`,
      flowInputId,
    };
  }
  return {
    status: "ready",
    code: "ready",
    reason: `${input.name} is bound to ${geometry.name}.`,
    flowInputId,
  };
}

export function getStepExecutionReadiness(
  stepRefId: string,
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  configuration: FlowConfiguration,
  geometries: GeometryEntity[],
): ConfigurationReadiness {
  const structureError = getTemplateStructureError(template, stepTemplates);
  if (structureError) return structureError;
  return getStepDependencyReadiness(stepRefId, template, stepTemplates, configuration, geometries);
}

function getStepDependencyReadiness(
  stepRefId: string,
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  configuration: FlowConfiguration,
  geometries: GeometryEntity[],
): ConfigurationReadiness {
  const structureError = getTemplateStructureError(template, stepTemplates, stepRefId);
  if (structureError) return structureError;
  const dependencies = analyzeFlowDependencies(
    template, stepTemplates, configuration, stepRefId,
  );
  const requiredSteps = dependencies.stepRefIds;

  const stepTemplateById = new Map(stepTemplates.map((item) => [item.id, item]));
  for (const input of template.flowInputs) {
    const sourceEdges = dependencies.edges.filter(
      (edge) =>
        edge.source.kind === "flowInput" &&
        edge.source.flowInputId === input.flowInputId &&
        requiredSteps.has(edge.target.stepRefId),
    );
    if (sourceEdges.length === 0) continue;
    const readiness = getFlowInputReadiness(
      template,
      stepTemplates,
      configuration,
      geometries,
      input.flowInputId,
      dependencies,
    );
    if (readiness.status !== "ready" && readiness.status !== "neutral") {
      return { ...readiness, stepRefId: sourceEdges[0].target.stepRefId };
    }
  }

  for (const ref of template.stepRefs) {
    if (!requiredSteps.has(ref.stepRefId)) continue;
    const stepTemplate = stepTemplateById.get(ref.processStepTemplateId);
    if (!stepTemplate) continue;
    const values =
      configuration.stepConfigurations[ref.stepRefId]?.parameterValues ?? {};
    const missing = stepTemplate.parameterDefinitions.find(
      (parameter) => !isParameterValueComplete(parameter, values[parameter.id]),
    );
    if (missing) {
      return {
        status: "incomplete",
        code: "incomplete-parameter",
        reason: `${stepDisplayName(ref.stepLabel, stepTemplate.name)}: ${missing.name} is incomplete.`,
        stepRefId: ref.stepRefId,
      };
    }
  }

  return {
    status: "ready",
    code: "ready",
    reason: "This step and its dependencies are configured.",
    stepRefId,
  };
}

export function isParameterValueComplete(
  definition: ParameterDefinition,
  value: unknown,
): boolean {
  if (definition.required === false && (value === undefined || value === null || value === "")) {
    return true;
  }
  if (value === undefined || value === null || value === "") return false;
  if (definition.valueType === "fieldGroupArray") {
    if (!isRecord(value) || !Array.isArray(value.items)) return false;
    const repeat = definition.repeatDefinition;
    if (!repeat) return false;
    if (repeat.minItems != null && value.items.length < repeat.minItems) return false;
    if (repeat.maxItems != null && value.items.length > repeat.maxItems) return false;
    const itemIds = new Set<string>();
    return value.items.every((item) => {
      if (!isRecord(item)) return false;
      if (typeof item.itemId !== "string" || !item.itemId || itemIds.has(item.itemId)) {
        return false;
      }
      itemIds.add(item.itemId);
      if (typeof item.index !== "number" || !Number.isFinite(item.index)) return false;
      const itemValues = item.values;
      if (!isRecord(itemValues)) return false;
      return repeat.itemParameterDefinitions.every((child) =>
        isParameterValueComplete(child, itemValues[child.id]),
      );
    });
  }
  if (definition.valueType === "placements") {
    if (!Array.isArray(value)) return false;
    return value.every(isPlacementValid);
  }
  if (definition.valueType.endsWith("[]")) {
    if (!Array.isArray(value)) return false;
    const scalarType = definition.valueType.slice(0, -2);
    return value.every((item) => scalarValueIsValid(scalarType, item, definition));
  }
  return scalarValueIsValid(definition.valueType, value, definition);
}

export function isConfigurationComplete(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  configuration: FlowConfiguration,
  geometries: GeometryEntity[],
) {
  if (getTemplateStructureError(template, stepTemplates)) return false;
  const knownInputs = new Set(template.flowInputs.map((input) => input.flowInputId));
  const knownSteps = new Set(template.stepRefs.map((ref) => ref.stepRefId));
  if (
    !isRecord(configuration.inputBindings) || !isRecord(configuration.stepConfigurations) ||
    !isRecord(configuration.embeddedGeometries) ||
    Object.keys(configuration.inputBindings).some((id) => !knownInputs.has(id)) ||
    Object.entries(configuration.stepConfigurations).some(([id, step]) =>
      !knownSteps.has(id) || !isRecord(step) ||
      !isRecord(step.parameterValues === undefined ? {} : step.parameterValues),
    )
  ) return false;
  const dependencies = analyzeFlowDependencies(template, stepTemplates, configuration);
  if (template.flowInputs.some((input) => {
    const readiness = getFlowInputReadiness(
      template, stepTemplates, configuration, geometries, input.flowInputId, dependencies,
    );
    return readiness.status === "error" || readiness.status === "incomplete";
  })) return false;
  const templatesById = new Map(stepTemplates.map((item) => [item.id, item]));
  return template.stepRefs.every((ref) => {
    if (!dependencies.stepRefIds.has(ref.stepRefId)) return true;
    const step = templatesById.get(ref.processStepTemplateId);
    if (!step) return false;
    const values = configuration.stepConfigurations[ref.stepRefId]?.parameterValues ?? {};
    return step.parameterDefinitions.every((parameter) =>
      isParameterValueComplete(parameter, values[parameter.id]),
    );
  });
}

export function getStepConfigurationReadiness(
  stepRefId: string,
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  configuration: FlowConfiguration,
  geometries: GeometryEntity[],
): ConfigurationReadiness {
  const structureError = getTemplateStructureError(template, stepTemplates, stepRefId);
  if (structureError) return structureError;
  const dependencies = analyzeFlowDependencies(template, stepTemplates, configuration);
  // In an unfinished graph, missing terminal roots may also make a step unreachable.
  // Only a structurally valid graph can classify a branch as unused.
  if (!dependencies.stepRefIds.has(stepRefId) && !getTemplateStructureError(template, stepTemplates)) {
    return {
      status: "neutral", code: "unused-dependency",
      reason: "Unused in this configuration. Preview requires this branch's configuration.",
      stepRefId,
    };
  }
  return getStepDependencyReadiness(stepRefId, template, stepTemplates, configuration, geometries);
}

export function isFlowInputBindingRequired(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  flowInputId: string,
  dependencies?: FlowDependencies,
) {
  if (dependencies && template.stepRefs.length > 0 && !dependencies.flowInputIds.has(flowInputId)) {
    return false;
  }
  const stepRefsById = new Map(template.stepRefs.map((item) => [item.stepRefId, item]));
  const templatesById = new Map(stepTemplates.map((item) => [item.id, item]));
  const flowInput = template.flowInputs.find((input) => input.flowInputId === flowInputId);
  if (flowInput?.required !== false) return true;
  return (dependencies?.edges ?? template.flowEdges).some((edge) => {
    if (edge.source.kind !== "flowInput" || edge.source.flowInputId !== flowInputId) return false;
    const stepRef = stepRefsById.get(edge.target.stepRefId);
    const step = stepRef ? templatesById.get(stepRef.processStepTemplateId) : undefined;
    return step?.inputPorts.find((port) => port.portId === edge.target.inputPortId)?.required !== false;
  });
}

function getTemplateStructureError(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  outputStepRefId?: string,
): ConfigurationReadiness | null {
  if (outputStepRefId !== undefined) {
    if (!template.stepRefs.some((ref) => ref.stepRefId === outputStepRefId)) {
      return {
        status: "error", code: "missing-step-template",
        reason: `Process step ${outputStepRefId} is missing.`, stepRefId: outputStepRefId,
      };
    }
    // Topology still includes die inputs even when zero placements prune execution.
    // Downstream and unrelated wiring errors must not change this node's status.
    const upstream = upstreamStepIds(template, outputStepRefId);
    const flowEdges = template.flowEdges.filter((edge) => upstream.has(edge.target.stepRefId));
    const flowInputIds = new Set(flowEdges.flatMap((edge) =>
      edge.source.kind === "flowInput" ? [edge.source.flowInputId] : [],
    ));
    template = {
      ...template,
      stepRefs: template.stepRefs.filter((ref) => upstream.has(ref.stepRefId)),
      flowEdges,
      flowInputs: template.flowInputs.filter((input) => flowInputIds.has(input.flowInputId)),
    };
  }
  const refs = new Map(template.stepRefs.map((ref) => [ref.stepRefId, ref]));
  const steps = new Map(stepTemplates.map((step) => [step.id, step]));
  const inputs = new Set(template.flowInputs.map((input) => input.flowInputId));
  const invalid = (reason: string): ConfigurationReadiness => ({
    status: "error", code: "missing-input-edge", reason,
  });
  if (refs.size !== template.stepRefs.length || inputs.size !== template.flowInputs.length) {
    return invalid("Duplicate flow input or step reference.");
  }
  if (hasStepCycle(template, new Set(refs.keys()))) {
    return { status: "error", code: "cycle", reason: "Process flow contains a cycle." };
  }
  for (const ref of template.stepRefs) {
    const step = steps.get(ref.processStepTemplateId);
    if (!step) return {
      status: "error", code: "missing-step-template",
      reason: `Process step template ${ref.processStepTemplateId} is missing.`,
      stepRefId: ref.stepRefId,
    };
    for (const port of step.inputPorts) {
      if (port.required && !template.flowEdges.some((edge) =>
        edge.target.stepRefId === ref.stepRefId && edge.target.inputPortId === port.portId,
      )) {
        return {
          ...invalid(`${stepDisplayName(ref.stepLabel, step.name)} needs ${port.name}.`),
          stepRefId: ref.stepRefId,
        };
      }
    }
  }
  const edgeIds = new Set<string>();
  const targets = new Set<string>();
  const sources = new Set<string>();
  for (const edge of template.flowEdges) {
    const target = refs.get(edge.target.stepRefId);
    const targetPort = target && steps.get(target.processStepTemplateId)?.inputPorts.find(
      (port) => port.portId === edge.target.inputPortId,
    );
    const key = JSON.stringify([edge.target.stepRefId, edge.target.inputPortId]);
    if (!targetPort || edgeIds.has(edge.edgeId) || targets.has(key)) {
      return invalid("Invalid or duplicate flow edge.");
    }
    edgeIds.add(edge.edgeId);
    targets.add(key);
    if (edge.source.kind === "flowInput") {
      if (!inputs.has(edge.source.flowInputId)) return invalid("Flow input is missing from the template.");
    } else {
      const source = refs.get(edge.source.stepRefId);
      const outputPortId = edge.source.outputPortId;
      const sourcePort = source && steps.get(source.processStepTemplateId)?.outputPorts.find(
        (port) => port.portId === outputPortId,
      );
      const sourceKey = JSON.stringify([edge.source.stepRefId, edge.source.outputPortId]);
      if (!sourcePort || sources.has(sourceKey)) {
        return invalid("Invalid step output or unsupported fan-out.");
      }
      sources.add(sourceKey);
    }
  }
  return null;
}

function scalarValueIsValid(
  valueType: string,
  value: unknown,
  definition: ParameterDefinition,
) {
  if (valueType === "string" || valueType === "materialRef") {
    if (typeof value !== "string") return false;
    const validation = definition.validation;
    if (validation?.minLength != null && value.length < validation.minLength) return false;
    if (validation?.maxLength != null && value.length > validation.maxLength) return false;
    if (validation?.regex) {
      try {
        if (!new RegExp(`^(?:${validation.regex})$`).test(value)) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  if (valueType === "integer") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      numericValueIsValid(value, definition)
    );
  }
  if (valueType === "float") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      numericValueIsValid(value, definition)
    );
  }
  if (valueType === "boolean") return typeof value === "boolean";
  return false;
}

function numericValueIsValid(value: number, definition: ParameterDefinition) {
  const validation = definition.validation;
  if (validation?.min != null) {
    if (validation.exclusiveMin ? value <= validation.min : value < validation.min) {
      return false;
    }
  }
  if (validation?.max != null) {
    if (validation.exclusiveMax ? value >= validation.max : value > validation.max) {
      return false;
    }
  }
  return true;
}

export function geometryMatchesFlowInput(
  geometry:
    | ReturnType<typeof geometryForFlowInput>
    | { entityType: string; category?: string | null; structureFormat: string },
  input: ProcessFlowTemplate["flowInputs"][number],
) {
  if (!geometry) return false;
  const constraints = input.geometryConstraints;
  if (!constraints) return true;
  if (
    constraints.entityTypes?.length &&
    !constraints.entityTypes.includes(geometry.entityType)
  ) {
    return false;
  }
  const category = geometry.category ?? "";
  if (
    constraints.categories?.length &&
    !constraints.categories.some(
      (item) => category === item || category.startsWith(`${item}.`),
    )
  ) {
    return false;
  }
  return !(
    constraints.structureFormats?.length &&
    !constraints.structureFormats.includes(geometry.structureFormat)
  );
}

function upstreamStepIds(template: ProcessFlowTemplate, outputStepRefId: string) {
  const stepRefIds = new Set<string>();
  const pending = [outputStepRefId];
  while (pending.length) {
    const stepRefId = pending.pop()!;
    if (stepRefIds.has(stepRefId)) continue;
    stepRefIds.add(stepRefId);
    for (const edge of template.flowEdges) {
      if (edge.target.stepRefId === stepRefId && edge.source.kind === "stepOutput") {
        pending.push(edge.source.stepRefId);
      }
    }
  }
  return stepRefIds;
}

function hasStepCycle(
  template: ProcessFlowTemplate,
  relevantStepIds: Set<string>,
) {
  const adjacency = new Map<string, string[]>();
  template.flowEdges.forEach((edge) => {
    if (
      edge.source.kind !== "stepOutput" ||
      !relevantStepIds.has(edge.source.stepRefId) ||
      !relevantStepIds.has(edge.target.stepRefId)
    ) {
      return;
    }
    adjacency.set(edge.source.stepRefId, [
      ...(adjacency.get(edge.source.stepRefId) ?? []),
      edge.target.stepRefId,
    ]);
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (current: string): boolean => {
    if (visiting.has(current)) return true;
    if (visited.has(current)) return false;
    visiting.add(current);
    if ((adjacency.get(current) ?? []).some(visit)) return true;
    visiting.delete(current);
    visited.add(current);
    return false;
  };
  return Array.from(relevantStepIds).some(visit);
}

function stepDisplayName(stepLabel: string | undefined, templateName: string) {
  return stepLabel?.trim() || templateName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
