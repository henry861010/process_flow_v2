import { addBumpBelowLowestDirectBody } from "./process-ubunp.js";

/**
 * Add a C4 bump feature below the lowest direct body in the die root container.
 *
 * Placement is identical to process-ubump: the lowest body defines the bump
 * footprint and z anchor, while existing bumps are ignored so repeated bump
 * steps overlap instead of stacking.
 *
 * @param {import("./status.js").Status} status - Die process status to update.
 * @param {string} material - Material name or identifier for the bump.
 * @param {number} density - Effective bump density inside the bump geometry.
 * @returns {import("./status.js").Status} The same status object after the
 *   bump is added.
 */
export function processC4Bump(status, material, density) {
  addBumpBelowLowestDirectBody(status, material, density, "process_c4Bump");
  return status;
}

export const process_c4Bump = processC4Bump;
export const process_c4_bump = processC4Bump;
