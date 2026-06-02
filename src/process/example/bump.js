import { addExampleBump } from "./shared.js";

export async function execute({ status, values }) {
  return addExampleBump(status, {
    material: values.material,
    density: values.density,
    thk: values.thk,
  });
}
