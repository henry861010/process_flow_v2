import type { BoundsTuple } from "@/components/viewer/model-loader";

export type FeatureKind = "via" | "circuit" | "bump";
export type FeatureDirection = "+z" | "-z" | null;

export type PreviewGeometry =
  | {
      type: "box";
      min: [number, number, number];
      max: [number, number, number];
    }
  | {
      type: "cylinder";
      center: [number, number, number];
      radius: number;
      height: number;
    }
  | {
      type: "cone";
      center: [number, number, number];
      bottomRadius: number;
      topRadius: number;
      height: number;
    }
  | {
      type: "polygon";
      loops: [number, number, number][][];
      zMin: number;
      height: number;
    };

export type PreviewFeature = {
  id: string;
  type: FeatureKind;
  material: string;
  density: number;
  normalizedDensity: number;
  direction: FeatureDirection;
  koz: number;
  geometry: PreviewGeometry;
  bounds: BoundsTuple;
  containerId: string;
  containerKey: string;
  containerPath: string;
};

export type FeatureSummary = {
  total: number;
  bumps: number;
  vias: number;
  circuits: number;
  densityMin: number | null;
  densityMax: number | null;
};

type FeatureContainerContext = {
  id: string;
  key: string;
  path: string;
};

const FEATURE_LABELS: Record<FeatureKind, string> = {
  via: "Via",
  circuit: "Circuit",
  bump: "Bump",
};

export function extractPreviewFeatures(structure: unknown): PreviewFeature[] {
  const root = asRecord(structure)?.root;
  if (!isRecord(root)) return [];

  const features: PreviewFeature[] = [];
  visitContainer(root, {
    id: stringValue(root.id, "root"),
    key: stringValue(root.key, "root"),
    path: stringValue(root.key, "root"),
  });
  return features;

  function visitContainer(
    container: Record<string, unknown>,
    context: FeatureContainerContext,
  ) {
    appendFeatureArray(container.vias, "via", context);
    appendFeatureArray(container.circuits, "circuit", context);
    appendFeatureArray(container.bumps, "bump", context);

    const children = Array.isArray(container.children) ? container.children : [];
    children.forEach((child, index) => {
      if (!isRecord(child)) return;
      const childKey = stringValue(child.key, `child-${index + 1}`);
      const childId = stringValue(child.id, `${context.id}/${childKey}`);
      visitContainer(child, {
        id: childId,
        key: childKey,
        path: `${context.path}/${childKey}`,
      });
    });
  }

  function appendFeatureArray(
    value: unknown,
    type: FeatureKind,
    context: FeatureContainerContext,
  ) {
    const items = Array.isArray(value) ? value : [];
    items.forEach((item, index) => {
      if (!isRecord(item)) return;
      const geometry = parsePreviewGeometry(item.geometry);
      if (!geometry) return;

      const density = clamp(finiteNumber(item.density, 0), 0, 100);
      const id = stringValue(item.id, `${context.id}:${type}:${index + 1}`);
      features.push({
        id,
        type,
        material: stringValue(item.material, "feature"),
        density,
        normalizedDensity: normalizeDensity(density),
        direction:
          item.direction === "+z" || item.direction === "-z"
            ? item.direction
            : null,
        koz: Math.max(finiteNumber(item.koz, 0), 0),
        geometry,
        bounds: geometryBounds(geometry),
        containerId: context.id,
        containerKey: context.key,
        containerPath: context.path,
      });
    });
  }
}

export function extractPreviewGeometryBounds(
  structure: unknown,
): BoundsTuple | null {
  const root = asRecord(structure)?.root;
  if (!isRecord(root)) return null;

  const geometryBoundsList: BoundsTuple[] = [];
  visitContainer(root);
  return mergeBounds(geometryBoundsList);

  function visitContainer(container: Record<string, unknown>) {
    const bodies = Array.isArray(container.bodies) ? container.bodies : [];
    bodies.forEach((body) => {
      if (!isRecord(body)) return;
      const geometry = parsePreviewGeometry(body.geometry);
      if (geometry) geometryBoundsList.push(geometryBounds(geometry));
    });

    const children = Array.isArray(container.children) ? container.children : [];
    children.forEach((child) => {
      if (isRecord(child)) visitContainer(child);
    });
  }
}

