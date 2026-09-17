const PLACEMENT_TOLERANCE = 1e-9;

export type PlacementValidationSummary = {
  totalPlacements: number;
  invalidPlacements: number;
  diagnostics: Array<string | null>;
};

export function placementDiagnostic(placement: unknown): string | null {
  if (!isRecord(placement)) return "Placement must be an object.";
  if (!isRecord(placement.targetRegion)) {
    return "Placement requires a target region.";
  }
  if (!isRecord(placement.pose)) return "Placement requires a pose.";
  if (
    placement.pose.x !== 0 ||
    placement.pose.y !== 0 ||
    placement.pose.rotationZ !== 0
  ) {
    return "Placement pose must use X 0, Y 0, and rotation Z 0.";
  }
  if (placement.anchor !== "center") {
    return "Placement anchor must be center.";
  }

  const region = placement.targetRegion;
  if (region.type === "rectangle") {
    const coordinates = [
      region.bottomLeftX,
      region.bottomLeftY,
      region.topRightX,
      region.topRightY,
    ];
    if (!coordinates.every(isFiniteNumber)) {
      return "Rectangle requires finite bottom-left and top-right coordinates.";
    }
    if (
      (region.topRightX as number) <= (region.bottomLeftX as number) ||
      (region.topRightY as number) <= (region.bottomLeftY as number)
    ) {
      return "Rectangle top-right coordinates must be greater than bottom-left coordinates.";
    }
    return null;
  }

  if (region.type !== "polygon" || !Array.isArray(region.points)) {
    return "Placement target region must be a rectangle or polygon.";
  }
  if (!region.points.every(isCoordinatePair)) {
    return "Enter a finite X and Y for every polygon point.";
  }

  const points = (region.points as number[][]).map((point) => [point[0], point[1]]);
  if (points.length > 3 && pointsEqual(points[0], points[points.length - 1])) {
    points.pop();
  }
  if (points.length < 3) return "Polygon requires at least three points.";
  if (new Set(points.map((point) => `${point[0]}:${point[1]}`)).size !== points.length) {
    return "Polygon points must be unique.";
  }
  if (points.some((point, index) => pointsEqual(point, points[(index + 1) % points.length]))) {
    return "Polygon must not contain zero-length edges.";
  }
  if (polygonSelfIntersects(points)) return "Polygon must not self-intersect.";
  if (Math.abs(polygonArea(points)) <= PLACEMENT_TOLERANCE) {
    return "Polygon must have non-zero area.";
  }
  return null;
}

export function isPlacementValid(placement: unknown): boolean {
  return placementDiagnostic(placement) === null;
}

export function summarizePlacementValidation(
  placements: readonly unknown[],
): PlacementValidationSummary {
  const diagnostics = placements.map(placementDiagnostic);
  return {
    totalPlacements: placements.length,
    invalidPlacements: diagnostics.filter((diagnostic) => diagnostic !== null).length,
    diagnostics,
  };
}

function polygonArea(points: number[][]) {
  return (
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      return area + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2
  );
}

function polygonSelfIntersects(points: number[][]) {
  for (let left = 0; left < points.length; left += 1) {
    const leftEnd = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightEnd = (right + 1) % points.length;
      if (
        left === right ||
        left === rightEnd ||
        leftEnd === right ||
        leftEnd === rightEnd
      ) {
        continue;
      }
      if (
        segmentsIntersect(
          points[left],
          points[leftEnd],
          points[right],
          points[rightEnd],
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function segmentsIntersect(a: number[], b: number[], c: number[], d: number[]) {
  const orientations = [
    orientation(a, b, c),
    orientation(a, b, d),
    orientation(c, d, a),
    orientation(c, d, b),
  ];
  if (
    orientations[0] * orientations[1] < -PLACEMENT_TOLERANCE &&
    orientations[2] * orientations[3] < -PLACEMENT_TOLERANCE
  ) {
    return true;
  }
  return (
    pointOnSegment(a, c, d) ||
    pointOnSegment(b, c, d) ||
    pointOnSegment(c, a, b) ||
    pointOnSegment(d, a, b)
  );
}

function pointOnSegment(point: number[], start: number[], end: number[]) {
  return (
    Math.abs(orientation(start, end, point)) <= PLACEMENT_TOLERANCE &&
    point[0] >= Math.min(start[0], end[0]) - PLACEMENT_TOLERANCE &&
    point[0] <= Math.max(start[0], end[0]) + PLACEMENT_TOLERANCE &&
    point[1] >= Math.min(start[1], end[1]) - PLACEMENT_TOLERANCE &&
    point[1] <= Math.max(start[1], end[1]) + PLACEMENT_TOLERANCE
  );
}

function orientation(a: number[], b: number[], c: number[]) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointsEqual(left: number[], right: number[]) {
  return (
    Math.abs(left[0] - right[0]) <= PLACEMENT_TOLERANCE &&
    Math.abs(left[1] - right[1]) <= PLACEMENT_TOLERANCE
  );
}

function isCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(isFiniteNumber)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
