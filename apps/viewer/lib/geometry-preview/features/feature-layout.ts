import { materialPreviewColor } from "@/components/viewer/material-palette";
import type { BoundsTuple } from "@/components/viewer/model-loader";
import {
  pointInsideFeatureFootprint,
  type FeatureKind,
  type PreviewFeature,
} from "@/lib/geometry-preview/features/feature-model";
import {
  resolveFeatureInstanceBudget,
  type FeatureLayoutSettings,
} from "@/lib/geometry-preview/features/feature-quality";

export type FeatureInstanceBatch = {
  kind: FeatureKind;
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
};

export type FeatureInstanceLayout = {
  batches: Record<FeatureKind, FeatureInstanceBatch>;
  total: number;
};

export function buildFeatureInstanceLayout(
  features: PreviewFeature[],
  sceneBounds: BoundsTuple,
  settings: FeatureLayoutSettings,
): FeatureInstanceLayout {
  const visible = features
    .filter((feature) => isVisible(feature, settings))
    .sort((left, right) => left.id.localeCompare(right.id));
  const budget = resolveFeatureInstanceBudget(settings);
  const quotas = allocateQuotas(visible, sceneBounds, settings, budget);
  const batchItems: Record<FeatureKind, number[]> = { bump: [], via: [], circuit: [] };
  const batchColors: Record<FeatureKind, number[]> = { bump: [], via: [], circuit: [] };

  visible.forEach((feature) => {
    const quota = quotas.get(feature.id) ?? 0;
    if (quota <= 0) return;
    const color = hexToLinearishRgb(materialPreviewColor(feature.material));
    const samples = sampleFeaturePositions(feature, quota);
    const grid = featureGridDimensions(feature, sceneBounds, settings);
    const maxDim = Math.max(...sceneBounds.size, 1);
    const featureMaxXY = Math.max(feature.bounds.size[0], feature.bounds.size[1], 1);
    const density = effectiveDensity(feature, settings);
    const baseRadius = clamp(
      (featureMaxXY / Math.max(grid.x, grid.y, 1)) * 0.24,
      maxDim * 0.001,
      maxDim * 0.03,
    );
    const radius = baseRadius * settings.glyphSizeScale * (0.65 + density * 0.45);

    samples.forEach(([x, y, z], index) => {
      const size = feature.bounds.size;
      let sx = radius;
      let sy = radius;
      let sz = radius;
      let rotation = 0;
      if (feature.type === "via") {
        sz = Math.max(size[2] / 2, radius * 0.6);
      } else if (feature.type === "circuit") {
        const cellWidth = Math.max(size[0] / Math.max(grid.x, 1), 0.001);
        const cellHeight = Math.max(size[1] / Math.max(grid.y, 1), 0.001);
        sx = Math.min(radius * 4.2, cellWidth * 0.62) / 2;
        sy = Math.min(radius * 0.72, cellHeight * 0.38) / 2;
        sz = clamp(radius * 0.3, size[2] * 0.12, size[2] * 0.72) / 2;
        rotation = ((index % 3) - 1) * 0.22;
      } else {
        sx = sy = sz = Math.max(radius, size[2] / 2);
      }
      appendMatrix(batchItems[feature.type], x, y, z, sx, sy, sz, rotation);
      batchColors[feature.type].push(...color);
    });
  });

  const batches = Object.fromEntries(
    (["bump", "via", "circuit"] as FeatureKind[]).map((kind) => [
      kind,
      {
        kind,
        count: batchItems[kind].length / 16,
        matrices: new Float32Array(batchItems[kind]),
        colors: new Float32Array(batchColors[kind]),
      },
    ]),
  ) as Record<FeatureKind, FeatureInstanceBatch>;
  return {
    batches,
    total: batches.bump.count + batches.via.count + batches.circuit.count,
  };
}

