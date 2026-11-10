import type { ArrangeType, WaferParameters } from "./wafer-arrangement-client";

type XYDraft = { x: string; y: string };
export type DummyDraft = { id: string; size: XYDraft; minSpacing: XYDraft };
export type WaferDraft = {
  allowableDiameter: string; cowSize: XYDraft; cowSpacing: XYDraft;
  arrangeType: ArrangeType; dummyLayers: DummyDraft[];
};
export function newDummyLayer(id: string): DummyDraft {
  return { id, size: { x: "", y: "" }, minSpacing: { x: "", y: "" } };
}
export function emptyWaferDraft(): WaferDraft {
  return { allowableDiameter: "", cowSize: { x: "", y: "" }, cowSpacing: { x: "", y: "" },
    arrangeType: "center", dummyLayers: [newDummyLayer("dummy-1")] };
}

export function validateWaferDraft(draft: WaferDraft): { parameters: WaferParameters | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  function value(raw: string, id: string, label: string, zeroAllowed = false) {
    const numeric = Number(raw);
    if (!raw.trim() || !Number.isFinite(numeric) || (zeroAllowed ? numeric < 0 : numeric <= 0)) {
      errors[id] = `${label} must be a finite number ${zeroAllowed ? "greater than or equal to 0" : "greater than 0"}.`;
    }
    return numeric;
  }
  const diameter = value(draft.allowableDiameter, "diameter", "Allowable diameter");
  if (diameter >= 300000) errors.diameter = "Allowable diameter must be less than 300000 µm.";
  const cowSize = { x: value(draft.cowSize.x, "cow-size-x", "COW size X"), y: value(draft.cowSize.y, "cow-size-y", "COW size Y") };
  const cowSpacing = { x: value(draft.cowSpacing.x, "cow-space-x", "COW space X", true), y: value(draft.cowSpacing.y, "cow-space-y", "COW space Y", true) };
  const dummyLayers = draft.dummyLayers.map((layer, index) => ({
    size: { x: value(layer.size.x, `${layer.id}-size-x`, `Layer ${index + 1} size X`), y: value(layer.size.y, `${layer.id}-size-y`, `Layer ${index + 1} size Y`) },
    minSpacing: { x: value(layer.minSpacing.x, `${layer.id}-gap-x`, `Layer ${index + 1} minimum spacing X`), y: value(layer.minSpacing.y, `${layer.id}-gap-y`, `Layer ${index + 1} minimum spacing Y`) },
  }));
  return { parameters: Object.keys(errors).length ? null : { allowableDiameter: diameter, cowSize, cowSpacing, arrangeType: draft.arrangeType, dummyLayers }, errors };
}
