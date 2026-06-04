import { rdlLayerThickness } from "./rdl-layer-thickness.js";

/**
 * Add an odd-count RDL stack to the current process state.
 *
 * Even-index layers create dielectric and a downward via region. Odd-index
 * layers create an upward circuit region followed by dielectric fill.
 *
 * @param {import("./process-geometry-state.js").ProcessGeometryState} state - Process state to update.
 * @param {object[]} rdlLayers - RDL layer definitions. Each layer must provide
 *   `pm_material`, `metal_material`, `density`, and a thickness via `thk` or
 *   matching `pm_thickness` and `rdl_thickness`.
 * @returns {import("./process-geometry-state.js").ProcessGeometryState} The same state object after the RDL
 *   stack is added.
 * @throws {Error} If the layer count is even or thickness fields are invalid.
 */
export function processRdl(state, rdlLayers: any[] = []) {
  if (rdlLayers.length % 2 === 0) {
    throw new Error("rdl_layers must contain an odd number of layers");
  }

  rdlLayers.forEach((rdlLayer, index) => {
    const thk = rdlLayerThickness(rdlLayer);
    const pmMaterial = rdlLayer.pm_material;
    const metalMaterial = rdlLayer.metal_material;
    const density = rdlLayer.density;

    if (index % 2 === 0) {
      state.depositLayer({ material: pmMaterial, thickness: thk });
      state.addViaBelowCursor({
        material: metalMaterial,
        density,
        thickness: thk,
      });
    } else {
      state.addCircuitAtCursor({
        material: metalMaterial,
        density,
        thickness: thk,
      });
      state.depositLayer({ material: pmMaterial, thickness: thk });
    }
  });

  return state;
}

export const process_rdl = processRdl;
