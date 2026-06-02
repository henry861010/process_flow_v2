import { addExampleMoldingLayer } from "./shared.js";

const MOLDING1_THICKNESS = 120;

export async function execute({ status, values }) {
  return addExampleMoldingLayer(status, {
    material: values.material,
    density: values.density,
    thk: MOLDING1_THICKNESS,
  });
}