export function mergeBounds(bounds: BoundsTuple[]): BoundsTuple | null {
  if (bounds.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  bounds.forEach((item) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], item.min[axis]);
      max[axis] = Math.max(max[axis], item.max[axis]);
    }
  });
  return boundsFromMinMax(min, max);
}

export function mergeFeatureBounds(
  baseBounds: BoundsTuple,
  features: PreviewFeature[],
) {
  return mergeBounds([baseBounds, ...features.map((feature) => feature.bounds)]) ?? baseBounds;
}

export function summarizeFeatures(features: PreviewFeature[]): FeatureSummary {
  const summary: FeatureSummary = {
    total: features.length,
    bumps: 0,
    vias: 0,
    circuits: 0,
    densityMin: null,
    densityMax: null,
  };

  features.forEach((feature) => {
    if (feature.type === "bump") summary.bumps += 1;
    if (feature.type === "via") summary.vias += 1;
    if (feature.type === "circuit") summary.circuits += 1;
    summary.densityMin =
      summary.densityMin === null
        ? feature.density
        : Math.min(summary.densityMin, feature.density);
    summary.densityMax =
      summary.densityMax === null
        ? feature.density
        : Math.max(summary.densityMax, feature.density);
  });
  return summary;
}

export function formatFeatureKind(kind: FeatureKind) {
  return FEATURE_LABELS[kind];
}

export function formatDensityPercent(value: number) {
  const percent = normalizeDensity(value) * 100;
  const digits = percent >= 10 || percent === 0 ? 0 : 1;
  return `${percent.toFixed(digits)}%`;
}

export function normalizeDensity(value: number) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value / 100, 0, 1);
}

export function parsePreviewGeometry(value: unknown): PreviewGeometry | null {
  if (!isRecord(value)) return null;

  if (value.type === "BoxGeometry") {
    const bottomLeft = vector3Value(value.bottom_left);
    const topRight = vector3Value(value.top_right);
    const height = finiteNumber(value.thk, 0);
    if (!bottomLeft || !topRight || height <= 0) return null;
    const epsilon = Math.max(1e-9, Math.abs(bottomLeft[2]) * 1e-12);
    if (Math.abs(bottomLeft[2] - topRight[2]) > epsilon) return null;
    return {
      type: "box",
      min: [
        Math.min(bottomLeft[0], topRight[0]),
        Math.min(bottomLeft[1], topRight[1]),
        bottomLeft[2],
      ],
      max: [
        Math.max(bottomLeft[0], topRight[0]),
        Math.max(bottomLeft[1], topRight[1]),
        bottomLeft[2] + height,
      ],
    };
  }

  if (value.type === "CylinderGeometry") {
    const center = vector3Value(value.center);
    const radius = finiteNumber(value.bottom_radius, 0);
    const height = finiteNumber(value.thk, 0);
    if (!center || radius <= 0 || height <= 0) return null;
    return { type: "cylinder", center, radius, height };
  }

  if (value.type === "ConeGeometry") {
    const center = vector3Value(value.center);
    const bottomRadius = finiteNumber(value.bottom_radius, -1);
    const topRadius = finiteNumber(value.top_radius, -1);
    const height = finiteNumber(value.thk, 0);
    if (
      !center ||
      height <= 0 ||
      bottomRadius < 0 ||
      topRadius < 0 ||
      Math.max(bottomRadius, topRadius) <= 0
    ) {
      return null;
    }
    return { type: "cone", center, bottomRadius, topRadius, height };
  }

  if (value.type === "PolygonGeometry") {
    const loops = parsePolygonLoops(value.polys);
    const height = finiteNumber(value.thk, 0);
    if (loops.length === 0 || height <= 0) return null;
    const zValues = loops.flat().map((point) => point[2]);
    const zMin = Math.min(...zValues);
    const epsilon = Math.max(1e-9, Math.abs(zMin) * 1e-12);
    if (zValues.some((z) => Math.abs(z - zMin) > epsilon)) return null;
    return { type: "polygon", loops, zMin, height };
  }

  return null;
}

