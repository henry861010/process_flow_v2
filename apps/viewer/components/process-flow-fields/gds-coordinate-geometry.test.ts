import { describe, expect, it } from "vitest";

import type { CoordinatePair } from "./coordinate-list-value";
import {
  createGdsRegionAccumulator,
  regionHasNonOrthogonalEdges,
  repairGdsRegion,
  referenceTransform,
  transformedPoints,
  unitScale,
  type GdsTargetRegion,
} from "./gds-coordinate-geometry";
import {
  steppedNotches, rectangularSteppedNotches, verticalNotch, rectangularVerticalNotch,
  sameOutline, insideOutline,
} from "./gds-test-fixtures";

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
      status: "repaired",
    });
  });

  it("keeps a round notch as a rectangular recess", () => {
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
      region: polygon([[7, 10], [7, 7], [3, 7], [3, 10], [0, 10], [0, 0], [10, 0], [10, 10]]),
      status: "repaired",
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
      status: "repaired",
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
      status: "repaired",
    });
  });

  it("preserves a fully non-orthogonal polygon instead of using its bounding box", () => {
    const largeDiamond = polygon([
      [-60, 0],
      [0, 40],
      [60, 0],
      [0, -40],
    ]);

    expect(repairGdsRegion(largeDiamond)).toEqual({
      region: largeDiamond,
      status: "preserved",
      reason: "unrecognized-outline",
    });
  });

  it("preserves an ambiguous outline with offset parallel anchors", () => {
    const offsetParallelEdges = polygon([
      [0, 0],
      [10, 0],
      [8, 2],
      [6, 2],
      [6, 8],
      [0, 8],
    ]);

    expect(repairGdsRegion(offsetParallelEdges)).toEqual({
      region: offsetParallelEdges,
      status: "preserved",
      reason: "unrecognized-outline",
    });
  });

  it("preserves an invalid source outline", () => {
    const collapsingOutline = polygon([
      [2, 1],
      [7, 1],
      [3, 0],
      [0, 1],
      [1, 3],
      [1, 1],
    ]);

    expect(repairGdsRegion(collapsingOutline)).toEqual({
      region: collapsingOutline,
      status: "preserved",
      reason: "invalid-outline",
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
      status: "unchanged",
    });
    expect(repairGdsRegion(manhattanPolygon)).toEqual({
      region: manhattanPolygon,
      status: "unchanged",
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
    expect(repairGdsRegion(nearlyAxisAligned).status).toBe("unchanged");
  });

  it("counts preserved input elements and diagnoses unique output regions", () => {
    const accumulator = createGdsRegionAccumulator(true);
    const smallCircle = circle(4);

    accumulator.add(smallCircle);
    accumulator.add(smallCircle);

    expect(accumulator.result()).toEqual({
      regions: [smallCircle],
      duplicatesRemoved: 1,
      repairedElements: 0,
      unrepairedElements: 2,
      repairDiagnostics: [{ regionIndex: 0, reason: "unrecognized-outline" }],
      nonOrthogonalRegions: 1,
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
      unrepairedElements: 0,
      repairDiagnostics: [],
      nonOrthogonalRegions: 1,
    });
  });

  it("converts GDS database units into the placement unit", () => {
    expect(unitScale(1e-9, "um")).toBeCloseTo(0.001);
    expect(unitScale(1e-9, "mm")).toBeCloseTo(0.000001);
    expect(unitScale(1e-9, "nm")).toBeCloseTo(1);
  });
});

