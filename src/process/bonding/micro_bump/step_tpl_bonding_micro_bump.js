import { processUbump } from "../../process-ubunp.js";

export async function execute({ status }) {
  return processUbump(status, "solder", 0.65);
}
