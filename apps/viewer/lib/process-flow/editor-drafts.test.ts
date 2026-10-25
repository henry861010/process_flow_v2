import { describe, expect, it } from "vitest";
import { assertDraftVersion, draftFingerprint, validateFlowDraftState } from "./editor-drafts";
import type { FlowDraft, ProcessStepTemplate, FlowDraftState } from "./types";

const state: FlowDraftState = {
  metadata: { name: "", version: "", owner: "", description: "" },
  configuration: { inputBindings: {}, stepConfigurations: { step: { recipeCandidates: [{ recipeId: "r1", name: "Recipe 1", description: "", parameterValues: { placements: [], items: ["", null] } }], selectedRecipeId: "r1" } },  },
  nodes: [{ id: "node", kind: "processStep", position: { x: -25, y: 123 }, stepRef: { stepRefId: "step", processStepTemplateId: "known" } }],
  editingRecipeIds: {}, edges: [], viewport: { x: 12, y: 33, zoom: 0.8 },
};
const steps = [{ id: "known" }] as ProcessStepTemplate[];

describe("editor draft recovery", () => {
  it("allows incomplete values, disconnected steps and unfinished topology", () => {
    expect(() => validateFlowDraftState(state, steps)).not.toThrow();
    expect(() => validateFlowDraftState({ ...state, edges: [{ id: "cycle", source: "node", target: "node", sourceHandle: null, targetHandle: null }] }, steps)).not.toThrow();
  });
  it("reports missing dependencies and dangling edges before replacing the graph", () => {
    expect(() => validateFlowDraftState(state, [])).toThrow("missing process step");
    expect(() => validateFlowDraftState({ ...state, edges: [{ id: "lost", source: "missing", target: "node", sourceHandle: null, targetHandle: null }] }, steps)).toThrow("missing node");
    expect(() => validateFlowDraftState({ ...state, nodes: [...state.nodes, state.nodes[0]] }, steps)).toThrow("duplicate node");
  });
  it("rejects unsupported persisted snapshot versions", () => {
    expect(() => assertDraftVersion({ schemaVersion: 1 } as unknown as FlowDraft)).toThrow("not supported");
  });
  it("compares snapshots independent of object key order while retaining new changes", () => {
    const captured = structuredClone(state);
    const restored = JSON.parse(JSON.stringify(state));
    restored.metadata = { owner: "", name: "", description: "", version: "" };
    expect(draftFingerprint(restored)).toBe(draftFingerprint(captured));
    state.configuration.stepConfigurations.step.recipeCandidates[0].parameterValues.newValue = 42;
    expect(draftFingerprint(state)).not.toBe(draftFingerprint(captured));
    delete state.configuration.stepConfigurations.step.recipeCandidates[0].parameterValues.newValue;
  });
});
