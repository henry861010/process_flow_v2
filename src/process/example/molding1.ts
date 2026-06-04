import { addExampleMoldingLayer } from "./shared.js";

const MOLDING1_THICKNESS = 120;

export async function execute({ state, values }) {
  return addExampleMoldingLayer(state, {
    material: values.material,
    density: values.density,
    thk: MOLDING1_THICKNESS,
  });
}
