import { math } from "./math.js";

export class PolygonRegion {
  constructor(outer, holes, z) {
    this.outer = outer;
    this.holes = holes;
    this.z = z;
  }
}

/**
 * Validate polygon loops for PolygonGeometry.
 *
 * API contract:
 * - Each loop must have at least three unique [x, y, z] points.
 * - All loops must lie on the same XY plane.
 * - A single loop may not self-intersect, repeat points, have zero-length
 *   edges, or have zero signed area.
 * - Multiple outer loops are allowed, so PolygonGeometry can represent a
 *   multipolygon.
 * - Different loops may touch only at a single shared endpoint. This supports
 *   point-touch multipolygons, such as two rectangles meeting at one corner.
 * - Different loops may not cross, overlap, share an edge, touch at an edge
 *   interior point, or form nested loops whose boundaries touch.
 * - Nested non-touching loops are interpreted by classifyPolygonLoops as holes
 *   using odd-even containment.
 */
export function validatePolygonLoops(polys) {
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

/**
 * Classify valid polygon loops into renderable regions.
 *
 * Outer loops are loops at even strict-containment depth. Holes are loops one
 * strict-containment level deeper than their owning outer loop. Points that lie
 * exactly on another loop boundary are not counted as inside, so point-touch
 * outer loops remain separate multipolygon regions instead of being mistaken
 * for holes.
 */
export function classifyPolygonLoops(polys) {
  const loops = validatePolygonLoops(polys);
  const depths = loops.map((loop) => {
    const probe = loop[0];
    return loops.filter(
      (other) => other !== loop && pointStrictlyInLoop(probe, other),
    ).length;
  });

  const regions = [];
  loops.forEach((loop, index) => {
    if (depths[index] % 2 !== 0) return;

    const holes = [];
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

function normalizeLoop(poly, index) {
  if (poly.length < 3) {
    throw new Error(`PolygonGeometry loop ${index} requires at least 3 points`);
  }

  let loop = poly.map((point, pointIndex) => {
    if (point.length !== 3) {
      throw new Error(
        `PolygonGeometry points must be [x, y, z] (loop ${index}, point ${pointIndex})`,
      );
    }
    return [...point];
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

function validateSingleLoop(loop, loopIndex) {
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

function validateLoopBoundariesDoNotCross(loops) {
  loops.forEach((left, leftIndex) => {
    loops.forEach((right, rightIndex) => {
      if (rightIndex <= leftIndex) return;
      let hasPointTouch = false;
      for (const [a1, a2] of edges(left)) {
        for (const [b1, b2] of edges(right)) {
          if (segmentsIntersect(a1, a2, b1, b2)) {
            if (segmentsTouchOnlyAtEndpoints(a1, a2, b1, b2)) {
              hasPointTouch = true;
              continue;
            }
            throw new Error(
              `PolygonGeometry loops intersect or touch (loops ${leftIndex} and ${rightIndex})`,
            );
          }
        }
      }
      if (hasPointTouch && loopsAreNested(left, right)) {
        throw new Error(
          `PolygonGeometry loops intersect or touch (loops ${leftIndex} and ${rightIndex})`,
        );
      }
    });
  });
}

function* edges(loop) {
  for (let index = 0; index < loop.length; index += 1) {
    yield [loop[index], loop[(index + 1) % loop.length]];
  }
}

function edgesAreAdjacent(left, right, edgeCount) {
  return Math.abs(left - right) === 1 || new Set([left, right]).size === 2 &&
    left + right === edgeCount - 1;
}

function segmentsIntersect(a1, a2, b1, b2) {
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

function segmentsTouchOnlyAtEndpoints(a1, a2, b1, b2) {
  const sharedEndpoints = [
    samePoint2(a1, b1) ? a1 : null,
    samePoint2(a1, b2) ? a1 : null,
    samePoint2(a2, b1) ? a2 : null,
    samePoint2(a2, b2) ? a2 : null,
  ].filter(Boolean);
  const uniqueSharedEndpoints = uniquePoints(sharedEndpoints);
  if (uniqueSharedEndpoints.length !== 1) return false;

  const [touchPoint] = uniqueSharedEndpoints;
  return ![
    [a1, b1, b2],
    [a2, b1, b2],
    [b1, a1, a2],
    [b2, a1, a2],
  ].some(([point, edgeStart, edgeEnd]) => {
    return !samePoint2(point, touchPoint) &&
      pointOnSegment(edgeStart, point, edgeEnd);
  });
}

function loopsAreNested(left, right) {
  return (
    left.some((point) => pointStrictlyInLoop(point, right)) ||
    right.some((point) => pointStrictlyInLoop(point, left))
  );
}

function orientation(a, b, c) {
  const value = (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
  if (math.fEq(value, 0)) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(a, b, c) {
  return (
    math.fLe(Math.min(a[0], c[0]), b[0]) &&
    math.fLe(b[0], Math.max(a[0], c[0])) &&
    math.fLe(Math.min(a[1], c[1]), b[1]) &&
    math.fLe(b[1], Math.max(a[1], c[1]))
  );
}

function pointInLoop(point, loop) {
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

function pointStrictlyInLoop(point, loop) {
  if (pointOnLoopBoundary(point, loop)) return false;
  return pointInLoop(point, loop);
}

function pointOnLoopBoundary(point, loop) {
  let previous = loop[loop.length - 1];
  for (const current of loop) {
    if (pointOnSegment(previous, point, current)) return true;
    previous = current;
  }
  return false;
}

function pointOnSegment(a, b, c) {
  return orientation(a, c, b) === 0 && onSegment(a, b, c);
}

function signedArea(loop) {
  let area = 0;
  for (const [point, nextPoint] of edges(loop)) {
    area += point[0] * nextPoint[1] - nextPoint[0] * point[1];
  }
  return area / 2;
}

function samePoint(left, right) {
  return (
    math.fEq(left[0], right[0]) &&
    math.fEq(left[1], right[1]) &&
    math.fEq(left[2], right[2])
  );
}

function samePoint2(left, right) {
  return math.fEq(left[0], right[0]) && math.fEq(left[1], right[1]);
}

function uniquePoints(points) {
  const unique = [];
  for (const point of points) {
    if (!unique.some((current) => samePoint2(current, point))) {
      unique.push(point);
    }
  }
  return unique;
}

export const validate_polygon_loops = validatePolygonLoops;
export const classify_polygon_loops = classifyPolygonLoops;
