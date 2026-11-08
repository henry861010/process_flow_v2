import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import templates from "../../../api/src/process_flow_api/fixtures/process-step-templates.json";
import type { ProcessStepTemplate } from "@/lib/process-flow/types";
import { StepTemplateDetails } from "@/components/process-flow-fields/step-template-details";
import { ParameterValueEditor } from "./parameter-value-editor";
import { RecipeParameterSummary } from "./recipe-parameter-summary";

describe("TIM templates in the existing viewer controls", () => {
  it.each(["tim1", "tim2"])("renders %s material and thickness for editing and recipe review", (program) => {
    const template = templates.find((item) => item.program === `layer/${program}`)! as ProcessStepTemplate;
    const parameterValues = { material: "TIM-Custom", thickness: 12.5 };
    const html = renderToStaticMarkup(<>
      <StepTemplateDetails template={template} />
      <ParameterValueEditor definitions={template.parameterDefinitions} values={parameterValues} onChange={() => {}} />
      <RecipeParameterSummary definitions={template.parameterDefinitions} recipe={{
        recipeId: "recipe", name: "TIM recipe", description: "", parameterValues,
      }} />
    </>);
    expect(html).toContain(program.toUpperCase());
    expect(html).toContain("TIM material");
    expect(html).toContain("TIM thickness");
    expect(html).toContain('value="TIM-Custom"');
    expect(html).toContain('type="number"');
    expect(html).toContain('value="12.5"');
    expect(html).toContain("um");
    expect(html).not.toContain("No parameters");
  });
});
