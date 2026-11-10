import { describe, expect, it } from "vitest";
import { emptyWaferDraft, validateWaferDraft } from "./wafer-arrangement-state";

describe("wafer parameter validation", () => {
  it("starts with blank inputs and one independent dummy layer", () => {
    const draft = emptyWaferDraft();
    expect(draft.arrangeType).toBe("center");
    expect(draft.dummyLayers).toHaveLength(1);
    expect(validateWaferDraft(draft).parameters).toBeNull();
    expect(Object.keys(validateWaferDraft(draft).errors)).toHaveLength(9);
  });
  it("allows zero COW gaps and COW-only patterns, rejecting invalid diameter and nonfinite values", () => {
    const draft = { ...emptyWaferDraft(), allowableDiameter: "290000", cowSize: { x: "40000", y: "50000" }, cowSpacing: { x: "0", y: "0" }, dummyLayers: [] };
    expect(validateWaferDraft(draft).parameters?.cowSpacing).toEqual({ x: 0, y: 0 });
    for (const value of ["", "300000", "0", "-1", "Infinity", "NaN"]) {
      expect(validateWaferDraft({ ...draft, allowableDiameter: value }).errors.diameter).toBeTruthy();
    }
    expect(validateWaferDraft({ ...draft, cowSpacing: { x: "", y: "0" } }).errors["cow-space-x"]).toBeTruthy();
  });
});
