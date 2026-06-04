/**
 * Initialize a process state with a square panel and add the panel body as the
 * first full-footprint material layer.
 *
 * @param {import("./process-geometry-state.js").ProcessGeometryState} state - Process state to initialize
 *   and update.
 * @param {string} material - Material name or identifier for the panel layer.
 * @param {number} thk - Panel thickness.
 * @param {number} width - Panel side length.
 * @returns {import("./process-geometry-state.js").ProcessGeometryState} The same state object after the
 *   panel layer is added.
 */
export function processPanel(state, material, thk, width) {
  state.initializeBoxLayer({
    material,
    bottomLeft: [-width / 2, -width / 2, 0.0],
    topRight: [width / 2, width / 2, 0.0],
    thickness: thk,
  });
  return state;
}

export const process_panel = processPanel;
