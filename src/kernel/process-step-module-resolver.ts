/**
 * Resolves a process step template to the JavaScript module that implements it.
 *
 * `program` is an extensionless module path relative to `src/process`.
 */
export class ProcessStepModuleResolver {
  private _importModule: (specifier: string, stepTemplate?: any) => Promise<any>;

  /**
   * @param {object} options
   * @param {?Function} options.importModule - Optional import hook for tests.
   */
  constructor({ importModule = null }: { importModule?: ((specifier: string, stepTemplate?: any) => Promise<any>) | null } = {}) {
    this._importModule = importModule ?? defaultImportModule;
  }

  /**
   * Build the module URL for one process step template.
   */
  moduleSpecifier(stepTemplate: any): string {
    if (!stepTemplate?.id) {
      throw new Error("Process step template is missing id");
    }
    const program = validateProgramPath(stepTemplate);

    return new URL(
      `../process/${program}.js`,
      import.meta.url,
    ).href;
  }

  /**
   * Import the process module and verify that it exports `execute(ctx)`.
   */
  async resolve(stepTemplate: any): Promise<{ execute: (context: any) => any; specifier: string }> {
    const specifier = this.moduleSpecifier(stepTemplate);
    let module;
    try {
      module = await this._importModule(specifier, stepTemplate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to load process step module for ${stepTemplate.id} from ${specifier}: ${message}`,
      );
    }
    if (typeof module.execute !== "function") {
      throw new Error(
        `Process step module for ${stepTemplate.id} must export execute(ctx)`,
      );
    }
    return {
      execute: module.execute,
      specifier,
    };
  }
}

/**
 * Default dynamic import used in runtime code.
 */
function defaultImportModule(specifier: string): Promise<any> {
  return Function("specifier", "return import(specifier)")(specifier);
}

const PROCESS_PROGRAM_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

function validateProgramPath(stepTemplate: any): string {
  const program = stepTemplate?.program;
  if (typeof program !== "string" || program.trim() === "") {
    throw new Error(`Process step template ${stepTemplate.id} is missing program`);
  }
  if (program !== program.trim()) {
    throw new Error(
      `Process step template ${stepTemplate.id} program must be an extensionless path relative to src/process`,
    );
  }
  if (
    program.startsWith("/") ||
    program.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(program)
  ) {
    throw new Error(
      `Process step template ${stepTemplate.id} program must be relative to src/process`,
    );
  }
  if (program.endsWith(".js")) {
    throw new Error(
      `Process step template ${stepTemplate.id} program must not include .js`,
    );
  }

  const segments = program.split("/");
  if (
    segments.some((segment) => {
      return (
        segment === "" ||
        segment === ".." ||
        !PROCESS_PROGRAM_SEGMENT_RE.test(segment)
      );
    })
  ) {
    throw new Error(
      `Process step template ${stepTemplate.id} program must be an extensionless path relative to src/process`,
    );
  }
  return program;
}
