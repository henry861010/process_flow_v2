import type {
  CoordinateBounds,
  CoordinatePair,
} from "./coordinate-list-value";
import { COORDINATE_DUPLICATE_TOLERANCE } from "./coordinate-list-value";

export type GdsTargetRegion =
  | { type: "rectangle"; bounds: CoordinateBounds }
  | { type: "polygon"; points: CoordinatePair[] };

export type GdsRegionCollection = {
  regions: GdsTargetRegion[];
  duplicatesRemoved: number;
  repairedElements: number;
  unrepairedElements: number;
  repairDiagnostics: GdsRepairDiagnostic[];
  nonOrthogonalRegions: number;
};

export type GdsRepairReason = "unrecognized-outline" | "invalid-outline";

export type GdsRepairDiagnostic = { regionIndex: number; reason: GdsRepairReason };

export type GdsRegionRepair = {
  region: GdsTargetRegion;
} & (
  | { status: "unchanged" | "repaired" }
  | { status: "preserved"; reason: GdsRepairReason }
);

export type Matrix = [number, number, number, number, number, number];

export type GdsReferenceTransform = {
  strans?: number;
  mag?: number;
  angle?: number;
};

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

type EdgeAxis = "horizontal" | "vertical";

export function createGdsRegionAccumulator(defeature = false) {
  const regions: GdsTargetRegion[] = [];
  const regionSignatures = new Map<string, number>();
  const repairDiagnostics: GdsRepairDiagnostic[] = [];
  const nonOrthogonalRegionIndices = new Set<number>();
  let duplicatesRemoved = 0;
  let repairedElements = 0;
  let unrepairedElements = 0;

  return {
    add(region: GdsTargetRegion, tolerance = COORDINATE_DUPLICATE_TOLERANCE) {
      let outputRegion = region;
      let reason: GdsRepairReason | undefined;
      if (defeature) {
        const repair = repairGdsRegion(region, tolerance);
        outputRegion = repair.region;
        if (repair.status === "repaired") {
          repairedElements += 1;
        }
        if (repair.status === "preserved") {
          unrepairedElements += 1;
          reason = repair.reason;
        }
      }

      const signature = regionSignature(outputRegion);
      const existingIndex = regionSignatures.get(signature);
      if (existingIndex !== undefined) {
        duplicatesRemoved += 1;
        if (reason && !repairDiagnostics.some(({ regionIndex }) => regionIndex === existingIndex)) {
          repairDiagnostics.push({ regionIndex: existingIndex, reason });
        }
        if (regionHasNonOrthogonalEdges(outputRegion, tolerance)) nonOrthogonalRegionIndices.add(existingIndex);
        return;
      }

      const regionIndex = regions.length;
      regionSignatures.set(signature, regionIndex);
      regions.push(outputRegion);
      if (reason) repairDiagnostics.push({ regionIndex, reason });
      if (regionHasNonOrthogonalEdges(outputRegion, tolerance)) {
        nonOrthogonalRegionIndices.add(regionIndex);
      }
    },
    result(): GdsRegionCollection {
      return {
        regions,
        duplicatesRemoved,
        repairedElements,
        unrepairedElements,
        repairDiagnostics,
        nonOrthogonalRegions: nonOrthogonalRegionIndices.size,
      };
    },
  };
}

export function repairGdsRegion(
  region: GdsTargetRegion,
  tolerance = COORDINATE_DUPLICATE_TOLERANCE,
): GdsRegionRepair {
  if (region.type === "rectangle" || !regionHasNonOrthogonalEdges(region, tolerance)) {
    return { region, status: "unchanged" };
  }

  const points = removeConsecutiveDuplicatePoints(region.points, tolerance);
  if (!isValidPolygon(points, tolerance)) {
    return { region, status: "preserved", reason: "invalid-outline" };
  }
  const localPoints = repairBoundaryFeatures(points, tolerance);
  const repairedPoints = localPoints && repairPolygonWithAxisAlignedEdges(localPoints, tolerance);
  if (repairedPoints) {
    const simplifiedPoints = simplifyOrthogonalPolygon(repairedPoints, tolerance);
    if (isValidOrthogonalPolygon(simplifiedPoints, tolerance)) {
      return {
        region: canonicalizeOrthogonalPolygon(simplifiedPoints, tolerance),
        status: "repaired",
      };
    }
  }

  return {
    region,
    status: "preserved",
    reason: repairedPoints ? "invalid-outline" : "unrecognized-outline",
  };
}

