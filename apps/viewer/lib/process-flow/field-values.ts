import type {
  FieldDefinition,
  FieldValue,
  ProcessStepTemplate,
  RepeatableGroupValue,
  ValidationRule,
  ValueType,
} from "@/lib/process-flow/types";

export function getGeometryInputFields(template: ProcessStepTemplate) {
  return template.fieldDefinitions.filter(isGeometryField);
}

export function isGeometryField(field: FieldDefinition) {
  return field.valueType === "geometryRef";
}

export function getFieldValue(fieldValues: FieldValue[], fieldId: string) {
  return fieldValues.find((fieldValue) => fieldValue.fieldId === fieldId)?.value;
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
  if (value === "") {
    return "";
  }
  if (valueType === "integer") {
    return Number.parseInt(value, 10);
  }
  if (valueType === "float") {
    return Number.parseFloat(value);
  }
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
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray((value as RepeatableGroupValue).items)
  );
}

export function formatRepeatItemName(field: FieldDefinition, index: number) {
  return (
    field.repeatDefinition?.itemNameTemplate.replace("{{index}}", String(index)) ??
    `${field.name} ${index}`
  );
}

export function passesNumericValidation(
  value: number,
  validation?: ValidationRule,
) {
  if (!validation) {
    return true;
  }
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
