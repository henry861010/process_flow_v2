import { describe, expect, it } from "vitest";

import { createGdsRegionAccumulator } from "./gds-coordinate-geometry";
import {
  duplicateGdsImportCriterionKeys,
  gdsElementMatchesCriteria,
  normalizeGdsImportCriteria,
  parseGdsIntegerInput,
} from "./gds-import-criteria";

describe("GDS import criteria", () => {
  it("parses only non-negative safe integers", () => {
    expect(parseGdsIntegerInput("0")).toBe(0);
    expect(parseGdsIntegerInput("01")).toBe(1);
    expect(parseGdsIntegerInput("")).toBeNull();
    expect(parseGdsIntegerInput("-1")).toBeNull();
    expect(parseGdsIntegerInput("1.5")).toBeNull();
    expect(parseGdsIntegerInput(String(Number.MAX_SAFE_INTEGER + 1))).toBeNull();
  });

  it("detects duplicate numeric layer/datatype pairs", () => {
    expect(
      duplicateGdsImportCriterionKeys([
        { layer: 1, datatype: 0 },
        { layer: 2, datatype: 1 },
        { layer: 1, datatype: 0 },
      ]),
    ).toEqual(new Set(["1:0"]));
    expect(() =>
      normalizeGdsImportCriteria([
        { layer: 1, datatype: 0 },
        { layer: 1, datatype: 0 },
      ]),
    ).toThrow("must be unique");
  });

  it("matches exact pairs with OR semantics without crossing fields", () => {
    const criteria = normalizeGdsImportCriteria([
      { layer: 1, datatype: 0 },
      { layer: 2, datatype: 1 },
    ]);

    expect(gdsElementMatchesCriteria(criteria, 1, 0, "TOP")).toBe(true);
    expect(gdsElementMatchesCriteria(criteria, 2, 1, "TOP")).toBe(true);
    expect(gdsElementMatchesCriteria(criteria, 1, 1, "TOP")).toBe(false);
    expect(gdsElementMatchesCriteria(criteria, 2, 0, "TOP")).toBe(false);
  });

  it("applies each pair's own include or exclude cell filter", () => {
    const criteria = normalizeGdsImportCriteria([
      {
        layer: 1,
        datatype: 0,
        cellNameFilter: { mode: "include", contains: " core " },
      },
      {
        layer: 2,
        datatype: 0,
        cellNameFilter: { mode: "exclude", contains: "dummy" },
      },
      {
        layer: 3,
        datatype: 0,
        cellNameFilter: { mode: "exclude", contains: "   " },
      },
    ]);

    expect(gdsElementMatchesCriteria(criteria, 1, 0, "CORE_CELL")).toBe(true);
    expect(gdsElementMatchesCriteria(criteria, 1, 0, "IO_CELL")).toBe(false);
    expect(gdsElementMatchesCriteria(criteria, 2, 0, "DUMMY_CELL")).toBe(false);
    expect(gdsElementMatchesCriteria(criteria, 2, 0, "ACTIVE_CELL")).toBe(true);
    expect(gdsElementMatchesCriteria(criteria, 3, 0, "ANY_CELL")).toBe(true);
  });

  it("shares defeature and global deduplication across matched pairs", () => {
    const criteria = normalizeGdsImportCriteria([
      { layer: 1, datatype: 0 },
      { layer: 2, datatype: 1 },
    ]);
    const accumulator = createGdsRegionAccumulator(true);
    const diamond = {
      type: "polygon" as const,
      points: [
        [-4, 0],
        [0, 4],
        [4, 0],
        [0, -4],
      ] as [number, number][],
    };

    [
      { layer: 1, datatype: 0 },
      { layer: 2, datatype: 1 },
    ].forEach((element) => {
      if (
        gdsElementMatchesCriteria(
          criteria,
          element.layer,
          element.datatype,
          "TOP",
        )
      ) {
        accumulator.add(diamond);
      }
    });

    expect(accumulator.result()).toEqual({
      regions: [{ type: "rectangle", bounds: [[-4, -4], [4, 4]] }],
      duplicatesRemoved: 1,
      repairedElements: 2,
      boundingBoxFallbacks: 2,
      nonOrthogonalRegions: 0,
    });
  });

  it("rejects empty and invalid runtime criteria", () => {
    expect(() => normalizeGdsImportCriteria([])).toThrow("At least one");
    expect(() =>
      normalizeGdsImportCriteria([{ layer: -1, datatype: 0 }]),
    ).toThrow("non-negative integers");
    expect(() =>
      normalizeGdsImportCriteria([{ layer: 1, datatype: 0.5 }]),
    ).toThrow("non-negative integers");
  });
});
