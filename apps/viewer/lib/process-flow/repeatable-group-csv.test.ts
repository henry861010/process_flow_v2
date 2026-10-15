import { describe, expect, it } from "vitest";

import stepTemplates from "../../../api/src/process_flow_api/fixtures/process-step-templates.json";
import { isParameterValueComplete } from "./configuration";
import {
  canImportRepeatableGroupCsv, convertCsvCell, createCsvColumnMapping,
  importRepeatableGroupCsv, inspectRepeatableGroupCsv, parseCsv, validateCsvColumnMapping,
  type CsvColumnMapping,
} from "./repeatable-group-csv";
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

describe("CSV column mapping", () => {
  const csv = "note,density, pm ,Conductivity,thk\nfirst,62,PI-2611,Cu,8\nsecond,48,ABF,Cu,6";
  const mapping = { Dielectric: "pm", Conductivity: "Conductivity", thk: "thk", density: "density" };

  it("inspects custom headers without importing and prefills exact keys only", () => {
    const inspected = inspectRepeatableGroupCsv(rdl, csv);
    expect(inspected.headers).toEqual(["note", "density", "pm", "Conductivity", "thk"]);
    expect(inspected.rows).toHaveLength(2);
    expect(inspected.headerLine).toBe(1);
    expect(createCsvColumnMapping(rdl, inspected.headers)).toEqual({ ...mapping, Dielectric: null });
    expect(createCsvColumnMapping(rdl, ["dielectric", "Thk"])).toEqual({
      Dielectric: null, Conductivity: null, thk: null, density: null,
    });
  });

  it("maps pm to Dielectric, ignores extra columns and preserves order, values and identities", () => {
    const before = JSON.stringify(rdl);
    const imported = importRepeatableGroupCsv(rdl, csv, mapping);
    expect(imported.items.map(({ index, values }) => ({ index, values }))).toEqual([
      { index: 1, values: { Dielectric: "PI-2611", Conductivity: "Cu", thk: 8, density: 62 } },
      { index: 2, values: { Dielectric: "ABF", Conductivity: "Cu", thk: 6, density: 48 } },
    ]);
    expect(new Set(imported.items.map((item) => item.itemId)).size).toBe(2);
    expect(importRepeatableGroupCsv(rdl, csv, mapping).items[0].itemId).not.toBe(imported.items[0].itemId);
    expect(isParameterValueComplete(rdl, JSON.parse(JSON.stringify(imported)))).toBe(true);
    expect(JSON.stringify(rdl)).toBe(before);
    expect(() => importRepeatableGroupCsv(rdl, csv)).toThrow("Unknown parameter key");
  });

  it("omits null, missing and blank optional fields without applying defaults", () => {
    const definition = group([
      field("integer"), field("string", { id: "note", required: false, defaultValue: "ignored" }),
    ]);
    const mappings: CsvColumnMapping[] = [{ value: "count" }, { value: "count", note: null }, { value: "count", note: "comment" }];
    for (const columnMapping of mappings) {
      expect(importRepeatableGroupCsv(definition, "count,comment,unused\n9,,anything", columnMapping).items[0])
        .toMatchObject({ index: 3, values: { value: 9 } });
    }
  });

  it.each([
    [{ ...mapping, Dielectric: null }, "required field"],
    [{ Conductivity: "Conductivity", thk: "thk", density: "density" }, "required field"],
    [{ ...mapping, Dielectric: "missing" }, 'Unknown CSV column "missing"'],
    [{ ...mapping, Dielectric: "" }, 'Unknown CSV column ""'],
    [{ ...mapping, Dielectric: "Conductivity" }, "already mapped"],
    [{ ...mapping, unknown: "note" }, "Unknown target parameter key"],
  ])("rejects invalid mappings: %j", (columnMapping, message) => {
    expect(validateCsvColumnMapping(rdl, inspectRepeatableGroupCsv(rdl, csv).headers, columnMapping))
      .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining(message) })]));
    expect(() => importRepeatableGroupCsv(rdl, csv, columnMapping)).toThrow(message);
  });

  it.each([
    ["pm, pm \nPI,PI", "Duplicate header"],
    ["pm,\nPI,Cu", 'key "(empty)"'],
    ["pm,note\nPI", "Expected 2 columns; found 1"],
    ["pm\nPI,extra", "Expected 1 columns; found 2"],
    ["pm\n", "at least one data row"],
    ['pm\n"unclosed', "Unclosed quoted cell"],
    ["", "empty"],
  ])("rejects malformed files before mapping: %s", (text, message) => {
    expect(() => inspectRepeatableGroupCsv(rdl, text)).toThrow(message);
    expect(() => importRepeatableGroupCsv(rdl, text, mapping)).toThrow(message);
  });

  it("validates later mapped rows with physical line, CSV column and target key", () => {
    const definition = group([
      field("string", { id: "name" }), field("float", { validation: { min: 0, exclusiveMin: true } }),
    ]);
    const before = JSON.stringify(definition);
    expect(() => importRepeatableGroupCsv(definition, 'label,height\n"first\nsecond",1\nlast,0', { name: "label", value: "height" }))
      .toThrow('Line 4, key "value": CSV column "height": Value must be > 0');
    expect(JSON.stringify(definition)).toBe(before);
  });

  it("enforces target types, enum and item limits after mapping", () => {
    const definition = group([
      field("integer", { optionSource: { type: "static", options: [{ name: "Two", value: 2 }] } }),
    ], { maxItems: 1 });
    expect(() => importRepeatableGroupCsv(definition, "count\n2.5", { value: "count" })).toThrow("integer");
    expect(() => importRepeatableGroupCsv(definition, "count\n3", { value: "count" })).toThrow("Expected one of: 2");
    expect(() => importRepeatableGroupCsv(definition, "count\n", { value: "count" })).toThrow("at least one data row");
    expect(() => importRepeatableGroupCsv(definition, "count\n2\n2", { value: "count" })).toThrow("at most 1 items");
    expect(() => importRepeatableGroupCsv(group([field("integer")], { minItems: 2 }), "count\n2", { value: "count" })).toThrow("at least 2 items");
    expect(() => importRepeatableGroupCsv(group([field("boolean")]), "flag\nyes", { value: "flag" })).toThrow('Expected "true" or "false"');
    expect(() => importRepeatableGroupCsv(group([field("string")]), "label,note\n ,kept", { value: "label" })).toThrow("A value is required");
  });
});
