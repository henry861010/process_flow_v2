"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import type { GeometrySectionResponse } from "@/components/geometry-preview/geometry-preview-client";
import { materialPreviewColor } from "@/components/viewer/material-palette";

export function GeometrySectionView({
  section,
  loading,
  error,
}: {
  section: GeometrySectionResponse | null;
  loading: boolean;
  error: string | null;
}) {
  const drawing = React.useMemo(() => buildSectionDrawing(section), [section]);

  return (
    <div className="space-y-3">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border bg-[#f7faf9]">
        {drawing ? (
          <svg
            className="h-full w-full"
            viewBox={drawing.viewBox}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`Exact ${section?.axis.toUpperCase()} material section`}
          >
            <g>
              {drawing.paths.map((path) => (
                <path
                  key={path.id}
                  d={path.d}
                  fill={path.color}
                  fillRule="evenodd"
                  stroke="#334155"
                  strokeWidth={drawing.strokeWidth}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          </svg>
        ) : (
          <p className="px-4 text-center text-xs text-muted-foreground">
            {error ?? (loading ? "Computing exact material section…" : "No material at this plane")}
          </p>
        )}
        {loading ? (
          <span className="absolute right-2 top-2 rounded bg-white/90 p-1 text-primary shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        ) : null}
      </div>

      {drawing ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              {section?.axis === "x" ? "Y / Z" : "X / Z"} · {section?.unitSystem}
            </span>
            {drawing.verticalScale > 1 ? (
              <span
                className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-amber-800"
                title="Only the display height is exaggerated; section coordinates and areas remain exact."
              >
                Display Z ×{formatScale(drawing.verticalScale)}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {drawing.materials.map((material) => (
              <span key={material} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-sm border border-black/15"
                  style={{ backgroundColor: materialPreviewColor(material) }}
                />
                {material}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function buildSectionDrawing(section: GeometrySectionResponse | null) {
  if (!section || section.regions.length === 0) return null;
  const points = section.regions.flatMap((region) => [region.outer, ...region.holes]).flat();
  if (points.length === 0) return null;

  const minU = Math.min(...points.map(([u]) => u));
  const maxU = Math.max(...points.map(([u]) => u));
  const minV = Math.min(...points.map(([, v]) => v));
  const maxV = Math.max(...points.map(([, v]) => v));
  const width = Math.max(maxU - minU, 1);
  const height = Math.max(maxV - minV, 1);
  const rawAspect = width / height;
  const verticalScale = rawAspect > 4 ? Math.min(rawAspect / 2.5, 1000) : 1;
  const scaledMinV = minV * verticalScale;
  const scaledMaxV = maxV * verticalScale;
  const scaledHeight = Math.max(scaledMaxV - scaledMinV, 1);
  const padding = Math.max(width, scaledHeight) * 0.06;

  return {
    viewBox: `${minU - padding} ${-scaledMaxV - padding} ${width + padding * 2} ${scaledHeight + padding * 2}`,
    strokeWidth: 1,
    verticalScale,
    materials: [...new Set(section.regions.map((region) => region.material))].sort(),
    paths: section.regions.map((region, index) => ({
      id: `${region.bodyId}:${index}`,
      color: materialPreviewColor(region.material),
      d: [region.outer, ...region.holes]
        .map((loop) => loopPath(loop, verticalScale))
        .join(" "),
    })),
  };
}

function loopPath(loop: [number, number][], verticalScale: number) {
  if (loop.length === 0) return "";
  return `${loop
    .map(
      ([u, v], index) =>
        `${index === 0 ? "M" : "L"}${u} ${-v * verticalScale}`,
    )
    .join(" ")} Z`;
}

function formatScale(value: number) {
  if (value >= 10) return Math.round(value).toLocaleString("en-US");
  return value.toFixed(1);
}
