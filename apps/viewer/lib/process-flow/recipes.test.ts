import { describe, expect, it } from "vitest";
import { createRecipe, createStepConfiguration, removeRecipe, selectedRecipe } from "./recipes";
import { flowAuthoringIssues } from "./flow-editor-save";
import type { ParameterDefinition, ProcessStepTemplate } from "./types";
const definitions: ParameterDefinition[] = [{ id: "layers", name: "Layers", valueType: "string[]", defaultValue: ["Cu"] }, { id: "thk", name: "Thickness", valueType: "float", required: true }];
describe("recipe candidates", () => {
  it("captures defaults once and adopts the initial recipe", () => {
    const config = createStepConfiguration(definitions);
    expect(selectedRecipe(config)?.parameterValues).toEqual({ layers: ["Cu"] });
    (config.recipeCandidates[0].parameterValues.layers as string[]).push("PI");
    expect(definitions[0].defaultValue).toEqual(["Cu"]);
    expect(selectedRecipe(undefined)).toBeNull();
  });
  it("keeps adding and editing independent from adoption", () => {
    const config = createStepConfiguration(definitions);
    const before = structuredClone(selectedRecipe(config));
    const other = createRecipe(definitions, "Recipe 2");
    config.recipeCandidates.push(other);
    other.parameterValues.thk = 10;
    expect(other.parameterValues.layers).toEqual(["Cu"]);
    expect(selectedRecipe(config)).toEqual(before);
    config.selectedRecipeId = other.recipeId;
    expect(selectedRecipe(config)?.parameterValues.thk).toBe(10);
  });
  it("adopts the next candidate, then the previous candidate, when deleting the adopted one", () => {
    const config = createStepConfiguration(definitions);
    const second = createRecipe(definitions, "Recipe 2");
    const third = createRecipe(definitions, "Recipe 3");
    config.recipeCandidates.push(second, third);
    const afterFirst = removeRecipe(config, config.selectedRecipeId!);
    expect(afterFirst.selectedRecipeId).toBe(second.recipeId);
    const afterLast = removeRecipe({ ...afterFirst, selectedRecipeId: third.recipeId }, third.recipeId);
    expect(afterLast.selectedRecipeId).toBe(second.recipeId);
    const empty = removeRecipe(afterLast, second.recipeId);
    expect(empty.selectedRecipeId).toBeNull();
    expect(selectedRecipe(empty)).toBeNull();
  });
  it("preserves an existing unselected state when deleting another candidate", () => {
    const config = createStepConfiguration(definitions);
    config.selectedRecipeId = null;
    config.recipeCandidates.push(createRecipe(definitions, "Recipe 2"));
    expect(removeRecipe(config, config.recipeCandidates[0].recipeId).selectedRecipeId).toBeNull();
  });
  it("allows incomplete candidates but checks supplied names and types in every candidate", () => {
    const step = { id: "step", parameterDefinitions: definitions } as ProcessStepTemplate;
    const definition = { flowInputs: [], stepRefs: [{ stepRefId: "a", processStepTemplateId: "step" }], flowEdges: [] };
    const config = createStepConfiguration(definitions);
    const configuration = { inputBindings: {}, stepConfigurations: { a: config } };
    expect(flowAuthoringIssues(definition, [step], configuration)).toEqual([]);
    const other = createRecipe(definitions); config.recipeCandidates.push(other);
    other.parameterValues.thk = "invalid";
    expect(flowAuthoringIssues(definition, [step], configuration).join()).toContain("Thickness");
    delete other.parameterValues.thk; other.parameterValues.unknown = 1;
    expect(flowAuthoringIssues(definition, [step], configuration).join()).toContain("unknown");
  });
});
