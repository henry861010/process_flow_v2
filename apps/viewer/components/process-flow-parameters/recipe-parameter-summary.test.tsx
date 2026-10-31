import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import stepTemplates from "../../../api/src/process_flow_api/fixtures/process-step-templates.json";
import type { ParameterDefinition } from "@/lib/process-flow/types";
import { RecipeParameterSummary } from "./recipe-parameter-summary";

const rdl = stepTemplates.find((step) => step.id === "step_tpl_rdl")!.parameterDefinitions[0] as ParameterDefinition;
const customGroup: ParameterDefinition = {
  id: "cycles", name: "Process cycles", valueType: "fieldGroupArray",
  repeatDefinition: {
    itemNameTemplate: "Cycle {{index}}", indexBase: 3,
    itemParameterDefinitions: [
      { id: "duration", name: "Duration", valueType: "float", unit: "s" },
      { id: "enabled", name: "Enabled", valueType: "boolean" },
      { id: "materials", name: "Materials", valueType: "materialRef[]" },
    ],
  },
};

function render(definition: ParameterDefinition, value: unknown) {
  return renderToStaticMarkup(<RecipeParameterSummary definitions={[definition]} recipe={{
    recipeId: "test-recipe", name: "Test recipe", parameterValues: { [definition.id]: value },
  }} />);
}

function row(values: Record<string, unknown>, index = 3) {
  return { itemId: `private-row-${index}`, index, values };
}

