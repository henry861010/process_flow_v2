import type { CoordinatePair } from "./coordinate-list-value";

// Synthetic geometry inspired by the hand-drawn layout; no customer GDS data.
export const steppedNotches: CoordinatePair[] = [
  [0, 0], [20, 0], [20, 10], [18, 10], [17, 8], [16, 7],
  [15, 8], [14, 10], [12, 10], [12, 20], [9, 20],
  [8, 18], [7, 17], [6, 17], [5, 18], [4, 20], [0, 20],
];

export const rectangularSteppedNotches: CoordinatePair[] = [
  [0, 0], [20, 0], [20, 10], [18, 10], [18, 7], [14, 7],
  [14, 10], [12, 10], [12, 20], [9, 20], [9, 17], [4, 17], [4, 20], [0, 20],
];

export const verticalNotch: CoordinatePair[] = [
  [24, 0], [28, 0], [28, 20], [24, 20], [24, 15],
  [26, 14], [27, 13], [26, 12], [24, 11],
];

export const rectangularVerticalNotch: CoordinatePair[] = [
  [24, 0], [28, 0], [28, 20], [24, 20], [24, 15],
  [27, 15], [27, 11], [24, 11],
];

// Occupies the empty upper-right part of the stepped main body. A whole-body
// bounding box would intersect it even though the original polygons do not.
export const adjacentRectangle: CoordinatePair[] = [[14, 12], [20, 12], [20, 19], [14, 19]];

export function sameOutline(actual: CoordinatePair[], expected: CoordinatePair[], tolerance = 1e-8) {
  if (actual.length !== expected.length) return false;
  return [expected, [...expected].reverse()].some((order) => order.some((_, offset) =>
    actual.every((point, index) => point.every((value, axis) =>
      Math.abs(value - order[(index + offset) % order.length][axis]) <= tolerance,
    )),
  ));
}

export function insideOutline(points: CoordinatePair[], [x, y]: CoordinatePair) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [a, b] = points[index];
    const [c, d] = points[previous];
    if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) inside = !inside;
  }
  return inside;
}
