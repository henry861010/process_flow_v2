import { describe, expect, it } from "vitest";

import type { ProcessStepTemplate } from "./types";
import {
  clearProcessStepParameterDefault,
  moveProcessStepInputPort,
  hasParameterDefault,
  setProcessStepParameterDefault,
} from "./process-step-update";

const template: ProcessStepTemplate = {
  schemaVersion: 2, status: "enabled",
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

describe("process step input ordering", () => {
  const ports: ProcessStepTemplate["inputPorts"] = [
    { portId: "main_geometry", name: "Main", dataType: "geometry", role: "primary", required: true },
    { portId: "die_geometry", name: "Die", dataType: "geometry", role: "auxiliary", required: true },
  ];
  const source = { ...template, inputPorts: ports };

  it("moves by port identity without changing any port definitions or the source", () => {
    const moved = moveProcessStepInputPort(source, "die_geometry", -1);
    expect(moved.inputPorts).toEqual([ports[1], ports[0]]);
    expect(source.inputPorts).toEqual(ports);
    expect(moved.inputPorts[0]).toBe(ports[1]);
    expect(moveProcessStepInputPort(moved, "die_geometry", 1)).toEqual(source);
  });

  it("leaves boundary moves and unknown ports unchanged", () => {
    expect(moveProcessStepInputPort(source, "main_geometry", -1)).toBe(source);
    expect(moveProcessStepInputPort(source, "die_geometry", 1)).toBe(source);
    expect(moveProcessStepInputPort(source, "missing", 1)).toBe(source);
  });
});
