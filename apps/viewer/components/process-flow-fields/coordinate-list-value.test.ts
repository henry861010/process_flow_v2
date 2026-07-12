import { describe, expect, it } from "vitest";

import {
  analyzeCoordinateRows,
  coordinateBoundsEqual,
  coordinateListValueIsComplete,
  normalizeCoordinateRows,
  type CoordinateBounds,
} from "./coordinate-list-value";
import { isParameterValueComplete } from "@/lib/process-flow/configuration";

const definition = {
  id: "coordinates",
  name: "Coordinates",
  valueType: "coordinates" as const,
  controlType: "coordinateList" as const,
};

describe("coordinate bounds values", () => {
  it("normalizes the nested lower-left and upper-right shape", () => {
    expect(normalizeCoordinateRows([[[1, 2], [11, 12]]])).toEqual([
      [[1, 2], [11, 12]],
    ]);
  });

  it("requires a positive rectangle on both axes", () => {
    const rows = normalizeCoordinateRows([
      [[0, 0], [10, 10]],
      [[5, 5], [5, 8]],
      [[4, 7], [8, 6]],
    ]);
    expect(analyzeCoordinateRows(rows).invalidBoundsRowIndexes).toEqual([1, 2]);
    expect(coordinateListValueIsComplete(rows)).toBe(false);
  });

  it("detects duplicates within one micrometre-millionth across bucket boundaries", () => {
    const first: CoordinateBounds = [[0.00000049, 2], [10, 12]];
    const second: CoordinateBounds = [[0.00000148, 2], [10, 12]];
    expect(coordinateBoundsEqual(first, second)).toBe(true);
    const diagnostics = analyzeCoordinateRows(
      normalizeCoordinateRows([first, second]),
    );
    expect(diagnostics.duplicateRowIndexes).toEqual([1]);
  });

  it("uses the same rectangle and tolerance rules for flow readiness", () => {
    expect(
      isParameterValueComplete(definition, [
        [[0, 0], [10, 10]],
        [[0.0000005, 0], [10, 10]],
      ]),
    ).toBe(false);
    expect(
      isParameterValueComplete(definition, [[[0, 0], [10, 10]]]),
    ).toBe(true);
  });
});
