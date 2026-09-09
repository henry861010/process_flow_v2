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
  boundingBoxFallbacks: number;
  nonOrthogonalRegions: number;
};

export type GdsRegionRepair = {
  region: GdsTargetRegion;
  repaired: boolean;
  usedBoundingBoxFallback: boolean;
};

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
  const regionSignatures = new Set<string>();
  let duplicatesRemoved = 0;
  let repairedElements = 0;
  let boundingBoxFallbacks = 0;
  let nonOrthogonalRegions = 0;

  return {
    add(region: GdsTargetRegion) {
      let outputRegion = region;
      if (defeature) {
        const repair = repairGdsRegion(region);
        outputRegion = repair.region;
        if (repair.repaired) {
          repairedElements += 1;
        }
        if (repair.usedBoundingBoxFallback) {
          boundingBoxFallbacks += 1;
        }
      }

      const signature = regionSignature(outputRegion);
      if (regionSignatures.has(signature)) {
        duplicatesRemoved += 1;
        return;
      }

      regionSignatures.add(signature);
      regions.push(outputRegion);
      if (regionHasNonOrthogonalEdges(outputRegion)) {
        nonOrthogonalRegions += 1;
      }
    },
    result(): GdsRegionCollection {
      return {
        regions,
        duplicatesRemoved,
        repairedElements,
        boundingBoxFallbacks,
        nonOrthogonalRegions,
      };
    },
  };
}

export function repairGdsRegion(region: GdsTargetRegion): GdsRegionRepair {
  if (region.type === "rectangle" || !regionHasNonOrthogonalEdges(region)) {
    return {
      region,
      repaired: false,
      usedBoundingBoxFallback: false,
    };
  }

  const points = removeConsecutiveDuplicatePoints(region.points);
  const repairedPoints = repairPolygonWithAxisAlignedEdges(points);
  if (repairedPoints) {
    const simplifiedPoints = simplifyOrthogonalPolygon(repairedPoints);
    if (isValidOrthogonalPolygon(simplifiedPoints)) {
      return {
        region: canonicalizeOrthogonalPolygon(simplifiedPoints),
        repaired: true,
        usedBoundingBoxFallback: false,
      };
    }
  }

  return {
    region: boundingBoxRegion(region.points),
    repaired: true,
    usedBoundingBoxFallback: true,
  };
}

export function regionHasNonOrthogonalEdges(region: GdsTargetRegion) {
  if (region.type === "rectangle") return false;
  return region.points.some(
    (point, index) => edgeAxis(point, region.points[(index + 1) % region.points.length]) === null,
  );
}

function repairPolygonWithAxisAlignedEdges(
  points: CoordinatePair[],
): CoordinatePair[] | null {
  const edgeAxes = points.map((point, index) =>
    edgeAxis(point, points[(index + 1) % points.length]),
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
      COORDINATE_DUPLICATE_TOLERANCE
    ) {
      return null;
    }
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
    ends[position] = intersection;
    starts[nextPosition] = intersection;
  }

  return starts.flatMap((start, position) => [start, ends[position]]);
}

