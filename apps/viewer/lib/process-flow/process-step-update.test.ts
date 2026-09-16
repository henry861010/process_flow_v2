import { describe, expect, it } from "vitest";

import type { ProcessStepTemplate } from "./types";
import {
  clearProcessStepParameterDefault,
  hasParameterDefault,
  setProcessStepParameterDefault,
} from "./process-step-update";

const template: ProcessStepTemplate = {
  schemaVersion: 2,
  id: "step_tpl_test",
  version: "V0.0.0",
  name: "Test",
  category: "test",
  program: "test/test",
  description: "",
  owner: "test",
  inputPorts: [],
  outputPorts: [],
  parameterDefinitions: [
    { id: "count", name: "Count", valueType: "integer", defaultValue: 2 },
    { id: "label", name: "Label", valueType: "string" },
  ],
};

describe("process step default editing", () => {
  it("sets a default without mutating the source template", () => {
    const updated = setProcessStepParameterDefault(template, "label", "ready");

    expect(updated.parameterDefinitions[1].defaultValue).toBe("ready");
    expect(hasParameterDefault(template.parameterDefinitions[1])).toBe(false);
  });

  it("clears only the selected parameter default", () => {
    const updated = clearProcessStepParameterDefault(template, "count");

    expect(hasParameterDefault(updated.parameterDefinitions[0])).toBe(false);
    expect(hasParameterDefault(updated.parameterDefinitions[1])).toBe(false);
    expect(updated.parameterDefinitions[0].id).toBe("count");
  });
});
