// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewCowDies, previewWafer, exportWafer, type CowDiePattern, type WaferPattern } from "./wafer-arrangement-client";
import { WaferArrangementPage } from "./wafer-arrangement-page";

vi.mock("./wafer-arrangement-client", () => ({ previewCowDies: vi.fn(), previewWafer: vi.fn(), exportWafer: vi.fn() }));

const noDies = { soc: 0, hbm: 0, lsi: 0, soic: 0, dmy: 0 };
const dieJson = { nested: [{ soc: { socCount: 99, socInfo: { "SOC-1": { bottomLeftX: -100, bottomLeftY: -200, upperRightX: 300, upperRightY: 400 } } } }] };
function diePattern(outside = false): CowDiePattern {
  return { dieLayers: [{ type: "soc", layer: 888, datatype: 1, count: 1,
    dies: [{ id: "SOC-1", path: "dieJson.nested[0].soc.socInfo.SOC-1", rectangle: [-100, -200, 300, 400] }] }],
    totalDies: 1, cowRectangle: [-20000, -25000, 20000, 25000], warnings: [],
    outOfBounds: outside ? [{ type: "soc", id: "SOC-1", path: "dieJson.nested[0].soc.socInfo.SOC-1", message: "SOC-1 extends outside the COW boundary." }] : [] };
}
async function chooseJson(name: string, text: string | Promise<string> = JSON.stringify(dieJson)) {
  const file = new File([], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  await act(async () => {
    const field = document.getElementById("cow-die-json") as HTMLInputElement;
    Object.defineProperty(field, "files", { configurable: true, value: [file] });
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function pattern(count = 21): WaferPattern {
  return { normalizedParameters: { allowableDiameter: 290000, cowSize: { x: 40000, y: 50000 }, cowSpacing: { x: 1000, y: 1000 }, arrangeType: "center",
    dummyLayers: [{ size: { x: 8000, y: 10000 }, minSpacing: { x: 100, y: 100 } }] },
    cowCount: count, cowAreaUtilization: .635, totalRectangles: count + 1, cowRectangles: [[-20000, -25000, 20000, 25000]], boundaryCells: [],
    dummyLayers: [{ layer: 413, datatype: 10, count: 1, rectangles: [[25000, 0, 33000, 10000]],
      x: { count: 4, a: 100, b: 300, bMax: 300 }, y: { count: 4, a: 100, b: 300, bMax: 300 } }], warnings: [] };
}
let host: HTMLDivElement;
let root: Root;
function button(text: string) {
  const element = [...host.querySelectorAll("button")].find(item => item.textContent === text || item.getAttribute("aria-label") === text);
  if (!element) throw new Error(`Missing button ${text}`);
  return element;
}
function input(id: string, value: string) {
  act(() => {
    const field = document.getElementById(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function fill() {
  for (const [id, value] of Object.entries({ diameter: "290000", "cow-size-x": "40000", "cow-size-y": "50000", "cow-space-x": "1000", "cow-space-y": "1000",
    "dummy-1-size-x": "8000", "dummy-1-size-y": "10000", "dummy-1-gap-x": "100", "dummy-1-gap-y": "100" })) input(id, value);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(previewWafer).mockReset(); vi.mocked(exportWafer).mockReset();
  vi.mocked(previewCowDies).mockReset();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<React.StrictMode><WaferArrangementPage /></React.StrictMode>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("wafer arrangement interactions", () => {
  it("shows a wafer circle immediately and updates its diameter before generating any pattern", () => {
    const reference = () => host.querySelector('[data-wafer-outline="reference"]')!;
    const allowable = () => host.querySelector('[data-wafer-outline="allowable"]');
    expect(reference().getAttribute("r")).toBe("150000");
    expect(allowable()).toBeNull();
    expect(host.textContent).toContain("Wafer reference Ø 300,000 µm");
    expect((document.getElementById("diameter") as HTMLInputElement).value).toBe("");
    input("diameter", "290000");
    expect(allowable()?.getAttribute("r")).toBe("145000");
    expect(reference().getAttribute("r")).toBe("150000");
    expect(host.textContent).toContain("Allowable Ø 290,000 µm");
    expect(button("Export GDS").disabled).toBe(true);
    for (const invalid of ["", "0", "-1", "300000"]) {
      input("diameter", invalid);
      expect(allowable()).toBeNull();
      expect(reference().getAttribute("r")).toBe("150000");
    }
    expect(previewWafer).not.toHaveBeenCalled();
  });

  it("updates the allowable circle over an existing pattern without replacing its geometry", async () => {
    fill(); vi.mocked(previewWafer).mockResolvedValue(pattern());
    await act(async () => button("Generate pattern").click());
    const geometry = host.querySelector('svg[aria-label="Wafer arrangement XY preview"] path.stroke-primary');
    const originalPath = geometry?.getAttribute("d");
    expect(originalPath).toBeTruthy();
    input("diameter", "200000");
    expect(host.querySelector('[data-wafer-outline="allowable"]')?.getAttribute("r")).toBe("100000");
    expect(host.querySelector('[data-wafer-outline="generated"]')?.getAttribute("r")).toBe("145000");
    expect(geometry?.getAttribute("d")).toBe(originalPath);
    expect(host.textContent).toContain("Previous pattern Ø 290,000 µm");
    expect(host.textContent).toContain("Parameters changed");
    expect(button("Export GDS").disabled).toBe(true);
    expect(previewWafer).toHaveBeenCalledTimes(1);
    input("diameter", "290000");
    expect(host.querySelector('[data-wafer-outline="generated"]')).toBeNull();
  });

  it("focuses a linked error summary, preserves inline messages, and makes no request for blanks", async () => {
    await act(async () => button("Generate pattern").click());
    expect(previewWafer).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("role")).toBe("alert");
    expect(host.querySelectorAll('[aria-invalid="true"]')).toHaveLength(9);
    expect(button("Export GDS").disabled).toBe(true);
  });

  it("keeps layers independent and renumbers their GDS datatypes after removal", () => {
    input("dummy-1-size-x", "1234");
    act(() => button("Add layer").click());
    const second = host.querySelectorAll('input[id$="-size-x"]')[2] as HTMLInputElement;
    expect(second.value).toBe("");
    expect(host.textContent).toContain("413:11");
    act(() => (host.querySelector('[aria-label="Remove dummy layer 1"]') as HTMLButtonElement).click());
    expect(host.textContent).not.toContain("413:11");
    expect(host.textContent).toContain("413:10");
    act(() => (host.querySelector('[aria-label="Remove dummy layer 1"]') as HTMLButtonElement).click());
    expect(host.textContent).toContain("COW-only pattern");
  });

  it("ignores an older response, invalidates on edit, and exports all layers despite hidden previews", async () => {
    fill();
    const older = deferred<WaferPattern>(), newer = deferred<WaferPattern>();
    vi.mocked(previewWafer).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await act(async () => button("Generate pattern").click());
    const firstSignal = vi.mocked(previewWafer).mock.calls[0][1]!;
    input("cow-space-x", "2000");
    expect(firstSignal.aborted).toBe(true);
    await act(async () => button("Generate pattern").click());
    const latest = pattern(22); latest.normalizedParameters.cowSpacing.x = 2000;
    await act(async () => newer.resolve(latest));
    await act(async () => older.resolve(pattern(99)));
    expect(host.textContent).not.toContain("99");
    expect(host.textContent).toContain("Pattern ready");
    expect(button("Export GDS").disabled).toBe(false);
    const dummyToggle = [...host.querySelectorAll('input[type="checkbox"]')].at(-1) as HTMLInputElement;
    act(() => dummyToggle.click());
    input("gds-output-path", "/tmp/wafer.gds");
    vi.mocked(exportWafer).mockResolvedValue({ outputPath: "/tmp/wafer.gds", cowCount: 22, dummyCounts: [1], dieCounts: noDies, totalRectangles: 23, warnings: [] });
    await act(async () => button("Export GDS").click());
    expect(exportWafer).toHaveBeenCalledWith(latest.normalizedParameters, "/tmp/wafer.gds", expect.any(AbortSignal));
    expect(host.textContent).toContain("GDS exported");
    input("diameter", "280000");
    expect(host.textContent).toContain("Parameters changed");
    expect(button("Export GDS").disabled).toBe(true);
    expect(host.textContent).not.toContain("GDS exported");
  });

  it("supports generation retry, zero COW, and export errors without losing parameters", async () => {
    fill();
    vi.mocked(previewWafer).mockRejectedValueOnce(new Error("API unavailable")).mockResolvedValueOnce(pattern(0)).mockResolvedValueOnce(pattern());
    await act(async () => button("Generate pattern").click());
    expect(host.textContent).toContain("API unavailable");
    await act(async () => button("Generate pattern").click());
    expect(button("Export GDS").disabled).toBe(true);
    await act(async () => button("Generate pattern").click());
    await act(async () => button("Export GDS").click());
    expect(host.textContent).toContain("Enter an absolute output file path");
    input("gds-output-path", "/missing/wafer.gds");
    vi.mocked(exportWafer).mockRejectedValueOnce(new Error("GDS output folder must already exist"));
    await act(async () => button("Export GDS").click());
    expect(host.textContent).toContain("GDS output folder must already exist");
    expect((document.getElementById("cow-size-x") as HTMLInputElement).value).toBe("40000");
    expect(button("Export GDS").disabled).toBe(false);
  });

  it("imports a single COW before wafer parameters exist and can remove the optional file", async () => {
    expect(button("CoW pattern graph").disabled).toBe(true);
    const layout = diePattern(); layout.cowRectangle = null;
    vi.mocked(previewCowDies).mockResolvedValue(layout);
    await chooseJson("cow.json");
    expect(previewCowDies).toHaveBeenCalledWith(dieJson, undefined, expect.any(AbortSignal));
    expect(previewWafer).not.toHaveBeenCalled();
    expect(host.querySelector('svg[aria-label="Single COW die XY preview"]')).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("1 die per CoW");
    act(() => button("CoW pattern graph").click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.querySelector('svg[aria-label="Single COW die XY preview"]')).not.toBeNull();
    expect(host.textContent).toContain("cow.json");
    expect(host.textContent).toContain("888:1 · 1 die");
    expect(host.textContent).toContain("Enter a valid COW size");
    act(() => button("Remove JSON").click());
    expect(host.querySelector('svg[aria-label="Single COW die XY preview"]')).toBeNull();
    expect(host.textContent).toContain("No JSON selected");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(button("CoW pattern graph").disabled).toBe(true);
  });

  it("closes the graph with Escape and returns keyboard focus to its trigger", async () => {
    vi.mocked(previewCowDies).mockResolvedValue(diePattern());
    await chooseJson("cow.json");
    const trigger = button("CoW pattern graph");
    trigger.focus();
    act(() => trigger.click());
    expect(host.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
    act(() => trigger.click());
    act(() => button("Close dialog").click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ignores superseded file reads and older die API responses", async () => {
    const oldFile = deferred<string>();
    const oldResponse = deferred<CowDiePattern>();
    vi.mocked(previewCowDies).mockReturnValueOnce(oldResponse.promise).mockResolvedValue(diePattern());
    await chooseJson("slow-file.json", oldFile.promise);
    await chooseJson("old-api.json");
    const oldSignal = vi.mocked(previewCowDies).mock.calls[0][2]!;
    await chooseJson("latest.json");
    expect(oldSignal.aborted).toBe(true);
    const obsolete = diePattern(); obsolete.totalDies = 999;
    await act(async () => { oldResponse.resolve(obsolete); oldFile.resolve("not JSON"); });
    expect(previewCowDies).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("latest.json");
    expect(host.textContent).not.toContain("999 die");
    expect(host.textContent).not.toContain("Choose a valid JSON");
  });

  it("rechecks COW dimensions, preserves outside geometry, and blocks export until cleared", async () => {
    fill(); vi.mocked(previewWafer).mockResolvedValue(pattern());
    await act(async () => button("Generate pattern").click());
    vi.mocked(previewCowDies).mockResolvedValueOnce(diePattern());
    await chooseJson("cow.json");
    expect(button("Export GDS").disabled).toBe(false);
    const checking = deferred<CowDiePattern>(); vi.mocked(previewCowDies).mockReturnValueOnce(checking.promise);
    input("cow-size-x", "400");
    expect(button("Export GDS").disabled).toBe(true);
    const updated = pattern(); updated.normalizedParameters.cowSize.x = 400;
    vi.mocked(previewWafer).mockResolvedValueOnce(updated);
    await act(async () => button("Generate pattern").click());
    await act(async () => checking.resolve(diePattern(true)));
    expect(previewCowDies).toHaveBeenLastCalledWith(dieJson, { x: 400, y: 50000 }, expect.any(AbortSignal));
    expect(host.textContent).toContain("1 die outside CoW. Export is blocked.");
    act(() => button("CoW pattern graph").click());
    expect(host.querySelector('svg[aria-label="Single COW die XY preview"]')).not.toBeNull();
    expect(host.textContent).toContain("SOC-1 extends outside");
    expect(button("Export GDS").disabled).toBe(true);
    act(() => button("Remove JSON").click());
    expect(button("Export GDS").disabled).toBe(false);
  });

  it("handles JSON syntax and API errors and allows selecting the same filename again", async () => {
    fill(); vi.mocked(previewWafer).mockResolvedValue(pattern());
    await act(async () => button("Generate pattern").click());
    await chooseJson("cow.json", "{");
    expect(host.textContent).toContain("Choose a valid JSON file");
    expect(previewCowDies).not.toHaveBeenCalled();
    expect(button("Export GDS").disabled).toBe(true);
    vi.mocked(previewCowDies).mockRejectedValueOnce(new Error("dieJson.soc.socInfo.SOC-1: missing coordinate"));
    await chooseJson("cow.json");
    expect(host.textContent).toContain("SOC-1: missing coordinate");
    vi.mocked(previewCowDies).mockResolvedValueOnce(diePattern());
    await chooseJson("cow.json");
    expect(host.textContent).not.toContain("missing coordinate");
    expect(button("Export GDS").disabled).toBe(false);
  });

  it("exports the selected source despite hidden die layers and locks file edits while writing", async () => {
    fill(); vi.mocked(previewWafer).mockResolvedValue(pattern());
    await act(async () => button("Generate pattern").click());
    vi.mocked(previewCowDies).mockResolvedValueOnce(diePattern());
    await chooseJson("cow.json");
    act(() => button("CoW pattern graph").click());
    const socToggle = [...host.querySelectorAll('label')].find(label => label.textContent?.includes("888:1"))!.querySelector("input")!;
    act(() => socToggle.click());
    expect(host.querySelector('[data-die-type="soc"]')).toBeNull();
    act(() => button("Close dialog").click());
    input("gds-output-path", "/tmp/wafer.gds");
    const writing = deferred<Awaited<ReturnType<typeof exportWafer>>>();
    vi.mocked(exportWafer).mockReturnValueOnce(writing.promise);
    await act(async () => button("Export GDS").click());
    expect(exportWafer).toHaveBeenCalledWith(pattern().normalizedParameters, "/tmp/wafer.gds", expect.any(AbortSignal), dieJson);
    expect(document.getElementById("cow-die-json")!.matches(":disabled")).toBe(true);
    expect(button("Remove JSON").matches(":disabled")).toBe(true);
    await act(async () => writing.resolve({ outputPath: "/tmp/wafer.gds", cowCount: 21, dummyCounts: [1], dieCounts: { ...noDies, soc: 21 }, totalRectangles: 43, warnings: [] }));
    expect(host.textContent).toContain("COW die on wafer: SOC 21");
    expect(document.getElementById("cow-die-json")!.matches(":disabled")).toBe(false);
  });
});