export function regionHasNonOrthogonalEdges(
  region: GdsTargetRegion,
  tolerance = COORDINATE_DUPLICATE_TOLERANCE,
) {
  if (region.type === "rectangle") return false;
  return region.points.some(
    (point, index) => edgeAxis(point, region.points[(index + 1) % region.points.length], tolerance) === null,
  );
}

// A circular notch is one concave turning chain, including any axis-aligned
// chords at its bottom. Looking only at non-axis-aligned edges splits that
// feature and mistakes its bottom for a structural support edge.
function repairBoundaryFeatures(points: CoordinatePair[], tolerance: number): CoordinatePair[] | null {
  const count = points.length;
  const winding = Math.sign(polygonArea(points));
  const turns = points.map((point, index) => {
    const previous = points[(index - 1 + count) % count];
    const next = points[(index + 1) % count];
    const cross = orientation(previous, point, next);
    const threshold = tolerance * (Math.hypot(point[0] - previous[0], point[1] - previous[1]) +
      Math.hypot(next[0] - point[0], next[1] - point[1]));
    return Math.abs(cross) <= threshold ? 0 : winding * Math.sign(cross);
  });
  const replacements = new Map<number, { end: number; points: CoordinatePair[] }>();
  const endpoints = new Map<number, CoordinatePair>();
  const consumedEdges = new Set<number>();

  for (let first = 0; first < count; first += 1) {
    const turn = turns[first];
    if (!turn) continue;
    let previousTurn = (first - 1 + count) % count;
    while (previousTurn !== first && turns[previousTurn] === 0) previousTurn = (previousTurn - 1 + count) % count;
    if (turns[previousTurn] === turn) continue;
    const chainFirst = (previousTurn + 1) % count;
    let last = first;
    let length = (first - chainFirst + count) % count + 1;
    while (length < count && (turns[(last + 1) % count] === turn || turns[(last + 1) % count] === 0)) {
      last = (last + 1) % count;
      length += 1;
    }
    if (length >= count - 2) continue;
    const start = (chainFirst - 1 + count) % count;
    const end = (last + 1) % count;
    const previous = points[(start - 1 + count) % count];
    const next = points[(end + 1) % count];
    const axis = edgeAxis(previous, points[start], tolerance);
    if (!axis || axis !== edgeAxis(points[end], next, tolerance) ||
      axis !== edgeAxis(points[start], points[end], tolerance)) continue;

    const chain: CoordinatePair[] = [];
    for (let offset = 0; offset <= length + 1; offset += 1) chain.push(points[(start + offset) % count]);
    if (!regionHasNonOrthogonalEdges({ type: "polygon", points: chain }, tolerance)) continue;
    const origin = points[start];
    const direction = Math.sign(points[end][axis === "horizontal" ? 0 : 1] - origin[axis === "horizontal" ? 0 : 1]);
    if (!direction) continue;
    const tangent: CoordinatePair = axis === "horizontal" ? [direction, 0] : [0, direction];
    const normal: CoordinatePair = [-tangent[1] * winding, tangent[0] * winding];
    const along = (p: CoordinatePair) => (p[0] - origin[0]) * tangent[0] + (p[1] - origin[1]) * tangent[1];
    const inward = (p: CoordinatePair) => (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1];
    const positions = chain.map(along);
    const depths = chain.map(inward);
    const minimum = Math.min(...positions);
    const maximum = Math.max(...positions);
    // The envelope may widen an undercut, but must stay on the two original
    // shoulder segments. Ambiguous or overlapping features are preserved.
    if (along(previous) > minimum + tolerance || along(next) < maximum - tolerance) continue;
    const at = (s: number, d: number): CoordinatePair => [
      origin[0] + tangent[0] * s + normal[0] * d,
      origin[1] + tangent[1] * s + normal[1] * d,
    ];
    let replacement: CoordinatePair[];
    if (turn < 0 && Math.min(...depths) >= -tolerance && Math.max(...depths) > tolerance) {
      const depth = Math.max(...depths);
      replacement = [at(minimum, 0), at(minimum, depth), at(maximum, depth), at(maximum, 0)];
    } else if (turn > 0 && Math.max(...depths) <= tolerance && Math.min(...depths) < -tolerance) {
      replacement = [points[start], points[end]];
    } else {
      continue;
    }
    for (let offset = 0; offset < length + 1; offset += 1) {
      const edge = (start + offset) % count;
      if (consumedEdges.has(edge)) return null;
      consumedEdges.add(edge);
    }
    replacements.set(start, { end, points: replacement });
    for (const [index, point] of [[start, replacement[0]], [end, replacement[replacement.length - 1]]] as const) {
      const previous = endpoints.get(index);
      if (previous && !pointsEqual(previous, point, tolerance)) return null;
      endpoints.set(index, point);
    }
  }

  if (!replacements.size) return points;
  const initial = replacements.keys().next().value as number;
  const result: CoordinatePair[] = [];
  let traversed = 0;
  while (traversed < count) {
    const index = (initial + traversed) % count;
    const replacement = replacements.get(index);
    if (replacement) {
      result.push(...replacement.points.slice(0, -1));
      traversed += (replacement.end - index + count) % count;
    } else {
      result.push(endpoints.get(index) ?? points[index]);
      traversed += 1;
    }
  }
  return removeConsecutiveDuplicatePoints(result, tolerance);
}

