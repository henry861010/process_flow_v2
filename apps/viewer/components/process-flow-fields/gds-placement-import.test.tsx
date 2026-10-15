import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { summarizePlacementValidation } from "@/lib/process-flow/placement-validation";
import { FlowGdsFileProvider } from "./flow-gds-file-context";
import { GdsPlacementImport } from "./gds-placement-import";

// Exercise event handlers and effect lifetimes without adding a DOM dependency,
// following the hook-mocking approach used by the viewer's action tests.
let active: HookHarness;
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof React>(),
  useState: (initial: unknown) => active.state(initial),
  useRef: (initial: unknown) => active.ref(initial),
  useEffect: (effect: () => void, deps: unknown[]) => active.effect(effect, deps),
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useContext: () => active.context,
  useId: () => `test-${active.cursor++}`,
}));
vi.mock("react-dom", () => ({ createPortal: (child: unknown) => child }));

type Element = React.ReactElement;
type Effect = { deps: unknown[]; cleanup?: () => void };
type SharedFile = {
  file: File | null;
  rememberFile: (file: File) => void;
  clearFile: () => void;
};

class HookHarness {
  cursor = 0;
  slots: unknown[] = [];
  effects = new Map<number, Effect>();
  pending: Array<() => void> = [];
  context: SharedFile | null = null;

  state(initial: unknown) {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = typeof initial === "function" ? initial() : initial;
    return [this.slots[index], (next: unknown) => {
      this.slots[index] = typeof next === "function" ? next(this.slots[index]) : next;
    }];
  }
  ref(initial: unknown) {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = { current: initial };
    return this.slots[index];
  }
  effect(callback: () => void | (() => void), deps: unknown[]) {
    const index = this.cursor++;
    const previous = this.effects.get(index);
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    this.pending.push(() => {
      previous?.cleanup?.();
      this.effects.set(index, { deps, cleanup: callback() || undefined });
    });
  }
  render(component: () => Element) {
    active = this;
    this.cursor = 0;
    const result = component();
    this.pending.splice(0).forEach((effect) => effect());
    return result;
  }
  unmount() { this.effects.forEach((effect) => effect.cleanup?.()); }
}

function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement(node)) return [];
  return [node, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function find(view: Element, predicate: (element: Element) => boolean) {
  const element = elements(view).find(predicate);
  if (!element) throw new Error("Missing control");
  return element;
}
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!React.isValidElement(node)) return "";
  return React.Children.toArray(node.props.children).map(text).join("");
}
function button(view: Element, label: string) {
  return find(view, (element) => text(element) === label && typeof element.props.onClick === "function");
}
function file(name: string): File {
  return { name, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)) } as unknown as File;
}
function provider() {
  const hooks = new HookHarness();
  return { hooks, value: () => hooks.render(() => FlowGdsFileProvider({ children: null })).props.value as SharedFile };
}
function step(shared?: ReturnType<typeof provider>) {
  const hooks = new HookHarness();
  const onImport = vi.fn(() => summarizePlacementValidation([]));
  const render = () => {
    hooks.context = shared?.value() ?? null;
    return hooks.render(() => GdsPlacementImport({ unit: "um", onImport }));
  };
  render(); // Run the portal-ready effect.
  return {
    hooks, render, onImport,
    open() { button(render(), "Import from GDS").props.onClick(); return render(); },
    choose(next?: File) {
      const target = { files: next ? [next] : [], value: "selected-path" };
      find(render(), (element) => element.props.type === "file").props.onChange({ target });
      return target;
    },
    criterion(layer = "1") {
      find(render(), (element) => element.props.ariaLabel === "Pattern 1 layer").props.onChange(layer);
      find(render(), (element) => element.props.ariaLabel === "Pattern 1 datatype").props.onChange("0");
    },
    async submit() {
      find(render(), (element) => element.type === "form").props.onSubmit({ preventDefault() {} });
      await Promise.resolve();
      await Promise.resolve();
      return workers.at(-1)!;
    },
  };
}

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (event: { data: Record<string, unknown> }) => void;
  onerror?: (event: { message: string }) => void;
  request?: { requestId: string; criteria: unknown[]; defeature?: boolean };
  terminate = vi.fn();
  constructor() { workers.push(this); }
  postMessage(request: FakeWorker["request"]) { this.request = request; }
  respond(type = "success") {
    this.onmessage?.({ data: {
      type, requestId: this.request?.requestId, message: "Invalid GDS",
      regions: [], matchedElements: 0, duplicatesRemoved: 0, repairedElements: 0,
      boundingBoxFallbacks: 0, nonOrthogonalRegions: 0, topCellNames: [],
      unsupportedElements: {}, unresolvedReferences: 0, cyclicReferences: 0,
    } });
  }
}

