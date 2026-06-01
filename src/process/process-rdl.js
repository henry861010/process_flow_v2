import { rdlLayerThickness } from "./rdl-layer-thickness.js";

/**
 * Add an odd-count RDL stack to the current process status.
 *
 * Even-index layers create dielectric and a downward via region. Odd-index
 * layers create an upward circuit region followed by dielectric fill.
 *
 * @param {import("./status.js").Status} status - Process status to update.
 * @param {object[]} rdlLayers - RDL layer definitions. Each layer must provide
 *   `pm_material`, `metal_material`, `density`, and a thickness via `thk` or
 *   matching `pm_thickness` and `rdl_thickness`.
 * @returns {import("./status.js").Status} The same status object after the RDL
 *   stack is added.
 * @throws {Error} If the layer count is even or thickness fields are invalid.
 */
export function processRdl(status, rdlLayers = []) {
  if (rdlLayers.length % 2 === 0) {
    throw new Error("rdl_layers must contain an odd number of layers");
  }

  rdlLayers.forEach((rdlLayer, index) => {
    const thk = rdlLayerThickness(rdlLayer);
    const pmMaterial = rdlLayer.pm_material;
    const metalMaterial = rdlLayer.metal_material;
    const density = rdlLayer.density;

    if (index % 2 === 0) {
      status.fillThk(pmMaterial, thk);
      status.digVia(thk, metalMaterial, density);
    } else {
      status.growCircuit(thk, metalMaterial, density);
      status.fillThk(pmMaterial, thk);
    }
  });

  return status;
}

export const process_rdl = processRdl;
