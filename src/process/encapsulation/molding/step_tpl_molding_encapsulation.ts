import { processMolding } from "../../process-molding.js";

export async function execute({ state, values }) {
  return processMolding(state, values.mold_compound, values.mold_thickness);
}