describe("recipe parameter summaries", () => {
  it("renders the actual RDL fixture as an ordered table with schema headings and units", () => {
    const before = JSON.stringify(rdl);
    const html = render(rdl, rdl.defaultValue);
    expect(html).toContain('<caption class="sr-only">layers</caption>');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    const headings = ["Item", "Dielectric", "Conductivity", "thk / um", "density"];
    const header = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
    headings.forEach((heading, index) => {
      expect(header).toContain(`>${heading}</th>`);
      if (index) expect(header.indexOf(`>${heading}</th>`)).toBeGreaterThan(header.indexOf(`>${headings[index - 1]}</th>`));
    });
    expect(html.indexOf("RDL layer 1")).toBeLessThan(html.indexOf("RDL layer 2"));
    expect(html).toContain(">PI-2611</span>");
    expect(html).toContain(">Cu</span>");
    expect(html).toContain(">8</span>");
    expect(html).toContain(">62</span>");
    expect(html).not.toContain("layers_item_");
    expect(html).not.toContain("&quot;items&quot;");
    expect(html).not.toContain("&quot;values&quot;");
    expect(JSON.stringify(rdl)).toBe(before);
  });

  it("uses arbitrary definitions, stored row order and indices, and retains zero and false", () => {
    const value = { items: [
      row({ duration: 0, enabled: false, materials: ["Silicon", "Copper"] }, 9),
      row({ duration: 12, enabled: true, materials: [] }, 4),
    ] };
    const before = JSON.stringify(value);
    const html = render(customGroup, value);
    expect(html).toContain("Duration / s");
    expect(html).toContain("Enabled");
    expect(html).toContain("Materials");
    expect(html).toContain(">0</span>");
    expect(html).toContain(">False</span>");
    expect(html).toContain(">True</span>");
    expect(html).toContain("<ul");
    expect(html.indexOf("Silicon")).toBeLessThan(html.indexOf("Copper"));
    expect(html).toContain("No items");
    expect(html.indexOf("Cycle 9")).toBeLessThan(html.indexOf("Cycle 4"));
    expect(html).not.toContain("private-row-");
    expect(JSON.stringify(value)).toBe(before);
  });

  it("recursively renders nested groups and placement previews without editing controls", () => {
    const nested: ParameterDefinition = {
      ...customGroup, repeatDefinition: { ...customGroup.repeatDefinition!, itemParameterDefinitions: [
        { ...rdl, id: "stack", name: "Stack" },
        { id: "sites", name: "Sites", valueType: "placements", unit: "um" },
      ] },
    };
    const html = render(nested, { items: [row({ stack: rdl.defaultValue, sites: [{
      targetRegion: { type: "rectangle", bottomLeftX: 0, bottomLeftY: 0, topRightX: 10, topRightY: 5 },
      pose: { x: 0, y: 0, rotationZ: 0 }, anchor: "center",
    }] })] });
    expect(html.match(/<table /g)).toHaveLength(2);
    expect(html).toContain("Cycle 3");
    expect(html).toContain("RDL layer 1");
    expect(html).toContain('<caption class="sr-only">Stack</caption>');
    expect(html).toContain('data-placement-index="0"');
    expect(html).not.toContain("data-placement-card");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Import CSV");
    expect(html).not.toContain("private-row-");
  });

  it.each([undefined, null, ""])("shows Not set for an absent group (%s)", (value) => {
    expect(render(customGroup, value)).toContain(">Not set</span>");
  });

  it("shows No items for an empty group without creating default rows", () => {
    const html = render(customGroup, { items: [] });
    expect(html).toContain(">No items</span>");
    expect(html).not.toContain("Cycle 3");
    expect(html).not.toContain("<table");
  });

  it.each([
    "invalid", [], {}, { items: null }, { items: [null] },
    { items: [{ index: 3, values: {} }] },
    { items: [{ itemId: "hidden", index: "3", values: {} }] },
    { items: [{ itemId: "hidden", index: NaN, values: {} }] },
    { items: [{ itemId: "hidden", index: 3, values: [] }] },
  ])("shows Invalid value for malformed group data (%j)", (value) => {
    const html = render(customGroup, value);
    expect(html).toContain(">Invalid value</span>");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("hidden");
  });

  it("reports missing group definitions without falling back to JSON", () => {
    const html = render({ ...customGroup, repeatDefinition: undefined }, { items: [row({ duration: 1 })] });
    expect(html).toContain(">Invalid value</span>");
    expect(html).not.toContain("private-row-");
  });

  it("handles missing or malformed children locally, preserving other row values", () => {
    const html = render(customGroup, { items: [
      row({ enabled: false, materials: { secret: "never serialize" } }),
      row({ duration: { secret: "never serialize" }, materials: [0, false] }, 4),
    ] });
    expect(html).toContain(">Not set</span>");
    expect(html).toContain(">Invalid value</span>");
    expect(html).toContain(">False</span>");
    expect(html).toContain(">0</span>");
    expect(html).not.toContain("never serialize");
    expect(html).toContain("Cycle 4");
  });

  it("keeps nested missing, empty and invalid groups local to their cells", () => {
    const definition: ParameterDefinition = {
      ...customGroup, repeatDefinition: { ...customGroup.repeatDefinition!, itemParameterDefinitions: [customGroup] },
    };
    const html = render(definition, { items: [
      row({}, 3), row({ cycles: { items: [] } }, 4), row({ cycles: { items: [null] } }, 5),
    ] });
    expect(html.match(/<table /g)).toHaveLength(1);
    expect(html).toContain("Cycle 3");
    expect(html).toContain("Cycle 4");
    expect(html).toContain("Cycle 5");
    expect(html).toContain(">Not set</span>");
    expect(html).toContain(">No items</span>");
    expect(html).toContain(">Invalid value</span>");
  });

  it("renders scalar and array values without JSON, escaping user content", () => {
    expect(render({ id: "n", name: "Number", valueType: "float" }, 0)).toContain(">0</span>");
    expect(render({ id: "b", name: "Boolean", valueType: "boolean" }, false)).toContain(">False</span>");
    expect(render({ id: "s", name: "String", valueType: "string" }, "<script>unsafe</script>"))
      .toContain("&lt;script&gt;unsafe&lt;/script&gt;");
    expect(render({ id: "a", name: "Array", valueType: "float[]" }, [0, 1.25])).toContain("<ul");
    expect(render({ id: "a", name: "Array", valueType: "float[]" }, 123)).toContain(">Invalid value</span>");
  });

  it("provides an accessible keyboard-scrollable table with bounded wrapping columns", () => {
    const html = render(customGroup, { items: [row({ materials: ["VeryLongMaterialName".repeat(20)] })] });
    expect(html).toContain('role="region" aria-label="Process cycles items" tabindex="0"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("max-w-full");
    expect(html).toContain("table-fixed");
    expect(html).toContain("[overflow-wrap:anywhere]");
  });
});
