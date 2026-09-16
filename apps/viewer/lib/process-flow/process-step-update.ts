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
