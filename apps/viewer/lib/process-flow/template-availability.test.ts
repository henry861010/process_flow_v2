import { describe, expect, it } from "vitest";
import { disabledStepsForNewFlow, isTemplateEnabled } from "./template-availability";
import type { ProcessFlowTemplate, ProcessStepTemplate } from "./types";

const step: ProcessStepTemplate = {
  schemaVersion: 2, status: "enabled", id: "step", name: "Step", version: "V0",
  owner: "test", category: "test", program: "layer/molding", description: "",
  inputPorts: [], outputPorts: [], parameterDefinitions: [],
};
const flow: ProcessFlowTemplate = {
  schemaVersion: 2, status: "enabled", id: "flow", name: "Flow", version: "V0",
  flowInputs: [], flowEdges: [], stepRefs: [{ stepRefId: "a", processStepTemplateId: "step" }],
};

describe("template availability", () => {
  it("allows legacy templates but rejects disabled or absent templates", () => {
    expect(isTemplateEnabled({})).toBe(true);
    expect(isTemplateEnabled(flow)).toBe(true);
    expect(isTemplateEnabled({ ...flow, status: "disabled" })).toBe(false);
    expect(isTemplateEnabled(null)).toBe(false);
    expect(isTemplateEnabled(undefined)).toBe(false);
  });

  it("blocks only referenced disabled steps when authoring a new flow", () => {
    expect(disabledStepsForNewFlow(flow, [step, { ...step, id: "unrelated", status: "disabled" }])).toEqual([]);
    const disabled = { ...step, status: "disabled" as const };
    const repeated = { ...flow, stepRefs: [...flow.stepRefs, { stepRefId: "b", processStepTemplateId: "step" }] };
    expect(disabledStepsForNewFlow(repeated, [disabled])).toEqual([disabled]);
    expect(flow.stepRefs).toHaveLength(1);
    expect(disabledStepsForNewFlow(flow, [step])).toEqual([]);
  });
});
