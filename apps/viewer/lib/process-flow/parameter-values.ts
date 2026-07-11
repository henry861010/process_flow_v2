import type {
  ParameterDefinition,
  RepeatableGroupValue,
  ValidationRule,
  ValueType,
} from "@/lib/process-flow/types";

export function getParameterValue(
  values: Record<string, unknown>,
  parameterId: string,
) {
  return values[parameterId];
}

export function setParameterValue(
  values: Record<string, unknown>,
  parameterId: string,
  value: unknown,
) {
  return { ...values, [parameterId]: value };
}

export function createDefaultParameterValue(parameter: ParameterDefinition): unknown {
  switch (parameter.valueType) {
    case "boolean":
      return false;
    case "coordinates":
      return [];
    case "fieldGroupArray":
      return createDefaultRepeatableGroup(parameter);
    case "string[]":
    case "integer[]":
    case "float[]":
    case "materialRef[]":
      return [];
    default:
      return "";
  }
}

export function createDefaultParameterValues(definitions: ParameterDefinition[]) {
  return Object.fromEntries(
    definitions.map((parameter) => [
      parameter.id,
      createDefaultParameterValue(parameter),
    ]),
  );
}

export function createDefaultRepeatableGroup(
  parameter: ParameterDefinition,
): RepeatableGroupValue {
  const repeat = parameter.repeatDefinition;
  const itemCount = repeat?.minItems ?? 0;
  return {
    items: Array.from({ length: itemCount }, (_, offset) =>
      createRepeatItem(parameter, (repeat?.indexBase ?? 0) + offset),
    ),
  };
}

export function createRepeatItem(
  parameter: ParameterDefinition,
  index: number,
): RepeatableGroupValue["items"][number] {
  return {
    itemId: createItemId(parameter.id),
    index,
    values: createDefaultParameterValues(
      parameter.repeatDefinition?.itemParameterDefinitions ?? [],
    ),
  };
}

export function isArrayValueType(valueType: ValueType) {
  return valueType.endsWith("[]");
}

export function isNumericValueType(valueType: ValueType) {
  return (
    valueType === "integer" ||
    valueType === "integer[]" ||
    valueType === "float" ||
    valueType === "float[]"
  );
}

export function isIntegerValueType(valueType: ValueType) {
  return valueType === "integer" || valueType === "integer[]";
}

export function coercePrimitiveValue(value: string, valueType: ValueType) {
  if (value === "") return "";
  if (valueType === "integer") return Number.parseInt(value, 10);
  if (valueType === "float") return Number.parseFloat(value);
  return value;
}

export function coerceArrayValue(values: string[], valueType: ValueType) {
  if (valueType === "integer[]") {
    return values.map((value) => Number.parseInt(value, 10));
  }
  if (valueType === "float[]") {
    return values.map((value) => Number.parseFloat(value));
  }
  return values;
}

export function isRepeatableGroupValue(
  value: unknown,
): value is RepeatableGroupValue {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  return value.items.every(
    (item) =>
      isRecord(item) &&
      typeof item.itemId === "string" &&
      typeof item.index === "number" &&
      isRecord(item.values),
  );
}

export function formatRepeatItemName(
  parameter: ParameterDefinition,
  index: number,
) {
  return (
    parameter.repeatDefinition?.itemNameTemplate.replace(
      "{{index}}",
      String(index),
    ) ?? `${parameter.name} ${index}`
  );
}

export function passesNumericValidation(
  value: number,
  validation?: ValidationRule,
) {
  if (!validation) return true;
  if (typeof validation.min === "number") {
    if (validation.exclusiveMin ? value <= validation.min : value < validation.min) {
      return false;
    }
  }
  if (typeof validation.max === "number") {
    if (validation.exclusiveMax ? value >= validation.max : value > validation.max) {
      return false;
    }
  }
  return true;
}

function createItemId(parameterId: string) {
  const suffix =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${parameterId}_${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
