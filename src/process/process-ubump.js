import { Bump } from "../data/bump.js";

/**
 * Add a u-bump feature below the lowest direct body in the die root container.
 *
 * The bump uses the lowest body's footprint and is translated so its top face
 * touches the body's bottom face without overlapping the body. Existing bumps
 * are intentionally ignored for placement, so repeated u-bump steps overlap
 * earlier bumps instead of stacking underneath them.
 *
 * @param {import("./status.js").Status} status - Die process status to update.
 * @param {string} material - Material name or identifier for the bump.
 * @param {number} density - Effective bump density inside the bump geometry.
 * @returns {import("./status.js").Status} The same status object after the
 *   bump is added.
 * @throws {Error} If the status has no root container or no direct body.
 */
export function processUbump(status, material, density) {
  addBumpBelowLowestDirectBody(status, material, density, "process_ubump");
  return status;
}

export const process_ubump = processUbump;

export function addBumpBelowLowestDirectBody(
  status,
  material,
  density,
  processName = "process_bump",
) {
  const container = status?.container?.();
  if (container === undefined || container === null) {
    throw new Error(`${processName} requires a status with a root container`);
  }

  const bodies = container.bodies();
  if (bodies.length === 0) {
    throw new Error(
      `${processName} requires at least one body in the root container`,
    );
  }

  const body = lowestDirectBody(bodies);
  const geometry = body.geometry();
  geometry.move({ z: body.zMin() - geometry.thk() - geometry.zMin() });

  return container.addBump(new Bump(geometry, density, material, "-z"));
}

function lowestDirectBody(bodies) {
  return bodies.reduce((lowest, body) => {
    if (body.zMin() < lowest.zMin()) return body;
    return lowest;
  });
}
