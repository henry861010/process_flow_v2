import { describe, expect, it } from "vitest";
import { analyzeFlowDependencies } from "./dependencies";
import { createEmptyFlowConfiguration, getFlowInputReadiness, getStepConfigurationReadiness, getStepExecutionReadiness, isConfigurationComplete } from "./configuration";
import { configurationFromInstance } from "./instance-editor";
import { geometryInputStatusLabel, stepReadinessStatusLabel } from "./readiness-presentation";
import type { FlowConfiguration, GeometryEntity, ProcessFlowInstance, ProcessFlowTemplate, ProcessStepTemplate, SavedFlowEdge } from "./types";

const prepare: ProcessStepTemplate = {
  schemaVersion: 2, id: "prepare", name: "Prepare", version: "V0", category: "layer",
  program: "layer/molding", owner: "test", description: "",
  inputPorts: [{ portId: "main_geometry", name: "Main", role: "primary", dataType: "geometry", required: true }],
  outputPorts: [{ portId: "result_geometry", name: "Result", dataType: "geometry" }],
  parameterDefinitions: [{ id: "thickness", name: "Thickness", valueType: "float", required: true }],
};
const pnp: ProcessStepTemplate = {
  ...prepare, id: "pnp", name: "PnP", program: "pnp/pnp",
  inputPorts: [...prepare.inputPorts.map((port) => ({ ...port })), { portId: "die_geometry", name: "Die", role: "auxiliary", dataType: "geometry", required: true }],
  parameterDefinitions: [{ id: "placements", name: "Placements", valueType: "placements", required: true }],
};
const placement = {
  targetRegion: { type: "rectangle", bottomLeftX: 0, bottomLeftY: 0, topRightX: 10, topRightY: 10 },
  pose: { x: 0, y: 0, rotationZ: 0 }, anchor: "center",
};
const geometry: GeometryEntity = { id: "main", name: "Main", category: "main", dim: "", owner: "test", description: "", entityType: "panel", structureFormat: "standard" };
const inputEdge = (edgeId: string, flowInputId: string, stepRefId: string, inputPortId = "main_geometry"): SavedFlowEdge => ({
  edgeId, source: { kind: "flowInput", flowInputId }, target: { stepRefId, inputPortId },
});
const outputEdge = (edgeId: string, source: string, stepRefId: string, inputPortId = "main_geometry"): SavedFlowEdge => ({
  edgeId, source: { kind: "stepOutput", stepRefId: source, outputPortId: "result_geometry" }, target: { stepRefId, inputPortId },
});

function scenario() {
  const template: ProcessFlowTemplate = {
    schemaVersion: 2, id: "flow", name: "Flow", version: "V0", owner: "test",
    flowInputs: ["main", "die"].map((flowInputId) => ({ flowInputId, name: flowInputId, dataType: "geometry", required: true })),
    stepRefs: [{ stepRefId: "prepare1", processStepTemplateId: "prepare" }, { stepRefId: "prepare2", processStepTemplateId: "prepare" }, { stepRefId: "place", processStepTemplateId: "pnp" }],
    flowEdges: [inputEdge("main", "main", "place"), inputEdge("die", "die", "prepare1"), outputEdge("prepare", "prepare1", "prepare2"), outputEdge("place", "prepare2", "place", "die_geometry")],
  };
  const configuration: FlowConfiguration = {
    inputBindings: { main: { kind: "catalog", geometryId: "main" } },
    stepConfigurations: { place: { parameterValues: { placements: [] } } }, embeddedGeometries: {},
  };
  return { template, configuration, steps: structuredClone([prepare, pnp]) };
}

function configuredScenario() {
  const result = scenario();
  result.configuration.inputBindings.die = { kind: "catalog", geometryId: "main" };
  result.configuration.stepConfigurations.prepare1 = { parameterValues: { thickness: 2 } };
  result.configuration.stepConfigurations.prepare2 = { parameterValues: { thickness: 2 } };
  result.configuration.stepConfigurations.place.parameterValues.placements = [placement];
  return result;
}

