import { describe, expect, it } from "vitest";

import stepTemplates from "../../../api/src/process_flow_api/fixtures/process-step-templates.json";
import { isParameterValueComplete } from "./configuration";
import { canImportRepeatableGroupCsv, convertCsvCell, importRepeatableGroupCsv, parseCsv } from "./repeatable-group-csv";
import type { ParameterDefinition, ValueType } from "./types";

const rdl = stepTemplates.find((step) => step.id === "step_tpl_rdl")!
  .parameterDefinitions[0] as ParameterDefinition;

function group(fields: ParameterDefinition[], limits = {}): ParameterDefinition {
  return {
    id: "rows", name: "Rows", valueType: "fieldGroupArray",
    repeatDefinition: {
      indexBase: 3, itemNameTemplate: "Row {{index}}", itemParameterDefinitions: fields, ...limits,
    },
  };
}

const field = (valueType: ValueType, overrides: Partial<ParameterDefinition> = {}): ParameterDefinition => ({
  id: "value", name: "Value", valueType, ...overrides,
});

describe("CSV import eligibility", () => {
  it.each<ValueType>(["string", "materialRef", "integer", "float", "boolean"])("accepts %s fields", (type) => {
    expect(canImportRepeatableGroupCsv(group([field(type)]))).toBe(true);
  });

  it.each<ValueType>(["string[]", "materialRef[]", "integer[]", "float[]", "placements", "fieldGroupArray"])("rejects groups containing %s", (type) => {
    expect(canImportRepeatableGroupCsv(group([field("string"), field(type, { id: "complex" })]))).toBe(false);
  });

  it("rejects missing and empty schemas, and judges nested groups independently", () => {
    expect(canImportRepeatableGroupCsv(field("fieldGroupArray"))).toBe(false);
    expect(canImportRepeatableGroupCsv(group([]))).toBe(false);
    expect(canImportRepeatableGroupCsv(field("string"))).toBe(false);
    const nested = group([field("float")]);
    expect(canImportRepeatableGroupCsv(group([nested]))).toBe(false);
    expect(canImportRepeatableGroupCsv(nested)).toBe(true);
    expect(() => importRepeatableGroupCsv(group([]), "value\n1")).toThrow("scalar fields");
  });
});

describe("CSV parser", () => {
  it("handles BOM, CRLF, escaped quotes, quoted commas/newlines, blank lines and trailing empty cells", () => {
    expect(parseCsv('\uFEFFname,note,optional\r\n\r\n"a,b","say ""hello""\r\nagain",\r\n')).toEqual([
      { line: 1, cells: ["name", "note", "optional"] },
      { line: 3, cells: ["a,b", 'say "hello"\r\nagain', ""] },
    ]);
    expect(parseCsv("a\nb\n \n\nc")).toEqual([
      { line: 1, cells: ["a"] }, { line: 2, cells: ["b"] }, { line: 5, cells: ["c"] },
    ]);
    expect(parseCsv("a\rb")).toEqual([{ line: 1, cells: ["a"] }, { line: 2, cells: ["b"] }]);
    expect(parseCsv("")).toEqual([]);
  });

  it.each(['value\n"open', 'value\nplain"quote', 'value\n"closed"extra'])("rejects malformed quoting: %s", (csv) => {
    expect(() => parseCsv(csv)).toThrow(/Line 2: .*quot/i);
  });
});

describe("CSV scalar conversion", () => {
  it("preserves strings and material references, parses decimals and booleans", () => {
    expect(convertCsvCell(field("string"), "  copper  ", 2)).toBe("  copper  ");
    expect(convertCsvCell(field("materialRef"), "Cu", 2)).toBe("Cu");
    expect(convertCsvCell(field("integer"), " 1.0 ", 2)).toBe(1);
    expect(convertCsvCell(field("float"), "-2.5e-2", 2)).toBe(-0.025);
    expect(convertCsvCell(field("float"), "+.5", 2)).toBe(0.5);
    expect(convertCsvCell(field("boolean"), "true", 2)).toBe(true);
    expect(convertCsvCell(field("boolean"), " false ", 2)).toBe(false);
  });

  it.each(["1um", "1,000", "0x10", "0b10", "NaN", "Infinity", "1e999", "--1"])("rejects invalid numbers %s", (value) => {
    expect(() => convertCsvCell(field("float"), value, 4)).toThrow('Line 4, key "value": Expected a complete');
  });

  it("rejects fractional integers and ambiguous booleans", () => {
    expect(() => convertCsvCell(field("integer"), "1.5", 2)).toThrow("integer");
    for (const value of ["1", "0", "yes", "TRUE"]) {
      expect(() => convertCsvCell(field("boolean"), value, 2)).toThrow('Expected "true" or "false"');
    }
  });

  it("requires nonblank required values and omits blank optional values without defaults", () => {
    expect(() => convertCsvCell(field("string"), " \t", 2)).toThrow("required");
    expect(convertCsvCell(field("float", { required: false, defaultValue: 42 }), "", 2)).toBeUndefined();
  });

  it("checks inclusive/exclusive numeric ranges", () => {
    const inclusive = field("float", { validation: { min: 0, max: 100 } });
    expect(convertCsvCell(inclusive, "0", 2)).toBe(0);
    expect(convertCsvCell(inclusive, "100", 2)).toBe(100);
    expect(() => convertCsvCell(inclusive, "101", 2)).toThrow("<= 100");
    const exclusive = field("float", { validation: { min: 0, max: 100, exclusiveMin: true, exclusiveMax: true } });
    expect(() => convertCsvCell(exclusive, "0", 2)).toThrow("> 0");
    expect(() => convertCsvCell(exclusive, "100", 2)).toThrow("< 100");
  });

  it("checks string lengths and full-match regex, reporting invalid patterns", () => {
    const string = field("string", { validation: { minLength: 2, maxLength: 4, regex: "[A-Z]+" } });
    expect(convertCsvCell(string, "CU", 2)).toBe("CU");
    expect(() => convertCsvCell(string, "C", 2)).toThrow("at least 2");
    expect(() => convertCsvCell(string, "ABCDE", 2)).toThrow("at most 4");
    expect(() => convertCsvCell(string, "aCU", 2)).toThrow("pattern");
    expect(() => convertCsvCell(string, "CU\n", 2)).toThrow("pattern");
    expect(() => convertCsvCell(field("string", { validation: { regex: "[" } }), "CU", 2)).toThrow("invalid validation pattern");
  });

  it("checks enum membership with typed values rather than option labels", () => {
    const string = field("materialRef", { optionSource: { type: "static", options: [{ name: "Copper", value: "Cu" }] } });
    expect(convertCsvCell(string, "Cu", 2)).toBe("Cu");
    expect(() => convertCsvCell(string, "Copper", 2)).toThrow("Expected one of: Cu");
    const numeric = field("integer", { optionSource: { type: "static", options: [{ name: "Two", value: 2 }] } });
    expect(convertCsvCell(numeric, "2", 2)).toBe(2);
    expect(() => convertCsvCell(numeric, "3", 2)).toThrow("Expected one of: 2");
  });
});

