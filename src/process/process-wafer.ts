/**
 * Initialize a process state with a circular wafer and add the wafer body as
 * the first full-footprint material layer.
 *
 * @param {import("./process-geometry-state.js").ProcessGeometryState} state - Process state to initialize
 *   and update.
 * @param {string} material - Material name or identifier for the wafer layer.
 * @param {number} thk - Wafer thickness.
 * @param {number} radius - Wafer radius.
 * @returns {import("./process-geometry-state.js").ProcessGeometryState} The same state object after the
 *   wafer layer is added.
 */
export function processWafer(state, material, thk, radius) {
  state.initializeCylinderLayer({
    material,
    center: [0.0, 0.0, 0.0],
    radius,
    thickness: thk,
  });
  return state;
}

export const process_wafer = processWafer;