function repairPolygonWithAxisAlignedEdges(
  points: CoordinatePair[],
  tolerance: number,
): CoordinatePair[] | null {
  const edgeAxes = points.map((point, index) =>
    edgeAxis(point, points[(index + 1) % points.length], tolerance),
  );
  const orthogonalEdgeIndices = edgeAxes.flatMap((axis, index) =>
    axis ? [index] : [],
  );
  if (orthogonalEdgeIndices.length < 2) {
    return null;
  }

  const supports = orthogonalEdgeIndices.map((edgeIndex) =>
    edgeSupport(points, edgeIndex, edgeAxes[edgeIndex] as EdgeAxis),
  );
  const parents = orthogonalEdgeIndices.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const parent = parents[index];
      parents[index] = root;
      index = parent;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let position = 0; position < orthogonalEdgeIndices.length; position += 1) {
    const nextPosition = (position + 1) % orthogonalEdgeIndices.length;
    const edgeIndex = orthogonalEdgeIndices[position];
    const nextEdgeIndex = orthogonalEdgeIndices[nextPosition];
    const axis = edgeAxes[edgeIndex] as EdgeAxis;
    const nextAxis = edgeAxes[nextEdgeIndex] as EdgeAxis;
    if (axis !== nextAxis) continue;
    if (
      Math.abs(supports[position] - supports[nextPosition]) >
      tolerance
    ) {
      return null;
    }
    // Collinear curved features were handled as complete turning chains above.
    // Do not silently bridge an unrecognized feature and fill its void.
    if ((edgeIndex + 1) % points.length !== nextEdgeIndex) return null;
    union(position, nextPosition);
  }

  const supportTotals = new Map<number, { total: number; count: number }>();
  supports.forEach((support, position) => {
    const root = find(position);
    const current = supportTotals.get(root) ?? { total: 0, count: 0 };
    current.total += support;
    current.count += 1;
    supportTotals.set(root, current);
  });
  const normalizedSupports = supports.map((_, position) => {
    const total = supportTotals.get(find(position));
    return total ? total.total / total.count : supports[position];
  });

  const starts = orthogonalEdgeIndices.map((edgeIndex, position) =>
    projectPointToEdgeSupport(
      points[edgeIndex],
      edgeAxes[edgeIndex] as EdgeAxis,
      normalizedSupports[position],
    ),
  );
  const ends = orthogonalEdgeIndices.map((edgeIndex, position) =>
    projectPointToEdgeSupport(
      points[(edgeIndex + 1) % points.length],
      edgeAxes[edgeIndex] as EdgeAxis,
      normalizedSupports[position],
    ),
  );

  for (let position = 0; position < orthogonalEdgeIndices.length; position += 1) {
    const nextPosition = (position + 1) % orthogonalEdgeIndices.length;
    const axis = edgeAxes[orthogonalEdgeIndices[position]] as EdgeAxis;
    const nextAxis = edgeAxes[orthogonalEdgeIndices[nextPosition]] as EdgeAxis;
    if (axis === nextAxis) continue;
    const intersection: CoordinatePair = axis === "horizontal"
      ? [normalizedSupports[nextPosition], normalizedSupports[position]]
      : [normalizedSupports[position], normalizedSupports[nextPosition]];
    if ((orthogonalEdgeIndices[position] + 1) % points.length !== orthogonalEdgeIndices[nextPosition]) {
      const chain: CoordinatePair[] = [points[(orthogonalEdgeIndices[position] + 1) % points.length]];
      for (let index = (orthogonalEdgeIndices[position] + 2) % points.length;
        index !== (orthogonalEdgeIndices[nextPosition] + 1) % points.length;
        index = (index + 1) % points.length) chain.push(points[index]);
      const bounds = transformedBounds(chain, IDENTITY)!;
      if (intersection.some((coordinate, axis) => coordinate < bounds[0][axis] - tolerance || coordinate > bounds[1][axis] + tolerance)) return null;
    }
    ends[position] = intersection;
    starts[nextPosition] = intersection;
  }

  return starts.flatMap((start, position) => [start, ends[position]]);
}

