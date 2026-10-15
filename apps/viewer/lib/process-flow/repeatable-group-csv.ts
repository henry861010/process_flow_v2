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

export type CsvColumnMapping = Record<string, string | null>;
export type RepeatableGroupCsvInspection = {
  headerLine: number;
  headers: string[];
  rows: CsvRow[];
};
export type CsvMappingIssue = { key: string; message: string };

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
  column?: string,
): string | number | boolean | undefined {
  const text = raw.trim();
  const fail = (message: string): never => csvError(
    line, column === undefined ? message : `CSV column "${column}": ${message}`, definition.id,
  );
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

/** Inspect file structure before asking the user to map its columns. */
export function inspectRepeatableGroupCsv(
  definition: ParameterDefinition,
  text: string,
): RepeatableGroupCsvInspection {
  if (!canImportRepeatableGroupCsv(definition)) {
    throw new Error("CSV import requires a non-empty group of scalar fields.");
  }
  const repeat = definition.repeatDefinition!;
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) throw new Error("The CSV file is empty. Include a header and at least one data row.");
  const headers = header.cells.map((cell) => cell.trim());
  const seen = new Set<string>();
  for (const key of headers) {
    if (!key) csvError(header.line, "Unknown parameter key.", "(empty)");
    if (seen.has(key)) csvError(header.line, "Duplicate header.", key);
    seen.add(key);
  }
  if (!rows.length) throw new Error("The CSV file must include at least one data row.");
  if (rows.length < (repeat.minItems ?? 0)) {
    throw new Error(`Expected at least ${repeat.minItems} items; found ${rows.length}.`);
  }
  if (repeat.maxItems != null && rows.length > repeat.maxItems) {
    throw new Error(`Expected at most ${repeat.maxItems} items; found ${rows.length}.`);
  }
  for (const row of rows) {
    if (row.cells.length !== headers.length) {
      csvError(row.line, `Expected ${headers.length} columns; found ${row.cells.length}.`);
    }
  }
  return { headerLine: header.line, headers, rows };
}

export function createCsvColumnMapping(
  definition: ParameterDefinition,
  headers: string[],
): CsvColumnMapping {
  const available = new Set(headers);
  return Object.fromEntries(definition.repeatDefinition!.itemParameterDefinitions.map((field) => [
    field.id, available.has(field.id) ? field.id : null,
  ]));
}

export function validateCsvColumnMapping(
  definition: ParameterDefinition,
  headers: string[],
  mapping: CsvColumnMapping,
): CsvMappingIssue[] {
  const fields = definition.repeatDefinition!.itemParameterDefinitions;
  const fieldIds = new Set(fields.map((field) => field.id));
  const available = new Set(headers);
  const used = new Set<string>();
  const issues: CsvMappingIssue[] = [];
  for (const key of Object.keys(mapping)) {
    if (!fieldIds.has(key)) issues.push({ key, message: "Unknown target parameter key." });
  }
  for (const field of fields) {
    const column = Object.hasOwn(mapping, field.id) ? mapping[field.id] : null;
    if (column == null) {
      if (field.required !== false) issues.push({ key: field.id, message: "Choose a CSV column for this required field." });
    } else if (!available.has(column)) {
      issues.push({ key: field.id, message: `Unknown CSV column "${column}".` });
    } else if (used.has(column)) {
      issues.push({ key: field.id, message: `CSV column "${column}" is already mapped to another field.` });
    } else {
      used.add(column);
    }
  }
  return issues;
}

export function importRepeatableGroupCsv(
  definition: ParameterDefinition,
  text: string,
  mapping?: CsvColumnMapping,
): RepeatableGroupValue {
  const { headerLine, headers, rows } = inspectRepeatableGroupCsv(definition, text);
  const repeat = definition.repeatDefinition!;
  const fieldsById = new Map(repeat.itemParameterDefinitions.map((field) => [field.id, field]));
  let columns: Array<{ field: ParameterDefinition; index: number }>;
  if (mapping === undefined) {
    // Preserve the strict public API for callers that have not opted into mapping.
    columns = headers.map((key, index) => {
      const field = fieldsById.get(key);
      if (!field) csvError(headerLine, "Unknown parameter key.", key);
      return { field, index };
    });
    for (const field of repeat.itemParameterDefinitions) {
      if (field.required !== false && !headers.includes(field.id)) {
        csvError(headerLine, "Missing required header.", field.id);
      }
    }
  } else {
    const issue = validateCsvColumnMapping(definition, headers, mapping)[0];
    if (issue) csvError(headerLine, issue.message, issue.key);
    columns = repeat.itemParameterDefinitions.flatMap((field) => {
      const column = Object.hasOwn(mapping, field.id) ? mapping[field.id] : null;
      return column == null ? [] : [{ field, index: headers.indexOf(column) }];
    });
  }

  // Validate the entire file before creating identities or changing the editor value.
  const values = rows.map((row) => {
    return Object.fromEntries(columns.flatMap(({ field, index }) => {
      const value = convertCsvCell(field, row.cells[index], row.line, mapping === undefined ? undefined : headers[index]);
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