describe("GDS boundary-notch regressions", () => {
  it("keeps the stepped body and multiple recesses, including a flat-bottom arc", () => {
    const repair = repairGdsRegion(polygon(steppedNotches));
    expect(repair.status).toBe("repaired");
    expect(repair.region.type).toBe("polygon");
    if (repair.region.type !== "polygon") return;
    expect(sameOutline(repair.region.points, rectangularSteppedNotches)).toBe(true);
    expect(insideOutline(repair.region.points, [17, 15])).toBe(false); // Neighbor's space.
    expect(insideOutline(repair.region.points, [6.5, 18])).toBe(false); // Deep top notch.
    expect(insideOutline(repair.region.points, [16, 8])).toBe(false); // Lower notch.
    // Rectangular recesses remove material; they must never fill the old void.
    for (let x = 0.25; x < 20; x += 0.5) {
      for (let y = 0.25; y < 20; y += 0.5) {
        if (insideOutline(repair.region.points, [x, y])) expect(insideOutline(steppedNotches, [x, y])).toBe(true);
      }
    }
  });

  it("groups collinear arc subdivisions into the same notch", () => {
    const subdivided = steppedNotches.flatMap((point, index): CoordinatePair[] => {
      const next = steppedNotches[(index + 1) % steppedNotches.length];
      return [point, [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]];
    });
    for (const order of [subdivided, [...subdivided].reverse()]) {
      const result = repairGdsRegion(polygon(order));
      expect(result.status).toBe("repaired");
      expect(result.region.type === "polygon" && sameOutline(result.region.points, rectangularSteppedNotches)).toBe(true);
    }
  });

  it("widens an undercut to its full envelope without filling removed material", () => {
    const points: CoordinatePair[] = [
      [0, 0], [10, 0], [10, 10], [6, 10], [7, 9], [7, 8],
      [6, 7], [4, 7], [3, 8], [3, 9], [4, 10], [0, 10],
    ];
    const result = repairGdsRegion(polygon(points));
    expect(result.status).toBe("repaired");
    expect(result.region.type === "polygon" && sameOutline(result.region.points, [
      [0, 0], [10, 0], [10, 10], [7, 10], [7, 7], [3, 7], [3, 10], [0, 10],
    ])).toBe(true);
  });

  it.each([3, 4, 8, 15, 32, 64])("preserves sampled notch width and depth with %i arc segments", (segments) => {
    const arc = Array.from({ length: segments + 1 }, (_, index): CoordinatePair => [
      10 + 4 * Math.cos(index * Math.PI / segments),
      index === 0 || index === segments ? 20 : 20 - 4 * Math.sin(index * Math.PI / segments),
    ]);
    const points: CoordinatePair[] = [[0, 0], [20, 0], [20, 20], ...arc, [0, 20]];
    const depth = Math.min(...arc.map((point) => point[1]));
    const result = repairGdsRegion(polygon(points));
    expect(result.status).toBe("repaired");
    expect(result.region.type === "polygon" && sameOutline(result.region.points, [
      [0, 0], [20, 0], [20, 20], [14, 20], [14, depth], [6, depth], [6, 20], [0, 20],
    ])).toBe(true);
  });

  it.each([0, 90, 180, 270])("commutes with reflection, scaling and %i-degree rotation for all vertex orders", (angle) => {
    for (const [points, expected] of [[steppedNotches, rectangularSteppedNotches], [verticalNotch, rectangularVerticalNotch]]) {
      for (const reflected of [false, true]) {
        const transform = referenceTransform({ angle, strans: reflected ? 0x8000 : 0, mag: 0.5 }, [-30.5, 40.5]);
        const expectedPoints = transformedPoints(expected, transform);
        for (let start = 0; start < points.length; start += 1) {
          const shifted = [...points.slice(start), ...points.slice(0, start)];
          for (const order of [shifted, [...shifted].reverse()]) {
            const result = repairGdsRegion(polygon(transformedPoints(order, transform)));
            expect(result.status).toBe("repaired");
            expect(result.region.type === "polygon" && sameOutline(result.region.points, expectedPoints)).toBe(true);
          }
        }
      }
    }
  });

  it("keeps exact quarter-turn transforms and fractional coordinates", () => {
    const transformed = transformedPoints([[1, 7], [-1, -7]], referenceTransform({ angle: -270, mag: 0.5 }, [0, 0]));
    expect(transformed).toEqual([[-3.5, 0.5], [3.5, -0.5]]);
    const accumulator = createGdsRegionAccumulator();
    // Half-grid regions on opposite sides must remain distinct and symmetric.
    accumulator.add({ type: "rectangle", bounds: [[0.5e-6, 0], [1.5e-6, 1]] });
    accumulator.add({ type: "rectangle", bounds: [[-0.5e-6, 0], [0.5e-6, 1]] });
    expect(accumulator.result().regions).toHaveLength(2);
  });

  it("preserves the complete original element when any local feature is ambiguous", () => {
    const points: CoordinatePair[] = [
      [0, 0], [20, 0], [18, 2], [16, 2], [16, 20],
      [9, 20], [8, 18], [6.5, 17], [5, 18], [4, 20], [0, 20],
    ];
    const source = polygon(points);
    const snapshot = structuredClone(source);
    expect(repairGdsRegion(source)).toEqual({ region: source, status: "preserved", reason: "unrecognized-outline" });
    expect(source).toEqual(snapshot);
  });

  it("counts repaired inputs before deduplication without changing source vertices", () => {
    const source = polygon(steppedNotches);
    const snapshot = structuredClone(source);
    const accumulator = createGdsRegionAccumulator(true);
    accumulator.add(source);
    accumulator.add(polygon([...steppedNotches].reverse()));
    expect(accumulator.result()).toMatchObject({
      duplicatesRemoved: 1, repairedElements: 2, unrepairedElements: 0, repairDiagnostics: [],
    });
    expect(accumulator.result().regions).toHaveLength(1);
    expect(source).toEqual(snapshot);
  });

  it("retains a preserved-input diagnostic when another hierarchy scale already emitted the same region", () => {
    const region = polygon([[0, 0], [5, 0.5e-6], [5, 5], [0, 5]]);
    const accumulator = createGdsRegionAccumulator(true);
    accumulator.add(region, 1e-6);
    accumulator.add(region, 1e-9);
    expect(accumulator.result()).toMatchObject({
      duplicatesRemoved: 1, unrepairedElements: 1, nonOrthogonalRegions: 1,
      repairDiagnostics: [{ regionIndex: 0, reason: "unrecognized-outline" }],
    });
    expect(accumulator.result().regions).toEqual([region]);
  });
});
