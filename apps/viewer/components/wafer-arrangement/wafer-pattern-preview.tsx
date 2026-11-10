"use client";

import * as React from "react";
import type { WaferPattern, WaferRectangle } from "./wafer-arrangement-client";
import { XyLayoutViewport } from "./xy-layout-viewport";

export const DUMMY_COLORS = ["#087e8b", "#b77908", "#8054b3", "#c34b72", "#3b6fba", "#667a30"];
const WAFER_DIAMETER = 300000;

export function rectanglesPath(rectangles: WaferRectangle[]) {
  return rectangles.map(([x0, y0, x1, y1]) => `M${x0},${y0}H${x1}V${y1}H${x0}Z`).join("");
}

export function WaferPatternPreview({ pattern, allowableDiameter, visible = [], showCow = true, showBoundary = true }: {
  pattern?: WaferPattern; allowableDiameter?: number; visible?: boolean[]; showCow?: boolean; showBoundary?: boolean;
}) {
  const diameter = allowableDiameter ?? pattern?.normalizedParameters.allowableDiameter;
  const generatedDiameter = pattern?.normalizedParameters.allowableDiameter;
  const changedDiameter = generatedDiameter !== undefined && generatedDiameter !== diameter;
  const format = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 3 });
  const bounds = React.useMemo(() => (pattern?.boundaryCells ?? []).reduce((acc, [x0, y0, x1, y1]) => ({
    xMin: Math.min(acc.xMin, x0), yMin: Math.min(acc.yMin, y0), xMax: Math.max(acc.xMax, x1), yMax: Math.max(acc.yMax, y1),
  }), { xMin: -WAFER_DIAMETER / 2, yMin: -WAFER_DIAMETER / 2, xMax: WAFER_DIAMETER / 2, yMax: WAFER_DIAMETER / 2 }), [pattern]);
  const paths = React.useMemo(() => ({ cow: rectanglesPath(pattern?.cowRectangles ?? []), boundary: rectanglesPath(pattern?.boundaryCells ?? []),
    dummy: pattern?.dummyLayers.map(layer => rectanglesPath(layer.rectangles)) ?? [] }), [pattern]);

  return <XyLayoutViewport bounds={bounds} resetKey={pattern} label="Wafer arrangement XY preview" subject="wafer"
    title={`${diameter === undefined ? "Wafer reference" : "Allowable wafer"} diameter ${diameter ?? WAFER_DIAMETER} µm; ${pattern ? `${pattern.cowCount} complete COW` : "no pattern generated"}`}
    summary={<div className="space-y-1">
      <p>Wafer reference Ø {format(WAFER_DIAMETER)} µm</p>
      {diameter !== undefined && <p className="flex items-center gap-2 text-primary"><span aria-hidden="true" className="inline-block w-3 border-t-2 border-primary" />Allowable Ø {format(diameter)} µm</p>}
      {changedDiameter && <p className="flex items-center gap-2"><span aria-hidden="true" className="inline-block w-3 border-t border-dashed border-slate-500" />Previous pattern Ø {format(generatedDiameter)} µm</p>}
    </div>}>
    <circle data-wafer-outline="reference" r={WAFER_DIAMETER / 2} className="fill-white/40 stroke-slate-400" vectorEffect="non-scaling-stroke" strokeWidth={1} />
    {diameter !== undefined && <circle data-wafer-outline="allowable" r={diameter / 2} className="fill-primary/5 stroke-primary" vectorEffect="non-scaling-stroke" strokeWidth={1.5} />}
    <path d={`M${-WAFER_DIAMETER / 2},0H${WAFER_DIAMETER / 2}M0,${-WAFER_DIAMETER / 2}V${WAFER_DIAMETER / 2}`} className="stroke-slate-300" vectorEffect="non-scaling-stroke" fill="none" />
    {showBoundary && <path d={paths.boundary} className="stroke-slate-400" fill="none" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
    {showCow && <path d={paths.cow} className="fill-primary/15 stroke-primary" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
    {pattern?.dummyLayers.map((layer, index) => visible[index] && <path key={layer.datatype} d={paths.dummy[index]} fill={DUMMY_COLORS[index % DUMMY_COLORS.length]}
      fillOpacity={0.22} stroke={DUMMY_COLORS[index % DUMMY_COLORS.length]} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />)}
    {changedDiameter && <circle data-wafer-outline="generated" r={generatedDiameter / 2} className="stroke-slate-500" fill="none" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />}
  </XyLayoutViewport>;
}