function edgeAxis(start: CoordinatePair, end: CoordinatePair): EdgeAxis | null {
  if (Math.abs(end[1] - start[1]) <= COORDINATE_DUPLICATE_TOLERANCE) {
    return "horizontal";
  }
  if (Math.abs(end[0] - start[0]) <= COORDINATE_DUPLICATE_TOLERANCE) {
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

function removeConsecutiveDuplicatePoints(points: CoordinatePair[]) {
  const result: CoordinatePair[] = [];
  points.forEach((point) => {
    if (!result.length || !pointsEqual(result[result.length - 1], point)) {
      result.push([...point]);
    }
  });
  if (result.length > 1 && pointsEqual(result[0], result[result.length - 1])) {
    result.pop();
  }
  return result;
}

function simplifyOrthogonalPolygon(points: CoordinatePair[]) {
  const result = removeConsecutiveDuplicatePoints(points);
  let changed = true;
  while (changed && result.length >= 3) {
    changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length];
      const point = result[index];
      const next = result[(index + 1) % result.length];
      if (pointOnAxisAlignedSegment(point, previous, next)) {
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
) {
  const axis = edgeAxis(start, end);
  if (!axis) return false;
  if (axis === "horizontal") {
    return (
      Math.abs(point[1] - start[1]) <= COORDINATE_DUPLICATE_TOLERANCE &&
      point[0] >= Math.min(start[0], end[0]) - COORDINATE_DUPLICATE_TOLERANCE &&
      point[0] <= Math.max(start[0], end[0]) + COORDINATE_DUPLICATE_TOLERANCE
    );
  }
  return (
    Math.abs(point[0] - start[0]) <= COORDINATE_DUPLICATE_TOLERANCE &&
    point[1] >= Math.min(start[1], end[1]) - COORDINATE_DUPLICATE_TOLERANCE &&
    point[1] <= Math.max(start[1], end[1]) + COORDINATE_DUPLICATE_TOLERANCE
  );
}

function isValidOrthogonalPolygon(points: CoordinatePair[]) {
  if (
    points.length < 4 ||
    points.some((point) => !point.every(Number.isFinite)) ||
    points.some((point, index) =>
      pointsEqual(point, points[(index + 1) % points.length]),
    ) ||
    new Set(points.map((point) => `${quantized(point[0])}:${quantized(point[1])}`)).size !==
      points.length ||
    points.some(
      (point, index) => edgeAxis(point, points[(index + 1) % points.length]) === null,
    ) ||
    Math.abs(polygonArea(points)) <= 1e-9
  ) {
    return false;
  }
  return !polygonSelfIntersects(points);
}

function polygonArea(points: CoordinatePair[]) {
  return points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2;
}

function polygonSelfIntersects(points: CoordinatePair[]) {
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
      if (segmentsIntersect(points[left], points[leftEnd], points[right], points[rightEnd])) {
        return true;
      }
    }
  }
  return false;
}

function segmentsIntersect(
  a: CoordinatePair,
  b: CoordinatePair,
  c: CoordinatePair,
  d: CoordinatePair,
) {
  const orientations = [
    orientation(a, b, c),
    orientation(a, b, d),
    orientation(c, d, a),
    orientation(c, d, b),
  ];
  if (
    orientations[0] * orientations[1] < -1e-9 &&
    orientations[2] * orientations[3] < -1e-9
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

function orientation(a: CoordinatePair, b: CoordinatePair, c: CoordinatePair) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(
  point: CoordinatePair,
  start: CoordinatePair,
  end: CoordinatePair,
) {
  return (
    Math.abs(orientation(start, end, point)) <= 1e-9 &&
    point[0] >= Math.min(start[0], end[0]) - COORDINATE_DUPLICATE_TOLERANCE &&
    point[0] <= Math.max(start[0], end[0]) + COORDINATE_DUPLICATE_TOLERANCE &&
    point[1] >= Math.min(start[1], end[1]) - COORDINATE_DUPLICATE_TOLERANCE &&
    point[1] <= Math.max(start[1], end[1]) + COORDINATE_DUPLICATE_TOLERANCE
  );
}

function canonicalizeOrthogonalPolygon(points: CoordinatePair[]): GdsTargetRegion {
  const bounds = transformedBounds(points, IDENTITY);
  if (bounds && points.length === 4 && pointsAreRectangleCorners(points, bounds)) {
    return { type: "rectangle", bounds };
  }
  return { type: "polygon", points };
}

function pointsAreRectangleCorners(
  points: CoordinatePair[],
  bounds: CoordinateBounds,
) {
  const corners: CoordinatePair[] = [
    [bounds[0][0], bounds[0][1]],
    [bounds[1][0], bounds[0][1]],
    [bounds[1][0], bounds[1][1]],
    [bounds[0][0], bounds[1][1]],
  ];
  return corners.every((corner) => points.some((point) => pointsEqual(point, corner)));
}

function boundingBoxRegion(points: CoordinatePair[]): GdsTargetRegion {
  const bounds = transformedBounds(points, IDENTITY);
  if (
    !bounds ||
    !bounds.flat().every(Number.isFinite) ||
    bounds[1][0] - bounds[0][0] <= COORDINATE_DUPLICATE_TOLERANCE ||
    bounds[1][1] - bounds[0][1] <= COORDINATE_DUPLICATE_TOLERANCE
  ) {
    throw new Error("Non-orthogonal GDS boundary has no valid bounding-box fallback.");
  }
  return { type: "rectangle", bounds };
}

function pointsEqual(left: CoordinatePair, right: CoordinatePair) {
  return (
    Math.abs(left[0] - right[0]) <= COORDINATE_DUPLICATE_TOLERANCE &&
    Math.abs(left[1] - right[1]) <= COORDINATE_DUPLICATE_TOLERANCE
  );
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
  const angle = ((element.angle ?? 0) * Math.PI) / 180;
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
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
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
  return Math.round(value / COORDINATE_DUPLICATE_TOLERANCE);
}
