import { describe, expect, it } from "vitest";
import { assertDraftVersion, draftFingerprint, validateTemplateDraftState } from "./editor-drafts";
import type { EditorDraft, ProcessStepTemplate, TemplateEditorDraftState } from "./types";

const state: TemplateEditorDraftState = {
  metadata: { name: "", version: "", owner: "", description: "" },
  configuration: { inputBindings: {}, stepConfigurations: { step: { parameterValues: { placements: [], items: ["", null] } } }, embeddedGeometries: {} },
  nodes: [{ id: "node", kind: "processStep", position: { x: -25, y: 123 }, stepRef: { stepRefId: "step", processStepTemplateId: "known" } }],
  edges: [], viewport: { x: 12, y: 33, zoom: 0.8 },
};
const steps = [{ id: "known" }] as ProcessStepTemplate[];

describe("editor draft recovery", () => {
  it("allows incomplete values, disconnected steps and unfinished topology", () => {
    expect(() => validateTemplateDraftState(state, steps)).not.toThrow();
    expect(() => validateTemplateDraftState({ ...state, edges: [{ id: "cycle", source: "node", target: "node", sourceHandle: null, targetHandle: null }] }, steps)).not.toThrow();
  });
  it("reports missing dependencies and dangling edges before replacing the graph", () => {
    expect(() => validateTemplateDraftState(state, [])).toThrow("missing process step");
    expect(() => validateTemplateDraftState({ ...state, edges: [{ id: "lost", source: "missing", target: "node", sourceHandle: null, targetHandle: null }] }, steps)).toThrow("missing node");
    expect(() => validateTemplateDraftState({ ...state, nodes: [...state.nodes, state.nodes[0]] }, steps)).toThrow("duplicate node");
  });
  it("rejects unsupported persisted snapshot versions", () => {
    expect(() => assertDraftVersion({ schemaVersion: 2 } as unknown as EditorDraft)).toThrow("not supported");
  });
  it("compares snapshots independent of object key order while retaining new changes", () => {
    const captured = structuredClone(state);
    const restored = JSON.parse(JSON.stringify(state));
    restored.metadata = { owner: "", name: "", description: "", version: "" };
    expect(draftFingerprint(restored)).toBe(draftFingerprint(captured));
    state.configuration.stepConfigurations.step.parameterValues.newValue = 42;
    expect(draftFingerprint(state)).not.toBe(draftFingerprint(captured));
    delete state.configuration.stepConfigurations.step.parameterValues.newValue;
  });
});
