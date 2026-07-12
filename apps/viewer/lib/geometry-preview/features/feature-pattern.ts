import { materialPreviewColor } from "@/components/viewer/material-palette";
import type {
  FeatureKind,
  PreviewFeature,
} from "@/lib/geometry-preview/features/feature-model";

export const FEATURE_PATTERN_POLICY_VERSION = 1 as const;

export type FeaturePatternMotif = "dots" | "capsules" | "hatch";

export type FeaturePatternDescriptor = {
  version: typeof FEATURE_PATTERN_POLICY_VERSION;
  motif: FeaturePatternMotif;
  materialColor: string;
  accentColor: string;
  density: number;
  pitchU: number;
  pitchV: number;
  markScale: number;
  phaseU: number;
  phaseV: number;
};

export const FEATURE_KIND_COLORS: Record<FeatureKind, string> = {
  via: "#12a8c6",
  circuit: "#2ea85d",
  bump: "#d8ad2f",
};

const MOTIFS: Record<FeatureKind, FeaturePatternMotif> = {
  bump: "dots",
  via: "capsules",
  circuit: "hatch",
};

export function createFeaturePatternDescriptor(
  feature: PreviewFeature,
  axis: "x" | "y",
  densityScale: number,
): FeaturePatternDescriptor {
  const density = clamp(feature.normalizedDensity * densityScale, 0, 1);
  const horizontalSpan = Math.max(feature.bounds.size[0], feature.bounds.size[1], 0.001);
  const cells = 8 + density * 28;
  const pitchU = Math.max(horizontalSpan / cells, 0.001);
  const pitchV = Math.max(Math.min(pitchU, feature.bounds.size[2]), 0.001);
  const uMin = axis === "x" ? feature.bounds.min[1] : feature.bounds.min[0];
  const seed = stableHash(feature.id);
  const seedU = ((seed & 0xffff) / 0xffff - 0.5) * pitchU * 0.2;
  const seedV = (((seed >>> 16) & 0xffff) / 0xffff - 0.5) * pitchV * 0.2;

  return {
    version: FEATURE_PATTERN_POLICY_VERSION,
    motif: MOTIFS[feature.type],
    materialColor: materialPreviewColor(feature.material),
    accentColor: FEATURE_KIND_COLORS[feature.type],
    density,
    pitchU,
    pitchV,
    markScale: 0.28 + density * 0.42,
    phaseU: uMin + pitchU * 0.5 + seedU,
    phaseV: feature.bounds.min[2] + pitchV * 0.5 + seedV,
  };
}

function stableHash(value: string) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
