import { addExampleMoldingLayer } from "./shared.js";

const MODELING2_THICKNESS = 80;

export async function execute({ status, values }) {
  return addExampleMoldingLayer(status, {
    material: values.material,
    density: values.density,
    thk: MODELING2_THICKNESS,
  });
}
