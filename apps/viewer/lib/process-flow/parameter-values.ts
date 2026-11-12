import type {
  FlowConfiguration,
  FlowDefinition,
  ParameterDefinition,
  ProcessStepTemplate,
  RepeatableGroupValue,
  ValidationRule,
  ValueType,
} from "./types";

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
  if (isMissingParameterValue(value)) {
    const next = { ...values };
    delete next[parameterId];
    return next;
  }
  return { ...values, [parameterId]: value };
}

/** Legacy missing-value markers; zero, false and collections are supplied values. */
export function isMissingParameterValue(value: unknown) {
  return value === undefined || value === null || value === "";
}

/**
 * Canonicalize declared parameter slots only. Keep invalid data for validation,
 * including unknown keys, malformed group structure and collection elements.
 * Raw editor draft snapshots intentionally do not use this persistence helper.
 */
export function normalizeParameterValues(
  definitions: ParameterDefinition[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  let normalized = values;
  for (const definition of definitions) {
    if (!hasOwn(values, definition.id)) continue;
    const value = values[definition.id];
    if (isMissingParameterValue(value)) {
      if (normalized === values) normalized = { ...values };
      delete normalized[definition.id];
      continue;
    }
    if (definition.valueType !== "fieldGroupArray" || !definition.repeatDefinition ||
        !isRecord(value) || !Array.isArray(value.items)) continue;
    const previousItems = value.items;
    const items = previousItems.map((item) => {
      if (!isRecord(item) || !isRecord(item.values)) return item;
      const itemValues = normalizeParameterValues(
        definition.repeatDefinition!.itemParameterDefinitions, item.values,
      );
      return itemValues === item.values ? item : { ...item, values: itemValues };
    });
    if (items.some((item, index) => item !== previousItems[index])) {
      if (normalized === values) normalized = { ...values };
      normalized[definition.id] = { ...value, items };
    }
  }
  return normalized;
}

export function normalizeFlowConfiguration(
  definition: FlowDefinition,
  steps: ProcessStepTemplate[],
  configuration: FlowConfiguration,
): FlowConfiguration {
  const templates = new Map(steps.map((step) => [step.id, step]));
  const definitions = new Map(definition.stepRefs.map((ref) => [
    ref.stepRefId, templates.get(ref.processStepTemplateId)?.parameterDefinitions,
  ]));
  return {
    ...configuration,
    stepConfigurations: Object.fromEntries(Object.entries(configuration.stepConfigurations).map(([id, step]) => [
      id, {
        ...step,
        recipeCandidates: step.recipeCandidates.map((recipe) => ({
          ...recipe,
          parameterValues: normalizeParameterValues(definitions.get(id) ?? [], recipe.parameterValues),
        })),
      },
    ])),
  };
}

export function createDefaultParameterValue(parameter: ParameterDefinition): unknown {
  switch (parameter.valueType) {
    case "boolean":
      return false;
    case "placements":
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
    definitions.flatMap((parameter) =>
      hasOwn(parameter, "defaultValue") && isPresentDefault(parameter.defaultValue)
        ? [[parameter.id, structuredClone(parameter.defaultValue)] as const]
        : [],
    ),
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

export function insertRepeatItem(
  parameter: ParameterDefinition,
  value: RepeatableGroupValue,
  beforeItemId: string | null = null,
): RepeatableGroupValue {
  const repeat = parameter.repeatDefinition!;
  if (value.items.length >= (repeat.maxItems ?? Number.POSITIVE_INFINITY)) return value;
  const targetIndex = value.items.findIndex((item) => item.itemId === beforeItemId);
  const insertionIndex = targetIndex < 0 ? value.items.length : targetIndex;
  const item = createRepeatItem(parameter, repeat.indexBase + insertionIndex);
  return reindexRepeatItems(parameter, [
    ...value.items.slice(0, insertionIndex),
    item,
    ...value.items.slice(insertionIndex),
  ]);
}

export function removeRepeatItem(
  parameter: ParameterDefinition,
  value: RepeatableGroupValue,
  itemId: string,
): RepeatableGroupValue {
  if (value.items.length <= (parameter.repeatDefinition!.minItems ?? 0)) return value;
  if (!value.items.some((item) => item.itemId === itemId)) return value;
  return reindexRepeatItems(parameter, value.items.filter((item) => item.itemId !== itemId));
}

function reindexRepeatItems(
  parameter: ParameterDefinition,
  items: RepeatableGroupValue["items"],
): RepeatableGroupValue {
  return {
    items: items.map((item, offset) => ({
      ...item,
      index: parameter.repeatDefinition!.indexBase + offset,
    })),
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
  if (valueType === "integer" || valueType === "float") {
    const number = Number(value);
    // Retain invalid input for drafts and validation, rather than truncating it
    // or producing NaN (which JSON serialization would turn into null).
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(number)
      ? number : value;
  }
  return value;
}

export function coerceArrayValue(values: string[], valueType: ValueType) {
  if (valueType === "integer[]") {
    return values.map((value) => coercePrimitiveValue(value, "integer"));
  }
  if (valueType === "float[]") {
    return values.map((value) => coercePrimitiveValue(value, "float"));
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

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPresentDefault(value: unknown) {
  return !isMissingParameterValue(value);
}
