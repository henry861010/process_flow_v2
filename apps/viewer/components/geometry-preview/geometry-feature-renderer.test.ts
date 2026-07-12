import { describe, expect, it } from "vitest";

import { createLowPolyGlyphGeometry } from "@/components/geometry-preview/geometry-feature-overlay";

describe("estimated feature renderer budgets", () => {
  it.each([
    ["bump", 20],
    ["via", 24],
    ["circuit", 12],
  ] as const)("keeps %s proxy at or below the triangle budget", (kind, budget) => {
    const geometry = createLowPolyGlyphGeometry(kind);
    const triangles = geometry.index
      ? geometry.index.count / 3
      : geometry.getAttribute("position").count / 3;
    expect(triangles).toBeLessThanOrEqual(budget);
    geometry.dispose();
  });
});
