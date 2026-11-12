// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ParameterValueEditor } from "./parameter-value-editor";
import { isConfigurationComplete, isParameterValueComplete } from "@/lib/process-flow/configuration";
import { flowAuthoringIssues } from "@/lib/process-flow/flow-editor-save";
import { normalizeFlowConfiguration } from "@/lib/process-flow/parameter-values";
import type { FlowConfiguration, ParameterDefinition, ProcessStepTemplate } from "@/lib/process-flow/types";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

function changeInput(name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  expect(input).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("parameter editor missing values", () => {
  it("fills, clears, saves and reloads an optional number as an omitted key ready for execution", () => {
    const definitions: ParameterDefinition[] = [{ id: "amount", name: "Amount", valueType: "float", required: false, validation: { min: 0 } }];
    let values: Record<string, unknown> = {};
    const render = () => root.render(<ParameterValueEditor definitions={definitions} values={values}
      onChange={(next) => { values = next; render(); }} />);
    act(render);
    changeInput("Amount", "12.5");
    expect(values).toEqual({ amount: 12.5 });
    changeInput("Amount", "");
    expect(values).toEqual({});

    const definition = { flowInputs: [], stepRefs: [{ stepRefId: "a", processStepTemplateId: "step" }], flowEdges: [] };
    const steps = [{ id: "step", name: "Step", parameterDefinitions: definitions, inputPorts: [], outputPorts: [] }] as unknown as ProcessStepTemplate[];
    const configuration: FlowConfiguration = { inputBindings: {}, stepConfigurations: { a: {
      selectedRecipeId: "r", recipeCandidates: [{ recipeId: "r", name: "Recipe", description: "", parameterValues: values }],
    } } };
    expect(flowAuthoringIssues(definition, steps, configuration)).toEqual([]);
    const saved = JSON.stringify(normalizeFlowConfiguration(definition, steps, configuration));
    const reloaded = normalizeFlowConfiguration(definition, steps, JSON.parse(saved));
    expect(reloaded.stepConfigurations.a.recipeCandidates[0].parameterValues).toEqual({});
    expect(isConfigurationComplete(definition, steps, reloaded, [])).toBe(true);
  });

  it("removes a nested child slot while keeping every group item, index and sibling value", () => {
    const definition: ParameterDefinition = {
      id: "layers", name: "Layers", valueType: "fieldGroupArray", repeatDefinition: {
        indexBase: 0, itemNameTemplate: "Layer {{index}}", itemParameterDefinitions: [{
          id: "nested", name: "Nested", valueType: "fieldGroupArray", repeatDefinition: {
            indexBase: 0, itemNameTemplate: "Child {{index}}", itemParameterDefinitions: [
              { id: "amount", name: "Nested amount", valueType: "float", required: false },
              { id: "enabled", name: "Enabled", valueType: "boolean", controlType: "checkbox" },
              { id: "tags", name: "Tags", valueType: "string[]" },
            ],
          },
        }],
      },
    };
    let values: Record<string, unknown> = { layers: { items: [{ itemId: "parent", index: 0, values: { nested: { items: [
      { itemId: "child", index: 0, values: { amount: 2, enabled: false, tags: [] } },
    ] } } }] } };
    const render = () => root.render(<ParameterValueEditor definitions={[definition]} values={values}
      onChange={(next) => { values = next; render(); }} />);
    act(render);
    changeInput("Nested amount", "0");
    expect(JSON.stringify(values)).toContain('"amount":0');
    changeInput("Nested amount", "");
    expect(values).toEqual({ layers: { items: [{ itemId: "parent", index: 0, values: { nested: { items: [
      { itemId: "child", index: 0, values: { enabled: false, tags: [] } },
    ] } } }] } });
  });

  it("keeps a nonempty invalid numeric value so authoring validation still reports it", () => {
    const definitions: ParameterDefinition[] = [{ id: "amount", name: "Amount", valueType: "float", required: false, validation: { min: 0 } }];
    let values: Record<string, unknown> = {};
    const render = () => root.render(<ParameterValueEditor definitions={definitions} values={values}
      onChange={(next) => { values = next; render(); }} />);
    act(render);
    changeInput("Amount", "-2");
    expect(values).toEqual({ amount: -2 });
    const definition = { flowInputs: [], stepRefs: [{ stepRefId: "a", processStepTemplateId: "step" }], flowEdges: [] };
    const steps = [{ id: "step", parameterDefinitions: definitions }] as ProcessStepTemplate[];
    expect(flowAuthoringIssues(definition, steps, { inputBindings: {}, stepConfigurations: { a: {
      selectedRecipeId: "r", recipeCandidates: [{ recipeId: "r", name: "Recipe", description: "", parameterValues: values }],
    } } }).join()).toContain("Amount");
  });

  it("retains empty elements in nonempty collection input and keeps a cleared collection as []", () => {
    const definition: ParameterDefinition = { id: "counts", name: "Counts", valueType: "integer[]", required: false };
    let values: Record<string, unknown> = {};
    const render = () => root.render(<ParameterValueEditor definitions={[definition]} values={values}
      onChange={(next) => { values = next; render(); }} />);
    act(render);
    changeInput("Counts", "1,,2units");
    expect(values).toEqual({ counts: [1, "", "2units"] });
    expect(JSON.parse(JSON.stringify(values))).toEqual(values);
    expect(isParameterValueComplete(definition, values.counts)).toBe(false);
    changeInput("Counts", "");
    expect(values).toEqual({ counts: [] });
    expect(isParameterValueComplete(definition, values.counts)).toBe(true);
    expect(isParameterValueComplete({ id: "tags", name: "Tags", valueType: "string[]", required: false }, [""])).toBe(false);
  });
});
