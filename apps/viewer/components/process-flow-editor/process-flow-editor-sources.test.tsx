import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import flowFixtures from "../../../api/src/process_flow_api/fixtures/process-flows.json";
import stepFixtures from "../../../api/src/process_flow_api/fixtures/process-step-templates.json";
import geometryFixtures from "../../../api/src/process_flow_api/fixtures/geometries.json";
import { ProcessFlowEditor } from "./process-flow-editor";
import { GeometryInputEditorDialog } from "./geometry-input-editor-dialog";
import { GeometrySourcePicker } from "./geometry-source-picker";
import { GeometryGeneratorEditorContent, GeometryGeneratorParameters, GeometryGeneratorValidation } from "@/components/geometry-generator/geometry-generator-editor";
import { BackendGeometryGeneratorDialog } from "@/components/geometry-generator/backend-geometry-generator-dialog";
import { GeometryGeneratorSaveDialog } from "@/components/geometry-generator/geometry-generator-save-dialog";
import { GeometryPreviewPanel } from "@/components/geometry-preview/geometry-preview-panel";
import type { GeometryGeneratorPreview } from "@/components/geometry-generator/geometry-generator-contracts";
import { ProcessFlowGraph } from "@/components/process-flow-graph/process-flow-graph";
import { EditorShellHeader, EditorStatusBar } from "@/components/process-flow-save/editor-shell-header";
import { FlowSourceDialog } from "@/components/process-flow-save/flow-source-dialog";
import { SaveInformationDialog } from "@/components/process-flow-save/save-information-dialog";
import { EditorDialog } from "@/components/process-flow-save/editor-dialog";
import { GeometryGeneratorDialogLauncher } from "@/components/geometry-generator/geometry-generator-registry";
import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import type { GeometryGeneratorDefineResult } from "@/components/geometry-generator/geometry-generator-types";
import { createDefaultParameterValues } from "@/lib/process-flow/parameter-values";
import {
  ApiRequestError, commitFlowDraft, createProcessFlow, deleteFlowDraft, getFlowDraft,
  getGeometryGeneratorVersion, getProcessFlow, listFlowDrafts, loadBootstrap, saveFlowDraft, updateProcessFlow, previewGeneratedGeometry, createGeometry, materializeGeneratedGeometry,
} from "@/lib/process-flow-api";
import type { FlowDraft, ProcessFlow, ProcessStepTemplate, GeometryEntity, GeometryBinding, FlowInputDefinition } from "@/lib/process-flow/types";

// Drive the real editor and draft handlers with the same hook approach as the GDS
// interaction tests. Graph rendering and browser layout are outside these tests.
let active: HookHarness;
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof React>(),
  useState: (initial: unknown) => active.state(initial),
  useRef: (initial: unknown) => active.ref(initial),
  useEffect: (effect: () => void, deps: unknown[]) => active.effect(effect, deps),
  useMemo: (factory: () => unknown, deps: unknown[]) => active.memo(factory, deps),
  useCallback: (callback: unknown, deps: unknown[]) => active.memo(() => callback, deps),
}));
const { canvas, clearFile } = vi.hoisted(() => ({
  canvas: { fitView: vi.fn(), getViewport: vi.fn(), setViewport: vi.fn(), screenToFlowPosition: vi.fn() },
  clearFile: vi.fn(),
}));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...await importOriginal<object>(), useReactFlow: () => canvas,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/process-flow-fields/flow-gds-file-context", async (importOriginal) => ({
  ...await importOriginal<object>(), useFlowGdsFile: () => ({ clearFile }),
}));
vi.mock("@/components/geometry-preview/file-export-jobs-provider", () => ({
  useFileExportJobs: () => ({ registerJob: vi.fn() }),
}));
vi.mock("@/components/geometry-generator/use-generator-binding-geometries", () => ({
  useGeneratorBindingGeometries: () => ({ geometries: [], errors: {} }),
}));
vi.mock("@/lib/process-flow-api", async (importOriginal) => ({
  ...await importOriginal<object>(),
  loadBootstrap: vi.fn(), getProcessFlow: vi.fn(), createProcessFlow: vi.fn(), updateProcessFlow: vi.fn(),
  getFlowDraft: vi.fn(), listFlowDrafts: vi.fn(), saveFlowDraft: vi.fn(), commitFlowDraft: vi.fn(), deleteFlowDraft: vi.fn(),
  getGeometryGeneratorVersion: vi.fn(), previewGeneratedGeometry: vi.fn(), createGeometry: vi.fn(), materializeGeneratedGeometry: vi.fn(),
}));

type Element = React.ReactElement;
type Effect = { deps: unknown[]; cleanup?: () => void };
const sameDeps = (left: unknown[], right: unknown[]) => left.length === right.length && left.every((value, i) => Object.is(value, right[i]));
class HookHarness {
  cursor = 0;
  slots: unknown[] = [];
  effects = new Map<number, Effect>();
  pending: Array<() => void> = [];
  changed = false;
  state(initial: unknown) {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = typeof initial === "function" ? initial() : initial;
    return [this.slots[index], (next: unknown) => {
      const value = typeof next === "function" ? next(this.slots[index]) : next;
      this.changed ||= !Object.is(this.slots[index], value);
      this.slots[index] = value;
    }];
  }
  ref(initial: unknown) {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = { current: initial };
    return this.slots[index];
  }
  memo(factory: () => unknown, deps: unknown[]) {
    const index = this.cursor++;
    const previous = this.slots[index] as { deps: unknown[]; value: unknown } | undefined;
    if (!previous || !sameDeps(deps, previous.deps)) this.slots[index] = { deps, value: factory() };
    return (this.slots[index] as { value: unknown }).value;
  }
  effect(callback: () => void | (() => void), deps: unknown[]) {
    const index = this.cursor++;
    const previous = this.effects.get(index);
    if (previous && sameDeps(deps, previous.deps)) return;
    this.pending.push(() => {
      previous?.cleanup?.();
      this.effects.set(index, { deps, cleanup: callback() || undefined });
    });
  }
  render(component: () => Element) {
    active = this;
    let view: Element;
    let renders = 0;
    do {
      this.changed = false;
      this.cursor = 0;
      view = component();
      this.pending.splice(0).forEach((effect) => effect());
      if (++renders > 20) throw new Error("Editor did not settle");
    } while (this.changed);
    return view;
  }
  unmount() { this.effects.forEach((effect) => effect.cleanup?.()); }
}
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  return [node, ...elements(node.props.children)];
}
function find(view: Element, predicate: (element: Element) => boolean) {
  const element = elements(view).find(predicate);
  if (!element) throw new Error("Missing editor control");
  return element;
}
function props<P>(view: Element, type: React.ComponentType<P>): P {
  return find(view, (element) => element.type === type).props;
}
function generatorContent(view: Element) {
  return GeometryGeneratorEditorContent(props(view, GeometryGeneratorEditorContent));
}
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return React.isValidElement(node) ? text(node.props.children) : "";
}
function button(view: Element, label: string) {
  return find(view, (element) => text(element) === label && typeof element.props.onClick === "function");
}

