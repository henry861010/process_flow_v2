import { describe, expect, it } from "vitest";

import type { CoordinatePair } from "./coordinate-list-value";
import {
  createGdsRegionAccumulator,
  regionHasNonOrthogonalEdges,
  repairGdsRegion,
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
  it("repairs a rounded corner by extending perpendicular orthogonal edges", () => {
    const roundedCorner = polygon([
      [0, 0],
      [10, 0],
      [10, 4],
      [6, 4],
      [5, 5],
      [4, 6],
      [4, 10],
      [0, 10],
    ]);

    expect(repairGdsRegion(roundedCorner)).toEqual({
      region: polygon([
        [0, 0],
        [10, 0],
        [10, 4],
        [4, 4],
        [4, 10],
        [0, 10],
      ]),
      repaired: true,
      usedBoundingBoxFallback: false,
    });
  });

  it("fills a round notch between collinear edges without deleting its polygon", () => {
    const notchedOutline = polygon([
      [0, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [6, 8],
      [5, 7],
      [4, 8],
      [3, 10],
      [0, 10],
    ]);

    expect(repairGdsRegion(notchedOutline)).toEqual({
      region: { type: "rectangle", bounds: [[0, 0], [10, 10]] },
      repaired: true,
      usedBoundingBoxFallback: false,
    });
  });

  it("trims a round protrusion between collinear edges", () => {
    const protrudingOutline = polygon([
      [0, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [6, 12],
      [5, 13],
      [4, 12],
      [3, 10],
      [0, 10],
    ]);

    expect(repairGdsRegion(protrudingOutline)).toEqual({
      region: { type: "rectangle", bounds: [[0, 0], [10, 10]] },
      repaired: true,
      usedBoundingBoxFallback: false,
    });
  });

  it("repairs multiple non-orthogonal features in one polygon", () => {
    const twoFeatures = polygon([
      [0, 0],
      [3, 0],
      [4, -2],
      [5, -3],
      [6, -2],
      [7, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [6, 12],
      [5, 13],
      [4, 12],
      [3, 10],
      [0, 10],
    ]);

    expect(repairGdsRegion(twoFeatures)).toEqual({
      region: { type: "rectangle", bounds: [[0, 0], [10, 10]] },
      repaired: true,
      usedBoundingBoxFallback: false,
    });
  });

  it("uses a bounding box for a fully non-orthogonal polygon regardless of size", () => {
    const largeDiamond = polygon([
      [-60, 0],
      [0, 40],
      [60, 0],
      [0, -40],
    ]);

    expect(repairGdsRegion(largeDiamond)).toEqual({
      region: { type: "rectangle", bounds: [[-60, -40], [60, 40]] },
      repaired: true,
      usedBoundingBoxFallback: true,
    });
  });

  it("uses a bounding box when parallel anchor edges are not collinear", () => {
    const offsetParallelEdges = polygon([
      [0, 0],
      [10, 0],
      [8, 2],
      [6, 2],
      [6, 8],
      [0, 8],
    ]);

    expect(repairGdsRegion(offsetParallelEdges)).toEqual({
      region: { type: "rectangle", bounds: [[0, 0], [10, 8]] },
      repaired: true,
      usedBoundingBoxFallback: true,
    });
  });

  it("uses a bounding box when the locally repaired polygon collapses", () => {
    const collapsingOutline = polygon([
      [2, 1],
      [7, 1],
      [3, 0],
      [0, 1],
      [1, 3],
      [1, 1],
    ]);

    expect(repairGdsRegion(collapsingOutline)).toEqual({
      region: { type: "rectangle", bounds: [[0, 0], [7, 3]] },
      repaired: true,
      usedBoundingBoxFallback: true,
    });
  });

  it("keeps rectangles and Manhattan polygons unchanged", () => {
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

    expect(repairGdsRegion(rectangle)).toEqual({
      region: rectangle,
      repaired: false,
      usedBoundingBoxFallback: false,
    });
    expect(repairGdsRegion(manhattanPolygon)).toEqual({
      region: manhattanPolygon,
      repaired: false,
      usedBoundingBoxFallback: false,
    });
  });

  it("uses the shared coordinate tolerance for nearly axis-aligned edges", () => {
    const nearlyAxisAligned = polygon([
      [0, 0],
      [5, 0.0000005],
      [5, 5],
      [0, 5],
    ]);

    expect(regionHasNonOrthogonalEdges(nearlyAxisAligned)).toBe(false);
    expect(repairGdsRegion(nearlyAxisAligned).repaired).toBe(false);
  });

  it("repairs before deduplication and counts every repaired input element", () => {
    const accumulator = createGdsRegionAccumulator(true);
    const smallCircle = circle(4);

    accumulator.add(smallCircle);
    accumulator.add(smallCircle);

    expect(accumulator.result()).toEqual({
      regions: [{ type: "rectangle", bounds: [[-4, -4], [4, 4]] }],
      duplicatesRemoved: 1,
      repairedElements: 2,
      boundingBoxFallbacks: 2,
      nonOrthogonalRegions: 0,
    });
  });

  it("preserves exact polygons and warnings when defeature is disabled", () => {
    const accumulator = createGdsRegionAccumulator();
    const smallCircle = circle(4);

    accumulator.add(smallCircle);
    accumulator.add(smallCircle);

    expect(accumulator.result()).toEqual({
      regions: [smallCircle],
      duplicatesRemoved: 1,
      repairedElements: 0,
      boundingBoxFallbacks: 0,
      nonOrthogonalRegions: 1,
    });
  });

  it("converts GDS database units into the placement unit", () => {
    expect(unitScale(1e-9, "um")).toBeCloseTo(0.001);
    expect(unitScale(1e-9, "mm")).toBeCloseTo(0.000001);
    expect(unitScale(1e-9, "nm")).toBeCloseTo(1);
  });
});
