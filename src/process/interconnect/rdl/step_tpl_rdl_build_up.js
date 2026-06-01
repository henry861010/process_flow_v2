import { processRdl } from "../../process-rdl.js";

export async function execute({ status, values }) {
  return processRdl(status, values.rdl_layers ?? []);
}
