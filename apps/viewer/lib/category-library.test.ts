import { describe, expect, it } from "vitest";
import { formatCategoryPath, getCategoryHierarchyLevel } from "./category-library";

describe("uncategorized catalog geometry", () => {
  it("groups omitted and null categories so manually authored geometries remain selectable", () => {
    const items = [{ id: "manual" }, { id: "import", category: null }, { id: "hbm", category: "die.hbm" }];
    const root = getCategoryHierarchyLevel(items, []);
    expect(root.folders.find((folder) => folder.name === "uncategorized")?.count).toBe(2);
    expect(getCategoryHierarchyLevel(items, ["uncategorized"]).items.map((item) => item.id)).toEqual(["manual", "import"]);
    expect(formatCategoryPath(undefined)).toBe("uncategorized");
  });
});