let keydown: ((event: Partial<KeyboardEvent>) => void) | undefined;
beforeEach(() => {
  workers.length = 0;
  keydown = undefined;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", { requestAnimationFrame: (callback: () => void) => { callback(); return 1; }, cancelAnimationFrame() {} });
  vi.stubGlobal("document", {
    body: {}, activeElement: null,
    addEventListener: (_: string, listener: typeof keydown) => { keydown = listener; },
    removeEventListener: (_: string, listener: typeof keydown) => { if (keydown === listener) keydown = undefined; },
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("flow GDS session", () => {
  it("shares successful imports across remounted steps and keeps their settings independent", async () => {
    const shared = provider();
    const a = step(shared);
    a.open(); a.choose(file("layout.gds")); a.criterion("7");
    find(a.render(), (element) => element.props.type === "checkbox").props.onChange({ target: { checked: true } });
    expect(shared.value().file).toBeNull();
    (await a.submit()).respond();
    expect(a.onImport).toHaveBeenCalledOnce();
    a.hooks.unmount();

    const b = step(shared);
    const view = b.open();
    expect(text(view)).toContain("layout.gds");
    expect(text(view)).not.toContain("Using last imported GDS for this flow");
    expect(text(view)).toContain("Choose another file");
    expect(find(view, (element) => element.props.ariaLabel === "Pattern 1 layer").props.value).toBe("");
    expect(find(view, (element) => element.props.type === "checkbox").props.checked).toBe(false);
    b.criterion("2");
    const worker = await b.submit();
    expect(worker.request?.criteria).toEqual([{ layer: 2, datatype: 0, cellNameFilter: undefined }]);
    worker.respond();
    expect(a.onImport).toHaveBeenCalledOnce();
    b.hooks.unmount();
    expect(text(step(shared).open())).toContain("layout.gds");
  });

  it("promotes the actual imported file even if selection changes during the read", async () => {
    const shared = provider();
    const a = step(shared);
    const imported = file("imported.gds");
    a.open(); a.choose(imported); a.criterion();
    const pending = a.submit();
    a.choose(file("pending.gds"));
    (await pending).respond();
    expect(shared.value().file).toBe(imported);
    expect(text(a.open())).toContain("imported.gds");
    expect(text(a.render())).not.toContain("pending.gds");
  });

  it("keeps a pending choice on modal close, and ignores picker cancellation and failed imports", async () => {
    const shared = provider();
    const original = file("original.gds");
    shared.value().rememberFile(original);
    const a = step(shared);
    a.open(); a.choose(file("replacement.gds")); a.choose();
    button(a.render(), "Cancel").props.onClick();
    expect(text(a.open())).toContain("replacement.gds");
    expect(shared.value().file).toBe(original);
    a.criterion();
    (await a.submit()).respond("error");
    expect(shared.value().file).toBe(original);
    expect(a.onImport).not.toHaveBeenCalled();
    expect(text(a.render())).toContain("Invalid GDS");
    a.hooks.unmount();
    expect(text(step(shared).open())).toContain("original.gds");
  });

  it("updates subsequent defaults after replacement without touching other steps", async () => {
    const shared = provider();
    shared.value().rememberFile(file("old.gds"));
    const a = step(shared);
    a.open(); a.choose(file("new.gds")); a.criterion();
    (await a.submit()).respond();
    expect(text(step(shared).open())).toContain("new.gds");
    expect(a.onImport).toHaveBeenCalledOnce();
  });

  it("shows the full selectable filename without truncation in the body and footer", () => {
    const shared = provider();
    const name = `${"long-layout-name-".repeat(20)}晶片.gds`;
    shared.value().rememberFile(file(name));
    const view = step(shared).open();
    const labels = elements(view).filter((element) =>
      (element.type === "p" || element.type === "span") && text(element) === name,
    );
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.props.className).toContain("break-all");
      expect(label.props.className).toContain("select-text");
      expect(label.props.className).not.toContain("truncate");
    }
    expect(text(view)).not.toContain("Using last imported GDS for this flow");
  });

  it("ignores superseded and unmounted worker completions", async () => {
    const shared = provider();
    const a = step(shared);
    a.open(); a.choose(file("first.gds")); a.criterion();
    const first = await a.submit();
    a.choose(file("second.gds"));
    const second = await a.submit();
    first.respond();
    expect(first.terminate).toHaveBeenCalled();
    expect(shared.value().file).toBeNull();
    expect(a.onImport).not.toHaveBeenCalled();
    a.hooks.unmount();
    second.respond();
    expect(second.terminate).toHaveBeenCalled();
    expect(shared.value().file).toBeNull();
    expect(a.onImport).not.toHaveBeenCalled();
  });

  it("clears replaced sessions, rejects their late completions, and isolates editor instances", () => {
    const shared = provider();
    const oldSession = shared.value();
    oldSession.rememberFile(file("old.gds"));
    expect(provider().value().file).toBeNull();
    shared.value().clearFile();
    oldSession.rememberFile(file("late.gds"));
    expect(shared.value().file).toBeNull();
    shared.value().rememberFile(file("new-session.gds"));
    expect(shared.value().file?.name).toBe("new-session.gds");
    expect(provider().value().file).toBeNull(); // Reload creates a new provider.
  });

  it("retains standalone selection without a provider and keeps keyboard close scoped to the modal", async () => {
    const a = step();
    a.open(); a.choose(file("standalone.gds")); a.criterion();
    const stopPropagation = vi.fn();
    keydown?.({ key: "Escape", preventDefault() {}, stopPropagation });
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(find(a.render(), (element) => element.type === "button" || element.props["aria-haspopup"] === "dialog").props["aria-expanded"]).toBe(false);
    a.open();
    (await a.submit()).respond();
    expect(text(a.open())).toContain("standalone.gds");
    expect(text(a.render())).not.toContain("Using last imported GDS for this flow");
  });

  it("focuses the file chooser, traps Tab, and returns focus after idle Escape", () => {
    const a = step();
    const view = a.render();
    function attach(element: Element, current: unknown) {
      (element as Element & { ref: { current: unknown } }).ref.current = current;
    }
    const triggerFocus = vi.fn();
    const chooseFocus = vi.fn();
    const inputClick = vi.fn();
    attach(button(view, "Import from GDS"), { focus: triggerFocus });
    attach(button(view, "Choose file"), { focus: chooseFocus });
    attach(find(view, (element) => element.props.type === "file"), { click: inputClick });
    const first = { focus: vi.fn() };
    const last = { focus: vi.fn() };
    const querySelectorAll = vi.fn(() => [first, last]);
    attach(find(view, (element) => element.type === "form"), { querySelectorAll });
    a.open();
    expect(chooseFocus).toHaveBeenCalledOnce();
    button(a.render(), "Choose file").props.onClick();
    expect(inputClick).toHaveBeenCalledOnce();
    Object.defineProperty(document, "activeElement", { value: first, configurable: true });
    keydown?.({ key: "Tab", shiftKey: true, preventDefault() {} });
    expect(last.focus).toHaveBeenCalledOnce();
    Object.defineProperty(document, "activeElement", { value: last, configurable: true });
    keydown?.({ key: "Tab", shiftKey: false, preventDefault() {} });
    expect(first.focus).toHaveBeenCalledOnce();
    expect(querySelectorAll.mock.calls[0]?.[0]).toContain(":not([hidden])");
    keydown?.({ key: "Escape", preventDefault() {}, stopPropagation() {} });
    a.render();
    expect(triggerFocus).toHaveBeenCalledOnce();
  });

  it("does not promote files after read, worker, or placement-application errors", async () => {
    const shared = provider();
    const a = step(shared);
    a.open(); a.criterion();
    const broken = file("broken.gds");
    vi.mocked(broken.arrayBuffer).mockRejectedValue(new Error("Cannot read file"));
    a.choose(broken);
    await a.submit();
    expect(workers).toHaveLength(0);
    expect(text(a.render())).toContain("Cannot read file");
    a.choose(file("worker-error.gds"));
    (await a.submit()).onerror?.({ message: "Worker failed" });
    expect(text(a.render())).toContain("Worker failed");
    a.choose(file("apply-error.gds"));
    a.onImport.mockImplementationOnce(() => { throw new Error("Cannot apply placements"); });
    (await a.submit()).respond();
    expect(text(a.render())).toContain("Cannot apply placements");
    expect(shared.value().file).toBeNull();
  });
});
