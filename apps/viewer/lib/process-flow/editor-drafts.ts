import type { FlowDraft, ProcessStepTemplate, FlowDraftState } from "./types";

export function assertDraftVersion(draft: FlowDraft) {
  if (draft.schemaVersion !== 2) throw new Error("This draft version is not supported.");
}

export function validateFlowDraftState(state: FlowDraftState, steps: ProcessStepTemplate[]) {
  const ids = new Set<string>();
  const refs = new Set<string>();
  const inputs = new Set<string>();
  const knownSteps = new Set(steps.map((step) => step.id));
  for (const node of state.nodes) {
    if (ids.has(node.id)) throw new Error("Draft contains duplicate node IDs.");
    ids.add(node.id);
    if (node.kind === "processStep") {
      if (!knownSteps.has(node.stepRef.processStepTemplateId)) {
        throw new Error(`Draft requires a missing process step: ${node.stepRef.processStepTemplateId}`);
      }
      if (refs.has(node.stepRef.stepRefId)) throw new Error("Draft contains duplicate step references.");
      refs.add(node.stepRef.stepRefId);
    } else {
      if (inputs.has(node.definition.flowInputId)) throw new Error("Draft contains duplicate flow input IDs.");
      inputs.add(node.definition.flowInputId);
    }
  }
  const edgeIds = new Set<string>();
  for (const edge of state.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error("Draft edge references a missing node.");
    if (edgeIds.has(edge.id)) throw new Error("Draft contains duplicate edge IDs.");
    edgeIds.add(edge.id);
  }
}

export function draftFingerprint(state: unknown) {
  // Object key order must not make a restored server snapshot appear dirty.
  return JSON.stringify(state, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
    }
    return value;
  });
}
