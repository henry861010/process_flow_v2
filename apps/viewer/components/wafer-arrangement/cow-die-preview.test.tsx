// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CowDiePreview } from "./cow-die-preview";
import type { CowDiePattern } from "./wafer-arrangement-client";

let host: HTMLDivElement;
let root: Root;
const pattern: CowDiePattern = {
  dieLayers: [{ type: "soc", layer: 888, datatype: 1, count: 1,
    dies: [{ id: "SOC-1", path: "dieJson.soc.socInfo.SOC-1", rectangle: [-10, -20, 300, 400] }] }],
  totalDies: 1, cowRectangle: [0, 0, 200, 200],
  outOfBounds: [{ type: "soc", id: "SOC-1", path: "dieJson.soc.socInfo.SOC-1", message: "SOC-1 extends outside the COW boundary." }], warnings: [],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root.render(<CowDiePreview pattern={pattern} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("single COW viewer", () => {
  it("fits outside die, supports keyboard navigation and exposes inspectable IDs and coordinates", () => {
    const svg = host.querySelector("svg[role=group]")!;
    const camera = () => svg.querySelector("g")!.getAttribute("transform");
    const fitted = camera();
    // Bounds include the outside die: [-10,-20,300,400], centered at (145,190).
    expect(fitted).toContain("translate(-145,-190)");
    act(() => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true })));
    expect(camera()).not.toBe(fitted);
    act(() => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(camera()).toBe(fitted);
    const details = host.querySelector("details")!;
    act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    const inspect = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("SOC-1"))!;
    expect(inspect.textContent).toContain("(-10, -20) → (300, 400) µm");
    act(() => inspect.click());
    expect(svg.querySelector('[stroke-width="2.5"]')).not.toBeNull();
    act(() => host.querySelector("input")!.click());
    expect(svg.querySelector('[data-die-type="soc"]')).toBeNull();
    expect(svg.querySelector('[stroke-width="2.5"]')).toBeNull();
    expect(host.textContent).toContain("Export is blocked");
  });

  it("paginates die inspection without materializing every row", () => {
    const many = { ...pattern, totalDies: 51, dieLayers: [{ ...pattern.dieLayers[0], count: 51,
      dies: Array.from({ length: 51 }, (_, index) => ({ ...pattern.dieLayers[0].dies[0], id: `SOC-${index + 1}` })) }] };
    act(() => root.render(<CowDiePreview pattern={many} />));
    expect(host.querySelectorAll("li")).toHaveLength(1); // Only the outside error before expanding.
    const details = host.querySelector("details")!;
    act(() => { details.open = true; details.dispatchEvent(new Event("toggle")); });
    expect(details.querySelectorAll("li")).toHaveLength(50);
    act(() => [...host.querySelectorAll("button")].find(button => button.textContent === "Next die")!.click());
    expect(details.querySelectorAll("li")).toHaveLength(1);
    expect(details.textContent).toContain("SOC-51");
  });
});
