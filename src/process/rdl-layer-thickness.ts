import { math } from "../utils/math.js";

/**
 * Normalize one RDL layer definition to the single thickness used by the
 * current geometry engine.
 *
 * @param {object} rdlLayer - RDL layer settings. Provide either `thk`, or both
 *   `pm_thickness` and `rdl_thickness`; when multiple fields are present they
 *   must describe the same thickness.
 * @returns {number} The validated thickness shared by the dielectric and metal
 *   portions of this RDL layer.
 * @throws {Error} If thickness fields are missing or inconsistent.
 */
export function rdlLayerThickness(rdlLayer) {
  if (Object.hasOwn(rdlLayer, "thk")) {
    const thk = rdlLayer.thk;
    const pmThickness = rdlLayer.pm_thickness ?? thk;
    const rdlThickness = rdlLayer.rdl_thickness ?? thk;
    if (math.fNe(pmThickness, thk) || math.fNe(rdlThickness, thk)) {
      throw new Error("RDL thk, pm_thickness, and rdl_thickness must match");
    }
    return thk;
  }

  const pmThickness = rdlLayer.pm_thickness;
  const rdlThickness = rdlLayer.rdl_thickness;
  if (pmThickness === undefined || rdlThickness === undefined) {
    throw new Error(
      "rdl_layer must define thk, or both pm_thickness and rdl_thickness",
    );
  }
  if (math.fNe(pmThickness, rdlThickness)) {
    throw new Error("pm_thickness and rdl_thickness must be equal");
  }
  return pmThickness;
}

export const _rdl_layer_thickness = rdlLayerThickness;
