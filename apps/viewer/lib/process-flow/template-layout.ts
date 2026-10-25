import type {
  FlowDefinition,
  ProcessStepTemplate,
  SavedFlowEdge,
  TemplateLayout,
} from "@/lib/process-flow/types";

const X_GAP = 330;
const Y_GAP = 190;
const MIN_X = 40;
const MIN_Y = 70;

type LayoutCell = {
  column: number;
  lane: number;
};

type LayoutBlock = {
  steps: Map<string, LayoutCell>;
  inputs: Map<string, LayoutCell>;
  minLane: number;
  maxLane: number;
};

type IncomingEdge = {
  edge: SavedFlowEdge;
  portIndex: number;
  role: "primary" | "auxiliary" | null;
};

export function computeTemplateLayout(
  template: FlowDefinition,
  stepTemplates: ProcessStepTemplate[],
): TemplateLayout {
  const stepIds = template.stepRefs.map((stepRef) => stepRef.stepRefId);
  const stepSet = new Set(stepIds);
  const stepRefById = new Map(
    template.stepRefs.map((stepRef) => [stepRef.stepRefId, stepRef]),
  );
  const stepTemplateById = new Map(
    stepTemplates.map((stepTemplate) => [stepTemplate.id, stepTemplate]),
  );
  const incomingByStep = new Map<string, SavedFlowEdge[]>();
  const stepsWithOutgoingEdges = new Set<string>();

  template.flowEdges.forEach((edge) => {
    if (stepSet.has(edge.target.stepRefId)) {
      incomingByStep.set(edge.target.stepRefId, [
        ...(incomingByStep.get(edge.target.stepRefId) ?? []),
        edge,
      ]);
    }
    if (edge.source.kind === "stepOutput" && stepSet.has(edge.source.stepRefId)) {
      stepsWithOutgoingEdges.add(edge.source.stepRefId);
    }
  });

  // Mark nodes before recursing so invalid cycles and shared sources stay finite.
  const visitedSteps = new Set<string>();
  const visitedInputs = new Set<string>();
  const stepCells = new Map<string, LayoutCell>();
  const flowInputCells = new Map<string, LayoutCell>();
  let nextLane = 0;

  const placeSource = (edge: SavedFlowEdge, column: number): LayoutBlock | null => {
    if (edge.source.kind === "flowInput") {
      const id = edge.source.flowInputId;
      if (visitedInputs.has(id)) return null;
      visitedInputs.add(id);
      return {
        steps: new Map(),
        inputs: new Map([[id, { column, lane: 0 }]]),
        minLane: 0,
        maxLane: 0,
      };
    }
    return visitStep(edge.source.stepRefId, column);
  };

  const orderedIncomingEdges = (stepRefId: string): {
    incoming: IncomingEdge[];
    primaryPortIndex: number;
  } => {
    const stepRef = stepRefById.get(stepRefId);
    const stepTemplate = stepRef
      ? stepTemplateById.get(stepRef.processStepTemplateId)
      : undefined;
    const portById = new Map(
      (stepTemplate?.inputPorts ?? []).map((port, index) => [
        port.portId,
        { index, role: port.role },
      ]),
    );

    const incoming = (incomingByStep.get(stepRefId) ?? [])
      .map((edge) => {
        const port = portById.get(edge.target.inputPortId);
        return {
          edge,
          portIndex: port?.index ?? Number.MAX_SAFE_INTEGER,
          role: port?.role ?? null,
        };
      })
      .sort(
        (left, right) =>
          left.portIndex - right.portIndex ||
          left.edge.edgeId.localeCompare(right.edge.edgeId),
      );
    return {
      incoming,
      // Use the declaration, even when the primary port has no incoming edge yet.
      primaryPortIndex: stepTemplate?.inputPorts.findIndex((port) => port.role === "primary") ?? -1,
    };
  };

  function visitStep(stepRefId: string, column: number): LayoutBlock | null {
    if (!stepSet.has(stepRefId) || visitedSteps.has(stepRefId)) return null;
    visitedSteps.add(stepRefId);
    const block: LayoutBlock = {
      steps: new Map([[stepRefId, { column, lane: 0 }]]),
      inputs: new Map(),
      minLane: 0,
      maxLane: 0,
    };

    const { incoming, primaryPortIndex } = orderedIncomingEdges(stepRefId);
    const primary = incoming.find((item) => item.role === "primary");
    if (primary) {
      const upstream = placeSource(primary.edge, column - 1);
      if (upstream) mergeBlock(block, upstream, 0);
    }

    // Finish the primary chain first: earlier merges stay closer to its row.
    // Reserve each entire subtree, including branches on either side of its root.
    const auxiliary = incoming.filter((item) => item !== primary);
    const above = auxiliary.filter((item) => item.portIndex < primaryPortIndex);
    const below = auxiliary.filter((item) => item.portIndex >= primaryPortIndex);
    // Insert the nearest upper port first, so top-to-bottom order matches inputPorts.
    above.reverse().forEach((item) => {
      const upstream = placeSource(item.edge, column - 1);
      if (upstream) mergeBlock(block, upstream, block.minLane - 1 - upstream.maxLane);
    });
    below.forEach((item) => {
      const upstream = placeSource(item.edge, column - 1);
      if (upstream) mergeBlock(block, upstream, block.maxLane + 1 - upstream.minLane);
    });
    return block;
  }

  const placeComponent = (stepRefId: string) => {
    const block = visitStep(stepRefId, 0);
    if (!block) return;
    const offset = nextLane - block.minLane;
    block.steps.forEach((cell, id) => stepCells.set(id, { ...cell, lane: cell.lane + offset }));
    block.inputs.forEach((cell, id) => flowInputCells.set(id, { ...cell, lane: cell.lane + offset }));
    nextLane += block.maxLane - block.minLane + 1;
  };

  const terminalStepIds = stepIds.filter(
    (stepRefId) => !stepsWithOutgoingEdges.has(stepRefId),
  );
  const stepOrder = new Map(
    stepIds.map((stepRefId, index) => [stepRefId, index]),
  );
  terminalStepIds.sort(
    (left, right) =>
      longestUpstreamSpan(right, incomingByStep) -
        longestUpstreamSpan(left, incomingByStep) ||
      (stepOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (stepOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
  terminalStepIds.forEach(placeComponent);

  // Invalid drafts may have cycles or unresolved templates; place every remaining node.
  stepIds.forEach(placeComponent);

  const leftmostColumn = Math.min(
    0,
    ...[...stepCells.values(), ...flowInputCells.values()].map(
      (cell) => cell.column,
    ),
  );
  template.flowInputs.forEach((flowInput) => {
    if (flowInputCells.has(flowInput.flowInputId)) {
      return;
    }
    flowInputCells.set(flowInput.flowInputId, {
      column: leftmostColumn,
      lane: nextLane++,
    });
  });

  const stepPositions = positionsFromCells(stepCells);
  const flowInputPositions = positionsFromCells(flowInputCells);
  normalizePositions(stepPositions, flowInputPositions);
  return { stepPositions, flowInputPositions };
}

function mergeBlock(target: LayoutBlock, source: LayoutBlock, offset: number) {
  source.steps.forEach((cell, id) => target.steps.set(id, { ...cell, lane: cell.lane + offset }));
  source.inputs.forEach((cell, id) => target.inputs.set(id, { ...cell, lane: cell.lane + offset }));
  target.minLane = Math.min(target.minLane, source.minLane + offset);
  target.maxLane = Math.max(target.maxLane, source.maxLane + offset);
}

function longestUpstreamSpan(
  stepRefId: string,
  incomingByStep: Map<string, SavedFlowEdge[]>,
  visiting = new Set<string>(),
): number {
  if (visiting.has(stepRefId)) {
    return 0;
  }
  const nextVisiting = new Set(visiting).add(stepRefId);
  return (incomingByStep.get(stepRefId) ?? []).reduce((longest, edge) => {
    const upstreamSpan =
      edge.source.kind === "stepOutput"
        ? longestUpstreamSpan(edge.source.stepRefId, incomingByStep, nextVisiting)
        : 0;
    return Math.max(longest, upstreamSpan + 1);
  }, 0);
}

function positionsFromCells(cells: Map<string, LayoutCell>) {
  return new Map(
    [...cells].map(([id, cell]) => [
      id,
      { x: cell.column * X_GAP, y: cell.lane * Y_GAP },
    ]),
  );
}

function normalizePositions(
  stepPositions: Map<string, { x: number; y: number }>,
  flowInputPositions: Map<string, { x: number; y: number }>,
) {
  const positions = [...stepPositions.values(), ...flowInputPositions.values()];
  if (positions.length === 0) {
    return;
  }
  const minX = Math.min(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const dx = MIN_X - minX;
  const dy = MIN_Y - minY;
  stepPositions.forEach((position) => {
    position.x += dx;
    position.y += dy;
  });
  flowInputPositions.forEach((position) => {
    position.x += dx;
    position.y += dy;
  });
}
