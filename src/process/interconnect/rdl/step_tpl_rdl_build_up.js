import { processRdl } from "../../process-rdl.js";

export async function execute({ state, values }) {
  return processRdl(state, values.rdl_layers ?? []);
}
