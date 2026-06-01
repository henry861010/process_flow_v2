import { processMolding } from "../../process-molding.js";

export async function execute({ status, values }) {
  return processMolding(status, values.mold_compound, values.mold_thickness);
}