function edgeAxis(start: CoordinatePair, end: CoordinatePair, tolerance: number): EdgeAxis | null {
  if (Math.abs(end[1] - start[1]) <= tolerance) {
    return "horizontal";
  }
  if (Math.abs(end[0] - start[0]) <= tolerance) {
    return "vertical";
  }
  return null;
}

function edgeSupport(
  points: CoordinatePair[],
  edgeIndex: number,
  axis: EdgeAxis,
) {
  const start = points[edgeIndex];
  const end = points[(edgeIndex + 1) % points.length];
  return axis === "horizontal"
    ? (start[1] + end[1]) / 2
    : (start[0] + end[0]) / 2;
}

function projectPointToEdgeSupport(
  point: CoordinatePair,
  axis: EdgeAxis,
  support: number,
): CoordinatePair {
  return axis === "horizontal" ? [point[0], support] : [support, point[1]];
}

function removeConsecutiveDuplicatePoints(points: CoordinatePair[], tolerance: number) {
  const result: CoordinatePair[] = [];
  points.forEach((point) => {
    if (!result.length || !pointsEqual(result[result.length - 1], point, tolerance)) {
      result.push([...point]);
    }
  });
  if (result.length > 1 && pointsEqual(result[0], result[result.length - 1], tolerance)) {
    result.pop();
  }
  return result;
}

