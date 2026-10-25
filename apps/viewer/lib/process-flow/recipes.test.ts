import { describe, expect, it } from "vitest";
import { copyRecipe, createRecipe, createStepConfiguration, removeRecipe, selectedRecipe } from "./recipes";
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
  it("keeps adding, copying and editing independent from adoption", () => {
    const config = createStepConfiguration(definitions);
    const before = structuredClone(selectedRecipe(config));
    const other = createRecipe(definitions, "Recipe 2");
    config.recipeCandidates.push(other);
    other.parameterValues.thk = 10;
    const duplicate = copyRecipe(other);
    (duplicate.parameterValues.layers as string[]).push("other");
    expect(duplicate.recipeId).not.toBe(other.recipeId);
    expect(other.parameterValues.layers).toEqual(["Cu"]);
    expect(selectedRecipe(config)).toEqual(before);
    config.selectedRecipeId = other.recipeId;
    expect(selectedRecipe(config)?.parameterValues.thk).toBe(10);
  });
  it("clears adoption when deleting the adopted candidate without falling back", () => {
    const config = createStepConfiguration(definitions);
    config.recipeCandidates.push(createRecipe(definitions));
    const result = removeRecipe(config, config.selectedRecipeId!);
    expect(result.recipeCandidates).toHaveLength(1);
    expect(result.selectedRecipeId).toBeNull(); expect(selectedRecipe(result)).toBeNull();
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
