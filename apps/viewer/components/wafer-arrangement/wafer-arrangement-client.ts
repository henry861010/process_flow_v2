import { apiFetch } from "@/lib/process-flow-api";

export type XY = { x: number; y: number };
export type ArrangeType = "center" | "corner" | "x_half" | "y_half";
export type WaferParameters = {
  allowableDiameter: number;
  cowSize: XY;
  cowSpacing: XY;
  arrangeType: ArrangeType;
  dummyLayers: Array<{ size: XY; minSpacing: XY }>;
};
export type WaferRectangle = [number, number, number, number];
export type DieType = "soc" | "hbm" | "lsi" | "soic" | "dmy";
export type CowDiePattern = {
  dieLayers: Array<{ type: DieType; layer: number; datatype: number; count: number;
    dies: Array<{ id: string; path: string; rectangle: WaferRectangle }> }>;
  totalDies: number;
  cowRectangle: WaferRectangle | null;
  outOfBounds: Array<{ type: DieType; id: string; path: string; message: string }>;
  warnings: string[];
};
export type AxisPacking = { count: number; a: number | null; b: number | null; bMax: number | null };
export type WaferPattern = {
  normalizedParameters: WaferParameters;
  cowRectangles: WaferRectangle[];
  boundaryCells: WaferRectangle[];
  dummyLayers: Array<{ layer: number; datatype: number; rectangles: WaferRectangle[]; count: number; x: AxisPacking; y: AxisPacking }>;
  cowCount: number;
  cowAreaUtilization: number;
  totalRectangles: number;
  warnings: string[];
};
export type WaferExportResult = {
  outputPath: string; cowCount: number; dummyCounts: number[]; dieCounts: Record<DieType, number>;
  totalRectangles: number; warnings: string[];
};

export function previewWafer(parameters: WaferParameters, signal?: AbortSignal) {
  return apiFetch<WaferPattern>("/api/wafer-arrangement/preview", {
    method: "POST", body: JSON.stringify(parameters), signal,
  });
}

export function previewCowDies(dieJson: unknown, cowSize?: XY, signal?: AbortSignal) {
  return apiFetch<CowDiePattern>("/api/wafer-arrangement/preview-dies", {
    method: "POST", body: JSON.stringify({ dieJson, cowSize }), signal,
  });
}

export function exportWafer(parameters: WaferParameters, outputPath: string, signal?: AbortSignal, dieJson?: unknown) {
  return apiFetch<WaferExportResult>("/api/wafer-arrangement/export-gds", {
    method: "POST", body: JSON.stringify({ ...parameters, outputPath, dieJson }), signal,
  });
}