describe("step configuration status scope", () => {
  it("keeps configured upstream nodes ready when downstream PnP is missing its main input", () => {
    const { template, configuration, steps } = configuredScenario();
    template.flowEdges = template.flowEdges.filter((edge) => edge.edgeId !== "main");

    for (const stepRefId of ["prepare1", "prepare2"]) {
      const readiness = getStepConfigurationReadiness(stepRefId, template, steps, configuration, [geometry]);
      expect(readiness.status).toBe("ready");
      expect(stepReadinessStatusLabel(readiness, stepRefId)).toBe("Ready");
    }
    expect(getStepConfigurationReadiness("place", template, steps, configuration, [geometry])).toMatchObject({
      status: "error", code: "missing-input-edge", stepRefId: "place",
    });
    // Saving and compiler-backed preview still reject the incomplete template.
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
    expect(getStepExecutionReadiness("prepare2", template, steps, configuration, [geometry]).code).toBe("missing-input-edge");
  });

  it("keeps upstream nodes ready when another branch or downstream template reference is invalid", () => {
    const { template, configuration, steps } = configuredScenario();
    template.stepRefs.push({ stepRefId: "unrelated", processStepTemplateId: "pnp" });
    expect(getStepConfigurationReadiness("prepare2", template, steps, configuration, [geometry]).status).toBe("ready");
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);

    template.stepRefs.pop();
    template.stepRefs[2].processStepTemplateId = "missing";
    expect(getStepConfigurationReadiness("prepare2", template, steps, configuration, [geometry]).status).toBe("ready");
    expect(getStepConfigurationReadiness("place", template, steps, configuration, [geometry]).code).toBe("missing-step-template");
    expect(getStepConfigurationReadiness("unknown", template, steps, configuration, [geometry]).code).toBe("missing-step-template");
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
  });

  it("still propagates missing bindings, parameters and wiring from upstream", () => {
    const { template, configuration, steps } = configuredScenario();
    delete configuration.stepConfigurations.prepare1.parameterValues.thickness;
    const incomplete = getStepConfigurationReadiness("prepare2", template, steps, configuration, [geometry]);
    expect(incomplete).toMatchObject({ status: "incomplete", code: "incomplete-parameter", stepRefId: "prepare1" });
    expect(stepReadinessStatusLabel(incomplete, "prepare2")).toBe("Waiting upstream");

    configuration.stepConfigurations.prepare1.parameterValues.thickness = 2;
    delete configuration.inputBindings.die;
    expect(getStepConfigurationReadiness("prepare2", template, steps, configuration, [geometry]).code).toBe("unbound-geometry");

    configuration.inputBindings.die = { kind: "catalog", geometryId: "main" };
    template.flowEdges = template.flowEdges.filter((edge) => edge.edgeId !== "prepare");
    expect(getStepConfigurationReadiness("prepare1", template, steps, configuration, [geometry]).status).toBe("ready");
    expect(getStepConfigurationReadiness("prepare2", template, steps, configuration, [geometry])).toMatchObject({
      status: "error", code: "missing-input-edge", stepRefId: "prepare2",
    });
  });

  it("does not label a configured upstream node unused when a downstream cycle removes terminal roots", () => {
    const { template, configuration, steps } = configuredScenario();
    template.flowEdges.push(outputEdge("cycle", "place", "prepare2"));
    expect(getStepConfigurationReadiness("prepare1", template, steps, configuration, [geometry]).status).toBe("ready");
    expect(getStepConfigurationReadiness("prepare2", template, steps, configuration, [geometry]).code).toBe("cycle");
    expect(getStepConfigurationReadiness("place", template, steps, configuration, [geometry]).code).toBe("cycle");
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
  });
});

