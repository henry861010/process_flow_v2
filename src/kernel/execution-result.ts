import { deepCopy, normalizeGeometryStructure } from "../data/schema.js";

/**
 * Immutable-style wrapper returned by `GeometryKernel.execute()`.
 *
 * It exposes the final geometry JSON for DB storage and lazy CAD exports for
 * viewers. Callers receive copies so they cannot mutate the stored result.
 */
export class GeometryKernelExecutionResult {
  private _geometryStructure: any;
  private _stepOutputs: Map<string, any>;
  private _terminalStepRefIds: string[];

  /**
   * Store the final geometry plus all intermediate step outputs.
   */
  constructor({
    geometryStructure,
    stepOutputs = new Map(),
    terminalStepRefIds = [],
  }: any) {
    this._geometryStructure = normalizeGeometryStructure(geometryStructure);
    this._stepOutputs = new Map(stepOutputs);
    this._terminalStepRefIds = [...terminalStepRefIds];
  }

  /**
   * Return the selected output geometry as normalized JSON.
   */
  geometry(): any {
    return deepCopy(this._geometryStructure);
  }

  /**
   * Return an intermediate step output by stepRefId, or null if it is missing.
   */
  stepOutput(stepRefId: string): any {
    const output = this._stepOutputs.get(stepRefId);
    return output === undefined ? null : deepCopy(output);
  }

  /**
   * Return stepRefIds that are terminal outputs of the executed flow.
   */
  terminalStepRefIds(): string[] {
    return [...this._terminalStepRefIds];
  }

  /**
   * Export the final geometry to binary GLB bytes for 3D display.
   */
  async glb(options: Record<string, any> = {}): Promise<any> {
    return this.cad("glb", options);
  }

  /**
   * Export the final geometry to one CAD format and return the generated file.
   */
  async cad(format = "step", options: Record<string, any> = {}): Promise<any> {
    const normalizedFormat = normalizeCadFormat(format);
    const { convertCad } = await importRuntime(
      resolveRuntimeUrl(import.meta.url, "../exporters/cad.js"),
    );
    const result = await convertCad(this._geometryStructure, {
      ...options,
      formats: [normalizedFormat],
    });
    return result.files[normalizedFormat];
  }
}

/**
 * Support common CAD aliases while keeping exporter format names consistent.
 */
function normalizeCadFormat(format: string): string {
  const normalized = String(format).toLowerCase();
  if (normalized === "gltf") return "glb";
  if (normalized === "stp") return "step";
  return normalized;
}

function importRuntime(specifier: string): Promise<any> {
  return Function("specifier", "return import(specifier)")(specifier);
}

function resolveRuntimeUrl(baseUrl: string, relativePath: string): string {
  return Function("baseUrl", "relativePath", "return new URL(relativePath, baseUrl).href")(
    baseUrl,
    relativePath,
  );
}
