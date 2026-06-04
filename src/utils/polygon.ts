import { math } from "./math.js";

type Point3 = [number, number, number];
type Loop = Point3[];

export class PolygonRegion {
  outer: Loop;
  holes: Loop[];
  z: number;

  constructor(outer: Loop, holes: Loop[], z: number) {
    this.outer = outer;
    this.holes = holes;
    this.z = z;
  }
}

export function validatePolygonLoops(polys: Loop[]): Loop[] {
  const loops = polys.map((poly, index) => normalizeLoop(poly, index));
  if (loops.length === 0) {
    throw new Error("PolygonGeometry requires at least one polygon loop");
  }

  const zBase = loops[0][0][2];
  loops.forEach((loop, loopIndex) => {
    loop.forEach((point) => {
      if (math.fNe(point[2], zBase)) {
        throw new Error(
          `PolygonGeometry loops must be on the same xy plane (loop ${loopIndex})`,
        );
      }
    });
    validateSingleLoop(loop, loopIndex);
  });

  validateLoopBoundariesDoNotCross(loops);
  return loops;
}

export function classifyPolygonLoops(polys: Loop[]): PolygonRegion[] {
  const loops = validatePolygonLoops(polys);
  const depths = loops.map((loop) => {
    const probe = loop[0];
    return loops.filter(
      (other) => other !== loop && pointInLoop(probe, other),
    ).length;
  });

  const regions: PolygonRegion[] = [];
  loops.forEach((loop, index) => {
    if (depths[index] % 2 !== 0) return;

    const holes: Loop[] = [];
    loops.forEach((hole, holeIndex) => {
      if (depths[holeIndex] !== depths[index] + 1) return;
      if (pointInLoop(hole[0], loop)) {
        holes.push(hole);
      }
    });

    regions.push(new PolygonRegion(loop, holes, loop[0][2]));
  });

  if (regions.length === 0) {
    throw new Error("PolygonGeometry does not contain any hull loop");
  }
  return regions;
}

function normalizeLoop(poly: Loop, index: number): Loop {
  if (poly.length < 3) {
    throw new Error(`PolygonGeometry loop ${index} requires at least 3 points`);
  }

  let loop: Loop = poly.map((point, pointIndex) => {
    if (point.length !== 3) {
      throw new Error(
        `PolygonGeometry points must be [x, y, z] (loop ${index}, point ${pointIndex})`,
      );
    }
    return [...point] as Point3;
  });

  if (samePoint(loop[0], loop[loop.length - 1])) {
    loop = loop.slice(0, -1);
  }

  if (loop.length < 3) {
    throw new Error(
      `PolygonGeometry loop ${index} requires at least 3 unique points`,
    );
  }
  return loop;
}

function validateSingleLoop(loop: Loop, loopIndex: number): void {
  loop.forEach((left, leftIndex) => {
    loop.forEach((right, rightIndex) => {
      if (rightIndex <= leftIndex) return;
      if (samePoint(left, right)) {
        throw new Error(
          `PolygonGeometry loop contains duplicate points (loop ${loopIndex})`,
        );
      }
    });
  });

  const edgeCount = loop.length;
  for (let i = 0; i < edgeCount; i += 1) {
    const a1 = loop[i];
    const a2 = loop[(i + 1) % edgeCount];
    if (samePoint(a1, a2)) {
      throw new Error(`PolygonGeometry loop ${loopIndex} has zero-length edge`);
    }

    for (let j = i + 1; j < edgeCount; j += 1) {
      if (edgesAreAdjacent(i, j, edgeCount)) continue;
      const b1 = loop[j];
      const b2 = loop[(j + 1) % edgeCount];
      if (segmentsIntersect(a1, a2, b1, b2)) {
        throw new Error(
          `PolygonGeometry loop self-intersects (loop ${loopIndex})`,
        );
      }
    }
  }

  if (math.fEq(signedArea(loop), 0)) {
    throw new Error(`PolygonGeometry loop ${loopIndex} has zero area`);
  }
}

function validateLoopBoundariesDoNotCross(loops: Loop[]): void {
  loops.forEach((left, leftIndex) => {
    loops.forEach((right, rightIndex) => {
      if (rightIndex <= leftIndex) return;
      for (const [a1, a2] of edges(left)) {
        for (const [b1, b2] of edges(right)) {
          if (segmentsIntersect(a1, a2, b1, b2)) {
            throw new Error(
              `PolygonGeometry loops intersect or touch (loops ${leftIndex} and ${rightIndex})`,
            );
          }
        }
      }
    });
  });
}

function* edges(loop: Loop): Generator<[Point3, Point3]> {
  for (let index = 0; index < loop.length; index += 1) {
    yield [loop[index], loop[(index + 1) % loop.length]];
  }
}

function edgesAreAdjacent(left: number, right: number, edgeCount: number): boolean {
  return (
    Math.abs(left - right) === 1 ||
    (new Set([left, right]).size === 2 && left + right === edgeCount - 1)
  );
}

function segmentsIntersect(a1: Point3, a2: Point3, b1: Point3, b2: Point3): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

function orientation(a: Point3, b: Point3, c: Point3): -1 | 0 | 1 {
  const value = (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
  if (math.fEq(value, 0)) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(a: Point3, b: Point3, c: Point3): boolean {
  return (
    math.fLe(Math.min(a[0], c[0]), b[0]) &&
    math.fLe(b[0], Math.max(a[0], c[0])) &&
    math.fLe(Math.min(a[1], c[1]), b[1]) &&
    math.fLe(b[1], Math.max(a[1], c[1]))
  );
}

function pointInLoop(point: Point3, loop: Loop): boolean {
  const [x, y] = point;
  let inside = false;
  let previous = loop[loop.length - 1];

  for (const current of loop) {
    if (pointOnSegment(previous, point, current)) {
      return true;
    }

    const yiAbove = current[1] > y;
    const yjAbove = previous[1] > y;
    if (yiAbove !== yjAbove) {
      const xAtY =
        ((previous[0] - current[0]) * (y - current[1])) /
          (previous[1] - current[1]) +
        current[0];
      if (x < xAtY) {
        inside = !inside;
      }
    }
    previous = current;
  }

  return inside;
}

function pointOnSegment(a: Point3, b: Point3, c: Point3): boolean {
  return orientation(a, c, b) === 0 && onSegment(a, b, c);
}

function signedArea(loop: Loop): number {
  let area = 0;
  for (const [point, nextPoint] of edges(loop)) {
    area += point[0] * nextPoint[1] - nextPoint[0] * point[1];
  }
  return area / 2;
}

function samePoint(left: Point3, right: Point3): boolean {
  return (
    math.fEq(left[0], right[0]) &&
    math.fEq(left[1], right[1]) &&
    math.fEq(left[2], right[2])
  );
}

export const validate_polygon_loops = validatePolygonLoops;
export const classify_polygon_loops = classifyPolygonLoops;