describe("repeatable group CSV import", () => {
  it("imports the actual RDL schema, preserving file order and persisted shape across JSON round trips", () => {
    const csv = "density, thk ,Conductivity,Dielectric\n62,8,Cu,PI-2611\n48,6,Cu,PI-2611";
    const imported = importRepeatableGroupCsv(rdl, csv);
    expect(imported.items.map(({ index, values }) => ({ index, values }))).toEqual([
      { index: 1, values: { Dielectric: "PI-2611", Conductivity: "Cu", thk: 8, density: 62 } },
      { index: 2, values: { Dielectric: "PI-2611", Conductivity: "Cu", thk: 6, density: 48 } },
    ]);
    expect(Object.keys(imported)).toEqual(["items"]);
    expect(imported.items.every((item) => /^[A-Za-z][A-Za-z0-9_.-]*$/.test(item.itemId))).toBe(true);
    expect(new Set(imported.items.map((item) => item.itemId)).size).toBe(2);
    expect(isParameterValueComplete(rdl, JSON.parse(JSON.stringify(imported)))).toBe(true);
    expect(importRepeatableGroupCsv(rdl, csv).items[0].itemId).not.toBe(imported.items[0].itemId);
  });

  it("uses indexBase and never fills omitted or blank optional fields with defaults", () => {
    const definition = group([
      field("integer"),
      field("string", { id: "optional", required: false, defaultValue: "ignored" }),
    ]);
    expect(importRepeatableGroupCsv(definition, "value\n9\n2").items.map(({ index, values }) => ({ index, values }))).toEqual([
      { index: 3, values: { value: 9 } }, { index: 4, values: { value: 2 } },
    ]);
    expect(importRepeatableGroupCsv(definition, "value,optional\n9,").items[0].values).toEqual({ value: 9 });
  });

  it.each([
    ["value,value\n1,2", "Duplicate header"],
    ["value,unknown\n1,2", 'key "unknown": Unknown'],
    ["Value\n1", 'key "Value": Unknown'],
    [",value\n1,2", 'key "(empty)": Unknown'],
    ["optional\nabc", 'key "value": Missing required'],
    ["value,optional\n1", "Expected 2 columns; found 1"],
    ["value\n1,2", "Expected 1 columns; found 2"],
    ["", "empty"],
    ["value\n\n", "at least one data row"],
  ])("rejects bad headers or rows: %s", (csv, message) => {
    expect(() => importRepeatableGroupCsv(group([field("integer"), field("string", { id: "optional", required: false })]), csv)).toThrow(message);
  });

  it("checks item counts and reports physical line numbers after quoted newlines", () => {
    expect(() => importRepeatableGroupCsv(group([field("integer")], { minItems: 2 }), "value\n1")).toThrow("at least 2 items");
    expect(() => importRepeatableGroupCsv(group([field("integer")], { maxItems: 1 }), "value\n1\n2")).toThrow("at most 1 items");
    const definition = group([field("string", { id: "name" }), field("float")]);
    expect(() => importRepeatableGroupCsv(definition, 'name,value\n"first\nsecond",1\n\nlast,nope')).toThrow('Line 5, key "value"');
  });

  it("rejects invalid later RDL rows without modifying the definition or its defaults", () => {
    const before = JSON.stringify(rdl);
    expect(() => importRepeatableGroupCsv(rdl, "Dielectric,Conductivity,thk,density\nPI,Cu,8,62\nPI,Cu,0,48")).toThrow('Line 3, key "thk": Value must be > 0');
    expect(() => importRepeatableGroupCsv(rdl, "Dielectric,Conductivity,thk,density\nPI,Cu,8,101")).toThrow('key "density": Value must be >= 0 and <= 100');
    expect(JSON.stringify(rdl)).toBe(before);
  });
});
