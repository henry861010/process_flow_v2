"use client";

import * as React from "react";
import { useFrame } from "@react-three/fiber";

import type { FeatureQualityTier } from "@/lib/geometry-preview/features/feature-quality";

export function GeometryFeatureQualityController({
  enabled,
  tier,
  onTierChange,
}: {
  enabled: boolean;
  tier: FeatureQualityTier;
  onTierChange: (tier: FeatureQualityTier) => void;
}) {
  const sampleRef = React.useRef({ slow: 0, fast: 0, cooldown: 0 });

  React.useEffect(() => {
    sampleRef.current = { slow: 0, fast: 0, cooldown: 18 };
  }, [enabled, tier]);

  useFrame((_, delta) => {
    if (!enabled) return;
    const samples = sampleRef.current;
    if (samples.cooldown > 0) {
      samples.cooldown -= 1;
      return;
    }

    if (delta >= 0.05) {
      samples.slow += 1;
      samples.fast = 0;
    } else if (delta <= 0.022) {
      samples.fast += 1;
      samples.slow = 0;
    } else {
      samples.slow = Math.max(0, samples.slow - 1);
      samples.fast = Math.max(0, samples.fast - 1);
    }

    if (samples.slow >= 5 && tier !== "low") {
      onTierChange(tier === "high" ? "balanced" : "low");
      samples.slow = 0;
      samples.cooldown = 24;
      return;
    }
    if (samples.fast >= 75 && tier !== "high") {
      onTierChange(tier === "low" ? "balanced" : "high");
      samples.fast = 0;
      samples.cooldown = 90;
    }
  });

  return null;
}
