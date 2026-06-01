import { deepCopy, normalizeGeometryDocument } from "../data/schema.js";

/**
 * Immutable-style wrapper returned by `GeometryKernel.execute()`.
 *
 * It exposes the final geometry JSON for DB storage and lazy CAD exports for
 * viewers. Callers receive copies so they cannot mutate the stored result.
 */
export class GeometryKernelExecutionResult {
  /**
   * Store the final geometry plus all intermediate step outputs.
   */
  constructor({
    geometryDocument,
    stepOutputs = new Map(),
    terminalStepRefIds = [],
  }) {
    this._geometryDocument = normalizeGeometryDocument(geometryDocument);
    this._stepOutputs = new Map(stepOutputs);
    this._terminalStepRefIds = [...terminalStepRefIds];
  }

  /**
   * Return the selected output geometry as normalized JSON.
   */
  geometry() {
    return deepCopy(this._geometryDocument);
  }

  /**
   * Return an intermediate step output by stepRefId, or null if it is missing.
   */
  stepOutput(stepRefId) {
    const output = this._stepOutputs.get(stepRefId);
    return output === undefined ? null : deepCopy(output);
  }

  /**
   * Return stepRefIds that are terminal outputs of the executed flow.
   */
  terminalStepRefIds() {
    return [...this._terminalStepRefIds];
  }

  /**
   * Export the final geometry to binary GLB bytes for 3D display.
   */
  async glb(options = {}) {
    return this.cad("glb", options);
  }

  /**
   * Export the final geometry to one CAD format and return the generated file.
   */
  async cad(format = "step", options = {}) {
    const normalizedFormat = normalizeCadFormat(format);
    const { convertCad } = await importRuntime(
      resolveRuntimeUrl(import.meta.url, "../exporters/cad.js"),
    );
    const result = await convertCad(this._geometryDocument, {
      ...options,
      formats: [normalizedFormat],
    });
    return result.files[normalizedFormat];
  }
}

/**
 * Support common CAD aliases while keeping exporter format names consistent.
 */
function normalizeCadFormat(format) {
  const normalized = String(format).toLowerCase();
  if (normalized === "gltf") return "glb";
  if (normalized === "stp") return "step";
  return normalized;
}

function importRuntime(specifier) {
  return Function("specifier", "return import(specifier)")(specifier);
}

function resolveRuntimeUrl(baseUrl, relativePath) {
  return Function("baseUrl", "relativePath", "return new URL(relativePath, baseUrl).href")(
    baseUrl,
    relativePath,
  );
}
