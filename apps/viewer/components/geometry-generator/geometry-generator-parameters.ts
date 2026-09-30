import type { GeneratorParameterDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import type { ParameterDefinition, RepeatableGroupValue } from "@/lib/process-flow/types";
import { isRepeatableGroupValue } from "../../lib/process-flow/parameter-values";

export function visibleGeneratorParameters(
  definitions: GeneratorParameterDefinition[],
  values: Record<string, unknown>,
): GeneratorParameterDefinition[] {
  return definitions.filter(
    (definition) =>
      !definition.visibleWhen ||
      values[definition.visibleWhen.parameterId] === definition.visibleWhen.equals,
  );
}

export function toGeneratorEditorValues(
  definitions: ParameterDefinition[],
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.id,
      toEditorValue(definition, parameters[definition.id]),
    ]),
  );
}

export function fromGeneratorEditorValues(
  definitions: GeneratorParameterDefinition[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    visibleGeneratorParameters(definitions, values).map((definition) => [
      definition.id,
      fromEditorValue(definition, values[definition.id]),
    ]),
  );
}

function toEditorValue(definition: ParameterDefinition, value: unknown): unknown {
  if (definition.valueType !== "fieldGroupArray" || !definition.repeatDefinition) {
    return value;
  }
  const items = Array.isArray(value) ? value : [];
  return {
    items: items.map((item, offset) => {
      const record = isRecord(item) ? item : {};
      const index = definition.repeatDefinition!.indexBase + offset;
      return {
        itemId:
          typeof record.id === "string"
            ? record.id
            : `${definition.id}-${String(index).padStart(2, "0")}`,
        index,
        values: Object.fromEntries(
          definition.repeatDefinition!.itemParameterDefinitions.map((child) => [
            child.id,
            toEditorValue(child, record[child.id]),
          ]),
        ),
      };
    }),
  } satisfies RepeatableGroupValue;
}

function fromEditorValue(definition: ParameterDefinition, value: unknown): unknown {
  if (definition.valueType !== "fieldGroupArray" || !definition.repeatDefinition) {
    return value;
  }
  if (!isRepeatableGroupValue(value)) return [];
  return value.items.map((item) => ({
    id: item.itemId,
    ...Object.fromEntries(
      definition.repeatDefinition!.itemParameterDefinitions.map((child) => [
        child.id,
        fromEditorValue(child, item.values[child.id]),
      ]),
    ),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
