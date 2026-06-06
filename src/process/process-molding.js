/**
 * Add one full-footprint material molding above the current process z plane.
 *
 * @param {import("../kernel/process-geometry-state.js").ProcessGeometryState} state - Process state to update.
 * @param {string} material - Material name or identifier for the new layer.
 * @param {number} thk - Thickness of the layer to add.
 * @param {?number} width - Reserved for callers that share a common process
 *   step signature; the current full-footprint implementation does not use it.
 * @returns {import("../kernel/process-geometry-state.js").ProcessGeometryState} The same state object after the
 *   layer is added.
 */
export function processMolding(state, material, thk, width = null) {
  void width;
  state.depositLayer({ material, thickness: thk });
  return state;
}

export const process_molding = processMolding;
