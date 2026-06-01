import { processUbump } from "../../process-ubump.js";

export async function execute({ status }) {
  return processUbump(status, "solder", 0.65);
}
