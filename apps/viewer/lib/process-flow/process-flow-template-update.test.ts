import { describe, expect, it } from "vitest";

import type { ProcessFlowTemplate, ProcessStepTemplate } from "./types";
import {
  clearFlowParameterDefault,
  initialFlowParameterDefault,
  resetFlowStepDefaults,
  setFlowParameterDefault,
  setFlowStepLabel,
} from "./process-flow-template-update";
import { normalizeStepLabel } from "./utils";

const stepTemplate: ProcessStepTemplate = {
  schemaVersion: 2, status: "enabled",
  id: "step_tpl_shared",
  version: "V0.0.0",
  name: "Shared step",
  category: "test",
  program: "test/shared",
  description: "",
  owner: "test",
  inputPorts: [],
  outputPorts: [],
  parameterDefinitions: [
    { id: "count", name: "Count", valueType: "integer", defaultValue: 2 },
    { id: "enabled", name: "Enabled", valueType: "boolean", defaultValue: false },
    { id: "label", name: "Label", valueType: "string" },
    { id: "items", name: "Items", valueType: "string[]", defaultValue: ["a"] },
  ],
};

const template: ProcessFlowTemplate = {
  schemaVersion: 2, status: "enabled",
  id: "flow_tpl_test",
  name: "Test",
  version: "V0.0.0",
  description: "",
  owner: "test",
  flowInputs: [],
  flowEdges: [],
  stepRefs: [
    {
      stepRefId: "first",
      processStepTemplateId: stepTemplate.id,
      parameterDefaults: { count: 1 },
    },
    {
      stepRefId: "second",
      processStepTemplateId: stepTemplate.id,
      parameterDefaults: { count: 9 },
    },
  ],
};

describe("process flow template default editing", () => {
  it("keeps labels isolated by stepRefId without changing defaults or the source", () => {
    const before = structuredClone(template);
    const updated = setFlowStepLabel(template, "first", "First molding");

    expect(updated.stepRefs[0]).toEqual({ ...template.stepRefs[0], stepLabel: "First molding" });
    expect(updated.stepRefs[1]).toEqual(template.stepRefs[1]);
    expect(updated.flowInputs).toEqual(template.flowInputs);
    expect(updated.flowEdges).toEqual(template.flowEdges);
    expect(template).toEqual(before);

    const repeated = setFlowStepLabel(updated, "second", "First molding");
    expect(repeated.stepRefs.map((ref) => ref.stepLabel)).toEqual([
      "First molding",
      "First molding",
    ]);
    expect(repeated.stepRefs.map((ref) => ref.parameterDefaults)).toEqual([
      { count: 1 },
      { count: 9 },
    ]);
  });

  it("keeps raw label input while displaying trimmed labels and the blank fallback", () => {
    const renamed = setFlowStepLabel(template, "first", "  Custom step  ");
    expect(renamed.stepRefs[0].stepLabel).toBe("  Custom step  ");
    expect(normalizeStepLabel(renamed.stepRefs[0].stepLabel, stepTemplate.name)).toBe("Custom step");

    for (const label of ["", "   "]) {
      const cleared = setFlowStepLabel(renamed, "first", label);
      expect(normalizeStepLabel(cleared.stepRefs[0].stepLabel, stepTemplate.name)).toBe(stepTemplate.name);
      expect(cleared.stepRefs[0].parameterDefaults).toEqual({ count: 1 });
    }
  });

  it("keeps defaults isolated by stepRefId", () => {
    const updated = setFlowParameterDefault(template, "first", "count", 4);
    const cleared = clearFlowParameterDefault(updated, "first", "count");

    expect(updated.stepRefs[0].parameterDefaults).toEqual({ count: 4 });
    expect(updated.stepRefs[1].parameterDefaults).toEqual({ count: 9 });
    expect(cleared.stepRefs[0].parameterDefaults).toEqual({});
    expect(cleared.stepRefs[1].parameterDefaults).toEqual({ count: 9 });
    expect(template.stepRefs[0].parameterDefaults).toEqual({ count: 1 });
  });

  it("resets a step to scalar process-step defaults only", () => {
    const updated = resetFlowStepDefaults(template, "second", stepTemplate);

    expect(updated.stepRefs[1].parameterDefaults).toEqual({
      count: 2,
      enabled: false,
    });
    expect(updated.stepRefs[0].parameterDefaults).toEqual({ count: 1 });
  });

  it("uses the process-step default before the type fallback", () => {
    expect(initialFlowParameterDefault(stepTemplate.parameterDefinitions[0])).toBe(2);
    expect(initialFlowParameterDefault(stepTemplate.parameterDefinitions[1])).toBe(false);
    expect(initialFlowParameterDefault(stepTemplate.parameterDefinitions[2])).toBe("");
  });
});
