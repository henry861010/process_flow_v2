import { addBumpBelowLowestDirectBody } from "./process-ubump.js";

/**
 * Add a C4 bump feature below the lowest direct body in the die root container.
 *
 * Placement is identical to process-ubump: the lowest body defines the bump
 * footprint and z anchor, while existing bumps are ignored so repeated bump
 * steps overlap instead of stacking.
 *
 * @param {import("./process-geometry-state.js").ProcessGeometryState} state - Die process state to update.
 * @param {string} material - Material name or identifier for the bump.
 * @param {number} density - Effective bump density inside the bump geometry.
 * @returns {import("./process-geometry-state.js").ProcessGeometryState} The same state object after the
 *   bump is added.
 */
export function processC4Bump(state, material, density) {
  addBumpBelowLowestDirectBody(state, material, density, "process_c4Bump");
  return state;
}

export const process_c4Bump = processC4Bump;
export const process_c4_bump = processC4Bump;
