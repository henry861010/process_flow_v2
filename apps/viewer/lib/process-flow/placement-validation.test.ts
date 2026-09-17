import { describe, expect, it } from "vitest";

import { isParameterValueComplete } from "./configuration";
import {
  isPlacementValid,
  placementDiagnostic,
  summarizePlacementValidation,
} from "./placement-validation";
import type { ParameterDefinition } from "./types";

const placementDefinition: ParameterDefinition = {
  id: "placements",
  name: "Placements",
  valueType: "placements",
  controlType: "placementList",
};

function rectanglePlacement(
  bottomLeftX = 0,
  bottomLeftY = 0,
  topRightX = 10,
  topRightY = 10,
) {
  return {
    targetRegion: {
      type: "rectangle",
      bottomLeftX,
      bottomLeftY,
      topRightX,
      topRightY,
    },
    pose: { x: 0, y: 0, rotationZ: 0 },
    anchor: "center",
  };
}

function polygonPlacement(points: Array<[number, number]>) {
  return {
    targetRegion: { type: "polygon", points },
    pose: { x: 0, y: 0, rotationZ: 0 },
    anchor: "center",
  };
}

describe("placement validation", () => {
  it("accepts valid rectangles and rejects missing or inverted coordinates", () => {
    expect(isPlacementValid(rectanglePlacement())).toBe(true);
    expect(
      placementDiagnostic({
        ...rectanglePlacement(),
        targetRegion: {
          ...rectanglePlacement().targetRegion,
          topRightX: "",
        },
      }),
    ).toBe("Rectangle requires finite bottom-left and top-right coordinates.");
    expect(placementDiagnostic(rectanglePlacement(0, 0, 0, 10))).toBe(
      "Rectangle top-right coordinates must be greater than bottom-left coordinates.",
    );
  });

  it("enforces the fixed pose and center anchor contract", () => {
    expect(
      placementDiagnostic({
        ...rectanglePlacement(),
        pose: { x: 1, y: 0, rotationZ: 0 },
      }),
    ).toBe("Placement pose must use X 0, Y 0, and rotation Z 0.");
    expect(
      placementDiagnostic({ ...rectanglePlacement(), anchor: "bottomLeft" }),
    ).toBe("Placement anchor must be center.");
  });

  it("accepts valid polygons, including a repeated closing point", () => {
    expect(
      isPlacementValid(
        polygonPlacement([
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ]),
      ),
    ).toBe(true);
    expect(
      isPlacementValid(
        polygonPlacement([
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ]),
      ),
    ).toBe(true);
  });

  it.each([
    {
      name: "non-finite point",
      points: [[0, 0], [10, 0], [10, Number.NaN]] as Array<[number, number]>,
      message: "Enter a finite X and Y for every polygon point.",
    },
    {
      name: "fewer than three points",
      points: [[0, 0], [10, 0]] as Array<[number, number]>,
      message: "Polygon requires at least three points.",
    },
    {
      name: "duplicate point",
      points: [[0, 0], [10, 0], [0, 10], [10, 0]] as Array<[number, number]>,
      message: "Polygon points must be unique.",
    },
    {
      name: "zero-length edge",
      points: [[0, 0], [1e-10, 0], [10, 10], [0, 10]] as Array<[number, number]>,
      message: "Polygon must not contain zero-length edges.",
    },
    {
      name: "self-intersection",
      points: [[0, 0], [10, 10], [0, 10], [10, 0]] as Array<[number, number]>,
      message: "Polygon must not self-intersect.",
    },
    {
      name: "zero area",
      points: [[0, 0], [5, 0], [10, 0]] as Array<[number, number]>,
      message: "Polygon must have non-zero area.",
    },
  ])("rejects a polygon with $name", ({ points, message }) => {
    expect(placementDiagnostic(polygonPlacement(points))).toBe(message);
  });

  it("counts mixed GDS-style imports and updates after manual correction or removal", () => {
    const invalid = rectanglePlacement(0, 0, 0, 10);
    expect(
      summarizePlacementValidation([rectanglePlacement(), invalid]),
    ).toMatchObject({ totalPlacements: 2, invalidPlacements: 1 });
    expect(
      summarizePlacementValidation([rectanglePlacement(), rectanglePlacement(20, 20, 30, 30)]),
    ).toMatchObject({ totalPlacements: 2, invalidPlacements: 0 });
    expect(summarizePlacementValidation([rectanglePlacement()])).toMatchObject({
      totalPlacements: 1,
      invalidPlacements: 0,
    });
  });

  it("uses the shared validator for step readiness", () => {
    const valid = rectanglePlacement();
    const invalid = rectanglePlacement(0, 0, 0, 10);
    expect(isParameterValueComplete(placementDefinition, [valid])).toBe(true);
    expect(isParameterValueComplete(placementDefinition, [valid, invalid])).toBe(false);
  });
});
