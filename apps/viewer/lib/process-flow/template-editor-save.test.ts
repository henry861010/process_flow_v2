import { describe, expect, it } from "vitest";
import { isConfigurationComplete, generatedGeometryId } from "./configuration";
import { buildTemplatePayload } from "./template-builder";
import {
  buildTemplateInstanceCreate,
  instanceMetadataForTemplate,
  templateInstanceConfigurationIssues,
} from "./template-editor-save";
import type { EditorMetadata, FlowConfiguration, GeometryEntity, ProcessFlowTemplate, ProcessStepTemplate } from "./types";

const metadata: EditorMetadata = { name: "Flow", version: "V0.0.0", owner: "engineer", description: "Example" };
const geometry: GeometryEntity = {
  id: "panel", name: "Panel", dim: "", owner: "test", description: "", entityType: "panel", structureFormat: "standard",
};
const step: ProcessStepTemplate = {
  schemaVersion: 2, status: "enabled", id: "molding", name: "Molding", version: "V0", category: "layer",
  program: "layer/molding", owner: "test", description: "",
  inputPorts: [{ portId: "main_geometry", name: "Main", role: "primary", dataType: "geometry", required: true }],
  outputPorts: [{ portId: "result_geometry", name: "Result", dataType: "geometry" }],
  parameterDefinitions: [{ id: "thickness", name: "Thickness", valueType: "float", required: true }],
};
function scenario() {
  const template: ProcessFlowTemplate = {
    schemaVersion: 2, status: "enabled", id: "temporary-id", ...metadata,
    flowInputs: [{ flowInputId: "main", name: "Main input", dataType: "geometry", required: true }],
    stepRefs: [{ stepRefId: "mold", processStepTemplateId: step.id, stepLabel: "Mold panel" }],
    flowEdges: [{ edgeId: "main", source: { kind: "flowInput", flowInputId: "main" }, target: { stepRefId: "mold", inputPortId: "main_geometry" } }],
  };
  const configuration: FlowConfiguration = { inputBindings: {}, stepConfigurations: {}, embeddedGeometries: {} };
  return { template, configuration };
}

