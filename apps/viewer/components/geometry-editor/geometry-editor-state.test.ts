import { describe, expect, it } from "vitest";
import {
  BOX_STRUCTURE_EXAMPLE, EMPTY_METADATA, EMPTY_STRUCTURE, buildGeometryCreateRequest,
  geometryClassificationSuggestions, geometryCreateRequestErrors, parseGeometryStructure,
} from "./geometry-editor-state";

const metadata = { ...EMPTY_METADATA, name: " Custom die ", entityType: " die ", owner: " engineering " };
const text = JSON.stringify(BOX_STRUCTURE_EXAMPLE);

describe("manual geometry authoring", () => {
  it("accepts complete wrappers including empty structures", () => {
    expect(parseGeometryStructure(JSON.stringify(EMPTY_STRUCTURE))).toEqual(EMPTY_STRUCTURE);
    expect(parseGeometryStructure(text)).toEqual(BOX_STRUCTURE_EXAMPLE);
  });

  it.each(["", "{invalid", "[]", "null", "5", JSON.stringify(EMPTY_STRUCTURE.root),
    JSON.stringify({ structure: EMPTY_STRUCTURE }),
    JSON.stringify({ ...EMPTY_STRUCTURE, schemaVersion: 2 }),
    JSON.stringify({ ...EMPTY_STRUCTURE, unitSystem: "mm" }),
    JSON.stringify({ ...EMPTY_STRUCTURE, root: [] }),
  ])("rejects invalid JSON or an unsupported wrapper: %s", (value) => {
    expect(() => parseGeometryStructure(value)).toThrow();
    expect(buildGeometryCreateRequest(metadata, value)).toMatchObject({ errors: { structure: expect.any(String) } });
  });

  it("requires name, entity type and owner, including whitespace-only input", () => {
    const result = buildGeometryCreateRequest({ ...EMPTY_METADATA, owner: " " }, text);
    expect(Object.keys(result.errors)).toEqual(["name", "entityType", "owner"]);
    expect(result.payload).toBeUndefined();
  });

  it("trims metadata, omits empty optional values and lets the server assign identity", () => {
    const result = buildGeometryCreateRequest({ ...metadata, category: " new.custom ", vendor: " ", dim: " 20 x 20 x 5 um " }, text);
    expect(result.errors).toEqual({});
    expect(result.payload).toEqual({
      name: "Custom die", entityType: "die", owner: "engineering", category: "new.custom",
      dim: "20 x 20 x 5 um", structureFormat: "standard", structure: BOX_STRUCTURE_EXAMPLE,
    });
    expect(result.payload).not.toHaveProperty("id");
    expect(result.payload).not.toHaveProperty("generation");
    expect(result.payload).not.toHaveProperty("adaptationContract");
  });

  it("preserves populated optional metadata and icon settings", () => {
    const result = buildGeometryCreateRequest({ ...metadata, vendor: " Vendor ", type1: " memory ",
      type2: " stack ", description: " silicon ", icon: "die.stack", iconScale: "0.5" }, text);
    expect(result.payload).toMatchObject({ vendor: "Vendor", type1: "memory", type2: "stack", description: "silicon", icon: "die.stack", iconScale: 0.5 });
  });

  it.each(["0", "-1", "1.01", "Infinity", "NaN", "invalid"])("rejects invalid icon scale %s", (iconScale) => {
    expect(buildGeometryCreateRequest({ ...metadata, iconScale }, text).errors.iconScale).toBeTruthy();
  });

  it.each(["0.01", "1", ""])("accepts supported icon scale %s", (iconScale) => {
    expect(buildGeometryCreateRequest({ ...metadata, iconScale }, text).payload).toBeDefined();
  });

  it("rejects unsupported icons", () => {
    expect(buildGeometryCreateRequest({ ...metadata, icon: "missing.icon" }, text).errors.icon).toBeTruthy();
  });

  it("maps server errors to fields and retains network errors for the summary", () => {
    const message = "structure.root.bodies[0].geometry.thk: must be positive";
    expect(geometryCreateRequestErrors(new Error(message))).toEqual({ structure: message });
    expect(geometryCreateRequestErrors(new Error("structureFormat: expected standard"))).toHaveProperty("structure");
    expect(geometryCreateRequestErrors(new Error("name: Field required"))).toHaveProperty("name");
    expect(geometryCreateRequestErrors(new Error("Failed to fetch"))).toEqual({ form: "Failed to fetch" });
  });

  it("deduplicates catalog suggestions while supporting missing categories", () => {
    expect(geometryClassificationSuggestions([
      { entityType: "die", category: "die.hbm" }, { entityType: " die ", category: "die.hbm" },
      { entityType: "panel", category: null }, { entityType: "wafer", category: " " },
    ])).toEqual({ entityTypes: ["die", "panel", "wafer"], categories: ["die.hbm"] });
  });
});
