import type {
  ProcessFlowTemplate,
  SavedFlowEdge,
  TemplateLayout,
} from "@/lib/process-flow/types";

export function computeTemplateLayout(
  template: ProcessFlowTemplate,
): TemplateLayout {
  const stepOrder = new Map(
    template.stepRefs.map((stepRef, index) => [stepRef.stepRefId, index]),
  );
  const stepIds = template.stepRefs.map((stepRef) => stepRef.stepRefId);
  const stepSet = new Set(stepIds);
  const rank = new Map(stepIds.map((stepRefId) => [stepRefId, 1]));

  for (let pass = 0; pass < Math.max(1, stepIds.length); pass += 1) {
    template.flowEdges.forEach((edge) => {
      if (
        edge.source.sourceType !== "stepOutput" ||
        !stepSet.has(edge.source.stepRefId) ||
        !stepSet.has(edge.target.stepRefId)
      ) {
        return;
      }
      const sourceRank = rank.get(edge.source.stepRefId) ?? 1;
      const targetRank = rank.get(edge.target.stepRefId) ?? 1;
      if (targetRank <= sourceRank) {
        rank.set(edge.target.stepRefId, sourceRank + 1);
      }
    });
  }

  const mainPath = findLongestStepPath(template);
  const mainSet = new Set(mainPath);
  const lane = new Map<string, number>();
  mainPath.forEach((stepRefId) => lane.set(stepRefId, 0));

  const lanePattern = buildLanePattern(stepIds.length + 4);
  let lanePatternIndex = 0;
  stepIds
    .filter((stepRefId) => !mainSet.has(stepRefId))
    .sort(
      (left, right) =>
        (rank.get(left) ?? 1) - (rank.get(right) ?? 1) ||
        (stepOrder.get(left) ?? 0) - (stepOrder.get(right) ?? 0) ||
        left.localeCompare(right),
    )
    .forEach((stepRefId) => {
      const upstreamLane = template.flowEdges
        .filter(
          (edge) =>
            edge.source.sourceType === "stepOutput" &&
            edge.target.stepRefId === stepRefId &&
            lane.has(edge.source.stepRefId) &&
            lane.get(edge.source.stepRefId) !== 0,
        )
        .map((edge) =>
          edge.source.sourceType === "stepOutput"
            ? lane.get(edge.source.stepRefId)
            : undefined,
        )
        .find((value): value is number => typeof value === "number");

      if (typeof upstreamLane === "number") {
        lane.set(stepRefId, upstreamLane);
        return;
      }

      lane.set(stepRefId, lanePattern[lanePatternIndex] ?? lanePatternIndex + 1);
      lanePatternIndex += 1;
    });

  const stepPositions = new Map<string, { x: number; y: number }>();
  const initialPositions = new Map<string, { x: number; y: number }>();
  const xGap = 330;
  const yGap = 190;

  stepIds.forEach((stepRefId) => {
    stepPositions.set(stepRefId, {
      x: (rank.get(stepRefId) ?? 1) * xGap,
      y: 280 + (lane.get(stepRefId) ?? 0) * yGap,
    });
  });

  const occupiedLayoutCells = new Set<string>();
  stepIds.forEach((stepRefId) => {
    occupiedLayoutCells.add(
      layoutCellKey(rank.get(stepRefId) ?? 1, lane.get(stepRefId) ?? 0),
    );
  });

  const geometryEdgesByTarget = new Map<string, SavedFlowEdge[]>();
  template.flowEdges.forEach((edge) => {
    if (edge.source.sourceType !== "geometryRef") {
      return;
    }
    const key = edge.target.stepRefId;
    geometryEdgesByTarget.set(key, [...(geometryEdgesByTarget.get(key) ?? []), edge]);
  });

  geometryEdgesByTarget.forEach((group, targetStepRefId) => {
    const targetRank = rank.get(targetStepRefId) ?? 1;
    const targetLane = lane.get(targetStepRefId) ?? 0;
    const initialRank = Math.max(0, targetRank - 1);
    const laneOffsets = centeredInitialLaneOffsets(
      group.length,
      group.length + stepIds.length + 8,
    );

    group
      .slice()
      .sort((left, right) => left.edgeId.localeCompare(right.edgeId))
      .forEach((edge) => {
        const initialLane =
          laneOffsets
            .map((offset) => targetLane + offset)
            .find(
              (candidateLane) =>
                !occupiedLayoutCells.has(layoutCellKey(initialRank, candidateLane)),
            ) ?? targetLane;
        occupiedLayoutCells.add(layoutCellKey(initialRank, initialLane));
        initialPositions.set(edge.edgeId, {
          x: initialRank * xGap,
          y: 280 + initialLane * yGap,
        });
      });
  });

  normalizePositions(stepPositions, initialPositions);
  return { stepPositions, initialPositions };
}

