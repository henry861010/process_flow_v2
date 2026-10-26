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
export function removeRecipe(configuration: StepConfiguration, recipeId: string): StepConfiguration {
  const removedIndex = configuration.recipeCandidates.findIndex((recipe) => recipe.recipeId === recipeId);
  const recipeCandidates = configuration.recipeCandidates.filter((recipe) => recipe.recipeId !== recipeId);
  const selectedRecipeId = configuration.selectedRecipeId === recipeId
    ? (recipeCandidates[removedIndex] ?? recipeCandidates[removedIndex - 1])?.recipeId ?? null
    : configuration.selectedRecipeId;
  return { recipeCandidates, selectedRecipeId };
}
