export type FeatureOverlayMode = "auto" | "summary" | "detail";
export type FeatureQualityTier = "summary" | "low" | "balanced" | "high";

export type FeatureOverlaySettings = {
  enabled: boolean;
  showBumps: boolean;
  showVias: boolean;
  showCircuits: boolean;
  mode: FeatureOverlayMode;
  densityScale: number;
  glyphSizeScale: number;
  opacity: number;
  maxInstances: number;
  qualityTier?: FeatureQualityTier;
};

export type FeatureLayoutSettings = Omit<FeatureOverlaySettings, "opacity">;

export function resolveFeatureInstanceBudget(settings: FeatureLayoutSettings) {
  if (!settings.enabled || settings.mode === "summary") return 0;
  if (settings.mode === "detail") return settings.maxInstances;
  const tier = settings.qualityTier ?? "balanced";
  if (tier === "summary") return 0;
  if (tier === "low") return Math.min(settings.maxInstances, 500);
  if (tier === "balanced") return Math.min(settings.maxInstances, 2000);
  return settings.maxInstances;
}
