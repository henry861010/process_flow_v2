import type {
  PreviewFeature,
  PreviewGeometry,
} from "@/lib/geometry-preview/features/feature-model";
import {
  FEATURE_PATTERN_POLICY_VERSION,
  createFeaturePatternDescriptor,
  type FeaturePatternDescriptor,
} from "@/lib/geometry-preview/features/feature-pattern";

export type FeatureSectionAxis = "x" | "y";
export type FeatureSectionPoint = [number, number];
export type FeatureSectionContour = {
  outer: FeatureSectionPoint[];
  holes: FeatureSectionPoint[][];
};

export type EstimatedFeatureSectionRegion = {
  featureId: string;
  featureKind: PreviewFeature["type"];
  material: string;
  densityPercent: number;
  direction: PreviewFeature["direction"];
  koz: number;
  containerId: string;
  containerKey: string;
  contours: FeatureSectionContour[];
  pattern: FeaturePatternDescriptor;
};

export type EstimatedFeatureSectionLayer = {
  authority: "estimated-density";
  patternPolicyVersion: typeof FEATURE_PATTERN_POLICY_VERSION;
  axis: FeatureSectionAxis;
  position: number;
  regions: EstimatedFeatureSectionRegion[];
};

export type FeatureSectionVisibility = {
  bumps: boolean;
  vias: boolean;
  circuits: boolean;
};

export function buildEstimatedFeatureSection(
  features: PreviewFeature[],
  {
    axis,
    position,
    densityScale,
    visibility,
  }: {
    axis: FeatureSectionAxis;
    position: number;
    densityScale: number;
    visibility: FeatureSectionVisibility;
  },
): EstimatedFeatureSectionLayer {
  const regions = features
    .filter((feature) => isVisible(feature, visibility))
    .map((feature) => {
      const contours = intersectFeatureEnvelope(feature.geometry, axis, position);
      if (contours.length === 0) return null;
      return {
        featureId: feature.id,
        featureKind: feature.type,
        material: feature.material,
        densityPercent: feature.density,
        direction: feature.direction,
        koz: feature.koz,
        containerId: feature.containerId,
        containerKey: feature.containerKey,
        contours,
        pattern: createFeaturePatternDescriptor(feature, axis, densityScale),
      } satisfies EstimatedFeatureSectionRegion;
    })
    .filter((region): region is EstimatedFeatureSectionRegion => region !== null)
    .sort((left, right) =>
      [left.featureKind, left.material, left.featureId]
        .join(":")
        .localeCompare([right.featureKind, right.material, right.featureId].join(":")),
    );

  return {
    authority: "estimated-density",
    patternPolicyVersion: FEATURE_PATTERN_POLICY_VERSION,
    axis,
    position,
    regions,
  };
}

export function intersectFeatureEnvelope(
  geometry: PreviewGeometry,
  axis: FeatureSectionAxis,
  position: number,
): FeatureSectionContour[] {
  const scale = geometryScale(geometry);
  const epsilon = Math.max(scale * 1e-9, Math.abs(position) * 1e-12, 1e-9);

  if (geometry.type === "box") {
    const cutIndex = axis === "x" ? 0 : 1;
    const uIndex = axis === "x" ? 1 : 0;
    if (!insideClosed(position, geometry.min[cutIndex], geometry.max[cutIndex], epsilon)) {
      return [];
    }
    return [rectangleContour(
      geometry.min[uIndex],
      geometry.max[uIndex],
      geometry.min[2],
      geometry.max[2],
    )];
  }

  if (geometry.type === "cylinder") {
    const cutCenter = axis === "x" ? geometry.center[0] : geometry.center[1];
    const uCenter = axis === "x" ? geometry.center[1] : geometry.center[0];
    const distance = Math.abs(position - cutCenter);
    if (distance >= geometry.radius - epsilon) return [];
    const halfChord = Math.sqrt(Math.max(geometry.radius ** 2 - distance ** 2, 0));
    if (halfChord <= epsilon) return [];
    return [rectangleContour(
      uCenter - halfChord,
      uCenter + halfChord,
      geometry.center[2],
      geometry.center[2] + geometry.height,
    )];
  }

  if (geometry.type === "cone") {
    return coneContours(geometry, axis, position, epsilon);
  }

  const intervals = polygonLineIntervals(geometry.loops, axis, position, epsilon);
  return intervals
    .filter(([min, max]) => max - min > epsilon)
    .map(([min, max]) =>
      rectangleContour(min, max, geometry.zMin, geometry.zMin + geometry.height),
    );
}