export function geometryBounds(geometry: PreviewGeometry): BoundsTuple {
  if (geometry.type === "box") {
    return boundsFromMinMax(geometry.min, geometry.max);
  }
  if (geometry.type === "cylinder") {
    const { center, radius, height } = geometry;
    return boundsFromMinMax(
      [center[0] - radius, center[1] - radius, center[2]],
      [center[0] + radius, center[1] + radius, center[2] + height],
    );
  }
  if (geometry.type === "cone") {
    const radius = Math.max(geometry.bottomRadius, geometry.topRadius);
    return boundsFromMinMax(
      [geometry.center[0] - radius, geometry.center[1] - radius, geometry.center[2]],
      [
        geometry.center[0] + radius,
        geometry.center[1] + radius,
        geometry.center[2] + geometry.height,
      ],
    );
  }

  const points = geometry.loops.flat();
  return boundsFromMinMax(
    [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      geometry.zMin,
    ],
    [
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1])),
      geometry.zMin + geometry.height,
    ],
  );
}

export function pointInsideFeatureFootprint(
  feature: PreviewFeature,
  x: number,
  y: number,
) {
  const geometry = feature.geometry;
  if (geometry.type === "cylinder") {
    return pointInsideCircle(x, y, geometry.center[0], geometry.center[1], geometry.radius);
  }
  if (geometry.type === "cone") {
    return pointInsideCircle(
      x,
      y,
      geometry.center[0],
      geometry.center[1],
      Math.max(geometry.bottomRadius, geometry.topRadius),
    );
  }
  if (geometry.type === "polygon") {
    return pointInsidePolygonLoops(x, y, geometry.loops);
  }
  return (
    x >= geometry.min[0] &&
    x <= geometry.max[0] &&
    y >= geometry.min[1] &&
    y <= geometry.max[1]
  );
}

export function boundsFromMinMax(
  min: [number, number, number],
  max: [number, number, number],
): BoundsTuple {
  return {
    min,
    max,
    center: [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ],
    size: [
      Math.max(max[0] - min[0], 0),
      Math.max(max[1] - min[1], 0),
      Math.max(max[2] - min[2], 0),
    ],
  };
}

function parsePolygonLoops(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((loop) => {
      if (!Array.isArray(loop)) return [];
      return loop
        .map((point) => vector3Value(point))
        .filter((point): point is [number, number, number] => point !== null);
    })
    .filter((loop) => loop.length >= 3);
}

function pointInsideCircle(
  x: number,
  y: number,
  cx: number,
  cy: number,
  radius: number,
) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function pointInsidePolygonLoops(
  x: number,
  y: number,
  loops: [number, number, number][][],
) {
  let winding = 0;
  loops.forEach((loop) => {
    if (pointInsideLoop(x, y, loop)) winding += 1;
  });
  return winding % 2 === 1;
}

function pointInsideLoop(
  x: number,
  y: number,
  loop: [number, number, number][],
) {
  let inside = false;
  for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
    const [xi, yi] = loop[index];
    const [xj, yj] = loop[previous];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function vector3Value(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = finiteNumber(value[0], NaN);
  const y = finiteNumber(value[1], NaN);
  const z = finiteNumber(value[2], 0);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
    ? [x, y, z]
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number) {
  if (typeof value === "boolean") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
