// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorDialog, useEditorDialogFocus } from "@/components/process-flow-save/editor-dialog";
import { summarizePlacementValidation } from "@/lib/process-flow/placement-validation";
import { GdsPlacementImport } from "./gds-placement-import";
import type { GdsImportResponse } from "./gds-coordinate-import.worker";

// UI-PLACE-030: use real React effects, portals, DOM focus and event propagation.
// Mocking hooks or rendering GDS alone misses the underlying editor's focus trap.
function NodeEditor({ onImport, onClose }: {
  onImport: React.ComponentProps<typeof GdsPlacementImport>["onImport"];
  onClose: () => void;
}) {
  const panel = React.useRef<HTMLElement>(null);
  const [recipeOpen, setRecipeOpen] = React.useState(false);
  useEditorDialogFocus(panel, onClose, false);
  return <section ref={panel} role="dialog" aria-label="Edit flow node" tabIndex={-1}>
    <button onClick={onClose}>Close node</button>
    <button onClick={() => setRecipeOpen(true)}>Edit PNP recipe</button>
    {recipeOpen ? <EditorDialog title="Edit PNP recipe" onClose={() => setRecipeOpen(false)}>
      <label>Recipe name<input data-autofocus defaultValue="Recipe 1" /></label>
      <GdsPlacementImport unit="um" onImport={onImport} />
      <button>Save recipe</button>
    </EditorDialog> : null}
  </section>;
}

const workers: ImportWorker[] = [];
class ImportWorker {
  onmessage?: (event: { data: GdsImportResponse }) => void;
  request?: { requestId: string };
  terminate = vi.fn();
  constructor() { workers.push(this); }
  postMessage(request: { requestId: string }) { this.request = request; }
  respond(error?: string) {
    this.onmessage?.({ data: error
      ? { type: "error", requestId: this.request!.requestId, message: error }
      : {
        type: "success", requestId: this.request!.requestId,
        regions: [{ type: "rectangle", bounds: [[0, 0], [2, 2]] }],
        matchedElements: 1, duplicatesRemoved: 0, repairedElements: 0,
        unrepairedElements: 0, repairDiagnostics: [], nonOrthogonalRegions: 0,
        topCellNames: [], unsupportedElements: {}, unresolvedReferences: 0, cyclicReferences: 0,
      },
    });
  }
}

let root: Root;
let frames: FrameRequestCallback[];
const onClose = vi.fn();
const onImport = vi.fn(() => summarizePlacementValidation([]));

