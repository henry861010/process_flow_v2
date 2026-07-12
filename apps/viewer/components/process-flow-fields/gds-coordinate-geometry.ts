import type {
  CoordinateBounds,
  CoordinatePair,
} from "./coordinate-list-value";

export type Matrix = [number, number, number, number, number, number];

export type GdsReferenceTransform = {
  strans?: number;
  mag?: number;
  angle?: number;
};

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function transformedBounds(
  points: CoordinatePair[],
  transform: Matrix,
): CoordinateBounds | null {
  if (points.length === 0) {
    return null;
  }
  const transformedPoints = points.map((point) => transformPoint(transform, point));
  const xs = transformedPoints.map((point) => point[0]);
  const ys = transformedPoints.map((point) => point[1]);
  return [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
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
