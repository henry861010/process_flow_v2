/**
 * Add a u-bump feature below the lowest direct body in the root scope.
 *
 * Existing bumps are ignored for placement, so repeated bump steps overlap
 * earlier bumps instead of stacking underneath them.
 *
 * @param {import("./process-geometry-state.js").ProcessGeometryState} state
 * @param {string} material - Material name or identifier for the bump.
 * @param {number} density - Effective bump density inside the bump geometry.
 * @param {?number} thickness - Optional bump thickness. Defaults to the lowest
 *   direct body thickness.
 * @returns {import("./process-geometry-state.js").ProcessGeometryState}
 */
export function processUbump(state, material, density, thickness = undefined) {
  addBumpBelowLowestDirectBody(
    state,
    material,
    density,
    "process_ubump",
    thickness,
  );
  return state;
}

export const process_ubump = processUbump;

export function addBumpBelowLowestDirectBody(
  state,
  material,
  density,
  processName = "process_bump",
  thickness = undefined,
) {
  try {
    return state.addBumpBelowLowestBody({
      material,
      density,
      thickness,
      direction: "-z",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${processName}: ${message}`);
  }
}
