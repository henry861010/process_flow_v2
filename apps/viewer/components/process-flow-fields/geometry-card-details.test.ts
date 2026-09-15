import { describe, expect, it } from "vitest";

import {
  geometryMetadataLine,
  geometrySearchText,
  type GeometryCardValue,
} from "./geometry-card-metadata";

const geometry: GeometryCardValue = {
  id: "hbm3_8hi",
  name: "HBM3 8-Hi",
  category: "die.hbm",
  entityType: "die",
  dim: "10975 x 10975 x 720 um",
  vendor: " Generic ",
  type1: null,
  type2: "stack",
};

describe("geometry card metadata", () => {
  it("joins only populated optional metadata in display order", () => {
    expect(geometryMetadataLine(geometry)).toBe("Generic / stack");
    expect(
      geometryMetadataLine({ ...geometry, vendor: " ", type1: null, type2: undefined }),
    ).toBe("");
  });

  it("makes displayed and identifying metadata searchable", () => {
    const searchText = geometrySearchText(geometry);
    expect(searchText).toContain("hbm3_8hi");
    expect(searchText).toContain("10975 x 10975 x 720 um");
    expect(searchText).toContain("Generic");
    expect(searchText).toContain("stack");
  });
});
