import type {
  ProcessFlowTemplate,
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

type IncomingEdge = {
  edge: SavedFlowEdge;
  portIndex: number;
  role: "primary" | "auxiliary" | null;
};

export function computeTemplateLayout(
  template: ProcessFlowTemplate,
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

  const stepCells = new Map<string, LayoutCell>();
  const flowInputCells = new Map<string, LayoutCell>();
  let nextLane = 1;

  const allocateLane = () => {
    const lane = nextLane;
    nextLane += 1;
    return lane;
  };

  const placeSource = (
    edge: SavedFlowEdge,
    lane: number,
    column: number,
  ) => {
    if (edge.source.kind === "flowInput") {
      if (!flowInputCells.has(edge.source.flowInputId)) {
        flowInputCells.set(edge.source.flowInputId, { column, lane });
      }
      return;
    }
    visitStep(edge.source.stepRefId, lane, column);
  };

  const orderedIncomingEdges = (stepRefId: string): IncomingEdge[] => {
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

    return (incomingByStep.get(stepRefId) ?? [])
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
  };

  function visitStep(stepRefId: string, lane: number, column: number) {
    if (!stepSet.has(stepRefId) || stepCells.has(stepRefId)) {
      return;
    }
    stepCells.set(stepRefId, { column, lane });

    const incoming = orderedIncomingEdges(stepRefId);
    const primaryIndex = incoming.findIndex((item) => item.role === "primary");

    if (primaryIndex >= 0) {
      placeSource(incoming[primaryIndex].edge, lane, column - 1);
    }

    // Allocate auxiliary lanes while unwinding the primary traversal. Branches
    // farther from the terminal therefore stay closer to the main geometry row,
    // and later branches cannot cross through their upstream flow lines.
    incoming.forEach((item, index) => {
      if (index === primaryIndex) {
        return;
      }
      placeSource(item.edge, allocateLane(), column - 1);
    });
  }

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
  let placedRoot = false;

  terminalStepIds.forEach((stepRefId) => {
    if (stepCells.has(stepRefId)) {
      return;
    }
    visitStep(stepRefId, placedRoot ? allocateLane() : 0, 0);
    placedRoot = true;
  });

  // Invalid drafts can contain only cycles or disconnected components. Keep the
  // layout total and deterministic without attempting to infer missing port roles.
  stepIds.forEach((stepRefId) => {
    if (stepCells.has(stepRefId)) {
      return;
    }
    visitStep(stepRefId, placedRoot ? allocateLane() : 0, 0);
    placedRoot = true;
  });

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
      lane: placedRoot ? allocateLane() : 0,
    });
    placedRoot = true;
  });

  const stepPositions = positionsFromCells(stepCells);
  const flowInputPositions = positionsFromCells(flowInputCells);
  normalizePositions(stepPositions, flowInputPositions);
  return { stepPositions, flowInputPositions };
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
