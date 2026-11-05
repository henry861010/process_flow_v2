import { describe, expect, it } from "vitest";
import flows from "../../../api/src/process_flow_api/fixtures/process-flows.json";
import { createFlowBranch } from "./flow-editor-source";
import type { ProcessFlow } from "./types";

function source() { return structuredClone(flows.find((flow) => flow.id === "flow_inst_aaa_demo_hbm4_alpha")!) as ProcessFlow; }

describe("flow branch snapshots", () => {
  it("keeps complete flow-local content and records the immediate source without an update identity", () => {
    const flow = source();
    flow.origin = { flowId: "ancestor", revision: 1 };
    const config = Object.values(flow.configuration.stepConfigurations)[0];
    config.selectedRecipeId = null;
    config.recipeCandidates.push({ recipeId: "unfinished", name: "Unfinished", parameterValues: {} });
    const branch = createFlowBranch(flow, [flow]);
    expect(branch).toEqual({
      schemaVersion: 3, name: `${flow.name} (branch)`, version: flow.version,
      owner: flow.owner, description: flow.description,
      definition: flow.definition, configuration: flow.configuration,
      origin: { flowId: flow.id, revision: flow.revision },
    });
    expect(branch).not.toHaveProperty("id");
    expect(branch).not.toHaveProperty("revision");
    branch.definition.flowInputs[0].name = "Changed input";
    branch.definition.stepRefs[0].stepLabel = "Changed step";
    branch.definition.flowEdges[0].target.inputPortId = "changed-port";
    const binding = Object.values(branch.configuration.inputBindings)[0];
    if (binding.kind === "catalog") binding.geometryId = "changed-geometry";
    Object.values(branch.configuration.stepConfigurations)[0].recipeCandidates[0].parameterValues = {};
    expect(branch.definition).not.toEqual(flow.definition);
    expect(branch.configuration).not.toEqual(flow.configuration);
    expect(Object.values(flow.configuration.stepConfigurations)[0].recipeCandidates[0].parameterValues).not.toEqual({});
  });

  it("uses the first free name for the source version, ignoring names in other versions", () => {
    const flow = source();
    const named = (name: string, version = flow.version) => ({ ...flow, name, version });
    const occupied = [named(`${flow.name} (branch)`), named(`${flow.name} (branch 2)`),
      named(`${flow.name} (branch 4)`), named(`${flow.name} (branch 3)`, "different-version")];
    expect(createFlowBranch(flow, occupied).name).toBe(`${flow.name} (branch 3)`);
    expect(createFlowBranch(flow, [named(`${flow.name} (branch)`, "different-version")]).name)
      .toBe(`${flow.name} (branch)`);
  });
});