function allocateQuotas(
  features: PreviewFeature[],
  bounds: BoundsTuple,
  settings: FeatureLayoutSettings,
  budget: number,
) {
  const quotas = new Map<string, number>();
  const requests = features
    .map((feature) => ({
      feature,
      requested:
        feature.normalizedDensity <= 0
          ? 0
          : Math.max(1, estimateFeatureSampleCount(feature, bounds, settings)),
    }))
    .filter(({ requested }) => requested > 0)
    .sort((left, right) => left.feature.id.localeCompare(right.feature.id));
  if (budget <= 0 || requests.length === 0) return quotas;

  const presence = Math.min(requests.length, budget);
  for (let slot = 0; slot < presence; slot += 1) {
    const index = Math.floor((slot * requests.length) / presence);
    quotas.set(requests[index].feature.id, 1);
  }
  let remaining = budget - presence;
  if (remaining <= 0) return quotas;

  const totalNeed = requests.reduce((sum, { requested }) => sum + Math.max(requested - 1, 0), 0);
  if (totalNeed <= remaining) {
    requests.forEach(({ feature, requested }) => quotas.set(feature.id, requested));
    return quotas;
  }

  const remainders = requests.map(({ feature, requested }) => {
    const exact = totalNeed === 0 ? 0 : (Math.max(requested - 1, 0) / totalNeed) * remaining;
    const whole = Math.floor(exact);
    quotas.set(feature.id, (quotas.get(feature.id) ?? 0) + whole);
    return { featureId: feature.id, remainder: exact - whole };
  });
  const allocated = [...quotas.values()].reduce((sum, value) => sum + value, 0);
  let leftovers = budget - allocated;
  remainders
    .sort((left, right) => right.remainder - left.remainder || left.featureId.localeCompare(right.featureId))
    .forEach(({ featureId }) => {
      if (leftovers <= 0) return;
      quotas.set(featureId, (quotas.get(featureId) ?? 0) + 1);
      leftovers -= 1;
    });
  return quotas;
}

function sampleFeaturePositions(feature: PreviewFeature, count: number) {
  const samples: [number, number, number][] = [];
  const { min, size, center } = feature.bounds;
  const seed = stableHash(feature.id);
  const offsetX = (seed & 0xffff) / 0x10000;
  const offsetY = ((seed >>> 16) & 0xffff) / 0x10000;
  const goldenX = 0.7548776662466927;
  const goldenY = 0.5698402909980532;
  const maxAttempts = count * 24 + 128;

  for (let index = 0; index < maxAttempts && samples.length < count; index += 1) {
    const x = min[0] + fract(offsetX + index * goldenX) * size[0];
    const y = min[1] + fract(offsetY + index * goldenY) * size[1];
    if (!pointInsideFeatureFootprint(feature, x, y)) continue;
    samples.push([x, y, center[2]]);
  }
  return samples;
}

function estimateFeatureSampleCount(
  feature: PreviewFeature,
  bounds: BoundsTuple,
  settings: FeatureLayoutSettings,
) {
  const grid = featureGridDimensions(feature, bounds, settings);
  return Math.max(1, grid.x * grid.y);
}

function featureGridDimensions(
  feature: PreviewFeature,
  bounds: BoundsTuple,
  settings: FeatureLayoutSettings,
) {
  const density = effectiveDensity(feature, settings);
  const sceneMaxXY = Math.max(bounds.size[0], bounds.size[1], 1);
  const pitch = sceneMaxXY / (14 + density * 82);
  const sx = Math.max(feature.bounds.size[0], pitch);
  const sy = Math.max(feature.bounds.size[1], pitch);
  return {
    x: clampInteger(Math.round(sx / pitch), 1, 90),
    y: clampInteger(Math.round(sy / pitch), 1, 90),
  };
}

function effectiveDensity(feature: PreviewFeature, settings: FeatureLayoutSettings) {
  if (feature.normalizedDensity <= 0) return 0;
  return clamp(feature.normalizedDensity * settings.densityScale, 0, 1);
}

function appendMatrix(
  target: number[],
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rotation: number,
) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  target.push(
    cosine * sx,
    sine * sx,
    0,
    0,
    -sine * sy,
    cosine * sy,
    0,
    0,
    0,
    0,
    sz,
    0,
    x,
    y,
    z,
    1,
  );
}

function hexToLinearishRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

function isVisible(feature: PreviewFeature, settings: FeatureLayoutSettings) {
  if (!settings.enabled) return false;
  if (feature.type === "bump") return settings.showBumps;
  if (feature.type === "via") return settings.showVias;
  return settings.showCircuits;
}

function stableHash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function fract(value: number) {
  return value - Math.floor(value);
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
