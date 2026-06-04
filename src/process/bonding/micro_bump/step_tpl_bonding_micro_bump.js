import { processUbump } from "../../process-ubump.js";

export async function execute({ state }) {
  return processUbump(state, "solder", 0.65);
}
