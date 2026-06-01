export class ProcessStepModuleResolver {
  constructor({ importModule = null } = {}) {
    this._importModule = importModule ?? defaultImportModule;
  }

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

function defaultImportModule(specifier) {
  return import(specifier);
}
