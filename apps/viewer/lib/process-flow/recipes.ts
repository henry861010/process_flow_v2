import type { ParameterDefinition, RecipeCandidate, StepConfiguration } from "./types";
import { createDefaultParameterValues } from "./parameter-values";

export function selectedRecipe(configuration: StepConfiguration | undefined) {
  return configuration?.recipeCandidates.find((recipe) => recipe.recipeId === configuration.selectedRecipeId) ?? null;
}
export function createRecipe(definitions: ParameterDefinition[], name = "Recipe 1"): RecipeCandidate {
  return { recipeId: crypto.randomUUID(), name, description: "", parameterValues: createDefaultParameterValues(definitions) };
}
export function createStepConfiguration(definitions: ParameterDefinition[]): StepConfiguration {
  const recipe = createRecipe(definitions);
  return { recipeCandidates: [recipe], selectedRecipeId: recipe.recipeId };
}
export function copyRecipe(recipe: RecipeCandidate): RecipeCandidate {
  return { ...structuredClone(recipe), recipeId: crypto.randomUUID(), name: `${recipe.name} copy` };
}
export function removeRecipe(configuration: StepConfiguration, recipeId: string): StepConfiguration {
  return { recipeCandidates: configuration.recipeCandidates.filter((recipe) => recipe.recipeId !== recipeId),
    selectedRecipeId: configuration.selectedRecipeId === recipeId ? null : configuration.selectedRecipeId };
}
