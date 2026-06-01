import { Body } from "../data/body.js";
import { BoxGeometry } from "../data/geometry.js";

/**
 * Initialize a process status with a square panel and add the panel body as the
 * first full-footprint material layer.
 *
 * @param {import("./status.js").Status} status - Process status to initialize
 *   and update.
 * @param {string} material - Material name or identifier for the panel layer.
 * @param {number} thk - Panel thickness.
 * @param {number} width - Panel side length.
 * @returns {import("./status.js").Status} The same status object after the
 *   panel layer is added.
 */
export function processPanel(status, material, thk, width) {
  const panelBody = new Body(
    new BoxGeometry(
      [-width / 2, -width / 2, 0.0],
      [width / 2, width / 2, 0.0],
      thk,
    ),
    material,
  );
  status.initialBody(panelBody);
  status.fillThk(material, thk);
  return status;
}

export const process_panel = processPanel;
