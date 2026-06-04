import { processPnp } from "../process-pnp.js";

export async function execute({ state, values, geometryState }) {
  const dieState = geometryState("die_geometry");
  if (!dieState) {
    throw new Error("example pnp requires die_geometry");
  }
  return processPnp(state, dieState, values.coordinates);
}