function button(label: string, within: ParentNode = document): HTMLButtonElement {
  const result = Array.from(within.querySelectorAll("button")).find((element) =>
    element.textContent === label || element.getAttribute("aria-label") === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function field(label: string): HTMLInputElement {
  const result = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing field: ${label}`);
  return result;
}
function modal(): HTMLFormElement {
  return document.querySelector<HTMLFormElement>('form[role="dialog"]')!;
}
function isOpen() { return modal().parentElement!.getAttribute("aria-hidden") === "false"; }
function click(element: HTMLElement) { act(() => { element.focus(); element.click(); }); }
function type(label: string, value: string) {
  const input = field(label);
  act(() => {
    input.focus();
    // Bypass React's value tracker to simulate a native user input event.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.activeElement).toBe(input);
  expect(field(label).value).toBe(value);
}
function key(key: string, shiftKey = false) {
  act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true })));
}
function flushFrames() { act(() => frames.splice(0).forEach((frame) => frame(0))); }
function openGds() { click(button("Import from GDS")); expect(isOpen()).toBe(true); }
async function importFile() {
  const file = new File(["test"], "layout.gds");
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(4) });
  act(() => {
    Object.defineProperty(field("GDS file"), "files", { configurable: true, value: [file] });
    field("GDS file").dispatchEvent(new Event("change", { bubbles: true }));
  });
  type("Pattern 1 layer", "7");
  type("Pattern 1 datatype", "0");
  await act(async () => button("Import and replace").click());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", ImportWorker);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  // jsdom has real focus events but no layout. Model visibility only; do not mock focus.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden], [aria-hidden="true"]') ? [] : [{}]) as unknown as DOMRectList;
  });
  workers.length = 0;
  onClose.mockClear();
  onImport.mockClear();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<React.StrictMode><NodeEditor onImport={onImport} onClose={onClose} /></React.StrictMode>));
  click(button("Edit PNP recipe"));
  flushFrames();
});
afterEach(() => {
  act(() => root.unmount());
  flushFrames();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PNP GDS import inside node and recipe dialogs (UI-PLACE-030)", () => {
  it("keeps focus and edits every pattern control while the underlying dialogs remain open", () => {
    openGds();
    expect(document.querySelector('[aria-label="Edit flow node"]')!.contains(modal())).toBe(false);
    type("Pattern 1 layer", "7");
    type("Pattern 1 datatype", "0");
    type("Pattern 1 cell name contains", "DIE_A");
    const select = modal().querySelector("select")!;
    act(() => {
      select.focus();
      select.value = "exclude";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.activeElement).toBe(select);
    expect(select.value).toBe("exclude");
    const defeature = modal().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => defeature.focus());
    click(defeature);
    expect(defeature.checked).toBe(true);
    expect(document.activeElement).toBe(defeature);
    click(button("Add pattern"));
    type("Pattern 2 layer", "12");
    type("Pattern 2 datatype", "1");
    type("Pattern 2 cell name contains", "BUMP");
    click(button("Remove pattern 2"));
    expect(modal().querySelector('[aria-label="Pattern 2"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab and outside focus in GDS, then lets Escape close one dialog at a time", () => {
    openGds();
    expect(document.activeElement).toBe(button("Choose file"));
    const first = button("Close GDS import dialog");
    const last = button("Cancel", modal()); // Import is disabled without a file/criteria.
    act(() => first.focus());
    key("Tab", true);
    expect(document.activeElement).toBe(last);
    key("Tab");
    expect(document.activeElement).toBe(first);
    act(() => button("Close node").focus());
    expect(modal().contains(document.activeElement)).toBe(true);
    key("Escape");
    flushFrames();
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(button("Import from GDS"));
    expect(button("Save recipe")).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
    key("Escape");
    flushFrames();
    expect(document.activeElement).toBe(button("Edit PNP recipe"));
    expect(onClose).not.toHaveBeenCalled();
    key("Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each(["Cancel", "Close GDS import dialog", "backdrop", "Escape"])(
    "restores the trigger after %s and preserves editable drafts across repeated openings", (dismiss) => {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        openGds();
        if (cycle) expect(field("Pattern 1 cell name contains").value).toBe(`DIE_${cycle - 1}`);
        type("Pattern 1 layer", "7");
        type("Pattern 1 datatype", "0");
        type("Pattern 1 cell name contains", `DIE_${cycle}`);
        if (dismiss === "Escape") key("Escape");
        else if (dismiss === "backdrop") click(modal().previousElementSibling as HTMLElement);
        else click(button(dismiss, modal()));
        flushFrames();
        expect(isOpen()).toBe(false);
        expect(document.activeElement).toBe(button("Import from GDS"));
        expect(onClose).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps focus usable through a failed import and retry, blocks busy Escape, and restores focus on success", async () => {
    openGds();
    await importFile();
    key("Escape");
    expect(isOpen()).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    act(() => workers[0].respond("Invalid GDS"));
    expect(modal().textContent).toContain("Invalid GDS");
    type("Pattern 1 cell name contains", "DIE");
    await act(async () => button("Import and replace").click());
    act(() => workers[1].respond());
    flushFrames();
    expect(isOpen()).toBe(false);
    expect(onImport).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button("Import from GDS"));
    expect(document.body.textContent).toContain("Imported 1 target regions");
    openGds();
    type("Pattern 1 datatype", "2");
    expect(onClose).not.toHaveBeenCalled();
  });
});
