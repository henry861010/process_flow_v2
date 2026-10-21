import { describe, expect, it } from "vitest";

import {
  buildProcessFlowInstanceCreate,
  instanceFlowConfiguration,
  missingActiveRecipeSteps,
  configurationFromInstance,
  instanceEditorEntry,
  instancesForTemplate,
  newInstanceIdentity,
  validateInstanceIdentity,
} from "./instance-editor";
import type {
  ProcessFlowInstance,
  ProcessFlowTemplate,
  ProcessStepTemplate,
} from "./types";

const template: ProcessFlowTemplate = {
  schemaVersion: 2, status: "enabled",
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
  schemaVersion: 2, status: "enabled",
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
    revision: 1,
    id,
    name: id,
    version: "V0.0.0",
    owner: "source.owner",
    description: "source description",
    processFlowTemplateId: templateId,
    inputBindings: {},
    stepConfigurations: { step: { activeRecipeId: "recipe", recipes: [{ id: "recipe", name: "Source", description: "", createdAt: "2026-10-21T00:00:00Z", parameterValues: { value: "source" } }] } },
  };
}

describe("instance editor helpers", () => {
  it("reads the fixed template entry", () => {
    expect(instanceEditorEntry("?templateId=flow-template")).toEqual({ templateId: "flow-template", instanceId: null });
    expect(instanceEditorEntry("")).toEqual({ templateId: null, instanceId: null });
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
    expect(source.stepConfigurations.step.recipes[0].parameterValues.value).toBe("source");
  });

  it("copies and submits generator recipes without sharing parameter objects", () => {
    const source = instance("source");
    source.inputBindings.incoming_hbm = {
      kind: "generator", generatorId: "hbm", generatorVersion: 2,
      parameters: { topCoreDieThickness: 50 },
    };
    const copied = configurationFromInstance(template, [stepTemplate], source);
    const payload = buildProcessFlowInstanceCreate(
      template.id,
      { ...newInstanceIdentity(), name: "Copy", owner: "test" },
      copied,
    );
    expect(payload.initialConfiguration!.inputBindings.incoming_hbm).toEqual(source.inputBindings.incoming_hbm);
    expect(payload.initialConfiguration!.embeddedGeometries).toEqual({});
    if (copied.inputBindings.incoming_hbm.kind !== "generator") throw new Error("Expected generator");
    copied.inputBindings.incoming_hbm.parameters.topCoreDieThickness = 70;
    expect(source.inputBindings.incoming_hbm).toMatchObject({ parameters: { topCoreDieThickness: 50 } });
    expect(payload.initialConfiguration!.inputBindings.incoming_hbm).toMatchObject({ parameters: { topCoreDieThickness: 50 } });
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
    const identity = { ...newInstanceIdentity(), name: " New ", owner: " owner " };
    const configuration = configurationFromInstance(template, [stepTemplate], instance("source"));
    const payload = buildProcessFlowInstanceCreate(template.id, identity, configuration);
    expect(payload).toMatchObject({
      name: "New",
      owner: "owner",
      version: "V0.0.0",
      processFlowTemplateId: template.id,
    });
    expect(payload).not.toHaveProperty("id");
  });
  it("validates required metadata without a client ID", () => {
    const identity = { ...newInstanceIdentity(), name: "New", owner: "test" };
    expect(newInstanceIdentity()).not.toHaveProperty("id");
    expect(validateInstanceIdentity(identity)).toBeNull();
    expect(validateInstanceIdentity({ ...identity, name: " " })).toBe("Instance name is required.");
    expect(validateInstanceIdentity({ ...identity, version: " " })).toBe("Version is required.");
    expect(validateInstanceIdentity({ ...identity, owner: " " })).toBe("Owner is required.");
  });

});


describe("tracked instance recipes", () => {
  it("creates an empty tracking object without client-generated recipes", () => {
    const payload = buildProcessFlowInstanceCreate(template.id, { ...newInstanceIdentity(), name: "R&D", owner: "rd" });
    expect(payload).not.toHaveProperty("initialConfiguration");
    expect(payload).not.toHaveProperty("revision");
  });
  it("reads an existing instance route", () => {
    expect(instanceEditorEntry("?instanceId=tracked")).toEqual({ templateId: null, instanceId: "tracked" });
  });
  it("projects only the active snapshot and isolates nested values", () => {
    const source = instance("source");
    source.stepConfigurations.step.recipes.push({ ...source.stepConfigurations.step.recipes[0], id: "next", parameterValues: { value: "next", nested: [1, 2] } });
    source.stepConfigurations.step.activeRecipeId = "next";
    const projected = instanceFlowConfiguration(source);
    expect(projected.stepConfigurations.step.parameterValues.value).toBe("next");
    (projected.stepConfigurations.step.parameterValues.nested as number[]).push(3);
    expect(source.stepConfigurations.step.recipes[1].parameterValues.nested).toEqual([1, 2]);
    expect(source.stepConfigurations.step.recipes[0].parameterValues.value).toBe("source");
  });
  it("does not select a recipe or defaults when active selection is cleared", () => {
    const source = instance("source");
    source.stepConfigurations.step.activeRecipeId = null;
    expect(instanceFlowConfiguration(source).stepConfigurations).toEqual({});
    expect(missingActiveRecipeSteps(source, template, [stepTemplate])).toEqual(["step"]);
  });
});
