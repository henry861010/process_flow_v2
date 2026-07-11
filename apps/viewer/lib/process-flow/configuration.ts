import type {
  FlowConfiguration,
  GeometryEntity,
  ParameterDefinition,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  StepConfiguration,
} from "@/lib/process-flow/types";
import { createDefaultParameterValues } from "@/lib/process-flow/parameter-values";

export function createEmptyFlowConfiguration(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
): FlowConfiguration {
  const templatesById = new Map(stepTemplates.map((item) => [item.id, item]));
  const stepConfigurations: Record<string, StepConfiguration> = {};
  template.stepRefs.forEach((stepRef) => {
    const stepTemplate = templatesById.get(stepRef.processStepTemplateId);
    stepConfigurations[stepRef.stepRefId] = {
      parameterValues: createDefaultParameterValues(
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
  const embedded = configuration.embeddedGeometries[binding.localId];
  return embedded ? { ...embedded, id: binding.localId } : null;
}

export type ConfigurationReadinessStatus =
  | "neutral"
  | "ready"
  | "incomplete"
  | "error";

export type ConfigurationReadinessCode =
  | "ready"
  | "optional-unbound"
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

  const binding = configuration.inputBindings[flowInputId];
  if (!binding) {
    const required = isFlowInputBindingRequired(
      template,
      stepTemplates,
      flowInputId,
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
  const requiredSteps = upstreamStepIds(template, stepRefId);
  if (hasStepCycle(template, requiredSteps)) {
    return {
      status: "error",
      code: "cycle",
      reason: "Process flow contains a cycle.",
      stepRefId,
    };
  }

  const stepTemplateById = new Map(stepTemplates.map((item) => [item.id, item]));
  for (const ref of template.stepRefs) {
    if (!requiredSteps.has(ref.stepRefId)) continue;
    const stepTemplate = stepTemplateById.get(ref.processStepTemplateId);
    if (!stepTemplate) {
      return {
        status: "error",
        code: "missing-step-template",
        reason: `Process step template ${ref.processStepTemplateId} is missing.`,
        stepRefId: ref.stepRefId,
      };
    }
    const missingPort = stepTemplate.inputPorts.find(
      (port) =>
        port.required &&
        !template.flowEdges.some(
          (edge) =>
            edge.target.stepRefId === ref.stepRefId &&
            edge.target.inputPortId === port.portId,
        ),
    );
    if (missingPort) {
      return {
        status: "error",
        code: "missing-input-edge",
        reason: `${stepDisplayName(ref.stepLabel, stepTemplate.name)} needs ${missingPort.name}.`,
        stepRefId: ref.stepRefId,
      };
    }
  }

  for (const input of template.flowInputs) {
    const sourceEdges = template.flowEdges.filter(
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
    reason: "Ready to preview.",
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
  if (definition.valueType === "coordinates") {
    if (!Array.isArray(value)) return false;
    const seen = new Set<string>();
    return value.every((coordinate) => {
      if (
        !Array.isArray(coordinate) ||
        coordinate.length !== 2 ||
        !coordinate.every(
          (item) => typeof item === "number" && Number.isFinite(item),
        )
      ) {
        return false;
      }
      const key = `${coordinate[0]}:${coordinate[1]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
  const templatesById = new Map(stepTemplates.map((item) => [item.id, item]));
  if (
    template.flowInputs.some((input) => {
      const geometry = geometryForFlowInput(
        configuration,
        input.flowInputId,
        geometries,
      );
      const required = isFlowInputBindingRequired(
        template,
        stepTemplates,
        input.flowInputId,
      );
      return required
        ? !geometryMatchesFlowInput(geometry, input)
        : geometry != null && !geometryMatchesFlowInput(geometry, input);
    })
  ) {
    return false;
  }
  return template.stepRefs.every((stepRef) => {
    const stepTemplate = templatesById.get(stepRef.processStepTemplateId);
    if (!stepTemplate) return false;
    const values = configuration.stepConfigurations[stepRef.stepRefId]?.parameterValues ?? {};
    return stepTemplate.parameterDefinitions.every((parameter) =>
      isParameterValueComplete(parameter, values[parameter.id]),
    );
  });
}

export function isFlowInputBindingRequired(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  flowInputId: string,
) {
  const stepRefsById = new Map(template.stepRefs.map((item) => [item.stepRefId, item]));
  const templatesById = new Map(stepTemplates.map((item) => [item.id, item]));
  const flowInput = template.flowInputs.find(
    (input) => input.flowInputId === flowInputId,
  );
  if (flowInput?.required !== false) return true;
  return template.flowEdges.some((edge) => {
    if (edge.source.kind !== "flowInput" || edge.source.flowInputId !== flowInputId) {
      return false;
    }
    const stepRef = stepRefsById.get(edge.target.stepRefId);
    const stepTemplate = stepRef
      ? templatesById.get(stepRef.processStepTemplateId)
      : undefined;
    return (
      stepTemplate?.inputPorts.find(
        (port) => port.portId === edge.target.inputPortId,
      )?.required !== false
    );
  });
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
  geometry: ReturnType<typeof geometryForFlowInput>,
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

function upstreamStepIds(template: ProcessFlowTemplate, targetStepRefId: string) {
  const incoming = new Map<string, string[]>();
  template.flowEdges.forEach((edge) => {
    if (edge.source.kind !== "stepOutput") return;
    incoming.set(edge.target.stepRefId, [
      ...(incoming.get(edge.target.stepRefId) ?? []),
      edge.source.stepRefId,
    ]);
  });
  const result = new Set<string>();
  const pending = [targetStepRefId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    pending.push(...(incoming.get(current) ?? []));
  }
  return result;
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
