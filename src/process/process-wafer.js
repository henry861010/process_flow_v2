import { Body } from "../data/body.js";
import { CylinderGeometry } from "../data/geometry.js";

/**
 * Initialize a process status with a circular wafer and add the wafer body as
 * the first full-footprint material layer.
 *
 * @param {import("./status.js").Status} status - Process status to initialize
 *   and update.
 * @param {string} material - Material name or identifier for the wafer layer.
 * @param {number} thk - Wafer thickness.
 * @param {number} radius - Wafer radius.
 * @returns {import("./status.js").Status} The same status object after the
 *   wafer layer is added.
 */
export function processWafer(status, material, thk, radius) {
  const waferBody = new Body(
    new CylinderGeometry([0.0, 0.0, 0.0], radius, thk),
    material,
  );
  status.initialBody(waferBody);
  status.fillThk(material, thk);
  return status;
}

export const process_wafer = processWafer;
