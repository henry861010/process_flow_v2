import { describe, expect, it } from "vitest";

import {
  generatedGeometryId,
  geometryForFlowInput,
  getFlowInputReadiness,
  isConfigurationComplete,
  geometryCategoryConstraints,
  geometryMatchesFlowInput,
} from "./configuration";
import type { FlowConfiguration, FlowInputDefinition, GeometryEntity, ProcessFlowTemplate } from "./types";

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
  it("accepts only a resolved generator preview for the current binding", () => {
    const template: ProcessFlowTemplate = {
      schemaVersion: 2, status: "enabled",
      id: "flow",
      name: "Flow",
      version: "V0.0.0",
      owner: "test",
      flowInputs: [constrainedInput],
      stepRefs: [],
      flowEdges: [],
    };
    const configuration: FlowConfiguration = {
      inputBindings: {
        incoming_hbm: {
          kind: "generator", generatorId: "hbm", generatorVersion: 2,
          parameters: { topCoreDieThickness: 50 },
        },
      },
      stepConfigurations: {},
      embeddedGeometries: {},
    };
    expect(geometryForFlowInput(configuration, "incoming_hbm", [])).toBeNull();
    expect(isConfigurationComplete(template, [], configuration, [])).toBe(false);

    const resolved = [{ ...baseGeometry, id: generatedGeometryId("incoming_hbm") }];
    expect(geometryForFlowInput(configuration, "incoming_hbm", resolved)).toEqual(resolved[0]);
    expect(getFlowInputReadiness(template, [], configuration, resolved, "incoming_hbm").status).toBe("ready");
    expect(isConfigurationComplete(template, [], configuration, resolved)).toBe(true);
    expect(geometryMatchesFlowInput(
      { entityType: "die", category: "die.dram", structureFormat: "standard" },
      constrainedInput,
    )).toBe(false);
  });
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
