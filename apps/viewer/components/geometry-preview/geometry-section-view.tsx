"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import type { GeometrySectionResponse } from "@/components/geometry-preview/geometry-preview-client";
import { materialPreviewColor } from "@/components/viewer/material-palette";
import { FEATURE_KIND_COLORS } from "@/lib/geometry-preview/features/feature-pattern";
import type { EstimatedFeatureSectionLayer } from "@/lib/geometry-preview/features/feature-section";

export function GeometrySectionView({
  section,
  estimatedFeatures,
  loading,
  error,
}: {
  section: GeometrySectionResponse | null;
  estimatedFeatures: EstimatedFeatureSectionLayer | null;
  loading: boolean;
  error: string | null;
}) {
  const drawing = React.useMemo(
    () => buildSectionDrawing(section, estimatedFeatures),
    [estimatedFeatures, section],
  );

  return (
    <div className="space-y-3">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md border bg-[#f7faf9]">
        {drawing ? (
          <svg
            className="h-full w-full"
            viewBox={drawing.viewBox}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${(section?.axis ?? estimatedFeatures?.axis)?.toUpperCase()} engineering section`}
          >
            <defs>
              {drawing.featurePatterns.map((pattern) => (
                <pattern
                  key={pattern.id}
                  id={pattern.id}
                  patternUnits="userSpaceOnUse"
                  x={pattern.x}
                  y={pattern.y}
                  width={pattern.width}
                  height={pattern.height}
                >
                  {pattern.motif === "dots" ? (
                    <circle
                      cx={pattern.width / 2}
                      cy={pattern.height / 2}
                      r={Math.min(pattern.width, pattern.height) * pattern.markScale * 0.5}
                      fill={pattern.color}
                    />
                  ) : pattern.motif === "capsules" ? (
                    <rect
                      x={pattern.width * 0.39}
                      y={pattern.height * 0.14}
                      width={pattern.width * 0.22}
                      height={pattern.height * 0.72}
                      rx={Math.min(pattern.width, pattern.height) * 0.11}
                      fill={pattern.color}
                    />
                  ) : (
                    <path
                      d={`M${-pattern.width * 0.15} ${pattern.height} L${pattern.width} ${-pattern.height * 0.15} M0 ${pattern.height * 1.15} L${pattern.width * 1.15} 0`}
                      stroke={pattern.color}
                      strokeWidth={Math.max(Math.min(pattern.width, pattern.height) * 0.12, 0.5)}
                    />
                  )}
                </pattern>
              ))}
            </defs>
            <g>
              {drawing.bodyPaths.map((path) => (
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
              {drawing.featurePaths.map((path) => (
                <path
                  key={path.id}
                  d={path.d}
                  fill={path.fill}
                  fillRule="evenodd"
                  stroke={path.stroke}
                  strokeWidth={drawing.strokeWidth}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          </svg>
        ) : (
          <p className="px-4 text-center text-xs text-muted-foreground">
            {error ??
              (loading
                ? "Computing exact material section…"
                : "No material or estimated feature at this plane")}
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
              {(section?.axis ?? estimatedFeatures?.axis) === "x" ? "Y / Z" : "X / Z"} · {section?.unitSystem ?? "um"}
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
          <div className="space-y-1.5 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="font-medium text-foreground">Bodies: Exact</span>
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
            {drawing.featureLegends.length > 0 ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-medium text-foreground">Features: Estimated</span>
                {drawing.featureLegends.map((item) => (
                  <span key={item.id} className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 rounded-sm border border-black/15"
                      style={{ backgroundColor: item.color }}
                    />
                    {item.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function buildSectionDrawing(
  section: GeometrySectionResponse | null,
  estimatedFeatures: EstimatedFeatureSectionLayer | null,
) {
  const bodyPoints =
    section?.regions.flatMap((region) => [region.outer, ...region.holes]).flat() ?? [];
  const featurePoints =
    estimatedFeatures?.regions
      .flatMap((region) => region.contours)
      .flatMap((contour) => [contour.outer, ...contour.holes])
      .flat() ?? [];
  const points = [...bodyPoints, ...featurePoints];
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
    materials: [...new Set(section?.regions.map((region) => region.material) ?? [])].sort(),
    bodyPaths: (section?.regions ?? []).map((region, index) => ({
      id: `${region.bodyId}:${index}`,
      color: materialPreviewColor(region.material),
      d: [region.outer, ...region.holes]
        .map((loop) => loopPath(loop, verticalScale))
        .join(" "),
    })),
    featurePatterns: (estimatedFeatures?.regions ?? []).map((region) => ({
      id: patternId(region.featureId),
      motif: region.pattern.motif,
      color: region.pattern.materialColor,
      markScale: region.pattern.markScale,
      x: region.pattern.phaseU - region.pattern.pitchU / 2,
      y: -region.pattern.phaseV * verticalScale - (region.pattern.pitchV * verticalScale) / 2,
      width: region.pattern.pitchU,
      height: region.pattern.pitchV * verticalScale,
    })),
    featurePaths: (estimatedFeatures?.regions ?? []).flatMap((region) =>
      region.contours.map((contour, index) => ({
        id: `${region.featureId}:${index}`,
        fill: region.pattern.density > 0 ? `url(#${patternId(region.featureId)})` : "none",
        stroke: FEATURE_KIND_COLORS[region.featureKind],
        d: [contour.outer, ...contour.holes]
          .map((loop) => loopPath(loop, verticalScale))
          .join(" "),
      })),
    ),
    featureLegends: [
      ...new Map(
        (estimatedFeatures?.regions ?? []).map((region) => [
          `${region.featureKind}:${region.material}`,
          {
            id: `${region.featureKind}:${region.material}`,
            color: region.pattern.materialColor,
            label: `${capitalize(region.featureKind)} · ${region.material}`,
          },
        ]),
      ).values(),
    ],
  };
}

function patternId(featureId: string) {
  return `estimated-feature-pattern-${featureId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
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
