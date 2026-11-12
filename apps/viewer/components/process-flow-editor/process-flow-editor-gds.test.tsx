// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import flowFixtures from "../../../api/src/process_flow_api/fixtures/process-flows.json";
import stepFixtures from "../../../api/src/process_flow_api/fixtures/process-step-templates.json";
import geometryFixtures from "../../../api/src/process_flow_api/fixtures/geometries.json";
import { ProcessFlowEditor } from "./process-flow-editor";
import type { ProcessFlow } from "@/lib/process-flow/types";
import type { GdsImportResponse } from "@/components/process-flow-fields/gds-coordinate-import.worker";
import type { ProcessFlowGraphNodeData } from "@/components/process-flow-graph/process-flow-graph";

// Keep the actual editor, provider, node/recipe dialogs, parameter controls and
// portals together. Hook mocks cannot detect a missing provider in this tree.
const { data, canvas } = vi.hoisted(() => ({
  data: { flow: null as ProcessFlow | null },
  canvas: { fitView: vi.fn(async () => true), getViewport: () => ({ x: 0, y: 0, zoom: 1 }) },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...await importOriginal<object>(), useReactFlow: () => canvas,
}));
vi.mock("@/components/geometry-preview/file-export-jobs-provider", () => ({
  useFileExportJobs: () => ({ registerJob: vi.fn() }),
}));
vi.mock("@/lib/process-flow-api", async (importOriginal) => ({
  ...await importOriginal<object>(),
  loadBootstrap: async () => ({
    processFlows: [data.flow], processStepTemplates: stepFixtures,
    geometries: geometryFixtures, geometryGenerators: [],
  }),
  getProcessFlow: async () => structuredClone(data.flow),
}));
vi.mock("@/components/process-flow-graph/process-flow-graph", () => ({
  ProcessFlowGraph: ({ nodes }: { nodes: { id: string; data: ProcessFlowGraphNodeData }[] }) => (
    <div>{nodes.filter((node) => node.data.onEdit).map((node) => (
      <button key={node.id} onClick={() => node.data.onEdit?.(node.id)}>
        Edit {node.data.stepRefId}
      </button>
    ))}</div>
  ),
}));

const workers: ImportWorker[] = [];
class ImportWorker {
  onmessage?: (event: { data: GdsImportResponse }) => void;
  request?: { requestId: string; criteria: unknown[] };
  terminate = vi.fn();
  constructor() { workers.push(this); }
  postMessage(request: ImportWorker["request"]) { this.request = request; }
  succeed() {
    this.onmessage?.({ data: {
      type: "success", requestId: this.request!.requestId,
      regions: [{ type: "rectangle", bounds: [[0, 0], [2, 2]] }],
      matchedElements: 1, duplicatesRemoved: 0, repairedElements: 0,
      unrepairedElements: 0, repairDiagnostics: [], nonOrthogonalRegions: 0,
      topCellNames: [], unsupportedElements: {}, unresolvedReferences: 0, cyclicReferences: 0,
    } });
  }
}

let root: Root;
let frames: FrameRequestCallback[];
function button(label: string, within: ParentNode = document) {
  const result = Array.from(within.querySelectorAll("button")).find((element) =>
    element.textContent === label || element.getAttribute("aria-label") === label || element.title === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function click(element: HTMLElement) { act(() => { element.focus(); element.click(); }); }
function field(label: string) {
  const result = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!result) throw new Error(`Missing field: ${label}`);
  return result;
}
function type(label: string, value: string) {
  act(() => {
    const input = field(label);
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function flushFrames() { act(() => frames.splice(0).forEach((frame) => frame(0))); }
function openStep(id: string) {
  click(button(`Edit ${id}`));
  click(button("Edit recipe Recipe 1"));
  click(button("Import from GDS"));
}
function closeStep(action: "Save recipe" | "Cancel") {
  click(button(action));
  flushFrames();
  click(button("Close", document.querySelector('[aria-label="Edit flow node"]')!));
  flushFrames();
}
async function importGds(chooseFile: boolean, layer: string) {
  if (chooseFile) {
    const file = new File(["test"], "shared-layout.gds");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(4) });
    act(() => {
      Object.defineProperty(field("GDS file"), "files", { configurable: true, value: [file] });
      field("GDS file").dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  type("Pattern 1 layer", layer);
  type("Pattern 1 datatype", "0");
  await act(async () => button("Import and replace").click());
  act(() => workers.at(-1)!.succeed());
  flushFrames();
  expect(document.body.textContent).toContain("Imported 1 target regions");
}

beforeEach(async () => {
  data.flow = structuredClone(flowFixtures.find((flow) => flow.id === "flow_inst_aaa_demo_hbm4_alpha")) as unknown as ProcessFlow;
  const pnp = data.flow.definition.stepRefs.find((step) => step.stepRefId === "pnp_hbm")!;
  data.flow.definition.stepRefs.push({ ...pnp, stepRefId: "pnp_second", stepLabel: "Second PNP" });
  data.flow.configuration.stepConfigurations.pnp_second = structuredClone(data.flow.configuration.stepConfigurations.pnp_hbm);
  history.replaceState(null, "", `/flow-editor?flowId=${data.flow.id}`);
  workers.length = 0;
  frames = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", ImportWorker);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden], [aria-hidden="true"]') ? [] : [{}]) as unknown as DOMRectList;
  });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<React.StrictMode><ProcessFlowEditor /></React.StrictMode>));
  await act(async () => frames.splice(0).forEach((frame) => frame(0)));
});
afterEach(() => {
  act(() => root.unmount());
  flushFrames();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["Save recipe", "Cancel"] as const)("reuses a successful GDS file across PNP steps after %s", async (action) => {
  openStep("pnp_hbm");
  await importGds(true, "7");
  closeStep(action);

  openStep("pnp_second");
  expect(document.querySelector('form[role="dialog"]')!.textContent).toContain("shared-layout.gds");
  expect(button("Change file")).toBeDefined();
  expect(field("Pattern 1 layer").value).toBe("");
  await importGds(false, "12");
  expect(workers[1].request?.criteria).toEqual([{ layer: 12, datatype: 0, cellNameFilter: undefined }]);
  closeStep(action);

  openStep("pnp_hbm");
  expect(document.querySelector('form[role="dialog"]')!.textContent).toContain("shared-layout.gds");
});

it("keeps the shared GDS available when browser storage is blocked", async () => {
  for (const storage of ["localStorage", "sessionStorage"] as const) {
    vi.spyOn(window, storage, "get").mockImplementation(() => {
      throw new DOMException("Storage is blocked", "SecurityError");
    });
  }
  openStep("pnp_hbm");
  await importGds(true, "7");
  closeStep("Save recipe");

  openStep("pnp_second");
  expect(document.querySelector('form[role="dialog"]')!.textContent).toContain("shared-layout.gds");
  await importGds(false, "12");
});