describe("zero placement dependencies", () => {
  it("initializes every new instance PnP to zero without changing template defaults or copies", () => {
    const { template, steps } = scenario();
    template.stepRefs.push({ stepRefId: "another", processStepTemplateId: "pnp" });
    const empty = configurationFromInstance(template, steps);
    expect(empty.inputBindings).toEqual({});
    expect(empty.stepConfigurations.place.parameterValues.placements).toEqual([]);
    expect(empty.stepConfigurations.another.parameterValues.placements).toEqual([]);
    expect(empty.stepConfigurations.prepare1.parameterValues).toEqual({});
    expect(createEmptyFlowConfiguration(template, steps).stepConfigurations.place.parameterValues).toEqual({});
    const source: ProcessFlowInstance = { schemaVersion: 2, id: "source", name: "Source", version: "V0", owner: "test", processFlowTemplateId: "flow", inputBindings: {}, stepConfigurations: { place: { parameterValues: { placements: [placement] } } } };
    const copied = configurationFromInstance(template, steps, source);
    expect(copied.stepConfigurations.place).toEqual(source.stepConfigurations.place);
    (copied.stepConfigurations.place.parameterValues.placements as unknown[]).pop();
    expect(source.stepConfigurations.place.parameterValues.placements).toEqual([placement]);
  });

  it("prunes multistep branches and shows unused separately from direct preview readiness", () => {
    const { template, configuration, steps } = scenario();
    const dependencies = analyzeFlowDependencies(template, steps, configuration);
    expect([...dependencies.stepRefIds]).toEqual(["place"]);
    expect([...dependencies.flowInputIds]).toEqual(["main"]);
    expect([...dependencies.edgeIds]).toEqual(["main"]);
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(true);
    const inputReadiness = getFlowInputReadiness(template, steps, configuration, [], "die");
    expect(inputReadiness.code).toBe("unused-dependency");
    expect(geometryInputStatusLabel(inputReadiness, undefined)).toBe("Unused");
    const stepReadiness = getStepConfigurationReadiness("prepare2", template, steps, configuration, []);
    expect(stepReadinessStatusLabel(stepReadiness, "prepare2")).toBe("Unused");
    expect(getStepExecutionReadiness("prepare2", template, steps, configuration, []).status).toBe("incomplete");
    configuration.inputBindings.die = { kind: "catalog", geometryId: "main" };
    configuration.stepConfigurations.prepare1 = { parameterValues: { thickness: 2 } };
    configuration.stepConfigurations.prepare2 = { parameterValues: { thickness: 2 } };
    expect(getStepExecutionReadiness("prepare2", template, steps, configuration, [geometry]).status).toBe("ready");
    expect(getStepConfigurationReadiness("prepare2", template, steps, configuration, [geometry]).status).toBe("neutral");
  });

  it("restores completeness requirements when placements change and preserves branch values", () => {
    const { template, configuration, steps } = scenario();
    configuration.stepConfigurations.prepare1 = { parameterValues: { thickness: 8 } };
    configuration.stepConfigurations.place.parameterValues.placements = [placement];
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
    configuration.stepConfigurations.place.parameterValues.placements = [];
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(true);
    expect(configuration.stepConfigurations.prepare1.parameterValues.thickness).toBe(8);
    delete configuration.inputBindings.main;
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
  });

  it("does not treat missing, null or malformed placements as zero", () => {
    const { template, configuration, steps } = scenario();
    for (const placements of [undefined, null, 0, "", {}]) {
      configuration.stepConfigurations.place.parameterValues.placements = placements;
      expect(analyzeFlowDependencies(template, steps, configuration).stepRefIds.has("prepare1")).toBe(true);
      expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
    }
    steps[1].program = "custom/pnp";
    configuration.stepConfigurations.place.parameterValues.placements = [];
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
  });

  it("prunes direct die input and ignores unresolved inactive recipes", () => {
    const { template, configuration, steps } = scenario();
    template.stepRefs = template.stepRefs.slice(-1);
    template.flowEdges = [inputEdge("main", "main", "place"), inputEdge("die", "die", "place", "die_geometry")];
    configuration.inputBindings.die = { kind: "generator", generatorId: "invalid", generatorVersion: 1, parameters: {} };
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(true);
    expect(getStepExecutionReadiness("place", template, steps, configuration, [geometry]).status).toBe("ready");
  });

  it("keeps shared flow inputs required for active consumers", () => {
    const { template, configuration, steps } = scenario();
    template.flowInputs[1].required = false;
    template.flowEdges[0] = inputEdge("main", "die", "place");
    expect(getFlowInputReadiness(template, steps, configuration, [geometry], "die").code).toBe("unbound-geometry");
    configuration.inputBindings.die = { kind: "catalog", geometryId: "main" };
    expect(getFlowInputReadiness(template, steps, configuration, [geometry], "die").status).toBe("ready");
  });

  it("uses only target consumers when checking optional input requiredness for preview", () => {
    const { template, configuration, steps } = scenario();
    template.flowInputs[1].required = false;
    steps[0].inputPorts[0].required = false;
    template.flowEdges[0] = inputEdge("main", "die", "place");
    configuration.stepConfigurations.prepare1 = { parameterValues: { thickness: 2 } };
    expect(getStepExecutionReadiness("prepare1", template, steps, configuration, []).status).toBe("ready");
    expect(getStepExecutionReadiness("place", template, steps, configuration, []).status).toBe("incomplete");
  });

  it("handles nested zero placement PnP", () => {
    const { template, configuration, steps } = scenario();
    template.stepRefs = [{ stepRefId: "inner", processStepTemplateId: "pnp" }, template.stepRefs[2]];
    template.flowInputs.push({ flowInputId: "unused", name: "Unused", dataType: "geometry", required: true });
    template.flowEdges = [inputEdge("main", "main", "place"), inputEdge("inner-main", "die", "inner"), inputEdge("inner-die", "unused", "inner", "die_geometry"), outputEdge("place", "inner", "place", "die_geometry")];
    configuration.stepConfigurations.place.parameterValues.placements = [placement];
    configuration.stepConfigurations.inner = { parameterValues: { placements: [] } };
    expect([...analyzeFlowDependencies(template, steps, configuration).flowInputIds].sort()).toEqual(["die", "main"]);
  });

  it("still rejects missing template ports, references, cycles and unknown configuration keys", () => {
    const { template, configuration, steps } = scenario();
    template.flowEdges.pop();
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
    expect(getStepExecutionReadiness("place", template, steps, configuration, [geometry]).code).toBe("missing-input-edge");
    template.flowEdges.push(outputEdge("place", "prepare2", "place", "die_geometry"));
    template.stepRefs[0].processStepTemplateId = "missing";
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
    template.stepRefs[0].processStepTemplateId = "prepare";
    template.flowEdges[1] = outputEdge("cycle", "prepare2", "prepare1");
    expect(getStepExecutionReadiness("place", template, steps, configuration, [geometry]).code).toBe("cycle");
    template.flowEdges[1] = inputEdge("die", "die", "prepare1");
    configuration.stepConfigurations.unknown = { parameterValues: {} };
    expect(isConfigurationComplete(template, steps, configuration, [geometry])).toBe(false);
  });
});