describe("template and instance save", () => {
  it("keeps untouched identity fields in sync and preserves edits including cleared fields", () => {
    const overrides = { name: "Custom instance", description: "" };
    expect(instanceMetadataForTemplate(metadata, {})).toEqual(metadata);
    expect(instanceMetadataForTemplate({ ...metadata, name: "Renamed", owner: "new owner", version: "V1" }, overrides))
      .toEqual({ name: "Custom instance", description: "", owner: "new owner", version: "V1" });
    // Reopening retains overrides; changing source resets the session overrides.
    expect(instanceMetadataForTemplate(metadata, overrides).name).toBe("Custom instance");
    expect(instanceMetadataForTemplate({ ...metadata, name: "Other source" }, {}).name).toBe("Other source");
  });

  it("submits independent full instance values while the template keeps only scalar defaults", () => {
    const { template, configuration } = scenario();
    const collectionsStep: ProcessStepTemplate = {
      ...step,
      parameterDefinitions: [
        ...step.parameterDefinitions,
        { id: "items", name: "Items", valueType: "string[]", required: true },
        { id: "placements", name: "Placements", valueType: "placements", required: true },
      ],
    };
    configuration.inputBindings.main = { kind: "generator", generatorId: "panel", generatorVersion: 2, parameters: { width: 100 } };
    configuration.stepConfigurations.mold = { parameterValues: { thickness: 10, items: ["a", "b"], placements: [], repeat: { items: [{ itemId: "one", index: 1, values: { value: 5 } }] } } };
    const built = buildTemplatePayload({ id: template.id, ...metadata }, template.flowInputs,
      [{ ref: template.stepRefs[0], template: collectionsStep }], template.flowEdges, configuration);
    const request = buildTemplateInstanceCreate(built, { ...metadata, name: " Instance ", owner: " owner " }, configuration);
    expect(request.processFlowTemplate).not.toHaveProperty("id");
    expect(request.processFlowTemplate.stepRefs[0].parameterDefaults).toEqual({ thickness: 10 });
    expect(request.processFlowTemplate).not.toHaveProperty("inputBindings");
    expect(request.processFlowInstance).not.toHaveProperty("id");
    expect(request.processFlowInstance).not.toHaveProperty("processFlowTemplateId");
    expect(request.processFlowInstance).toMatchObject({ name: "Instance", owner: "owner", ...configuration });
    request.processFlowInstance.stepConfigurations.mold.parameterValues.items = [];
    const binding = request.processFlowInstance.inputBindings.main;
    if (binding.kind === "generator") binding.parameters.width = 200;
    expect(configuration.stepConfigurations.mold.parameterValues.items).toEqual(["a", "b"]);
    expect(configuration.inputBindings.main).toMatchObject({ parameters: { width: 100 } });
  });

  it("lists missing inputs and parameters and enables saving once complete", () => {
    const { template, configuration } = scenario();
    expect(templateInstanceConfigurationIssues(template, [step], configuration, [geometry])).toEqual([
      "Main input needs a geometry binding.", "Mold panel: Thickness is incomplete.",
    ]);
    expect(isConfigurationComplete(template, [step], configuration, [geometry])).toBe(false);
    configuration.inputBindings.main = { kind: "catalog", geometryId: geometry.id };
    configuration.stepConfigurations.mold = { parameterValues: { thickness: 10 } };
    expect(templateInstanceConfigurationIssues(template, [step], configuration, [geometry])).toEqual([]);
    expect(isConfigurationComplete(template, [step], configuration, [geometry])).toBe(true);
  });

  it("requires a resolved generator preview for the current recipe", () => {
    const { template, configuration } = scenario();
    configuration.inputBindings.main = { kind: "generator", generatorId: "panel", generatorVersion: 2, parameters: {} };
    configuration.stepConfigurations.mold = { parameterValues: { thickness: 10 } };
    expect(isConfigurationComplete(template, [step], configuration, [])).toBe(false);
    expect(templateInstanceConfigurationIssues(template, [step], configuration, [])).toEqual([
      "Main input references a geometry that cannot be resolved.",
    ]);
    expect(isConfigurationComplete(template, [step], configuration, [{ ...geometry, id: generatedGeometryId("main") }])).toBe(true);
  });

  it("ignores unused die bindings at zero placements and restores their requirements when changed", () => {
    const { template, configuration } = scenario();
    const pnp: ProcessStepTemplate = {
      ...step, program: "pnp/pnp",
      inputPorts: [...step.inputPorts, { portId: "die_geometry", name: "Die", role: "auxiliary", dataType: "geometry", required: true }],
      parameterDefinitions: [{ id: "placements", name: "Placements", valueType: "placements", required: true }],
    };
    template.flowInputs.push({ flowInputId: "die", name: "Die input", dataType: "geometry", required: true });
    template.flowEdges.push({ edgeId: "die", source: { kind: "flowInput", flowInputId: "die" }, target: { stepRefId: "mold", inputPortId: "die_geometry" } });
    configuration.inputBindings.main = { kind: "catalog", geometryId: geometry.id };
    configuration.inputBindings.die = { kind: "generator", generatorId: "unavailable", generatorVersion: 99, parameters: {} };
    configuration.stepConfigurations.mold = { parameterValues: { placements: [] } };
    expect(isConfigurationComplete(template, [pnp], configuration, [geometry])).toBe(true);
    expect(templateInstanceConfigurationIssues(template, [pnp], configuration, [geometry])).toEqual([]);
    const request = buildTemplateInstanceCreate(template, metadata, configuration);
    expect(request.processFlowInstance.inputBindings.die).toEqual(configuration.inputBindings.die);
    for (const placements of [undefined, null, {}, [null]]) {
      configuration.stepConfigurations.mold.parameterValues.placements = placements;
      expect(isConfigurationComplete(template, [pnp], configuration, [geometry])).toBe(false);
      expect(templateInstanceConfigurationIssues(template, [pnp], configuration, [geometry])).toContain("Die input references a geometry that cannot be resolved.");
    }
  });
});
