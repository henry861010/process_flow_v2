import type {
  FlowConfiguration,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  SavedFlowEdge,
} from "./types";

export type FlowDependencies = {
  stepRefIds: Set<string>;
  edges: SavedFlowEdge[];
  edgeIds: Set<string>;
  flowInputIds: Set<string>;
};

export function analyzeFlowDependencies(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  configuration: FlowConfiguration,
  outputStepRefId?: string,
): FlowDependencies {
  const templatesById = new Map(stepTemplates.map((step) => [step.id, step]));
  const refsById = new Map(template.stepRefs.map((ref) => [ref.stepRefId, ref]));
  const sourceSteps = new Set(template.flowEdges.flatMap((edge) =>
    edge.source.kind === "stepOutput" ? [edge.source.stepRefId] : [],
  ));
  const incoming = new Map<string, SavedFlowEdge[]>();
  for (const edge of template.flowEdges) {
    const edges = incoming.get(edge.target.stepRefId) ?? [];
    edges.push(edge);
    incoming.set(edge.target.stepRefId, edges);
  }
  const pending = outputStepRefId !== undefined
    ? [outputStepRefId]
    : template.stepRefs.filter((ref) => !sourceSteps.has(ref.stepRefId)).map((ref) => ref.stepRefId);
  const stepRefIds = new Set<string>();
  const edges: SavedFlowEdge[] = [];
  const flowInputIds = new Set<string>();
  while (pending.length) {
    const stepRefId = pending.pop()!;
    if (stepRefIds.has(stepRefId)) continue;
    stepRefIds.add(stepRefId);
    const ref = refsById.get(stepRefId);
    const step = ref ? templatesById.get(ref.processStepTemplateId) : undefined;
    const placements = configuration.stepConfigurations[stepRefId]?.parameterValues?.placements;
    const zeroPlacements = step?.program === "pnp/pnp" && Array.isArray(placements) && placements.length === 0;
    for (const edge of incoming.get(stepRefId) ?? []) {
      if (zeroPlacements && edge.target.inputPortId === "die_geometry") continue;
      edges.push(edge);
      if (edge.source.kind === "flowInput") flowInputIds.add(edge.source.flowInputId);
      else pending.push(edge.source.stepRefId);
    }
  }
  return { stepRefIds, edges, edgeIds: new Set(edges.map((edge) => edge.edgeId)), flowInputIds };
}
