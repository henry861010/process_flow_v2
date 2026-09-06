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
  defeaturedElements: number;
  nonOrthogonalRegions: number;
};

export type Matrix = [number, number, number, number, number, number];

export type GdsReferenceTransform = {
  strans?: number;
  mag?: number;
  angle?: number;
};

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function createGdsRegionAccumulator(
  minimumFeatureSize?: number,
) {
  const regions: GdsTargetRegion[] = [];
  const regionSignatures = new Set<string>();
  let duplicatesRemoved = 0;
  let defeaturedElements = 0;
  let nonOrthogonalRegions = 0;

  return {
    add(region: GdsTargetRegion) {
      if (
        minimumFeatureSize !== undefined &&
        shouldDefeatureRegion(region, minimumFeatureSize)
      ) {
        defeaturedElements += 1;
        return;
      }

      const signature = regionSignature(region);
      if (regionSignatures.has(signature)) {
        duplicatesRemoved += 1;
        return;
      }

      regionSignatures.add(signature);
      regions.push(region);
      if (regionHasNonOrthogonalEdges(region)) {
        nonOrthogonalRegions += 1;
      }
    },
    result(): GdsRegionCollection {
      return {
        regions,
        duplicatesRemoved,
        defeaturedElements,
        nonOrthogonalRegions,
      };
    },
  };
}

export function shouldDefeatureRegion(
  region: GdsTargetRegion,
  minimumFeatureSize: number,
) {
  if (
    !Number.isFinite(minimumFeatureSize) ||
    minimumFeatureSize <= 0 ||
    region.type !== "polygon" ||
    !regionHasNonOrthogonalEdges(region)
  ) {
    return false;
  }

  const bounds = transformedBounds(region.points, IDENTITY);
  if (!bounds) return false;
  const width = bounds[1][0] - bounds[0][0];
  const height = bounds[1][1] - bounds[0][1];
  return width < minimumFeatureSize && height < minimumFeatureSize;
}

export function regionHasNonOrthogonalEdges(region: GdsTargetRegion) {
  if (region.type === "rectangle") return false;
  return region.points.some((point, index) => {
    const next = region.points[(index + 1) % region.points.length];
    return (
      Math.abs(next[0] - point[0]) > COORDINATE_DUPLICATE_TOLERANCE &&
      Math.abs(next[1] - point[1]) > COORDINATE_DUPLICATE_TOLERANCE
    );
  });
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
