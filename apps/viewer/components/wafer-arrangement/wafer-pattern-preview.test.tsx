// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WaferPatternPreview } from "./wafer-pattern-preview";

let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

describe("initial wafer outline hydration", () => {
  it.each([undefined, 290000])("hydrates the server-rendered outline at diameter %s without replacing it", async allowableDiameter => {
    const preview = <WaferPatternPreview allowableDiameter={allowableDiameter} />;
    host.innerHTML = renderToString(preview);
    const circle = host.querySelector('[data-wafer-outline="reference"]');
    const recoverableErrors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(host, preview, { onRecoverableError: error => recoverableErrors.push(error) });
    });
    expect(recoverableErrors).toEqual([]);
    expect(host.querySelector('[data-wafer-outline="reference"]')).toBe(circle);
    expect(circle?.getAttribute("r")).toBe("150000");
    const allowable = host.querySelector('[data-wafer-outline="allowable"]');
    if (allowableDiameter === undefined) expect(allowable).toBeNull();
    else expect(allowable?.getAttribute("r")).toBe(String(allowableDiameter / 2));
    expect(host.querySelector("title")?.textContent).toBe(`${allowableDiameter ? "Allowable wafer" : "Wafer reference"} diameter ${allowableDiameter ?? 300000} µm; no pattern generated`);
  });
});
