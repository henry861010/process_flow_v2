import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InstanceRecipeDialog } from "./instance-recipe-dialog";
import { recipeDraftFromSource } from "./new-instance-recipe-dialog";
import type { InstanceStepConfiguration, ProcessStepTemplate } from "@/lib/process-flow/types";

const station: InstanceStepConfiguration = {
  activeRecipeId: "active-id",
  recipes: [
    { id: "active-id", name: "Current", description: "Active details", createdAt: "2026-10-21T00:00:00Z", parameterValues: { value: "active-value", nested: { items: [1] } } },
    { id: "candidate-id", name: "Candidate", description: "Hidden candidate details", createdAt: "2026-10-21T01:00:00Z", parameterValues: {} },
  ],
};
const template: ProcessStepTemplate = {
  schemaVersion: 2, status: "enabled", id: "step", version: "V1", owner: "test", name: "Template name", description: "Step description",
  category: "test", program: "test", inputPorts: [], outputPorts: [],
  parameterDefinitions: [{ id: "value", name: "Value", valueType: "string", required: true }],
};
function render(configuration = station) {
  return renderToStaticMarkup(<InstanceRecipeDialog label="Custom step label" station={configuration} template={template}
    defaults={{ value: "default-value" }} busy={false} error={null} onAdd={async () => station.recipes[0]}
    onActivate={async () => {}} onClose={() => {}} />);
}

describe("station recipe dialog", () => {
  it("opens with actual active parameters above compact, collapsed recipe rows", () => {
    const html = render();
    expect(html).toContain("Custom step label");
    expect(html).toContain("Step description");
    expect(html).not.toContain("Template name");
    expect(html.indexOf('value="active-value"')).toBeLessThan(html.indexOf('aria-label="Station recipes"'));
    expect(html).toContain("Candidate");
    expect(html).toContain("candidate-id");
    expect(html).not.toContain("Hidden candidate details");
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
  it("keeps only Add recipe and disabled Set active in the footer", () => {
    const html = render();
    const footer = html.slice(html.indexOf("<footer"));
    expect(footer.match(/<button/g)).toHaveLength(2);
    expect(footer).toContain("Add recipe");
    expect(footer).toMatch(/<button[^>]*disabled=""[^>]*>Set active/);
    expect(html).not.toContain("Clear active");
  });
  it("allows an empty station to start by adding its first recipe", () => {
    const html = render({ recipes: [], activeRecipeId: null });
    expect(html).toContain("No active recipe yet");
    expect(html).toContain("No recipes yet");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Set active/);
  });
  it("starts from copied defaults without changing nested defaults", () => {
    const defaults = { placements: [], nested: { items: [2] } };
    const draft = recipeDraftFromSource(station, defaults, "");
    expect(draft).toEqual({ name: "Recipe 3", description: "", parameterValues: defaults, activate: false });
    (draft.parameterValues.nested as { items: number[] }).items.push(3);
    expect(defaults.nested.items).toEqual([2]);
  });
  it("copies stored parameters exactly, including incomplete values, without applying defaults", () => {
    expect(recipeDraftFromSource(station, { value: "default" }, "candidate-id")).toEqual({
      name: "Candidate copy", description: "Hidden candidate details", parameterValues: {}, activate: false,
    });
    const draft = recipeDraftFromSource(station, {}, "active-id");
    (draft.parameterValues.nested as { items: number[] }).items.push(9);
    expect(station.recipes[0].parameterValues.nested).toEqual({ items: [1] });
  });
});