function normalizePositions(
  stepPositions: Map<string, { x: number; y: number }>,
  initialPositions: Map<string, { x: number; y: number }>,
) {
  const positions = [...stepPositions.values(), ...initialPositions.values()];
  if (positions.length === 0) {
    return;
  }
  const minX = Math.min(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const dx = minX < 40 ? 40 - minX : 0;
  const dy = minY < 70 ? 70 - minY : 0;
  if (dx === 0 && dy === 0) {
    return;
  }
  stepPositions.forEach((position) => {
    position.x += dx;
    position.y += dy;
  });
  initialPositions.forEach((position) => {
    position.x += dx;
    position.y += dy;
  });
}

function findLongestStepPath(template: ProcessFlowTemplate) {
  const stepOrder = new Map(
    template.stepRefs.map((stepRef, index) => [stepRef.stepRefId, index]),
  );
  const stepIds = template.stepRefs.map((stepRef) => stepRef.stepRefId);
  const stepSet = new Set(stepIds);
  const adjacency = new Map<string, string[]>();
  template.flowEdges.forEach((edge) => {
    if (
      edge.source.sourceType !== "stepOutput" ||
      !stepSet.has(edge.source.stepRefId) ||
      !stepSet.has(edge.target.stepRefId)
    ) {
      return;
    }
    adjacency.set(edge.source.stepRefId, [
      ...(adjacency.get(edge.source.stepRefId) ?? []),
      edge.target.stepRefId,
    ]);
  });
  adjacency.forEach((targets, source) => {
    adjacency.set(
      source,
      targets.sort(
        (left, right) =>
          (stepOrder.get(left) ?? 0) - (stepOrder.get(right) ?? 0) ||
          left.localeCompare(right),
      ),
    );
  });

  const memo = new Map<string, string[]>();
  function dfs(stepRefId: string, visiting: Set<string>): string[] {
    const cached = memo.get(stepRefId);
    if (cached) {
      return cached;
    }
    if (visiting.has(stepRefId)) {
      return [stepRefId];
    }
    visiting.add(stepRefId);
    let best = [stepRefId];
    for (const target of adjacency.get(stepRefId) ?? []) {
      const candidate = [stepRefId, ...dfs(target, new Set(visiting))];
      if (compareStepPaths(candidate, best, stepOrder) < 0) {
        best = candidate;
      }
    }
    memo.set(stepRefId, best);
    return best;
  }

  let bestPath: string[] = [];
  stepIds.forEach((stepRefId) => {
    const candidate = dfs(stepRefId, new Set());
    if (bestPath.length === 0 || compareStepPaths(candidate, bestPath, stepOrder) < 0) {
      bestPath = candidate;
    }
  });
  return bestPath;
}

function compareStepPaths(
  left: string[],
  right: string[],
  stepOrder: Map<string, number>,
) {
  if (left.length !== right.length) {
    return right.length - left.length;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) {
      continue;
    }
    if (leftValue === undefined) {
      return 1;
    }
    if (rightValue === undefined) {
      return -1;
    }
    const orderDiff =
      (stepOrder.get(leftValue) ?? Number.MAX_SAFE_INTEGER) -
      (stepOrder.get(rightValue) ?? Number.MAX_SAFE_INTEGER);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return leftValue.localeCompare(rightValue);
  }
  return 0;
}

function buildLanePattern(count: number) {
  const lanes: number[] = [];
  for (let index = 1; lanes.length < count; index += 1) {
    lanes.push(-index, index);
  }
  return lanes;
}

function centeredInitialLaneOffsets(groupSize: number, minimumCount: number) {
  const offsets: number[] = [];
  if (groupSize % 2 === 1) {
    offsets.push(0);
  }
  for (let distance = 1; offsets.length < minimumCount; distance += 1) {
    offsets.push(-distance, distance);
  }
  if (groupSize % 2 === 0) {
    offsets.push(0);
  }
  return offsets;
}

function layoutCellKey(rank: number, lane: number) {
  return `${rank}:${lane}`;
}
