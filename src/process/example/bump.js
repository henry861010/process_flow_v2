import { addExampleBump } from "./shared.js";

export async function execute({ state, values }) {
  return addExampleBump(state, {
    material: values.material,
    density: values.density,
    thk: values.thk,
  });
}
