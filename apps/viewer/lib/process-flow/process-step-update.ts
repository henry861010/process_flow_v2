import type { ParameterDefinition, ProcessStepTemplate } from "./types";

export function hasParameterDefault(definition: ParameterDefinition) {
  return Object.prototype.hasOwnProperty.call(definition, "defaultValue");
}

export function setProcessStepParameterDefault(
  template: ProcessStepTemplate,
  parameterId: string,
  defaultValue: unknown,
): ProcessStepTemplate {
  return {
    ...template,
    parameterDefinitions: template.parameterDefinitions.map((definition) =>
      definition.id === parameterId ? { ...definition, defaultValue } : definition,
    ),
  };
}

export function clearProcessStepParameterDefault(
  template: ProcessStepTemplate,
  parameterId: string,
): ProcessStepTemplate {
  return {
    ...template,
    parameterDefinitions: template.parameterDefinitions.map((definition) => {
      if (definition.id !== parameterId) return definition;
      const { defaultValue: _defaultValue, ...withoutDefault } = definition;
      return withoutDefault;
    }),
  };
}

export function moveProcessStepInputPort(
  template: ProcessStepTemplate,
  portId: string,
  direction: -1 | 1,
): ProcessStepTemplate {
  const index = template.inputPorts.findIndex((port) => port.portId === portId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= template.inputPorts.length) return template;
  const inputPorts = [...template.inputPorts];
  [inputPorts[index], inputPorts[targetIndex]] = [inputPorts[targetIndex], inputPorts[index]];
  return { ...template, inputPorts };
}
