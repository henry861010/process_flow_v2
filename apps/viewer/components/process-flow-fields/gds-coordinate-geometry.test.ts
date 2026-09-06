import { describe, expect, it } from "vitest";

import type { CoordinatePair } from "./coordinate-list-value";
import {
  createGdsRegionAccumulator,
  regionHasNonOrthogonalEdges,
  shouldDefeatureRegion,
  unitScale,
  type GdsTargetRegion,
} from "./gds-coordinate-geometry";

function polygon(points: CoordinatePair[]): GdsTargetRegion {
  return { type: "polygon", points };
}

function circle(radius: number, vertices = 16): GdsTargetRegion {
  return polygon(
    Array.from({ length: vertices }, (_, index): CoordinatePair => {
      const angle = (index / vertices) * Math.PI * 2;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }),
  );
}

describe("GDS defeature geometry", () => {
  it("removes a small discretized circle", () => {
    expect(shouldDefeatureRegion(circle(4), 10)).toBe(true);
  });

  it("removes a small rotated rectangle", () => {
    const rotatedRectangle = polygon([
      [0, -4],
      [3, 0],
      [0, 4],
      [-3, 0],
    ]);

    expect(shouldDefeatureRegion(rotatedRectangle, 10)).toBe(true);
  });

  it("keeps small rectangles and Manhattan polygons", () => {
    const rectangle: GdsTargetRegion = {
      type: "rectangle",
      bounds: [[0, 0], [4, 4]],
    };
    const manhattanPolygon = polygon([
      [0, 0],
      [6, 0],
      [6, 3],
      [3, 3],
      [3, 6],
      [0, 6],
    ]);

    expect(shouldDefeatureRegion(rectangle, 10)).toBe(false);
    expect(shouldDefeatureRegion(manhattanPolygon, 10)).toBe(false);
  });

  it("keeps non-orthogonal regions that reach the threshold on either axis", () => {
    const equalThreshold = polygon([
      [-5, 0],
      [0, 4],
      [5, 0],
      [0, -4],
    ]);
    const widerThanThreshold = polygon([
      [-6, 0],
      [0, 3],
      [6, 0],
      [0, -3],
    ]);

    expect(shouldDefeatureRegion(equalThreshold, 10)).toBe(false);
    expect(shouldDefeatureRegion(widerThanThreshold, 10)).toBe(false);
  });

  it("uses the shared coordinate tolerance for nearly axis-aligned edges", () => {
    const nearlyAxisAligned = polygon([
      [0, 0],
      [5, 0.0000005],
      [5, 5],
      [0, 5],
    ]);

    expect(regionHasNonOrthogonalEdges(nearlyAxisAligned)).toBe(false);
    expect(shouldDefeatureRegion(nearlyAxisAligned, 10)).toBe(false);
  });

  it("counts defeatured elements before deduplication", () => {
    const accumulator = createGdsRegionAccumulator(10);
    const smallCircle = circle(4);

    accumulator.add(smallCircle);
    accumulator.add(smallCircle);

    expect(accumulator.result()).toEqual({
      regions: [],
      duplicatesRemoved: 0,
      defeaturedElements: 2,
      nonOrthogonalRegions: 0,
    });
  });

  it("deduplicates retained regions and counts only unique non-orthogonal output", () => {
    const accumulator = createGdsRegionAccumulator(10);
    const largeDiamond = polygon([
      [-6, 0],
      [0, 4],
      [6, 0],
      [0, -4],
    ]);

    accumulator.add(largeDiamond);
    accumulator.add(largeDiamond);

    expect(accumulator.result()).toEqual({
      regions: [largeDiamond],
      duplicatesRemoved: 1,
      defeaturedElements: 0,
      nonOrthogonalRegions: 1,
    });
  });

  it("preserves the existing import behavior when defeature is disabled", () => {
    const accumulator = createGdsRegionAccumulator();
    const smallCircle = circle(4);

    accumulator.add(smallCircle);
    accumulator.add(smallCircle);

    expect(accumulator.result()).toEqual({
      regions: [smallCircle],
      duplicatesRemoved: 1,
      defeaturedElements: 0,
      nonOrthogonalRegions: 1,
    });
  });

  it("converts GDS database units into the placement unit", () => {
    expect(unitScale(1e-9, "um")).toBeCloseTo(0.001);
    expect(unitScale(1e-9, "mm")).toBeCloseTo(0.000001);
    expect(unitScale(1e-9, "nm")).toBeCloseTo(1);
  });
});
