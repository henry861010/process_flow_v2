import { normalizeGeometryStructure } from "../data/schema.js";
import { ProcessGeometryState } from "../process/process-geometry-state.js";

/**
 * Rebuild a mutable process geometry state from a stored geometry structure.
 */
export function geometryStructureToProcessGeometryState(payload: any, options: any = {}) {
  return ProcessGeometryState.fromStructure(payload, {
    footprint: { derive: "largestRootBody" },
    ...options,
  });
}

/**
 * Convert a ProcessGeometryState-like value back into a normalized structure.
 */
export function processGeometryStateToGeometryStructure(value: any) {
  if (
    value instanceof ProcessGeometryState ||
    (value?.toGeometryStructure && typeof value.toGeometryStructure === "function")
  ) {
    return value.toGeometryStructure();
  }
  return normalizeGeometryStructure(value);
}
