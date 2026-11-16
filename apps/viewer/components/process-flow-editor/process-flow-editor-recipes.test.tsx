// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import stepTemplates from "../../../api/src/process_flow_api/fixtures/process-step-templates.json";
import { loadFieldTemplate, writeDataField } from "@/lib/process-flow/data-fields";
import { ApiRequestError } from "@/lib/process-flow-api";
import type { DataFieldDefinition, ProcessStepTemplate, StepConfiguration } from "@/lib/process-flow/types";
import { StepEditorDialog } from "./step-editor-dialog";

vi.mock("@/lib/process-flow/data-fields", async (original) => ({
  ...await original<typeof import("@/lib/process-flow/data-fields")>(),
  loadFieldTemplate: vi.fn(),
  writeDataField: vi.fn(),
}));

const placement = {
  targetRegion: { type: "rectangle", bottomLeftX: 0, bottomLeftY: 0, topRightX: 10, topRightY: 5 },
  pose: { x: 0, y: 0, rotationZ: 0 }, anchor: "center",
};
const template = {
  id: "pnp", name: "PnP", description: "Step template description",
  parameterDefinitions: [
    { id: "placements", name: "Placements", valueType: "placements", controlType: "placementList", description: "Parameter description" },
    { id: "thickness", name: "Thickness", valueType: "float" },
  ],
} as ProcessStepTemplate;
const stepRef = { stepRefId: "step-1", stepLabel: "PnP", processStepTemplateId: "pnp" };
const recipes = [
  { recipeId: "r1", name: "Recipe 1", description: "Recipe description", parameterValues: { placements: [placement], thickness: 10 } },
  { recipeId: "r2", name: "Recipe 2", description: "Other recipe description", parameterValues: { placements: [], thickness: 20 } },
];

type DialogProps = React.ComponentProps<typeof StepEditorDialog>;
let root: Root;
let host: HTMLDivElement;
const update = vi.fn();
const close = vi.fn();

function Editor({ recipeCandidates = recipes, selectedRecipeId = "r1", ...props }: Partial<StepConfiguration> & Partial<DialogProps>) {
  const [configuration, setConfiguration] = React.useState({ recipeCandidates, selectedRecipeId });
  return <StepEditorDialog stepRef={stepRef} template={template} topologyLocked={false} configuration={configuration}
    onClose={close} onStepLabelChange={() => {}} onPreviewStep={() => {}} onDelete={() => {}} stepPreviewAvailability={{ ok: true }}
    onStepConfigurationChange={(...args) => { update(...args); setConfiguration(args[0]); }} {...props} />;
}

async function render(props: React.ComponentProps<typeof Editor> = {}) {
  await act(async () => root.render(<React.StrictMode><Editor {...props} /></React.StrictMode>));
  return host.innerHTML;
}

function button(label: string, container: ParentNode = host) {
  const result = [...container.querySelectorAll("button")].find((control) =>
    !control.closest("[inert]") && (control.getAttribute("aria-label") ?? control.textContent) === label);
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}

function recipeName() {
  return host.querySelector<HTMLInputElement>('[data-autofocus]:not([inert] *)')!;
}

async function click(label: string, container?: ParentNode) { await act(async () => button(label, container).click()); }

