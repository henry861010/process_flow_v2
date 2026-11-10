"use client";

import * as React from "react";
import type { WaferPattern, WaferRectangle } from "./wafer-arrangement-client";
import { XyLayoutViewport } from "./xy-layout-viewport";

export const DUMMY_COLORS = ["#087e8b", "#b77908", "#8054b3", "#c34b72", "#3b6fba", "#667a30"];

export function rectanglesPath(rectangles: WaferRectangle[]) {
  return rectangles.map(([x0, y0, x1, y1]) => `M${x0},${y0}H${x1}V${y1}H${x0}Z`).join("");
}

export function WaferPatternPreview({ pattern, allowableDiameter, visible = [], showCow = true, showBoundary = true }: {
  pattern?: WaferPattern; allowableDiameter?: number; visible?: boolean[]; showCow?: boolean; showBoundary?: boolean;
}) {
  const diameter = pattern?.normalizedParameters.allowableDiameter ?? allowableDiameter ?? 300000;
  const referenceOnly = !pattern && allowableDiameter === undefined;
  const bounds = React.useMemo(() => (pattern?.boundaryCells ?? []).reduce((acc, [x0, y0, x1, y1]) => ({
    xMin: Math.min(acc.xMin, x0), yMin: Math.min(acc.yMin, y0), xMax: Math.max(acc.xMax, x1), yMax: Math.max(acc.yMax, y1),
  }), { xMin: -diameter / 2, yMin: -diameter / 2, xMax: diameter / 2, yMax: diameter / 2 }), [pattern, diameter]);
  const paths = React.useMemo(() => ({ cow: rectanglesPath(pattern?.cowRectangles ?? []), boundary: rectanglesPath(pattern?.boundaryCells ?? []),
    dummy: pattern?.dummyLayers.map(layer => rectanglesPath(layer.rectangles)) ?? [] }), [pattern]);

  return <XyLayoutViewport bounds={bounds} resetKey={pattern} label="Wafer arrangement XY preview" subject="wafer"
    title={`${referenceOnly ? "Wafer reference" : "Allowable wafer"} diameter ${diameter} µm; ${pattern ? `${pattern.cowCount} complete COW` : "no pattern generated"}`}
    summary={`${referenceOnly ? "Wafer reference" : "Allowable"} Ø ${diameter.toLocaleString("en-US", { maximumFractionDigits: 3 })} µm`}>
    <path d={`M${-diameter / 2},0H${diameter / 2}M0,${-diameter / 2}V${diameter / 2}`} className="stroke-slate-300" vectorEffect="non-scaling-stroke" fill="none" />
    <circle r={diameter / 2} className="fill-white/40 stroke-slate-500" vectorEffect="non-scaling-stroke" fill="none" strokeWidth={1.5} />
    {showBoundary && <path d={paths.boundary} className="stroke-slate-400" fill="none" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
    {showCow && <path d={paths.cow} className="fill-primary/15 stroke-primary" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />}
    {pattern?.dummyLayers.map((layer, index) => visible[index] && <path key={layer.datatype} d={paths.dummy[index]} fill={DUMMY_COLORS[index % DUMMY_COLORS.length]}
      fillOpacity={0.22} stroke={DUMMY_COLORS[index % DUMMY_COLORS.length]} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />)}
  </XyLayoutViewport>;
}
