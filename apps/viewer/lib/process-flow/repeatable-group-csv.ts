import { createRepeatItem, passesNumericValidation } from "./parameter-values";
import type { ParameterDefinition, RepeatableGroupValue, ValueType } from "./types";

const CSV_VALUE_TYPES = new Set<ValueType>([
  "string", "materialRef", "integer", "float", "boolean",
]);
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function canImportRepeatableGroupCsv(definition: ParameterDefinition): boolean {
  const fields = definition.repeatDefinition?.itemParameterDefinitions;
  return definition.valueType === "fieldGroupArray" && !!fields?.length &&
    fields.every((field) => CSV_VALUE_TYPES.has(field.valueType));
}

type CsvRow = { line: number; cells: string[] };

function csvError(line: number, message: string, key?: string): never {
  throw new Error(`Line ${line}${key ? `, key "${key}"` : ""}: ${message}`);
}

// State machine rather than splitting: quoted cells can contain commas and newlines.
export function parseCsv(text: string): CsvRow[] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let line = 1;
  let rowLine = 1;

  function finishCell() {
    cells.push(cell);
    cell = "";
    state = "start";
  }

  function finishRow() {
    finishCell();
    if (cells.some((value) => value.trim() !== "")) {
      rows.push({ line: rowLine, cells });
    }
    cells = [];
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const newline = character === "\n" || character === "\r";
    const isCrLf = character === "\r" && source[index + 1] === "\n";
    if (state === "quoted") {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          state = "closed";
        }
      } else {
        cell += isCrLf ? "\r\n" : character;
        if (newline) line += 1;
        if (isCrLf) index += 1;
      }
      continue;
    }
    if (character === ",") {
      finishCell();
    } else if (newline) {
      finishRow();
      line += 1;
      rowLine = line;
      if (isCrLf) index += 1;
    } else if (character === '"' && state === "start") {
      state = "quoted";
    } else if (character === '"' || state === "closed") {
      csvError(line, "Invalid CSV quoting; quotes must enclose the entire cell.");
    } else {
      cell += character;
      state = "plain";
    }
  }
  if (state === "quoted") csvError(rowLine, "Unclosed quoted cell.");
  finishRow();
  return rows;
}

export function convertCsvCell(
  definition: ParameterDefinition,
  raw: string,
  line: number,
): string | number | boolean | undefined {
  const text = raw.trim();
  const fail = (message: string): never => csvError(line, message, definition.id);
  if (!text) {
    if (definition.required !== false) fail("A value is required.");
    return undefined;
  }

  let value: string | number | boolean;
  switch (definition.valueType) {
    case "string":
    case "materialRef":
      value = raw;
      break;
    case "integer":
    case "float":
      if (!DECIMAL_NUMBER.test(text) || !Number.isFinite(Number(text))) {
        fail("Expected a complete, finite decimal number (without units).");
      }
      value = Number(text);
      if (definition.valueType === "integer" && !Number.isInteger(value)) {
        fail("Expected an integer.");
      }
      break;
    case "boolean":
      if (text !== "true" && text !== "false") fail('Expected "true" or "false".');
      value = text === "true";
      break;
    default:
      return fail("This field type does not support CSV import.");
  }

  const validation = definition.validation;
  if (typeof value === "number" && !passesNumericValidation(value, validation)) {
    const bounds = [
      validation?.min != null ? `${validation.exclusiveMin ? ">" : ">="} ${validation.min}` : "",
      validation?.max != null ? `${validation.exclusiveMax ? "<" : "<="} ${validation.max}` : "",
    ].filter(Boolean).join(" and ");
    fail(`Value must be ${bounds}.`);
  }
  if (typeof value === "string") {
    if (validation?.minLength != null && value.length < validation.minLength) {
      fail(`Expected at least ${validation.minLength} characters.`);
    }
    if (validation?.maxLength != null && value.length > validation.maxLength) {
      fail(`Expected at most ${validation.maxLength} characters.`);
    }
    if (validation?.regex) {
      let pattern: RegExp;
      try {
        const source = new RegExp(validation.regex).source;
        // JS "$" alone also matches before a final newline; require the actual end.
        pattern = new RegExp(`^(?:${source})$(?![\\s\\S])`);
      } catch {
        return fail("The field definition contains an invalid validation pattern.");
      }
      if (!pattern.test(value)) fail("Value does not match the required pattern.");
    }
  }
  const options = definition.optionSource?.options;
  if (options && !options.some((option) => option.value === value)) {
    fail(`Expected one of: ${options.map((option) => String(option.value)).join(", ")}.`);
  }
  return value;
}

export function importRepeatableGroupCsv(
  definition: ParameterDefinition,
  text: string,
): RepeatableGroupValue {
  if (!canImportRepeatableGroupCsv(definition)) {
    throw new Error("CSV import requires a non-empty group of scalar fields.");
  }
  const repeat = definition.repeatDefinition!;
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw new Error("The CSV file is empty. Include a header and at least one data row.");
  const headers = header.cells.map((cell) => cell.trim());
  const fieldsById = new Map(repeat.itemParameterDefinitions.map((field) => [field.id, field]));
  const seen = new Set<string>();
  const fields = headers.map((key) => {
    if (seen.has(key)) csvError(header.line, "Duplicate header.", key);
    seen.add(key);
    const field = fieldsById.get(key);
    if (!field) csvError(header.line, "Unknown parameter key.", key || "(empty)");
    return field;
  });
  for (const field of repeat.itemParameterDefinitions) {
    if (field.required !== false && !seen.has(field.id)) {
      csvError(header.line, "Missing required header.", field.id);
    }
  }
  if (!rows.length) throw new Error("The CSV file must include at least one data row.");
  if (rows.length < (repeat.minItems ?? 0)) {
    throw new Error(`Expected at least ${repeat.minItems} items; found ${rows.length}.`);
  }
  if (repeat.maxItems != null && rows.length > repeat.maxItems) {
    throw new Error(`Expected at most ${repeat.maxItems} items; found ${rows.length}.`);
  }

  // Validate the entire file before creating identities or changing the editor value.
  const values = rows.map((row) => {
    if (row.cells.length !== fields.length) {
      csvError(row.line, `Expected ${fields.length} columns; found ${row.cells.length}.`);
    }
    return Object.fromEntries(fields.flatMap((field, index) => {
      const value = convertCsvCell(field, row.cells[index], row.line);
      return value === undefined ? [] : [[field.id, value]];
    }));
  });
  return {
    items: values.map((itemValues, offset) => ({
      ...createRepeatItem(definition, repeat.indexBase + offset),
      values: itemValues,
    })),
  };
}
