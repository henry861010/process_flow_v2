import { describe, expect, it } from "vitest";

import { geometryInputLabel, geometryInputNodePresentation, geometryInputStatusLabel } from "./readiness-presentation";
import type { FlowInputDefinition } from "./types";

const input: FlowInputDefinition = { flowInputId: "dmy", name: "DMY input", dataType: "geometry", required: true };
const ready = { status: "ready", code: "ready", reason: "" } as const;

describe("geometry input labels", () => {
  it("prefers the custom label, then the generator name, independently of generated geometry", () => {
    expect(geometryInputNodePresentation({ ...input, inputLabel: "  Lower DMY  " }, "Generated die", ready, "DMY die generator"))
      .toEqual({ displayLabel: "Lower DMY", displaySublabel: "DMY die generator · Generated die · DMY input" });
    for (const inputLabel of [undefined, "", "   "]) {
      expect(geometryInputNodePresentation({ ...input, inputLabel }, "Generated die", ready, "DMY die generator").displayLabel)
        .toBe("DMY die generator");
    }
  });

  it("keeps catalog and unbound fallbacks and deduplicates supporting names", () => {
    expect(geometryInputNodePresentation(input, "Catalog die", ready))
      .toEqual({ displayLabel: "Catalog die", displaySublabel: "DMY input" });
    expect(geometryInputNodePresentation({ ...input, inputLabel: "Custom" }, "DMY input", ready))
      .toEqual({ displayLabel: "Custom", displaySublabel: "DMY input" });
    expect(geometryInputLabel(input)).toBe("DMY input");
    expect(geometryInputLabel({ ...input, name: "flow input" })).toBe("Geometry input");
  });
});

describe("geometry input status", () => {
  it("names a resolved generator binding correctly", () => {
    expect(geometryInputStatusLabel({ status: "ready", code: "ready", reason: "" }, "generator"))
      .toBe("Generator");
  });
});
