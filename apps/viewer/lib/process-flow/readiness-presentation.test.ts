import { describe, expect, it } from "vitest";

import { geometryInputStatusLabel } from "./readiness-presentation";

describe("geometry input status", () => {
  it("names a resolved generator binding correctly", () => {
    expect(geometryInputStatusLabel({ status: "ready", code: "ready", reason: "" }, "generator"))
      .toBe("Generator");
  });
});