function simplifyOrthogonalPolygon(points: CoordinatePair[], tolerance: number) {
  const result = removeConsecutiveDuplicatePoints(points, tolerance);
  let changed = true;
  while (changed && result.length >= 3) {
    changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const point = result[index];
      const next = result[(index + 1) % result.length];
      if (pointOnAxisAlignedSegment(point, previous, next, tolerance)) {
        result.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

function pointOnAxisAlignedSegment(
  point: CoordinatePair,
  start: CoordinatePair,
  end: CoordinatePair,
  tolerance: number,
) {
  const axis = edgeAxis(start, end, tolerance);
  if (!axis) return false;
  if (axis === "horizontal") {
    return (
      Math.abs(point[1] - start[1]) <= tolerance &&
      point[0] >= Math.min(start[0], end[0]) - tolerance &&
      point[0] <= Math.max(start[0], end[0]) + tolerance
    );
  }
  return (
    Math.abs(point[0] - start[0]) <= tolerance &&
    point[1] >= Math.min(start[1], end[1]) - tolerance &&
    point[1] <= Math.max(start[1], end[1]) + tolerance
  );
}

function isValidPolygon(points: CoordinatePair[], tolerance: number) {
  return points.length >= 3 &&
    points.every((point) => point.every(Number.isFinite)) &&
    !points.some((point, index) => pointsEqual(point, points[(index + 1) % points.length], tolerance)) &&
    Math.abs(polygonArea(points)) > tolerance * tolerance &&
    !polygonSelfIntersects(points, tolerance);
}

function isValidOrthogonalPolygon(points: CoordinatePair[], tolerance: number) {
  return points.length >= 4 && isValidPolygon(points, tolerance) &&
    !regionHasNonOrthogonalEdges({ type: "polygon", points }, tolerance);
}

function polygonArea(points: CoordinatePair[]) {
  // Translate before the shoelace sum to avoid cancellation far from the origin.
  const [x, y] = points[0];
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + (point[0] - x) * (next[1] - y) - (next[0] - x) * (point[1] - y);
  }, 0) / 2;
}

function polygonSelfIntersects(points: CoordinatePair[], tolerance: number) {
  for (let left = 0; left < points.length; left += 1) {
    const leftEnd = (left + 1) % points.length;
    for (let right = left + 1; right < points.length; right += 1) {
      const rightEnd = (right + 1) % points.length;
      if (left === rightEnd || leftEnd === right) continue;
      if (segmentsIntersect(points[left], points[leftEnd], points[right], points[rightEnd], tolerance)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: CoordinatePair, b: CoordinatePair, c: CoordinatePair, d: CoordinatePair, tolerance: number) {
  if (orientationSign(a, b, c, tolerance) * orientationSign(a, b, d, tolerance) < 0 &&
    orientationSign(c, d, a, tolerance) * orientationSign(c, d, b, tolerance) < 0) return true;
  return pointOnSegment(a, c, d, tolerance) || pointOnSegment(b, c, d, tolerance) ||
    pointOnSegment(c, a, b, tolerance) || pointOnSegment(d, a, b, tolerance);
}

function orientation(a: CoordinatePair, b: CoordinatePair, c: CoordinatePair) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function orientationSign(a: CoordinatePair, b: CoordinatePair, c: CoordinatePair, tolerance: number) {
  const cross = orientation(a, b, c);
  const threshold = tolerance * Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Math.abs(cross) <= threshold ? 0 : Math.sign(cross);
}

function pointOnSegment(point: CoordinatePair, start: CoordinatePair, end: CoordinatePair, tolerance: number) {
  return orientationSign(start, end, point, tolerance) === 0 &&
    point[0] >= Math.min(start[0], end[0]) - tolerance &&
    point[0] <= Math.max(start[0], end[0]) + tolerance &&
    point[1] >= Math.min(start[1], end[1]) - tolerance &&
    point[1] <= Math.max(start[1], end[1]) + tolerance;
}

function canonicalizeOrthogonalPolygon(points: CoordinatePair[], tolerance: number): GdsTargetRegion {
  const bounds = transformedBounds(points, IDENTITY);
  if (bounds && points.length === 4 && pointsAreRectangleCorners(points, bounds, tolerance)) {
    return { type: "rectangle", bounds };
  }
  return { type: "polygon", points };
}

function pointsAreRectangleCorners(
  points: CoordinatePair[],
  bounds: CoordinateBounds,
  tolerance: number,
) {
  const corners: CoordinatePair[] = [
    [bounds[0][0], bounds[0][1]],
    [bounds[1][0], bounds[0][1]],
    [bounds[1][0], bounds[1][1]],
    [bounds[0][0], bounds[1][1]],
  ];
  return corners.every((corner) => points.some((point) => pointsEqual(point, corner, tolerance)));
}

function pointsEqual(left: CoordinatePair, right: CoordinatePair, tolerance: number) {
  return Math.abs(left[0] - right[0]) <= tolerance && Math.abs(left[1] - right[1]) <= tolerance;
}

export function unitScale(metersPerDbUnit: number, unit?: string | null) {
  const normalized = unit?.trim().toLowerCase();
  if (!normalized) {
    return 1;
  }
  if (normalized === "m" || normalized === "meter" || normalized === "meters") {
    return metersPerDbUnit;
  }
  if (normalized === "mm" || normalized === "millimeter" || normalized === "millimeters") {
    return metersPerDbUnit * 1e3;
  }
  if (
    normalized === "um" ||
    normalized === "µm" ||
    normalized === "micron" ||
    normalized === "microns" ||
    normalized === "micrometer" ||
    normalized === "micrometers"
  ) {
    return metersPerDbUnit * 1e6;
  }
  if (normalized === "nm" || normalized === "nanometer" || normalized === "nanometers") {
    return metersPerDbUnit * 1e9;
  }
  return 1;
}

export function transformedBounds(
  points: CoordinatePair[],
  transform: Matrix,
): CoordinateBounds | null {
  if (points.length === 0) {
    return null;
  }
  const result = transformedPoints(points, transform);
  const xs = result.map((point) => point[0]);
  const ys = result.map((point) => point[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
}

export function transformedPoints(
  points: CoordinatePair[],
  transform: Matrix,
): CoordinatePair[] {
  return points.map((point) => transformPoint(transform, point));
}

export function referenceTransform(
  element: GdsReferenceTransform,
  origin: CoordinatePair,
): Matrix {
  const angle = element.angle ?? 0;
  const mag = element.mag ?? 1;
  const reflected = Boolean((element.strans ?? 0) & 0x8000);
  const scaleAndReflect: Matrix = [mag, 0, 0, reflected ? -mag : mag, 0, 0];
  return multiply(
    translation(origin[0], origin[1]),
    multiply(rotation(angle), scaleAndReflect),
  );
}

export function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

function transformPoint(matrix: Matrix, point: CoordinatePair): CoordinatePair {
  return [
    matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
    matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
  ];
}

function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

function rotation(angle: number): Matrix {
  const quarter = ((angle / 90) % 4 + 4) % 4;
  const cos = Number.isInteger(quarter) ? [1, 0, -1, 0][quarter] : Math.cos(angle * Math.PI / 180);
  const sin = Number.isInteger(quarter) ? [0, 1, 0, -1][quarter] : Math.sin(angle * Math.PI / 180);
  return [cos, sin, -sin, cos, 0, 0];
}

function regionSignature(region: GdsTargetRegion) {
  if (region.type === "rectangle") {
    return `rectangle:${region.bounds.flat().map(quantized).join(":")}`;
  }
  const points = region.points.map(
    (point) => `${quantized(point[0])}:${quantized(point[1])}`,
  );
  const variants: string[] = [];
  for (const ordered of [points, [...points].reverse()]) {
    for (let index = 0; index < ordered.length; index += 1) {
      variants.push([...ordered.slice(index), ...ordered.slice(0, index)].join(";"));
    }
  }
  variants.sort();
  return `polygon:${variants[0] ?? ""}`;
}

function quantized(value: number) {
  return Math.sign(value) * Math.round(Math.abs(value) / COORDINATE_DUPLICATE_TOLERANCE);
}