async function enterText(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function rename(name: string) { await enterText(recipeName(), name); }

async function escape() {
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  vi.mocked(loadFieldTemplate).mockReset().mockResolvedValue(template);
  vi.mocked(writeDataField).mockReset();
  localStorage.removeItem("data-field-actor");
  update.mockClear();
  close.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

describe("shared data field creation from Candidate recipes", () => {
  const field: DataFieldDefinition = {
    id: "tool-lot", name: "Tool lot", valueType: "string", unit: "", reason: "Track material lots",
    status: "proposed", createdBy: "Henry", updatedBy: "Henry", createdAt: "2026-11-16", updatedAt: "2026-11-16",
  };

  function fieldForm() {
    return host.querySelector<HTMLFormElement>('form[aria-label="Add data field"]')!;
  }

  it("creates a single shared field and opens a fresh form next time", async () => {
    const updateTemplate = vi.fn();
    const savedTemplate = { ...template, dataFieldsRevision: 5, dataFieldDefinitions: [field] };
    vi.mocked(loadFieldTemplate).mockResolvedValue({ ...template, dataFieldsRevision: 4 });
    let finishSave!: (template: ProcessStepTemplate) => void;
    vi.mocked(writeDataField).mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    await render({ onTemplateUpdated: updateTemplate });
    expect(host.querySelector('[aria-haspopup="dialog"]')).toBeNull();
    await click("Edit recipe");
    const trigger = button("Add data field", host.querySelector('[aria-label="Candidate recipes"]')!);
    await click("Add data field");
    const form = fieldForm();
    const fieldName = form.querySelector<HTMLInputElement>("input[required]")!;
    expect(document.activeElement).toBe(fieldName);
    expect(host.querySelector('[aria-label="Edit flow node"]')?.hasAttribute("inert")).toBe(true);
    await enterText(fieldName, field.name);
    await enterText(form.querySelector("textarea")!, field.reason);
    await enterText(form.querySelector("fieldset > label:last-of-type input")!, field.createdBy);

    await act(async () => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(writeDataField).toHaveBeenCalledExactlyOnceWith(template.id,
      { name: field.name, valueType: field.valueType, reason: field.reason, unit: "" }, 4, field.createdBy);
    expect(button("Close dialog").disabled).toBe(true);
    await escape();
    expect(fieldForm()).toBe(form);
    vi.mocked(loadFieldTemplate).mockResolvedValue(savedTemplate);
    await act(async () => finishSave(savedTemplate));
    expect(fieldForm()).toBeNull();
    expect(updateTemplate).toHaveBeenCalledExactlyOnceWith(savedTemplate);
    expect(update).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Data field added. Open a recipe to enter a value.");
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));

    await render({ template: savedTemplate, onTemplateUpdated: updateTemplate });
    await click("Back to step");
    const summary = host.querySelector('[aria-label="Collected recipe data"]');
    expect(summary?.querySelector("dt")?.textContent).toBe("Tool lotProposed");
    expect(summary?.querySelector("dd")?.textContent).toBe("Not set");
    expect(update).not.toHaveBeenCalled();

    await click("Edit recipe");
    const newTrigger = button("Add data field");
    await click("Add data field");
    const reopened = fieldForm();
    expect(reopened.querySelector("input")?.value).toBe("");
    expect(reopened.querySelector("textarea")?.value).toBe("");
    expect(reopened.querySelector<HTMLInputElement>("fieldset > label:last-of-type input")?.value).toBe(field.createdBy);
    await click("Cancel", reopened);
    await vi.waitFor(() => expect(document.activeElement).toBe(newTrigger));
    await click("Open recipe Recipe 1 (active)");
    expect(host.textContent).not.toMatch(/Save data|Refresh fields|Data fields/);
    await enterText(host.querySelector<HTMLInputElement>(`#data-value-${field.id}`)!, "A123");
    await rename("Recipe with lot data");
    expect(update).not.toHaveBeenCalled();
    await click("Apply changes");
    expect(update).toHaveBeenCalledExactlyOnceWith({
      recipeCandidates: [{ ...recipes[0], name: "Recipe with lot data", dataValues: { [field.id]: "A123" } }, recipes[1]],
      selectedRecipeId: "r1",
    }, { stepRefId: stepRef.stepRefId, recipeId: "r1", dataFieldsRevision: 5 });
    await click("Open recipe Recipe 2");
    expect(host.querySelector<HTMLInputElement>(`[data-recipe-scroll]:not([inert] *) #data-value-${field.id}`)?.value).toBe("");
  });

  it("opens on an empty list and closes with Escape without creating a field", async () => {
    await render({ recipeCandidates: [], selectedRecipeId: null });
    await click("Edit recipe");
    const trigger = button("Add data field");
    await click("Add data field");
    expect(fieldForm()).toBeTruthy();
    await escape();
    expect(fieldForm()).toBeNull();
    expect(host.textContent).toContain("No recipes yet.");
    expect(writeDataField).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("preserves the form and refreshes the revision after a conflict", async () => {
    const existing = { ...field, id: "tool-lot-backup", name: "Tool lot backup" };
    const changed = { ...template, dataFieldsRevision: 3, dataFieldDefinitions: [existing] };
    vi.mocked(loadFieldTemplate).mockRejectedValue(new Error("Could not reach the server"));
    vi.mocked(writeDataField)
      .mockRejectedValueOnce(new ApiRequestError("Fields changed. Refresh before saving.", 409))
      .mockResolvedValueOnce({ ...changed, dataFieldsRevision: 4, dataFieldDefinitions: [existing, field] });
    await render();
    await click("Edit recipe");
    await click("Add data field");
    const form = fieldForm();
    const fieldName = form.querySelector("input")!;
    const reason = form.querySelector("textarea")!;
    await enterText(fieldName, field.name);
    await enterText(reason, field.reason);
    expect(button("Save field", form).disabled).toBe(true);
    expect(host.textContent).toContain("Could not reach the server");

    vi.mocked(loadFieldTemplate).mockResolvedValue({ ...template, dataFieldsRevision: 2 });
    await click("Retry loading fields");
    vi.mocked(loadFieldTemplate).mockResolvedValue(changed);
    await click("Save field", form);
    expect(writeDataField).toHaveBeenCalledTimes(1);
    expect(fieldForm()).toBe(form);
    expect(fieldName.value).toBe(field.name);
    expect(reason.value).toBe(field.reason);
    expect(form.querySelector('[role="alert"]')?.textContent).toContain("The shared fields changed");
    expect(form.textContent).toContain("Existing fields: Tool lot backup");

    await click("Save field", form);
    expect(vi.mocked(writeDataField).mock.calls.map(([, , revision]) => revision)).toEqual([2, 3]);
    expect(fieldForm()).toBeNull();
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("process step recipe presentation", () => {
  it("shows step details, active values, and an edit button on the overview", async () => {
    const html = await render();
    expect(html.indexOf("Step details")).toBeLessThan(html.indexOf("Active recipe"));
    expect(html.indexOf("Active recipe")).toBeLessThan(html.indexOf("Edit recipe"));
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
    expect(html).not.toContain("Candidate recipes");
    expect(html).not.toContain("Delete recipe");
  });

  it("asks for an explicit adoption when a legacy flow has candidates but no selection", async () => {
    const html = await render({ selectedRecipeId: null });
    expect(html).toContain("Choose a recipe");
    expect(html).toContain("Choose a recipe to apply to this step.");
  });

  it("labels adoption options with recipe names while retaining IDs as values", async () => {
    const html = await render();
    expect(host.querySelector("select")?.value).toBe("r1");
    expect(html).toContain('<option value="r1">Recipe 1</option>');
    expect(html).toContain('<option value="r2">Recipe 2</option>');
    expect(html).not.toContain('Recipe 1 (r1)</option>');
  });

  it("shows only the selected recipe's group values when adoption changes", async () => {
    const rdlTemplate = stepTemplates.find((step) => step.id === "step_tpl_rdl")! as ProcessStepTemplate;
    const candidates = ["First dielectric", "Second dielectric"].map((material, index) => ({
      recipeId: `rdl-recipe-${index}`, name: `Stack ${index}`, description: "",
      parameterValues: { layers: { items: [{
        itemId: `internal-${index}`, index: 1,
        values: { Dielectric: material, Conductivity: "Cu", thk: 8, density: 0 },
      }] } },
    }));
    const html = await render({ template: rdlTemplate, recipeCandidates: candidates, selectedRecipeId: candidates[0].recipeId });
    expect(html).toContain("<table");
    expect(html).toContain("First dielectric");
    expect(html).not.toContain("Second dielectric");
    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = candidates[1].recipeId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("Second dielectric");
    expect(host.textContent).not.toContain("First dielectric");
    expect(host.textContent).not.toContain("internal-");
  });
});

describe("recipe navigation in the step dialog", () => {
  it("slides between views and restores focus after discarding or applying changes", async () => {
    await render();
    const dialog = host.querySelector('[role="dialog"]')!;
    const header = dialog.querySelector("header");
    await click("Edit recipe");
    const title = dialog.querySelector('[aria-label="Candidate recipes"] h3');
    expect(document.activeElement).toBe(title);
    expect(title?.closest('[class*="slide-in-from-right"]')).toBeTruthy();
    expect(dialog.querySelector('[inert][aria-hidden="true"] [aria-label="Active recipe"]')).toBeTruthy();

    await click("Open recipe Recipe 2");
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog.querySelector("header")).toBe(header);
    expect(document.activeElement).toBe(recipeName());
    expect(host.textContent).toContain("Apply changes, then choose Save flow… to write them to the database.");
    await rename("Unsaved");
    await click("Cancel");
    expect(update).not.toHaveBeenCalled();
    const recipeButton = button("Open recipe Recipe 2");
    expect(document.activeElement).toBe(recipeButton);
    expect(recipeButton.closest('[class*="slide-in-from-left"]')).toBeTruthy();

    await click("Open recipe Recipe 2");
    expect(recipeName().value).toBe("Recipe 2");
    await rename("  Revised  ");
    await click("Apply changes");
    expect(update).toHaveBeenCalledWith({ recipeCandidates: [recipes[0], { ...recipes[1], name: "Revised" }], selectedRecipeId: "r1" }, undefined);
    expect(document.activeElement).toBe(button("Open recipe Revised"));
    await render({ hasUnsavedRecipeChanges: true });
    expect(header?.querySelector('[role="status"]')?.textContent).toBe("Unsaved recipe changes");
    await escape();
    expect(document.activeElement).toBe(button("Edit recipe"));
    expect(header?.querySelector('[role="status"]')?.textContent).toBe("Unsaved recipe changes");
    await escape();
    expect(close).toHaveBeenCalledOnce();
  });

  it("can add from an empty list and activates the first recipe only when applied", async () => {
    await render({ recipeCandidates: [], selectedRecipeId: null, canSaveDraft: true });
    expect(host.querySelector("select")?.disabled).toBe(true);
    await click("Edit recipe");
    expect(host.textContent).toContain("No recipes yet.");
    await click("Add recipe");
    expect(recipeName().value).toBe("Recipe 1");
    expect(host.textContent).toContain("Apply changes, then choose Save flow… or Save Draft to write them to the database.");
    await escape();
    expect(document.activeElement).toBe(button("Add recipe"));
    expect(update).not.toHaveBeenCalled();
    await click("Add recipe");
    await click("Apply changes");
    const state = update.mock.lastCall?.[0] as StepConfiguration;
    expect(state.recipeCandidates).toHaveLength(1);
    expect(state.selectedRecipeId).toBe(state.recipeCandidates[0].recipeId);
    expect(document.activeElement).toBe(button("Open recipe Recipe 1 (active)"));
  });

  it("keeps deletion confirmation above the list and adopts the adjacent candidate", async () => {
    await render();
    await click("Edit recipe");
    await click("Delete recipe Recipe 1");
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await escape();
    expect(update).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await click("Delete recipe Recipe 1");
    await click("Delete recipe");
    expect(update).toHaveBeenLastCalledWith({ recipeCandidates: [recipes[1]], selectedRecipeId: "r2" });
    expect(button("Open recipe Recipe 2 (active)")).toBeTruthy();
    await click("Delete recipe Recipe 2");
    await click("Delete recipe");
    expect(update).toHaveBeenLastCalledWith({ recipeCandidates: [], selectedRecipeId: null });
  });

  it("opens a linked recipe directly and discards collected inputs on Escape", async () => {
    const field: DataFieldDefinition = {
      id: "note", name: "Note", valueType: "string", unit: "", reason: "Record results",
      status: "proposed", createdBy: "RD", updatedBy: "RD", createdAt: "2026-11-16", updatedAt: "2026-11-16",
    };
    vi.mocked(loadFieldTemplate).mockResolvedValue({ ...template, dataFieldDefinitions: [field] });
    await render({ initialRecipeId: "r2" });
    expect(recipeName().value).toBe("Recipe 2");
    expect(document.activeElement).toBe(recipeName());
    await enterText(host.querySelector<HTMLInputElement>("#data-value-note")!, "Unsaved note");
    await escape();
    expect(document.activeElement).toBe(button("Open recipe Recipe 2"));
    expect(update).not.toHaveBeenCalled();
    await click("Open recipe Recipe 2");
    expect(host.querySelector<HTMLInputElement>("#data-value-note")?.value).toBe("");
  });
});

describe("recipe data in the shared form", () => {
  const field: DataFieldDefinition = {
    id: "power", name: "Power", valueType: "float", unit: "W", min: 0, max: 500, reason: "Record tool setting",
    status: "proposed", createdBy: "RD", updatedBy: "RD", createdAt: "2026-11-16", updatedAt: "2026-11-16",
  };
  const flag = { ...field, id: "flag", name: "Flag", status: "formal" as const, valueType: "boolean" as const,
    min: undefined, max: undefined, unit: "" };
  const power = () => host.querySelector<HTMLInputElement>("#data-value-power")!;

  it("shows the active recipe's collected values and updates the summary after approval", async () => {
    const proposedTemplate = { ...template, dataFieldDefinitions: [field, flag] };
    const filled = { ...recipes[0], dataValues: { power: 0, flag: false } };
    await render({ template: proposedTemplate, recipeCandidates: [filled, recipes[1]] });
    const summary = () => host.querySelector('[aria-label="Collected recipe data"]');
    const values = () => Array.from(summary()?.querySelectorAll("dd") ?? [], (item) => item.textContent);
    expect(summary()?.querySelector("dt")?.textContent).toBe("PowerProposed");
    expect(values()).toEqual(["0 W", "false"]);

    const select = host.querySelector("select")!;
    await act(async () => {
      select.value = "r2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(values()).toEqual(["Not set"]);

    const approvedTemplate: ProcessStepTemplate = { ...template, dataFieldDefinitions: [{ ...field, status: "formal" }, flag] };
    await render({ template: approvedTemplate });
    expect(summary()).toBeNull();

    await act(async () => {
      select.value = "r1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(summary()?.querySelector("dt")?.textContent).toBe("Power");
    expect(values()).toEqual(["0 W", "false"]);
  });

  it("keeps values through a failed refresh and applies formal rules after retry", async () => {
    vi.mocked(loadFieldTemplate).mockResolvedValue({ ...template, dataFieldsRevision: 2, dataFieldDefinitions: [flag, field] });
    await render({ initialRecipeId: "r1" });
    expect(host.querySelector('#data-value-power-status')?.textContent).toBe("In proposed");
    expect(host.querySelector('#data-value-flag-status')).toBeNull();
    const parameter = host.querySelector('input[aria-label="Thickness"]')!;
    const formal = host.querySelector('#data-value-flag')!;
    const parameterRow = parameter.closest('.grid')!;
    expect(power().closest('.grid')?.parentElement).toBe(parameterRow.parentElement);
    expect(formal.closest('.grid')?.parentElement).toBe(parameterRow.parentElement);
    expect(power().className).toBe(parameter.className);
    await enterText(power(), "approximately 150");
    expect(host.textContent).toContain("Original value can still be saved for review");
    expect(button("Apply changes").disabled).toBe(false);

    vi.mocked(loadFieldTemplate).mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(host.textContent).toContain("Network unavailable");
    expect(power().value).toBe("approximately 150");
    expect(button("Apply changes").disabled).toBe(true);

    vi.mocked(loadFieldTemplate).mockResolvedValue({ ...template, dataFieldsRevision: 3,
      dataFieldDefinitions: [flag, { ...field, status: "formal" }] });
    await click("Retry loading fields");
    expect(host.querySelector('#data-value-power-status')).toBeNull();
    expect(power().value).toBe("approximately 150");
    expect(power().getAttribute("aria-invalid")).toBe("true");
    expect(button("Apply changes").disabled).toBe(true);
    await enterText(power(), "0");
    const select = host.querySelector<HTMLSelectElement>("#data-value-flag")!;
    await act(async () => { select.value = "false"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("Apply changes");
    expect(update).toHaveBeenCalledExactlyOnceWith({
      recipeCandidates: [{ ...recipes[0], dataValues: { power: 0, flag: false } }, recipes[1]], selectedRecipeId: "r1",
    }, { stepRefId: "step-1", recipeId: "r1", dataFieldsRevision: 3 });
  });

  it("requires explicit discard of a removed field and confirms the new revision for staged data", async () => {
    vi.mocked(loadFieldTemplate).mockResolvedValue({ ...template, dataFieldsRevision: 3, dataFieldDefinitions: [flag] });
    await render({ initialRecipeId: "r1", recipeCandidates: [{ ...recipes[0], dataValues: { power: 100, flag: false } }, recipes[1]],
      recipeDataEdits: [{ stepRefId: "step-1", recipeId: "r1", dataFieldsRevision: 2 }] });
    expect(host.textContent).toContain("A field was removed. Entered value: 100.");
    expect(button("Apply changes").disabled).toBe(true);
    await click("Discard removed field value");
    expect(button("Apply changes").disabled).toBe(false);
    await click("Apply changes");
    expect(update).toHaveBeenCalledExactlyOnceWith({
      recipeCandidates: [{ ...recipes[0], dataValues: { flag: false } }, recipes[1]], selectedRecipeId: "r1",
    }, { stepRefId: "step-1", recipeId: "r1", dataFieldsRevision: 3 });
  });
});
