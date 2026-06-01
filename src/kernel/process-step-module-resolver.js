/**
 * Resolves a process step template to the JavaScript module that implements it.
 *
 * The default convention is:
 *   src/process/<category path>/<step template id>.js
 *
 * Example: category `encapsulation.molding` and id
 * `step_tpl_molding_encapsulation` resolves to
 * `src/process/encapsulation/molding/step_tpl_molding_encapsulation.js`.
 */
export class ProcessStepModuleResolver {
  /**
   * @param {object} options
   * @param {?Function} options.importModule - Optional import hook for tests.
   */
  constructor({ importModule = null } = {}) {
    this._importModule = importModule ?? defaultImportModule;
  }

  /**
   * Build the module URL for one process step template.
   */
  moduleSpecifier(stepTemplate) {
    if (!stepTemplate?.id) {
      throw new Error("Process step template is missing id");
    }
    if (!stepTemplate?.category) {
      throw new Error(`Process step template ${stepTemplate.id} is missing category`);
    }

    const categoryPath = stepTemplate.category.split(".").join("/");
    return new URL(
      `../process/${categoryPath}/${stepTemplate.id}.js`,
      import.meta.url,
    ).href;
  }

  /**
   * Import the process module and verify that it exports `execute(ctx)`.
   */
  async resolve(stepTemplate) {
    const specifier = this.moduleSpecifier(stepTemplate);
    let module;
    try {
      module = await this._importModule(specifier, stepTemplate);
    } catch (error) {
      throw new Error(
        `Unable to load process step module for ${stepTemplate.id} from ${specifier}: ${error.message}`,
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
function defaultImportModule(specifier) {
  return Function("specifier", "return import(specifier)")(specifier);
}