let source: ProcessFlow;
let beforeSource: ProcessFlow;
let savedDraft: FlowDraft;
const sessions: HookHarness[] = [];
const beforeUnload = new Set<unknown>();
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  source = structuredClone(flowFixtures.find((flow) => flow.id === "flow_inst_aaa_demo_hbm4_alpha")!) as unknown as ProcessFlow;
  source.origin = { flowId: "ancestor", revision: 2 };
  beforeSource = structuredClone(source);
  beforeUnload.clear();
  const location = { search: "" };
  vi.stubGlobal("window", {
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args), clearTimeout: (timer: number) => clearTimeout(timer),
    location, history: { replaceState: vi.fn((_state, _title, url: string) => { location.search = new URL(url, "http://localhost").search; }) },
    addEventListener: (name: string, listener: unknown) => { if (name === "beforeunload") beforeUnload.add(listener); },
    removeEventListener: (name: string, listener: unknown) => { if (name === "beforeunload") beforeUnload.delete(listener); },
  });
  vi.stubGlobal("document", { body: { style: {} }, activeElement: null });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => { callback(); return 1; });
  canvas.fitView.mockResolvedValue(true);
  canvas.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
  canvas.setViewport.mockResolvedValue(true);
  canvas.screenToFlowPosition.mockImplementation(({ x, y }) => {
    const viewport = canvas.getViewport();
    return { x: (x - graphBounds.left - viewport.x) / viewport.zoom,
      y: (y - graphBounds.top - viewport.y) / viewport.zoom };
  });
  vi.mocked(loadBootstrap).mockImplementation(async () => ({
    processFlows: [source], processStepTemplates: stepFixtures as ProcessStepTemplate[],
    geometries: geometryFixtures as GeometryEntity[], geometryGenerators: [],
  }));
  vi.mocked(previewGeneratedGeometry).mockImplementation(async (id, version, parameters) => ({
    generatorId: id, generatorVersion: version, valid: true, errors: {}, normalizedParameters: structuredClone(parameters),
    computedParameters: {}, engineeringPreview: null, geometryHash: "hash", previewToken: "token",
    geometryEntityJson: geometryFixtures[0] as GeometryGeneratorPreview["geometryEntityJson"],
  }));
  vi.mocked(getProcessFlow).mockImplementation(async () => source);
  vi.mocked(createProcessFlow).mockImplementation(async (body) => ({ ...structuredClone(body), id: "new-branch", revision: 1 }));
  vi.mocked(updateProcessFlow).mockImplementation(async (id, body) => ({ ...structuredClone(body), id, revision: body.revision + 1 }));
  vi.mocked(listFlowDrafts).mockResolvedValue([]);
  vi.mocked(saveFlowDraft).mockImplementation(async (body) => {
    savedDraft = { ...structuredClone(body), id: "branch-draft", revision: 1, createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z" };
    return savedDraft;
  });
  vi.mocked(getFlowDraft).mockImplementation(async () => savedDraft);
  vi.mocked(commitFlowDraft).mockImplementation(async (_draft, body) => ({ ...structuredClone(body), id: "committed-branch", revision: 1 }));
});
afterEach(() => {
  sessions.splice(0).forEach((session) => session.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function editor(search = "") {
  window.location.search = search;
  const hooks = new HookHarness();
  sessions.push(hooks);
  const inner = ProcessFlowEditor().props.children.props.children.type as () => Element;
  const render = () => hooks.render(inner);
  async function flush() {
    for (let tick = 0; tick < 8; tick++) await Promise.resolve();
    return render();
  }
  render(); await flush(); await flush();
  const graphRef = props(render(), ProcessFlowGraph).containerRef as React.MutableRefObject<HTMLElement | null>;
  graphRef.current = { getBoundingClientRect: () => graphBounds } as HTMLElement;
  return {
    render, flush,
    header: () => props(render(), EditorShellHeader),
    status: () => props(render(), EditorStatusBar),
    graph: () => props(render(), ProcessFlowGraph),
    saveDialog: () => props(render(), SaveInformationDialog),
    async start() {
      props(render(), EditorShellHeader).onStartFrom();
      const loaded = await props(render(), FlowSourceDialog).onUseFlow(source.id);
      if (loaded) props(render(), FlowSourceDialog).onClose();
      await flush();
      return loaded;
    },
    openSave() { props(render(), EditorShellHeader).onSave(); return props(render(), SaveInformationDialog); },
    async save() { await props(render(), SaveInformationDialog).onSubmit(); await flush(); },
  };
}

const graphBounds = { left: 280, top: 120, right: 1280, bottom: 720, width: 1000, height: 600 };
type EditorHarness = Awaited<ReturnType<typeof editor>>;

function libraryItem(app: EditorHarness, kind: "geometry" | "step", id?: string): Element {
  const library = find(app.render(), (element) => element.props.searchPlaceholder ===
    (kind === "geometry" ? "Search geometry" : "Search step templates"));
  const item = library.props.items.find((item: GeometryEntity | ProcessStepTemplate) =>
    id ? item.id === id : kind === "geometry" ? Boolean(item.category) : (item as ProcessStepTemplate).status !== "disabled");
  return library.props.renderItem(item, { showCategoryPath: false });
}

function paletteButton(item: Element): Element {
  const hooks = new HookHarness();
  sessions.push(hooks);
  const element = hooks.render(() => (item.type as (props: unknown) => Element)(item.props));
  // The step palette exposes its native button through the hover preview's render prop.
  return element.type === "button" ? element : element.props.children({ triggerProps: {}, closePreview: vi.fn() });
}

async function saveNewDraft(app: EditorHarness) {
  button(app.header().draftControl as Element, " Save Draft").props.onClick();
  for (const [label, value] of [["Draft name", "Centered flow"], ["User", "RD"]]) {
    const field = find(app.render(), (element) => element.type === "label" && text(element).startsWith(label));
    find(field, (element) => element.type === "input").props.onChange({ target: { value } });
  }
  find(app.render(), (element) => element.type === "form").props.onSubmit({ preventDefault() {} });
  await app.flush();
}

describe("flow editor library insertion", () => {
  it.each([
    { kind: "geometry", zoom: 0.5 }, { kind: "step", zoom: 0.5 },
    { kind: "geometry", zoom: 1.4 }, { kind: "step", zoom: 1.4 },
  ] as const)("centers $kind at zoom $zoom after panning a long flow", async ({ kind, zoom }) => {
    const app = await editor();
    await app.start();
    const view = { x: -12000, y: -2000, zoom };
    canvas.getViewport.mockReturnValue(view);
    canvas.fitView.mockClear(); canvas.setViewport.mockClear();
    const oldNodes = app.graph().nodes;
    paletteButton(libraryItem(app, kind)).props.onClick({ detail: 1 });
    const graph = app.graph();
    const node = graph.nodes.at(-1)!;
    expect(graph.nodes).toHaveLength(oldNodes.length + 1);
    const width = kind === "geometry" ? 132 : 248;
    expect(node.position.x + width / 2).toBeCloseTo((graphBounds.width / 2 - view.x) / zoom);
    expect(node.position.y + 66).toBeCloseTo((graphBounds.height / 2 - view.y) / zoom);
    expect(node.selected).toBe(true);
    expect(graph.nodes.slice(0, -1).map((node) => node.position)).toEqual(oldNodes.map((node) => node.position));
    expect(graph.fitView).toBeFalsy();
    expect(canvas.fitView).not.toHaveBeenCalled();
    expect(canvas.setViewport).not.toHaveBeenCalled();
    expect(canvas.screenToFlowPosition).toHaveBeenLastCalledWith(
      { x: graphBounds.right, y: graphBounds.bottom }, { snapToGrid: false });
  });

  it("avoids repeated geometry overlap and preserves bindings, default recipes and the viewport in drafts", async () => {
    const app = await editor();
    const viewport = { x: -4000, y: 200, zoom: 0.8 };
    canvas.getViewport.mockReturnValue(viewport);
    app.graph().onMoveEnd!(null, viewport);
    const geometry = libraryItem(app, "geometry").props.geometry as GeometryEntity;
    paletteButton(libraryItem(app, "geometry")).props.onClick({ detail: 0 });
    paletteButton(libraryItem(app, "geometry")).props.onClick({ detail: 1 });
    const inputs = app.graph().nodes;
    expect(inputs[0].position).not.toEqual(inputs[1].position);
    const template = libraryItem(app, "step").props.template as ProcessStepTemplate;
    paletteButton(libraryItem(app, "step")).props.onClick({ detail: 0 });
    const positions = app.graph().nodes.map((node) => node.position);
    await saveNewDraft(app);
    expect(savedDraft.state.viewport).toEqual(viewport);
    expect(savedDraft.state.nodes.map((node) => node.position)).toEqual(positions);
    expect(Object.values(savedDraft.state.configuration.inputBindings)).toEqual([
      { kind: "catalog", geometryId: geometry.id }, { kind: "catalog", geometryId: geometry.id },
    ]);
    const [configuration] = Object.values(savedDraft.state.configuration.stepConfigurations);
    expect(configuration.recipeCandidates).toHaveLength(1);
    expect(configuration.selectedRecipeId).toBe(configuration.recipeCandidates[0].recipeId);
    expect(configuration.recipeCandidates[0]).toMatchObject({ name: "Recipe 1",
      parameterValues: createDefaultParameterValues(template.parameterDefinitions) });
    const resumed = await editor("?draftId=branch-draft");
    expect(resumed.graph().nodes.map((node) => node.position)).toEqual(positions);
    expect(canvas.setViewport).toHaveBeenLastCalledWith(viewport);
  });

  it.each(["geometry", "step"] as const)("drops one %s at the pointer and suppresses a subsequent drag click", async (kind) => {
    const app = await editor();
    canvas.getViewport.mockReturnValue({ x: -1000, y: -500, zoom: 0.5 });
    const control = paletteButton(libraryItem(app, kind));
    const data = new Map<string, string>();
    const transfer = { setData: (key: string, value: string) => data.set(key, value),
      getData: (key: string) => data.get(key) ?? "" };
    control.props.onPointerDown();
    control.props.onDragStart({ dataTransfer: transfer });
    const preventDefault = vi.fn();
    app.graph().onDrop!({ clientX: 680, clientY: 420, preventDefault, dataTransfer: transfer } as unknown as React.DragEvent<HTMLDivElement>);
    control.props.onClick({ detail: 1 });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(app.graph().nodes).toHaveLength(1);
    expect(app.graph().nodes[0].position).toEqual({ x: 2800, y: 1600 });
    // A new pointer gesture, or a native keyboard click, can add normally again.
    control.props.onPointerDown(); control.props.onClick({ detail: 1 });
    expect(app.graph().nodes).toHaveLength(2);
    control.props.onClick({ detail: 0 });
    expect(app.graph().nodes).toHaveLength(3);
  });

  it.each(["geometry", "step"] as const)("uses a disabled native button for unavailable %s items", async (kind) => {
    const app = await editor();
    const item = libraryItem(app, kind);
    const control = paletteButton(React.cloneElement(item, { disabled: true }));
    expect(control.type).toBe("button");
    expect(control.props.type).toBe("button");
    expect(control.props.disabled).toBe(true);
    expect(control.props.draggable).toBe(false);
    control.props.onClick({ detail: 0 });
    control.props.onDragStart({ dataTransfer: { setData: vi.fn() } });
    expect(app.graph().nodes).toHaveLength(0);
  });

  it("centers a generator's new input at completion and keeps an existing input's position when replacing its source", async () => {
    const definition: GeometryGeneratorDefinition = {
      schemaVersion: 2, id: "test-generator", version: 1, label: "Test generator", description: "",
      uiPlacements: ["templateGeometryLibrary", "flowInputPicker"], entityType: "die", category: "die",
      adaptationContract: { adapterId: "box-rescale", adapterVersion: 1 },
      defaultParameters: {}, parameterDefinitions: [], parameterGroups: [], previewViews: [],
    };
    const bootstrap = vi.mocked(loadBootstrap).getMockImplementation()!;
    vi.mocked(loadBootstrap).mockImplementation(async () => ({ ...await bootstrap(), geometryGenerators: [definition] }));
    const app = await editor();
    button(app.render(), "Test generator").props.onClick();
    const view = { x: -5000, y: -1200, zoom: 0.5 };
    canvas.getViewport.mockReturnValue(view);
    const result: GeometryGeneratorDefineResult = {
      binding: { kind: "generator", generatorId: definition.id, generatorVersion: 1, parameters: { size: 10 } },
      geometry: geometryFixtures[0] as GeometryGeneratorDefineResult["geometry"],
      suggestedFlowInputName: "Generated input",
    };
    props(app.render(), GeometryGeneratorDialogLauncher).onDefine(result);
    const input = app.graph().nodes[0];
    expect(input.position).toEqual({ x: 10934, y: 2934 });
    expect(input.selected).toBe(true);
    expect(input.data.definition).toMatchObject({ name: "Generated input" });
    app.graph().onNodeDoubleClick!({} as React.MouseEvent, input);
    const dialog = props(app.render(), GeometryInputEditorDialog);
    const changed = { ...result, binding: { ...result.binding, parameters: { size: 20 } } };
    canvas.getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    dialog.onApply({ definition: dialog.flowInput, binding: changed.binding });
    expect(app.graph().nodes).toHaveLength(1);
    expect(app.graph().nodes[0].position).toEqual(input.position);
    await saveNewDraft(app);
    expect(Object.values(savedDraft.state.configuration.inputBindings)).toEqual([changed.binding]);
  });
});

const pickerGenerator: GeometryGeneratorDefinition = {
  schemaVersion: 2, id: "test-generator", version: 2, label: "Test generator", description: "",
  uiPlacements: ["templateGeometryLibrary", "flowInputPicker"], entityType: "die", category: "die",
  adaptationContract: { adapterId: "box-rescale", adapterVersion: 1 },
  defaultParameters: { size: 100, enabled: true, layers: [{ thickness: 5 }] },
  parameterDefinitions: [
    { id: "size", name: "Size", valueType: "float" },
    { id: "enabled", name: "Enabled", valueType: "boolean" },
    { id: "layers", name: "Layers", valueType: "fieldGroupArray", repeatDefinition: {
      minItems: 0, indexBase: 1, itemNameTemplate: "Layer {index}",
      itemParameterDefinitions: [{ id: "thickness", name: "Thickness", valueType: "float" }],
    } },
  ], parameterGroups: [], previewViews: [],
};
const otherPickerGenerator = { ...pickerGenerator, id: "other-generator", label: "Other generator" };
const savedGenerator = { ...pickerGenerator, version: 1, defaultParameters: { size: 10, enabled: true, layers: [] } };
const savedBinding: GeometryBinding = {
  kind: "generator", generatorId: pickerGenerator.id, generatorVersion: 1,
  parameters: { size: 0, enabled: false, layers: [{ thickness: 0 }] },
};

async function geometryInputEditor(binding: GeometryBinding | null = savedBinding, loadSaved = false) {
  const flowInput = source.definition.flowInputs[0];
  flowInput.geometryConstraints = { categories: ["die"], structureFormats: ["standard"] };
  if (binding) source.configuration.inputBindings[flowInput.flowInputId] = structuredClone(binding);
  else delete source.configuration.inputBindings[flowInput.flowInputId];
  const bootstrap = vi.mocked(loadBootstrap).getMockImplementation()!;
  vi.mocked(loadBootstrap).mockImplementation(async () => ({
    ...await bootstrap(), geometryGenerators: [pickerGenerator, otherPickerGenerator],
  }));
  vi.mocked(getGeometryGeneratorVersion).mockResolvedValue(savedGenerator);
  const app = await editor(loadSaved ? `?flowId=${source.id}` : "");
  if (!loadSaved) await app.start();
  const node = app.graph().nodes.find((node) => node.type === "flowInput"
    && (node.data.definition as FlowInputDefinition).flowInputId === flowInput.flowInputId)!;
  app.graph().onNodeDoubleClick!({} as React.MouseEvent, node);
  const hooks = new HookHarness();
  const pickerHooks = new HookHarness();
  sessions.push(hooks, pickerHooks);
  const render = () => {
    const inputProps = props(app.render(), GeometryInputEditorDialog);
    return hooks.render(() => GeometryInputEditorDialog(inputProps));
  };
  const picker = () => {
    const pickerProps = props(render(), GeometrySourcePicker);
    return pickerHooks.render(() => GeometrySourcePicker(pickerProps));
  };
  const parameters = () => props(generatorContent(render()), GeometryGeneratorParameters);
  function update(values: Record<string, unknown>) { parameters().onChange({ ...parameters().values, ...values }); render(); }
  async function flush() { await app.flush(); render(); }
  async function preview() { render(); await vi.advanceTimersByTimeAsync(180); await flush(); }
  render();
  return { app, node, flowInputId: flowInput.flowInputId, render, picker, parameters, update, flush, preview,
    hooks, close: () => button(render(), "Cancel").props.onClick(),
    changeSource: () => button(render(), "Change source").props.onClick(),
    selectCatalog: () => {
      const library = find(picker(), (element) => element.props.searchPlaceholder === "Search geometry");
      const geometry = library.props.items[0] as GeometryEntity;
      library.props.renderItem(geometry, { showCategoryPath: false }).props.onClick();
      render();
      return geometry;
    },
    editName: (name: string) => {
      const field = find(render(), (element) => element.type === "label" && text(element).startsWith("Name"));
      find(field, (element) => element.type === "input").props.onChange({ target: { value: name } });
    },
  };
}

describe("flow geometry input editing session", () => {
  it("opening, previewing and canceling a saved input leave the flow clean", async () => {
    const session = await geometryInputEditor(savedBinding, true);
    expect(session.app.status().saved).toBe(true);
    await session.flush(); await session.preview();
    expect(session.app.status().saved).toBe(true);
    session.close();
    expect(session.app.status().saved).toBe(true);
    expect(updateProcessFlow).not.toHaveBeenCalled();
  });

  it("blocks duplicate source requests and preserves the current draft when backing out of a pending choice", async () => {
    const session = await geometryInputEditor(); await session.flush();
    session.changeSource();
    button(session.picker(), otherPickerGenerator.label).props.onClick();
    session.update({ size: 42 });
    session.changeSource();
    let resolve!: (definition: GeometryGeneratorDefinition) => void;
    vi.mocked(getGeometryGeneratorVersion).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const choice = button(session.picker(), pickerGenerator.label);
    choice.props.onClick(); choice.props.onClick();
    expect(getGeometryGeneratorVersion).toHaveBeenCalledTimes(2);
    const picker = props(session.render(), GeometrySourcePicker);
    expect(picker.loadingGeneratorId).toBe(pickerGenerator.id);
    picker.onSelect(geometryFixtures[0].id);
    expect(props(session.render(), GeometrySourcePicker).binding?.kind).toBe("generator");
    button(session.render(), "Back to geometry").props.onClick();
    resolve(savedGenerator); await session.flush();
    expect(session.parameters().definition.id).toBe(otherPickerGenerator.id);
    expect(session.parameters().values.size).toBe(42);
  });

  it("ignores a superseded preview even if the request completes after a newer valid result", async () => {
    const session = await geometryInputEditor(); await session.flush();
    let resolve!: (preview: GeometryGeneratorPreview) => void;
    const valid = vi.mocked(previewGeneratedGeometry).getMockImplementation()!;
    vi.mocked(previewGeneratedGeometry).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    session.update({ size: 25 }); await session.preview();
    session.update({ size: 50 }); await session.preview();
    resolve(await valid(pickerGenerator.id, 1, { size: 25 })); await session.flush();
    expect(props(generatorContent(session.render()), GeometryGeneratorValidation).preview?.normalizedParameters.size).toBe(50);
    button(session.render(), "Apply changes").props.onClick();
    await saveNewDraft(session.app);
    expect(savedDraft.state.configuration.inputBindings[session.flowInputId]).toMatchObject({ parameters: { size: 50 } });
  });

  it("shows a recoverable error for an unavailable catalog geometry", async () => {
    const session = await geometryInputEditor({ kind: "catalog", geometryId: "missing" });
    expect(text(session.render())).toContain("This catalog geometry is unavailable");
    expect(button(session.render(), "Apply changes").props.disabled).toBe(true);
    session.changeSource();
    expect(props(session.render(), GeometrySourcePicker)).toBeDefined();
  });

  it("opens saved parameters directly without needing resolved geometry and remains clean on cancel", async () => {
    const session = await geometryInputEditor();
    await session.flush();
    expect(getGeometryGeneratorVersion).toHaveBeenCalledWith(pickerGenerator.id, 1);
    expect(session.parameters().definition).toEqual(savedGenerator);
    expect(session.parameters().values).toMatchObject({ size: 0, enabled: false,
      layers: { items: [{ values: { thickness: 0 } }] } });
    expect(elements(session.render()).some((element) => element.type === GeometrySourcePicker)).toBe(false);
    await session.preview();
    expect(button(session.render(), "Apply changes").props.disabled).toBe(true);
    session.update({ size: 25 }); session.editName("Edited input");
    session.close();
    await saveNewDraft(session.app);
    expect(savedDraft.state.configuration.inputBindings[session.flowInputId]).toEqual(savedBinding);
    expect(savedDraft.state.nodes.find((node) => node.id === session.node.id)).toMatchObject({ definition: source.definition.flowInputs[0] });
    expect(createGeometry).not.toHaveBeenCalled();
  });

  it("keeps local parameter drafts when canceling source selection and offers one named generator entry", async () => {
    const session = await geometryInputEditor(); await session.flush();
    session.update({ size: 25 });
    session.changeSource();
    expect(elements(session.picker()).filter((element) => text(element) === pickerGenerator.label && element.props.onClick)).toHaveLength(1);
    expect(text(session.picker())).toContain("Geometry catalog");
    button(session.render(), "Back to geometry").props.onClick();
    expect(session.parameters().values.size).toBe(25);
    session.changeSource();
    button(session.picker(), pickerGenerator.label).props.onClick();
    expect(session.parameters().values.size).toBe(25);
    expect(getGeometryGeneratorVersion).toHaveBeenCalledTimes(1);
  });

  it.each(["unconfigured", "catalog", "other-generator"] as const)("starts a different generator with defaults from %s", async (kind) => {
    const binding: GeometryBinding | null = kind === "unconfigured" ? null
      : kind === "catalog" ? { kind: "catalog", geometryId: geometryFixtures[0].id }
      : { ...savedBinding, generatorId: otherPickerGenerator.id };
    const session = await geometryInputEditor(binding); await session.flush();
    if (kind !== "unconfigured") session.changeSource();
    button(session.picker(), pickerGenerator.label).props.onClick();
    expect(session.parameters().definition).toEqual(pickerGenerator);
    expect(session.parameters().values).toMatchObject({ size: 100, enabled: true });
    session.close();
    await saveNewDraft(session.app);
    expect(savedDraft.state.configuration.inputBindings[session.flowInputId]).toEqual(binding ?? undefined);
  });

  it("retries saved-version loading and offers source replacement on failure", async () => {
    const session = await geometryInputEditor();
    // Start another session so the initial request fails before its effect runs.
    session.hooks.unmount();
    vi.mocked(getGeometryGeneratorVersion).mockRejectedValueOnce(new Error("Saved version unavailable."));
    const fresh = new HookHarness(); sessions.push(fresh);
    const inputProps = props(session.app.render(), GeometryInputEditorDialog);
    const render = () => fresh.render(() => GeometryInputEditorDialog(inputProps));
    render(); await session.app.flush();
    expect(text(render())).toContain("Saved version unavailable.");
    expect(button(render(), "Apply changes").props.disabled).toBe(true);
    expect(button(render(), "Change source")).toBeDefined();
    button(render(), "Retry").props.onClick(); await session.app.flush();
    expect(props(generatorContent(render()), GeometryGeneratorParameters).definition).toEqual(savedGenerator);
  });

  it.each(["close", "unmount", "change-source"] as const)("ignores delayed version responses after %s", async (action) => {
    let resolve!: (definition: GeometryGeneratorDefinition) => void;
    const original = getGeometryGeneratorVersion;
    const session = await geometryInputEditor(); session.hooks.unmount();
    vi.mocked(original).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const fresh = new HookHarness(); sessions.push(fresh);
    const inputProps = props(session.app.render(), GeometryInputEditorDialog);
    const render = () => fresh.render(() => GeometryInputEditorDialog(inputProps));
    render();
    if (action === "close") button(render(), "Cancel").props.onClick();
    else if (action === "unmount") fresh.unmount();
    else button(render(), "Change source").props.onClick();
    fresh.changed = false;
    resolve(savedGenerator); await session.app.flush();
    expect(fresh.changed).toBe(false);
    if (action === "change-source") expect(props(render(), GeometrySourcePicker)).toBeDefined();
  });

  it("applies normalized parameters and input metadata together, preserving topology and other bindings", async () => {
    const session = await geometryInputEditor(); await session.flush();
    const positions = session.app.graph().nodes.map((node) => ({ id: node.id, position: node.position }));
    const edges = session.app.graph().edges.map(({ data: _data, ...edge }) => edge);
    const valid = vi.mocked(previewGeneratedGeometry).getMockImplementation()!;
    vi.mocked(previewGeneratedGeometry).mockImplementation(async (...args) => ({ ...await valid(...args),
      normalizedParameters: { ...args[2], size: 26 } }));
    session.update({ size: 25 }); session.editName("Updated input");
    expect(button(session.render(), "Apply changes").props.disabled).toBe(true);
    await session.preview();
    expect(button(session.render(), "Apply changes").props.disabled).toBe(false);
    button(session.render(), "Apply changes").props.onClick();
    expect(session.app.graph().nodes.map((node) => ({ id: node.id, position: node.position }))).toEqual(positions);
    expect(session.app.graph().edges.map(({ data: _data, ...edge }) => edge)).toEqual(edges);
    await saveNewDraft(session.app);
    expect(savedDraft.state.configuration.inputBindings).toEqual({ ...source.configuration.inputBindings,
      [session.flowInputId]: { ...savedBinding, parameters: { size: 26, enabled: false, layers: [{ id: "layers-01", thickness: 0 }] } } });
    expect(savedDraft.state.nodes.find((node) => node.id === session.node.id)).toMatchObject({ definition: { name: "Updated input" } });
    expect(createGeometry).not.toHaveBeenCalled();
  });

  it("disables Apply on invalid or failed previews and supports retry", async () => {
    const session = await geometryInputEditor(); await session.flush(); await session.preview();
    const valid = vi.mocked(previewGeneratedGeometry).getMockImplementation()!;
    vi.mocked(previewGeneratedGeometry).mockImplementationOnce(async (...args) => ({ ...await valid(...args), valid: false, errors: { size: "Must be positive" } }));
    session.update({ size: -1 }); await session.preview();
    expect(props(generatorContent(session.render()), GeometryGeneratorValidation).preview?.errors).toEqual({ size: "Must be positive" });
    expect(button(session.render(), "Apply changes").props.disabled).toBe(true);
    vi.mocked(previewGeneratedGeometry).mockRejectedValueOnce(new Error("Offline"));
    session.update({ size: 50 }); await session.preview();
    expect(props(generatorContent(session.render()), GeometryGeneratorValidation).error).toBe("Offline");
    expect(button(session.render(), "Apply changes").props.disabled).toBe(true);
    props(generatorContent(session.render()), GeometryGeneratorValidation).onRetry(); await session.preview();
    expect(button(session.render(), "Apply changes").props.disabled).toBe(false);
  });

  it("previews a pending catalog selection without committing it, then applies explicitly", async () => {
    const session = await geometryInputEditor(); await session.flush();
    session.changeSource();
    const geometry = session.selectCatalog();
    button(session.render(), "Preview geometry").props.onClick();
    const preview = props(session.app.render(), GeometryPreviewPanel).preview;
    expect(preview.request.flow!.configuration.inputBindings[session.flowInputId]).toEqual({ kind: "catalog", geometryId: geometry.id });
    expect(props(session.app.render(), GeometryInputEditorDialog).initialBinding).toEqual(savedBinding);
    props(session.app.render(), GeometryPreviewPanel).onClose();
    button(session.render(), "Apply changes").props.onClick();
    await saveNewDraft(session.app);
    expect(savedDraft.state.configuration.inputBindings[session.flowInputId]).toEqual({ kind: "catalog", geometryId: geometry.id });
  });

  it("preserves saved binding exactly when only Advanced settings change", async () => {
    const session = await geometryInputEditor(); await session.flush(); await session.preview();
    session.editName("Metadata only");
    const field = find(session.render(), (element) => element.type === "label" && text(element).startsWith("Allowed categories"));
    find(field, (element) => element.type === "input").props.onChange({ target: { value: "die.other" } });
    button(session.render(), "Apply changes").props.onClick();
    await saveNewDraft(session.app);
    expect(savedDraft.state.configuration.inputBindings[session.flowInputId]).toEqual(savedBinding);
    expect((savedDraft.state.nodes.find((node) => node.id === session.node.id) as { definition: FlowInputDefinition }).definition.geometryConstraints?.structureFormats).toEqual(["standard"]);
    expect((savedDraft.state.nodes.find((node) => node.id === session.node.id) as { definition: FlowInputDefinition }).definition.geometryConstraints?.categories).toEqual(["die.other"]);
  });
});

describe("catalog generator actions through the shared editor", () => {
  function catalogEditor() {
    const hooks = new HookHarness();
    sessions.push(hooks);
    const onClose = vi.fn();
    const render = () => hooks.render(() => BackendGeometryGeneratorDialog({
      definition: pickerGenerator, presentation: "page", onClose,
    }));
    const content = () => generatorContent(render());
    const parameters = () => props(content(), GeometryGeneratorParameters);
    async function preview() {
      render();
      await vi.advanceTimersByTimeAsync(180);
      render();
    }
    render();
    return { render, content, parameters, preview, onClose };
  }

  it("downloads the materialized structure only after a valid preview", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:geometry");
    const revokeObjectURL = vi.fn();
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("document", { body: { style: {}, appendChild: vi.fn() }, createElement: () => link });
    vi.mocked(materializeGeneratedGeometry).mockResolvedValue({
      geometryHash: "hash", geometryEntityJson: geometryFixtures[0],
    });
    const session = catalogEditor();
    expect(button(session.render(), "Generate JSON").props.disabled).toBe(true);
    expect(button(session.render(), "Save to DB").props.disabled).toBe(true);
    await session.preview();
    expect(previewGeneratedGeometry).toHaveBeenCalledTimes(1);
    expect(button(session.render(), "Generate JSON").props.disabled).toBe(false);
    button(session.render(), "Generate JSON").props.onClick();
    await session.preview();
    expect(materializeGeneratedGeometry).toHaveBeenCalledWith("token");
    expect(JSON.parse(await createObjectURL.mock.calls[0][0].text())).toEqual(geometryFixtures[0].structure);
    expect(link.download).toBe(`${pickerGenerator.id}-geometry.json`);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:geometry");
    expect(createGeometry).not.toHaveBeenCalled();
    expect(session.onClose).not.toHaveBeenCalled();
  });

  it("saves a catalog snapshot in place and keeps parameter edits connected to one preview request", async () => {
    vi.mocked(materializeGeneratedGeometry).mockResolvedValue({
      geometryHash: "hash", geometryEntityJson: geometryFixtures[0],
    });
    vi.mocked(createGeometry).mockResolvedValue({ ...geometryFixtures[0], id: "new-catalog-geometry", name: "Saved generator" });
    const session = catalogEditor();
    await session.preview();
    const originalValues = structuredClone(session.parameters().values);
    button(session.render(), "Save to DB").props.onClick();
    props(session.render(), GeometryGeneratorSaveDialog).onChange({ name: " Saved generator ", owner: " RD ", vendor: " " });
    await props(session.render(), GeometryGeneratorSaveDialog).onSubmit();
    expect(materializeGeneratedGeometry).toHaveBeenCalledWith("token");
    expect(createGeometry).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: null, name: "Saved generator", owner: "RD", vendor: null,
      structure: geometryFixtures[0].structure,
    }));
    expect(text(session.content())).toContain("new-catalog-geometry");
    expect(session.parameters().values).toEqual(originalValues);
    expect(session.onClose).not.toHaveBeenCalled();
    session.parameters().onChange({ ...originalValues, size: 125 });
    expect(text(session.content())).not.toContain("new-catalog-geometry");
    expect(button(session.render(), "Save to DB").props.disabled).toBe(true);
    await session.preview();
    expect(previewGeneratedGeometry).toHaveBeenCalledTimes(2);
    expect(previewGeneratedGeometry).toHaveBeenLastCalledWith(pickerGenerator.id, pickerGenerator.version,
      expect.objectContaining({ size: 125 }), expect.any(AbortSignal));
    expect(button(session.render(), "Save to DB").props.disabled).toBe(false);
  });

  it("shows a download failure in the shared body and clears it when parameters change", async () => {
    vi.mocked(materializeGeneratedGeometry).mockResolvedValue({
      geometryHash: "different-hash", geometryEntityJson: geometryFixtures[0],
    });
    const session = catalogEditor();
    await session.preview();
    button(session.render(), "Generate JSON").props.onClick();
    await session.preview();
    expect(text(session.content())).toContain("Preview geometry changed before materialization.");
    session.parameters().onChange({ ...session.parameters().values, size: 150 });
    expect(text(session.content())).not.toContain("Preview geometry changed before materialization.");
    expect(createGeometry).not.toHaveBeenCalled();
  });

  it("keeps metadata and the editor open when catalog persistence fails", async () => {
    vi.mocked(materializeGeneratedGeometry).mockResolvedValue({
      geometryHash: "hash", geometryEntityJson: geometryFixtures[0],
    });
    vi.mocked(createGeometry).mockRejectedValueOnce(new Error("Catalog offline"));
    const session = catalogEditor();
    await session.preview();
    button(session.render(), "Save to DB").props.onClick();
    props(session.render(), GeometryGeneratorSaveDialog).onChange({ name: "Keep draft", owner: "RD" });
    await props(session.render(), GeometryGeneratorSaveDialog).onSubmit();
    expect(props(session.render(), GeometryGeneratorSaveDialog)).toMatchObject({
      metadata: { name: "Keep draft", owner: "RD" }, error: "Catalog offline", saving: false,
    });
    expect(session.onClose).not.toHaveBeenCalled();
  });
});

