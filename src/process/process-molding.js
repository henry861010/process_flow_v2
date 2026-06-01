/**
 * Add one full-footprint material molding above the current process z plane.
 *
 * @param {import("./status.js").Status} status - Process status to update.
 * @param {string} material - Material name or identifier for the new layer.
 * @param {number} thk - Thickness of the layer to add.
 * @param {?number} width - Reserved for callers that share a common process
 *   step signature; the current full-footprint implementation does not use it.
 * @returns {import("./status.js").Status} The same status object after the
 *   layer is added.
 */
export function processMolding(status, material, thk, width = null) {
  void width;
  status.fillThk(material, thk);
  return status;
}

export const process_molding = processMolding;