function coneContours(
  geometry: Extract<PreviewGeometry, { type: "cone" }>,
  axis: FeatureSectionAxis,
  position: number,
  epsilon: number,
) {
  const cutCenter = axis === "x" ? geometry.center[0] : geometry.center[1];
  const uCenter = axis === "x" ? geometry.center[1] : geometry.center[0];
  const distance = Math.abs(position - cutCenter);
  const r0 = geometry.bottomRadius;
  const r1 = geometry.topRadius;
  if (distance >= Math.max(r0, r1) - epsilon) return [];

  let tMin = 0;
  let tMax = 1;
  const delta = r1 - r0;
  if (Math.abs(delta) <= epsilon) {
    if (r0 <= distance + epsilon) return [];
  } else {
    const crossing = (distance - r0) / delta;
    if (delta > 0) tMin = Math.max(0, crossing);
    else tMax = Math.min(1, crossing);
  }
  if (tMax - tMin <= epsilon) return [];

  const samples = 32;
  const left: FeatureSectionPoint[] = [];
  const right: FeatureSectionPoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = tMin + (tMax - tMin) * (index / samples);
    const radius = r0 + delta * t;
    const halfChord = Math.sqrt(Math.max(radius ** 2 - distance ** 2, 0));
    const z = geometry.center[2] + geometry.height * t;
    left.push([uCenter - halfChord, z]);
    right.push([uCenter + halfChord, z]);
  }
  const loop = canonicalLoop([...left, ...right.reverse()], false, epsilon);
  return loop.length >= 4 ? [{ outer: loop, holes: [] }] : [];
}

function polygonLineIntervals(
  loops: [number, number, number][][],
  axis: FeatureSectionAxis,
  position: number,
  epsilon: number,
) {
  const cutIndex = axis === "x" ? 0 : 1;
  const uIndex = axis === "x" ? 1 : 0;
  const crossings: number[] = [];
  const solidBoundaryIntervals: [number, number][] = [];
  const holeBoundaryIntervals: [number, number][] = [];

  loops.forEach((loop, loopIndex) => {
    const nestingDepth = loops.reduce((depth, candidate, candidateIndex) => {
      if (candidateIndex === loopIndex) return depth;
      return pointInsideLoop2D(loop[0][0], loop[0][1], candidate)
        ? depth + 1
        : depth;
    }, 0);
    for (let index = 0; index < loop.length; index += 1) {
      const left = loop[index];
      const right = loop[(index + 1) % loop.length];
      const a = left[cutIndex];
      const b = right[cutIndex];
      if (Math.abs(a - position) <= epsilon && Math.abs(b - position) <= epsilon) {
        const target =
          nestingDepth % 2 === 0
            ? solidBoundaryIntervals
            : holeBoundaryIntervals;
        target.push(sortPair(left[uIndex], right[uIndex]));
        continue;
      }
      const crosses =
        (a <= position && position < b) || (b <= position && position < a);
      if (!crosses) continue;
      const t = (position - a) / (b - a);
      crossings.push(left[uIndex] + (right[uIndex] - left[uIndex]) * t);
    }
  });

  crossings.sort((a, b) => a - b);
  const intervals: [number, number][] = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    intervals.push(sortPair(crossings[index], crossings[index + 1]));
  }
  const solid = mergeIntervals([...intervals, ...solidBoundaryIntervals], epsilon);
  return subtractIntervals(solid, holeBoundaryIntervals, epsilon);
}