describe("flow editor sources and save targets", () => {
  it("starts unsaved, creates a separate flow after edits and updates only that new ID thereafter", async () => {
    const app = await editor();
    expect(await app.start()).toBe(true);
    expect(window.location.search).toBe("");
    expect(app.status()).toMatchObject({ progress: "Unsaved changes", saved: false });
    expect(app.header().draftControl).not.toBeNull();
    expect(beforeUnload.size).toBe(1);
    expect(createProcessFlow).not.toHaveBeenCalled();
    expect(updateProcessFlow).not.toHaveBeenCalled();
    const graph = app.graph();
    const node = graph.nodes.find((node) => node.type === "processStep")!;
    graph.onNodeDoubleClick!({} as React.MouseEvent, node);
    const inspector = find(app.render(), (element) => typeof element.props.onStepLabelChange === "function");
    inspector.props.onStepLabelChange("Branch label");
    app.openSave();
    expect(app.saveDialog()).toMatchObject({ hasTarget: false, blockingIssues: [] });
    await app.save();
    expect(createProcessFlow).toHaveBeenCalledOnce();
    const request = vi.mocked(createProcessFlow).mock.calls[0][0];
    expect(request).toMatchObject({ name: `${source.name} (branch)`, version: source.version,
      origin: { flowId: source.id, revision: source.revision }, configuration: source.configuration });
    expect(request.definition.stepRefs[0].stepLabel).toBe("Branch label");
    expect(request).not.toHaveProperty("id");
    expect(request).not.toHaveProperty("revision");
    expect(source).toEqual(beforeSource);
    expect(window.location.search).toBe("?flowId=new-branch");
    expect(app.header().draftControl).toBeNull();
    app.openSave(); await app.save();
    expect(updateProcessFlow).toHaveBeenCalledWith("new-branch", expect.objectContaining({ revision: 1, origin: request.origin }));
    expect(app.status().progress).toBe("Saved flow · revision 2");
  });

  it("can save the untouched snapshot and keeps incomplete recipes without adding defaults", async () => {
    const config = Object.values(source.configuration.stepConfigurations)[0];
    config.selectedRecipeId = null;
    config.recipeCandidates.push({ recipeId: "partial", name: "Partial", description: "", parameterValues: {} });
    beforeSource = structuredClone(source);
    const app = await editor();
    await app.start(); app.openSave(); await app.save();
    expect(createProcessFlow).toHaveBeenCalledWith(expect.objectContaining({ definition: source.definition, configuration: source.configuration }));
    expect(updateProcessFlow).not.toHaveBeenCalled();
    expect(source).toEqual(beforeSource);
  });

  it("clears an existing edit target and numbers subsequent branches in the same editor", async () => {
    const app = await editor(`?flowId=${source.id}`);
    expect(app.status().saved).toBe(true);
    await app.start();
    expect(app.openSave()).toMatchObject({ hasTarget: false, metadata: { name: `${source.name} (branch)` } });
    await app.save();
    await app.start();
    expect(app.openSave()).toMatchObject({ hasTarget: false, metadata: { name: `${source.name} (branch 2)` } });
    expect(window.location.search).toBe("");
    expect(app.status().saved).toBe(false);
    expect(createProcessFlow).toHaveBeenCalledOnce();
    expect(updateProcessFlow).not.toHaveBeenCalled();
    expect(source).toEqual(beforeSource);
  });

  it("saves a branch draft, resumes it and commits a new flow with the same origin", async () => {
    const app = await editor();
    await app.start();
    const control = app.header().draftControl as Element;
    button(control, " Save Draft").props.onClick();
    for (const [label, value] of [["Draft name", "Branch work"], ["User", "RD"]]) {
      const field = find(app.render(), (element) => element.type === "label" && text(element).startsWith(label));
      find(field, (element) => element.type === "input").props.onChange({ target: { value } });
    }
    find(app.render(), (element) => element.type === "form").props.onSubmit({ preventDefault() {} });
    await app.flush();
    expect(savedDraft.origin).toEqual({ flowId: source.id, revision: source.revision });
    expect(savedDraft.state.configuration).toEqual(source.configuration);
    expect(window.location.search).toBe("?draftId=branch-draft");
    const resumed = await editor("?draftId=branch-draft");
    expect(resumed.status().saved).toBe(true);
    resumed.openSave(); await resumed.save();
    expect(commitFlowDraft).toHaveBeenCalledWith(savedDraft, expect.objectContaining({
      origin: savedDraft.origin, definition: source.definition, configuration: source.configuration,
    }));
    expect(createProcessFlow).not.toHaveBeenCalled();
    expect(updateProcessFlow).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?flowId=committed-branch");
    expect(source).toEqual(beforeSource);
  });

  it("detaches a saved draft when starting from a flow, leaving that draft intact", async () => {
    savedDraft = { schemaVersion: 2, id: "old-draft", user: "RD", name: "Old work", revision: 1,
      createdAt: "2026-11-05T12:00:00Z", updatedAt: "2026-11-05T12:00:00Z",
      state: { metadata: { name: "Old flow", version: source.version, owner: source.owner, description: "" },
        configuration: structuredClone(source.configuration), editingRecipeIds: {},
        nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } };
    const oldDraft = structuredClone(savedDraft);
    const app = await editor("?draftId=old-draft");
    await app.start(); app.openSave(); await app.save();
    expect(createProcessFlow).toHaveBeenCalledOnce();
    expect(commitFlowDraft).not.toHaveBeenCalled();
    expect(deleteFlowDraft).not.toHaveBeenCalled();
    expect(savedDraft).toEqual(oldDraft);
  });

  it("preserves unsaved edits when source replacement is cancelled or loading fails", async () => {
    const app = await editor(`?flowId=${source.id}`);
    app.openSave().onChange({ name: "Unsaved name" });
    app.saveDialog().onClose();
    app.header().onStartFrom();
    const pending = props(app.render(), FlowSourceDialog).onUseFlow(source.id);
    await app.flush();
    const confirmation = find(app.render(), (element) => element.type === EditorDialog && element.props.title === "Discard unsaved changes?");
    button(confirmation.props.footer, "Keep editing").props.onClick();
    expect(await pending).toBe(false);
    expect(app.header().subtitle).toBe("Unsaved name");
    expect(window.location.search).toBe(`?flowId=${source.id}`);
    vi.mocked(getProcessFlow).mockRejectedValueOnce(new Error("Source unavailable"));
    await expect(props(app.render(), FlowSourceDialog).onUseFlow(source.id)).rejects.toThrow("Source unavailable");
    expect(app.openSave()).toMatchObject({ metadata: { name: "Unsaved name" }, hasTarget: true });
    expect(source).toEqual(beforeSource);
  });

  it("retains a failed branch save and lets a name collision be fixed without updating the source", async () => {
    const app = await editor();
    await app.start(); app.openSave();
    vi.mocked(createProcessFlow).mockRejectedValueOnce(new ApiRequestError("A process flow with this name and version already exists.", 409));
    await app.save();
    expect(app.saveDialog()).toMatchObject({ hasTarget: false, conflict: false });
    expect(app.saveDialog().error).toContain("Change the name or version");
    expect(app.status().saved).toBe(false);
    expect(window.location.search).toBe("");
    app.saveDialog().onChange({ name: "Another branch" });
    await app.save();
    expect(createProcessFlow).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Another branch", origin: { flowId: source.id, revision: source.revision } }));
    expect(updateProcessFlow).not.toHaveBeenCalled();
    expect(source).toEqual(beforeSource);
  });

  it("validates missing step dependencies before replacing the current saved flow", async () => {
    const app = await editor(`?flowId=${source.id}`);
    const invalid = structuredClone(source);
    invalid.definition.stepRefs[0].processStepTemplateId = "missing-template";
    vi.mocked(getProcessFlow).mockResolvedValueOnce(invalid);
    app.header().onStartFrom();
    await expect(props(app.render(), FlowSourceDialog).onUseFlow(source.id)).rejects.toThrow("Missing step templates");
    expect(app.openSave()).toMatchObject({ hasTarget: true, metadata: { name: source.name } });
    expect(window.location.search).toBe(`?flowId=${source.id}`);
    expect(app.graph().nodes).toHaveLength(source.definition.flowInputs.length + source.definition.stepRefs.length);
    expect(source).toEqual(beforeSource);
  });

  it("keeps direct editing and conflict reload on the original flow identity", async () => {
    const app = await editor(`?flowId=${source.id}`);
    expect(app.header().draftControl).toBeNull();
    app.openSave().onChange({ name: "Edited" });
    vi.mocked(updateProcessFlow).mockRejectedValueOnce(new ApiRequestError("Flow changed in another session.", 409));
    await app.save();
    expect(updateProcessFlow).toHaveBeenCalledWith(source.id, expect.objectContaining({ revision: source.revision, origin: source.origin }));
    expect(app.saveDialog()).toMatchObject({ hasTarget: true, conflict: true, metadata: { name: "Edited" } });
    const latest = { ...structuredClone(source), revision: source.revision + 1, name: "Latest saved" };
    vi.mocked(getProcessFlow).mockResolvedValueOnce(latest);
    app.saveDialog().onReload(); await app.flush();
    const confirmation = find(app.render(), (element) => element.type === EditorDialog && element.props.title === "Discard unsaved changes?");
    button(confirmation.props.footer, "Discard changes").props.onClick();
    await app.flush(); await app.flush();
    expect(app.openSave()).toMatchObject({ hasTarget: true, metadata: { name: latest.name } });
    await app.save();
    expect(updateProcessFlow).toHaveBeenLastCalledWith(source.id, expect.objectContaining({ revision: latest.revision }));
    expect(createProcessFlow).not.toHaveBeenCalled();
  });

  it("does not let an old edit-layout completion mark a new branch as saved", async () => {
    let completeFit!: (value: boolean) => void;
    canvas.fitView.mockReturnValueOnce(new Promise<boolean>((resolve) => { completeFit = resolve; }));
    const app = await editor(`?flowId=${source.id}`);
    // The initial URL load has not yet finished fitting its viewport.
    const pending = app.start(); await app.flush();
    const confirmation = elements(app.render()).find((element) => element.type === EditorDialog && element.props.title === "Discard unsaved changes?");
    if (confirmation) button(confirmation.props.footer, "Discard changes").props.onClick();
    await pending;
    completeFit(true); await app.flush();
    expect(app.status()).toMatchObject({ saved: false, progress: "Unsaved changes" });
    expect(beforeUnload.size).toBeGreaterThan(0);
  });
});

