import { describe, expect, it } from "vitest";

import {
  IDENTITY,
  referenceTransform,
  transformedBounds,
} from "./gds-coordinate-geometry";

const rectangle = [
  [0, 0],
  [2, 0],
  [2, 1],
  [0, 1],
] as [number, number][];

describe("GDS coordinate geometry", () => {
  it("returns both lower-left and upper-right bounds", () => {
    expect(transformedBounds(rectangle, IDENTITY)).toEqual([[0, 0], [2, 1]]);
  });

  it("uses the axis-aligned bounds after reference rotation and magnification", () => {
    const transform = referenceTransform({ angle: 90, mag: 2 }, [10, 20]);
    const bounds = transformedBounds(rectangle, transform);
    expect(bounds?.[0][0]).toBeCloseTo(8);
    expect(bounds?.[0][1]).toBeCloseTo(20);
    expect(bounds?.[1][0]).toBeCloseTo(10);
    expect(bounds?.[1][1]).toBeCloseTo(24);
  });

  it("includes GDS reflection when resolving bounds", () => {
    const transform = referenceTransform({ strans: 0x8000 }, [5, 6]);
    expect(transformedBounds(rectangle, transform)).toEqual([[5, 5], [7, 6]]);
  });
});