function mergeIntervals(intervals: [number, number][], epsilon: number) {
  const sorted = intervals
    .filter(([min, max]) => max - min > epsilon)
    .sort(([left], [right]) => left - right);
  const result: [number, number][] = [];
  sorted.forEach(([min, max]) => {
    const previous = result[result.length - 1];
    if (!previous || min > previous[1] + epsilon) {
      result.push([min, max]);
    } else {
      previous[1] = Math.max(previous[1], max);
    }
  });
  return result;
}

function subtractIntervals(
  source: [number, number][],
  cuts: [number, number][],
  epsilon: number,
) {
  let result = source;
  mergeIntervals(cuts, epsilon).forEach(([cutMin, cutMax]) => {
    result = result.flatMap(([min, max]) => {
      if (cutMax <= min + epsilon || cutMin >= max - epsilon) return [[min, max]];
      const pieces: [number, number][] = [];
      if (cutMin - min > epsilon) pieces.push([min, Math.min(cutMin, max)]);
      if (max - cutMax > epsilon) pieces.push([Math.max(cutMax, min), max]);
      return pieces;
    });
  });
  return result;
}

function rectangleContour(uMin: number, uMax: number, zMin: number, zMax: number) {
  return {
    outer: [
      [uMin, zMin],
      [uMax, zMin],
      [uMax, zMax],
      [uMin, zMax],
      [uMin, zMin],
    ] as FeatureSectionPoint[],
    holes: [],
  };
}

function canonicalLoop(
  source: FeatureSectionPoint[],
  clockwise: boolean,
  epsilon: number,
) {
  const points: FeatureSectionPoint[] = [];
  source.forEach((point) => {
    const previous = points[points.length - 1];
    if (!previous || distanceSquared(previous, point) > epsilon ** 2) points.push(point);
  });
  if (points.length > 1 && distanceSquared(points[0], points[points.length - 1]) <= epsilon ** 2) {
    points.pop();
  }
  if (points.length < 3) return [];
  const area = signedArea(points);
  if ((clockwise && area > 0) || (!clockwise && area < 0)) points.reverse();
  let start = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (
      points[index][0] < points[start][0] ||
      (points[index][0] === points[start][0] && points[index][1] < points[start][1])
    ) {
      start = index;
    }
  }
  const canonical = [...points.slice(start), ...points.slice(0, start)];
  canonical.push([...canonical[0]] as FeatureSectionPoint);
  return canonical;
}

function signedArea(points: FeatureSectionPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function geometryScale(geometry: PreviewGeometry) {
  if (geometry.type === "box") {
    return Math.max(
      geometry.max[0] - geometry.min[0],
      geometry.max[1] - geometry.min[1],
      geometry.max[2] - geometry.min[2],
      1,
    );
  }
  if (geometry.type === "cylinder") return Math.max(geometry.radius * 2, geometry.height, 1);
  if (geometry.type === "cone") {
    return Math.max(geometry.bottomRadius * 2, geometry.topRadius * 2, geometry.height, 1);
  }
  return Math.max(geometry.height, 1);
}

function isVisible(feature: PreviewFeature, visibility: FeatureSectionVisibility) {
  if (feature.type === "bump") return visibility.bumps;
  if (feature.type === "via") return visibility.vias;
  return visibility.circuits;
}

function insideClosed(value: number, min: number, max: number, epsilon: number) {
  return value >= min - epsilon && value <= max + epsilon;
}

function sortPair(left: number, right: number): [number, number] {
  return left <= right ? [left, right] : [right, left];
}

function distanceSquared(left: FeatureSectionPoint, right: FeatureSectionPoint) {
  return (left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2;
}

function pointInsideLoop2D(
  x: number,
  y: number,
  loop: [number, number, number][],
) {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
    const [xi, yi] = loop[index];
    const [xj, yj] = loop[previous];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
