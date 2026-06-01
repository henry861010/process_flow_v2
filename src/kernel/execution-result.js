import { convertCad } from "../exporters/cad.js";
import { deepCopy, normalizeGeometryDocument } from "../data/schema.js";

export class GeometryKernelExecutionResult {
  constructor({
    geometryDocument,
    stepOutputs = new Map(),
    terminalStepRefIds = [],
  }) {
    this._geometryDocument = normalizeGeometryDocument(geometryDocument);
    this._stepOutputs = new Map(stepOutputs);
    this._terminalStepRefIds = [...terminalStepRefIds];
  }

  geometry() {
    return deepCopy(this._geometryDocument);
  }

  stepOutput(stepRefId) {
    const output = this._stepOutputs.get(stepRefId);
    return output === undefined ? null : deepCopy(output);
  }

  terminalStepRefIds() {
    return [...this._terminalStepRefIds];
  }

  async glb(options = {}) {
    return this.cad("glb", options);
  }

  async cad(format = "step", options = {}) {
    const normalizedFormat = normalizeCadFormat(format);
    const result = await convertCad(this._geometryDocument, {
      ...options,
      formats: [normalizedFormat],
    });
    return result.files[normalizedFormat];
  }
}

function normalizeCadFormat(format) {
  const normalized = String(format).toLowerCase();
  if (normalized === "gltf") return "glb";
  if (normalized === "stp") return "step";
  return normalized;
}
