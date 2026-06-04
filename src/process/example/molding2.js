import { addExampleMoldingLayer } from "./shared.js";

const MODELING2_THICKNESS = 80;

export async function execute({ state, values }) {
  return addExampleMoldingLayer(state, {
    material: values.material,
    density: values.density,
    thk: MODELING2_THICKNESS,
  });
}