describe("Start from dialog actions", () => {
  it("explains deferred creation, uses a flow as a starting point and still resumes drafts", async () => {
    const hooks = new HookHarness();
    sessions.push(hooks);
    const onUseFlow = vi.fn().mockResolvedValue(true), onClose = vi.fn();
    const drafts: React.ComponentProps<typeof FlowSourceDialog>["drafts"] = {
      busy: false, loading: false, pickerContent: <></>,
      selectedDraft: { schemaVersion: 2, id: "resume-draft", user: "RD", name: "Draft", revision: 1, createdAt: "", updatedAt: "" },
      setPickerOpen: vi.fn(), load: vi.fn().mockResolvedValue(true),
    };
    const render = () => hooks.render(() => FlowSourceDialog({ flows: [source], drafts, onUseFlow, onClose }));
    expect(render().props.description).toContain("Save creates a new flow; the source stays unchanged.");
    find(render(), (element) => element.props["aria-pressed"] === false).props.onClick();
    button(render().props.footer, "Use as starting point").props.onClick();
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();
    expect(onUseFlow).toHaveBeenCalledWith(source.id);
    expect(onClose).toHaveBeenCalledOnce();
    onClose.mockClear(); onUseFlow.mockClear();
    find(render(), (element) => typeof element.props.onValueChange === "function").props.onValueChange("drafts");
    expect(render().props.description).toContain("Resume a draft");
    button(render().props.footer, "Resume draft").props.onClick();
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();
    expect(drafts.load).toHaveBeenCalledWith(drafts.selectedDraft);
    expect(onUseFlow).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
