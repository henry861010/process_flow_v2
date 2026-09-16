import type {
  EngineeringPreviewBounds,
} from "@/components/geometry-generator/geometry-generator-contracts";

export const CROSS_SECTION_MAX_RENDERED_ASPECT_RATIO = 2;

export type EngineeringPreviewDrawingTransform = {
  scaleU: number;
  scaleV: number;
  renderedWidth: number;
  renderedHeight: number;
  u: (value: number) => number;
  v: (value: number) => number;
};

export function engineeringPreviewAspectRatioLimit(
  viewId: string,
  showOriginalAspectRatio: boolean,
) {
  return viewId === "cross-section-x" && !showOriginalAspectRatio
    ? CROSS_SECTION_MAX_RENDERED_ASPECT_RATIO
    : undefined;
}

export function createEngineeringPreviewDrawingTransform({
  bounds,
  width,
  height,
  padding,
  maxRenderedAspectRatio,
}: {
  bounds: EngineeringPreviewBounds;
  width: number;
  height: number;
  padding: { left: number; right: number; top: number; bottom: number };
  maxRenderedAspectRatio?: number;
}): EngineeringPreviewDrawingTransform {
  const uSpan = Math.max(1e-9, bounds.uMax - bounds.uMin);
  const vSpan = Math.max(1e-9, bounds.vMax - bounds.vMin);
  const plotWidth = Math.max(1e-9, width - padding.left - padding.right);
  const plotHeight = Math.max(1e-9, height - padding.top - padding.bottom);
  const physicalAspectRatio = uSpan / vSpan;
  const shouldLimitAspectRatio =
    maxRenderedAspectRatio != null &&
    Number.isFinite(maxRenderedAspectRatio) &&
    maxRenderedAspectRatio > 0 &&
    physicalAspectRatio > maxRenderedAspectRatio;

  let renderedWidth: number;
  let renderedHeight: number;
  if (shouldLimitAspectRatio) {
    renderedWidth = Math.min(plotWidth, plotHeight * maxRenderedAspectRatio);
    renderedHeight = renderedWidth / maxRenderedAspectRatio;
  } else {
    const scale = Math.min(plotWidth / uSpan, plotHeight / vSpan);
    renderedWidth = uSpan * scale;
    renderedHeight = vSpan * scale;
  }

  const scaleU = renderedWidth / uSpan;
  const scaleV = renderedHeight / vSpan;
  const xOffset = padding.left + (plotWidth - renderedWidth) / 2;
  const yOffset = padding.top + (plotHeight - renderedHeight) / 2;

  return {
    scaleU,
    scaleV,
    renderedWidth,
    renderedHeight,
    u: (value: number) => xOffset + (value - bounds.uMin) * scaleU,
    v: (value: number) =>
      yOffset + renderedHeight - (value - bounds.vMin) * scaleV,
  };
}
