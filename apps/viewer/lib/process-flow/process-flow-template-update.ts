import {
  createDefaultParameterValue,
  createDefaultParameterValues,
  createFlowParameterDefaults,
  isFlowDefaultValueType,
} from "./parameter-values";
import type {
  ParameterDefinition,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  StepRef,
} from "./types";

export function scalarParameterDefinitions(template: ProcessStepTemplate) {
  return template.parameterDefinitions.filter((definition) =>
    isFlowDefaultValueType(definition.valueType),
  );
}

export function hasFlowParameterDefault(
  stepRef: StepRef,
  parameterId: string,
) {
  return Object.prototype.hasOwnProperty.call(
    stepRef.parameterDefaults ?? {},
    parameterId,
  );
}

export function initialFlowParameterDefault(definition: ParameterDefinition) {
  if (Object.prototype.hasOwnProperty.call(definition, "defaultValue")) {
    return structuredClone(definition.defaultValue);
  }
  return createDefaultParameterValue(definition);
}

export function setFlowParameterDefault(
  template: ProcessFlowTemplate,
  stepRefId: string,
  parameterId: string,
  value: unknown,
): ProcessFlowTemplate {
  return updateStepRef(template, stepRefId, (stepRef) => ({
    ...stepRef,
    parameterDefaults: {
      ...(stepRef.parameterDefaults ?? {}),
      [parameterId]: value,
    },
  }));
}

export function clearFlowParameterDefault(
  template: ProcessFlowTemplate,
  stepRefId: string,
  parameterId: string,
): ProcessFlowTemplate {
  return updateStepRef(template, stepRefId, (stepRef) => {
    const defaults = { ...(stepRef.parameterDefaults ?? {}) };
    delete defaults[parameterId];
    return { ...stepRef, parameterDefaults: defaults };
  });
}

export function resetFlowStepDefaults(
  template: ProcessFlowTemplate,
  stepRefId: string,
  stepTemplate: ProcessStepTemplate,
): ProcessFlowTemplate {
  const defaults = createFlowParameterDefaults(
    stepTemplate.parameterDefinitions,
    createDefaultParameterValues(stepTemplate.parameterDefinitions),
  );
  return updateStepRef(template, stepRefId, (stepRef) => ({
    ...stepRef,
    parameterDefaults: defaults,
  }));
}

function updateStepRef(
  template: ProcessFlowTemplate,
  stepRefId: string,
  update: (stepRef: StepRef) => StepRef,
): ProcessFlowTemplate {
  return {
    ...template,
    stepRefs: template.stepRefs.map((stepRef) =>
      stepRef.stepRefId === stepRefId ? update(stepRef) : stepRef,
    ),
  };
}
