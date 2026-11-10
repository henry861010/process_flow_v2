import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/process-flow-api";
import { exportWafer, previewCowDies, type WaferParameters } from "./wafer-arrangement-client";

vi.mock("@/lib/process-flow-api", () => ({ apiFetch: vi.fn() }));
const parameters: WaferParameters = { allowableDiameter: 290000, cowSize: { x: 40000, y: 50000 },
  cowSpacing: { x: 1000, y: 1000 }, arrangeType: "center", dummyLayers: [] };
const dieJson = { package: [{ soc: { socInfo: { "SOC-1": { bottomLeftX: 0, bottomLeftY: 0, upperRightX: 100, upperRightY: 200 } } } }] };
beforeEach(() => vi.mocked(apiFetch).mockReset());

describe("COW die API payloads", () => {
  it("previews source JSON independently, optionally including COW size", () => {
    const signal = new AbortController().signal;
    previewCowDies(dieJson, undefined, signal);
    expect(apiFetch).toHaveBeenLastCalledWith("/api/wafer-arrangement/preview-dies", { method: "POST", body: JSON.stringify({ dieJson }), signal });
    previewCowDies(dieJson, parameters.cowSize, signal);
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ dieJson, cowSize: parameters.cowSize });
  });
  it("only adds dieJson to exports when provided", () => {
    exportWafer(parameters, "/tmp/wafer.gds");
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ ...parameters, outputPath: "/tmp/wafer.gds" });
    exportWafer(parameters, "/tmp/wafer.gds", undefined, dieJson);
    expect(JSON.parse(vi.mocked(apiFetch).mock.calls.at(-1)![1]!.body as string)).toEqual({ ...parameters, outputPath: "/tmp/wafer.gds", dieJson });
  });
});
