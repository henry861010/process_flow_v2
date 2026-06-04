import { addBumpBelowLowestDirectBody } from "./process-ubump.js";

/**
 * Add a BGA bump feature below the lowest direct body in the root scope.
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
export function processBgaBump(state, material, density) {
  addBumpBelowLowestDirectBody(state, material, density, "process_bgaBump");
  return state;
}

export const process_bgaBump = processBgaBump;
export const process_bga_bump = processBgaBump;
