import { describe, expect, it } from "vitest";

import {
  buildProcessFlowInstanceCreate,
  configurationFromInstance,
  instanceEditorEntry,
  instancesForTemplate,
  newInstanceIdentity,
} from "./instance-editor";
import type {
  ProcessFlowInstance,
  ProcessFlowTemplate,
  ProcessStepTemplate,
} from "./types";

const template: ProcessFlowTemplate = {
  schemaVersion: 2,
  id: "flow-template",
  name: "Flow template",
  version: "V0.0.0",
  owner: "test",
  flowInputs: [],
  stepRefs: [
    {
      stepRefId: "step",
      processStepTemplateId: "step-template",
      parameterDefaults: { value: "flow" },
    },
  ],
  flowEdges: [],
};
const stepTemplate: ProcessStepTemplate = {
  schemaVersion: 2,
  id: "step-template",
  version: "V0.0.0",
  name: "Step",
  category: "test",
  program: "test.step",
  description: "",
  owner: "test",
  inputPorts: [],
  outputPorts: [],
  parameterDefinitions: [
    {
      id: "value",
      name: "Value",
      valueType: "string",
      required: false,
      defaultValue: "step",
    },
    {
      id: "items",
      name: "Items",
      valueType: "string[]",
      required: false,
      defaultValue: ["step"],
    },
  ],
};

function instance(id: string, templateId = template.id): ProcessFlowInstance {
  return {
    schemaVersion: 2,
    id,
    name: id,
    version: "V0.0.0",
    owner: "source.owner",
    description: "source description",
    processFlowTemplateId: templateId,
    inputBindings: {},
    stepConfigurations: { step: { parameterValues: { value: "source" } } },
  };
}

describe("instance editor helpers", () => {
  it("reads templateId and rejects legacy workspace entry", () => {
    expect(instanceEditorEntry("?templateId=flow-template")).toEqual({
      templateId: "flow-template",
      workspaceUnsupported: false,
    });
    expect(instanceEditorEntry("?workspaceId=workspace-1").workspaceUnsupported).toBe(true);
  });

  it("only returns instances for the selected template", () => {
    expect(instancesForTemplate([instance("b"), instance("a"), instance("other", "other")], template.id).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("copies imported values without carrying embedded geometry", () => {
    const source = instance("source");
    const copied = configurationFromInstance(template, [stepTemplate], source);
    expect(copied.stepConfigurations.step.parameterValues.value).toBe("source");
    expect(copied.embeddedGeometries).toEqual({});
    copied.stepConfigurations.step.parameterValues.value = "changed";
    expect(source.stepConfigurations.step.parameterValues.value).toBe("source");
  });

  it("uses flow scalar defaults only when no instance is imported", () => {
    const configuration = configurationFromInstance(template, [stepTemplate]);
    expect(configuration.stepConfigurations.step.parameterValues).toEqual({
      value: "flow",
    });

    const imported = configurationFromInstance(
      template,
      [stepTemplate],
      instance("source"),
    );
    expect(imported.stepConfigurations.step.parameterValues).toEqual({
      value: "source",
    });
  });

  it("falls back to legacy step scalar defaults but excludes collections", () => {
    const legacyTemplate = structuredClone(template);
    delete legacyTemplate.stepRefs[0].parameterDefaults;
    const configuration = configurationFromInstance(legacyTemplate, [stepTemplate]);
    expect(configuration.stepConfigurations.step.parameterValues).toEqual({
      value: "step",
    });
  });

  it("builds a trimmed create payload without copying source identity", () => {
    const identity = { ...newInstanceIdentity(), id: " new.instance ", name: " New ", owner: " owner " };
    const configuration = configurationFromInstance(template, [stepTemplate], instance("source"));
    const payload = buildProcessFlowInstanceCreate(template.id, identity, configuration);
    expect(payload).toMatchObject({
      id: "new.instance",
      name: "New",
      owner: "owner",
      version: "V0.0.0",
      processFlowTemplateId: template.id,
    });
    expect(payload.id).not.toBe("source");
  });
});
