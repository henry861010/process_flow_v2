import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/arrangement.json";
import type { GdsImportRequest, GdsImportResponse } from "@/components/process-flow-fields/gds-coordinate-import.worker";

// This real binary was produced by the Python wafer exporter, not the JS parser.
// It exercises the existing worker with each exact layer/datatype pair.
const scope = {
  onmessage: null as ((event: MessageEvent<GdsImportRequest>) => void) | null,
  response: null as GdsImportResponse | null,
  postMessage(response: GdsImportResponse) { this.response = response; },
};
beforeAll(async () => {
  vi.stubGlobal("self", scope);
  await import("@/components/process-flow-fields/gds-coordinate-import.worker");
});
afterAll(() => vi.unstubAllGlobals());

describe("wafer GDS compatibility with placement importer", () => {
  it("imports every rectangle in micrometers using the intended layer and datatype", () => {
    const bytes = readFileSync(new URL("./fixtures/arrangement.gds", import.meta.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const groups = [{ layer: 100, datatype: 100, rectangles: fixture.cowRectangles },
      ...fixture.dummyLayers.map(layer => ({ layer: 413, datatype: layer.datatype, rectangles: layer.rectangles })),
      ...fixture.dieLayers.map(layer => ({ layer: 888, datatype: layer.datatype, rectangles: layer.rectangles }))];
    for (const group of groups) {
      scope.onmessage!({ data: { requestId: `pair-${group.datatype}`, buffer, unit: "um", criteria: [{ layer: group.layer, datatype: group.datatype }] } } as MessageEvent<GdsImportRequest>);
      const response = scope.response!;
      expect(response.type).toBe("success");
      if (response.type !== "success") throw new Error(response.message);
      expect(response.topCellNames).toEqual(["WAFER_ARRANGEMENT"]);
      expect(response.regions).toHaveLength(group.rectangles.length);
      response.regions.forEach((region, index) => {
        expect(region.type).toBe("rectangle");
        if (region.type !== "rectangle") throw new Error("Expected rectangle");
        region.bounds.flat().forEach((coordinate, axis) => expect(coordinate).toBeCloseTo(group.rectangles[index][axis], 6));
      });
    }
  });
});
