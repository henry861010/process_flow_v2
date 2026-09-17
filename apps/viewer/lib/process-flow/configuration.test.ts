import { describe, expect, it } from "vitest";

import {
  geometryCategoryConstraints,
  geometryMatchesFlowInput,
} from "./configuration";
import type { FlowInputDefinition, GeometryEntity } from "./types";

const baseGeometry: GeometryEntity = {
  id: "hbm3_8hi",
  category: "die.hbm",
  name: "HBM3 8-Hi",
  dim: "",
  owner: "test",
  description: "",
  entityType: "die",
  structureFormat: "standard",
};

const constrainedInput: FlowInputDefinition = {
  flowInputId: "incoming_hbm",
  name: "Incoming HBM",
  dataType: "geometry",
  required: true,
  geometryConstraints: { categories: ["die.hbm"] },
};

describe("flow input geometry category constraints", () => {
  it("captures only the source category and not its catalog identity", () => {
    const constraints = geometryCategoryConstraints(baseGeometry);

    expect(constraints).toEqual({ categories: ["die.hbm"] });
    expect(JSON.stringify(constraints)).not.toContain(baseGeometry.id);
  });

  it("does not create an unrestricted constraint for an uncategorized geometry", () => {
    expect(geometryCategoryConstraints({ category: "  " })).toBeNull();
  });

  it("accepts an exact category and its descendants", () => {
    expect(geometryMatchesFlowInput(baseGeometry, constrainedInput)).toBe(true);
    expect(
      geometryMatchesFlowInput(
        {
          ...baseGeometry,
          id: "alternate-metadata",
          entityType: "package",
          structureFormat: "future-format",
        },
        constrainedInput,
      ),
    ).toBe(true);
    expect(
      geometryMatchesFlowInput(
        { ...baseGeometry, id: "hbm-child", category: "die.hbm.experimental" },
        constrainedInput,
      ),
    ).toBe(true);
  });

  it("rejects sibling and unrelated categories while preserving legacy Any behavior", () => {
    expect(
      geometryMatchesFlowInput(
        { ...baseGeometry, id: "dram", category: "die.dram" },
        constrainedInput,
      ),
    ).toBe(false);
    expect(
      geometryMatchesFlowInput(
        { ...baseGeometry, id: "panel", category: "carrier.panel" },
        constrainedInput,
      ),
    ).toBe(false);
    expect(
      geometryMatchesFlowInput(baseGeometry, {
        ...constrainedInput,
        geometryConstraints: undefined,
      }),
    ).toBe(true);
  });
});
