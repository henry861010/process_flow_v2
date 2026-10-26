import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FlowConfiguration, ProcessStepTemplate } from "@/lib/process-flow/types";
import { StepInspector } from "./process-flow-editor";

const placement = {
  targetRegion: { type: "rectangle", bottomLeftX: 0, bottomLeftY: 0, topRightX: 10, topRightY: 5 },
  pose: { x: 0, y: 0, rotationZ: 0 }, anchor: "center",
};
const template = {
  name: "PnP", description: "Step template description",
  parameterDefinitions: [
    { id: "placements", name: "Placements", valueType: "placements", controlType: "placementList", description: "Parameter description" },
    { id: "thickness", name: "Thickness", valueType: "float" },
  ],
} as ProcessStepTemplate;
const node = {
  data: { stepRef: { stepRefId: "step-1", stepLabel: "PnP", processStepTemplateId: "pnp" }, stepTemplate: template },
} as Parameters<typeof StepInspector>[0]["node"];
const recipes = [
  { recipeId: "r1", name: "Recipe 1", description: "Recipe description", parameterValues: { placements: [placement], thickness: 10 } },
  { recipeId: "r2", name: "Recipe 2", description: "Other recipe description", parameterValues: { placements: [], thickness: 20 } },
];

function render(selectedRecipeId: string | null) {
  const configuration: FlowConfiguration = {
    inputBindings: {}, stepConfigurations: { "step-1": { recipeCandidates: recipes, selectedRecipeId } },
  };
  return renderToStaticMarkup(<StepInspector node={node} topologyLocked={false} configuration={configuration}
    onLabelChange={() => {}} onConfigurationChange={() => {}} onPreview={() => {}}
    onDelete={() => {}} previewAvailability={{ ok: true }} />);
}

describe("process step recipe presentation", () => {
  it("shows step details first, then active values and the candidate cards", () => {
    const html = render("r1");
    expect(html.indexOf("Step details")).toBeLessThan(html.indexOf("Active recipe"));
    expect(html.indexOf("Active recipe")).toBeLessThan(html.indexOf("Candidate recipes"));
    expect(html).toContain("Step label");
    expect(html).not.toContain("step-1");
    expect(html).not.toMatch(/<summary[^>]*>Step details<\/summary>/);
    expect(html).toContain('data-placement-index="0"');
    expect(html).not.toContain("data-placement-card");
    expect(html).toContain("10");
    expect(html).not.toContain("Recipe description");
    expect(html).not.toContain("Parameter description");
    expect(html).toContain("Recipe 2");
    expect(html).not.toContain(">20<");
    expect(html).not.toContain("Copy recipe");
    expect(html).toContain('aria-label="Open recipe Recipe 1"');
    expect(html).toContain('aria-label="Edit recipe Recipe 1"');
    expect(html).toContain('aria-label="Delete recipe Recipe 1"');
  });

  it("asks for an explicit adoption when a legacy flow has candidates but no selection", () => {
    const html = render(null);
    expect(html).toContain("Choose a recipe");
    expect(html).toContain("Choose a recipe to apply to this step.");
  });

  it("labels adoption options with recipe names while retaining IDs as values", () => {
    const html = render("r1");
    expect(html).toContain('<option value="r1" selected="">Recipe 1</option>');
    expect(html).toContain('<option value="r2">Recipe 2</option>');
    expect(html).not.toContain('Recipe 1 (r1)</option>');
  });
});
