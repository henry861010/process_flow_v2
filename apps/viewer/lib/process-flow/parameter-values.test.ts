import { describe, expect, it } from "vitest";

import {
  createDefaultParameterValues,
  createFlowParameterDefaults,
  resolveFlowParameterDefaults,
} from "./parameter-values";
import type { ParameterDefinition, StepRef } from "./types";

const definitions: ParameterDefinition[] = [
  { id: "name", name: "Name", valueType: "string", defaultValue: "stable" },
  { id: "count", name: "Count", valueType: "integer", defaultValue: 0 },
  { id: "enabled", name: "Enabled", valueType: "boolean", defaultValue: false },
  { id: "items", name: "Items", valueType: "string[]", defaultValue: ["a"] },
  { id: "placements", name: "Placements", valueType: "placements", defaultValue: [] },
  {
    id: "layers",
    name: "Layers",
    valueType: "fieldGroupArray",
    defaultValue: { items: [] },
  },
  { id: "unset", name: "Unset", valueType: "float" },
];

const stepRef: StepRef = {
  stepRefId: "step",
  processStepTemplateId: "template",
};

describe("parameter defaults", () => {
  it("deep clones every definition default for step authoring", () => {
    const values = createDefaultParameterValues(definitions);
    expect(values).toEqual({
      name: "stable",
      count: 0,
      enabled: false,
      items: ["a"],
      placements: [],
      layers: { items: [] },
    });
    (values.items as string[]).push("changed");
    expect(definitions[3].defaultValue).toEqual(["a"]);
  });

  it("serializes only present scalar values as flow defaults", () => {
    expect(
      createFlowParameterDefaults(definitions, {
        name: "flow",
        count: 0,
        enabled: false,
        items: ["ignored"],
        placements: [{ ignored: true }],
        layers: { items: [{ ignored: true }] },
        unset: "",
      }),
    ).toEqual({ name: "flow", count: 0, enabled: false });
  });

  it("uses an explicit flow snapshot and legacy scalar fallback", () => {
    expect(
      resolveFlowParameterDefaults(
        { ...stepRef, parameterDefaults: { name: "flow", items: ["ignored"] } },
        definitions,
      ),
    ).toEqual({ name: "flow" });
    expect(resolveFlowParameterDefaults(stepRef, definitions)).toEqual({
      name: "stable",
      count: 0,
      enabled: false,
    });
  });
});
