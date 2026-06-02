import { processPnp } from "../process-pnp.js";

export async function execute({ status, values, geometryStatus }) {
  const dieStatus = geometryStatus("die_geometry");
  if (!dieStatus) {
    throw new Error("example pnp requires die_geometry");
  }
  return processPnp(status, dieStatus, values.coordinates);
}
