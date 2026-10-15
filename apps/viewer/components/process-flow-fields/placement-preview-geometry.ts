import type { PlacementDraft } from "./placement-list-control";
import type { PlacementValidationSummary } from "@/lib/process-flow/placement-validation";

export type PreviewPoint = [number, number];
export type PreviewBounds = { xMin: number; yMin: number; xMax: number; yMax: number };
export type PreviewCamera = { x: number; y: number; scale: number };
export type PreviewShape = {
  index: number;
  type: "rectangle" | "polygon";
  points: PreviewPoint[];
  bounds: PreviewBounds;
  diagnostic: string | null;
};

export function placementPreviewGeometry(
  placements: readonly PlacementDraft[],
  validation: PlacementValidationSummary,
) {
  const shapes: PreviewShape[] = [];
  let bounds: PreviewBounds | null = null;
  placements.forEach((placement, index) => {
    const region = placement.targetRegion;
    const points = region.type === "rectangle"
      ? [
          [region.bottomLeftX, region.bottomLeftY],
          [region.topRightX, region.bottomLeftY],
          [region.topRightX, region.topRightY],
          [region.bottomLeftX, region.topRightY],
        ]
      : region.points;
    if (!points.length || !points.every((point) => point.every(
      (coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate),
    ))) return;
    const numericPoints = points as PreviewPoint[];
    const shapeBounds = numericPoints.reduce<PreviewBounds>((acc, [x, y]) => ({
      xMin: Math.min(acc.xMin, x), yMin: Math.min(acc.yMin, y),
      xMax: Math.max(acc.xMax, x), yMax: Math.max(acc.yMax, y),
    }), { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity });
    shapes.push({ index, type: region.type, points: numericPoints, bounds: shapeBounds,
      diagnostic: validation.diagnostics[index] ?? null });
    bounds = bounds ? {
      xMin: Math.min(bounds.xMin, shapeBounds.xMin), yMin: Math.min(bounds.yMin, shapeBounds.yMin),
      xMax: Math.max(bounds.xMax, shapeBounds.xMax), yMax: Math.max(bounds.yMax, shapeBounds.yMax),
    } : { ...shapeBounds };
  });
  return { shapes, bounds, omitted: placements.length - shapes.length };
}

export function fitPlacementCamera(bounds: PreviewBounds, width: number, height: number, bottomPadding = 24): PreviewCamera {
  const xSpan = bounds.xMax - bounds.xMin;
  const ySpan = bounds.yMax - bounds.yMin;
  // A point or a flat invalid draft still needs a usable viewport.
  const fallbackSpan = Math.max(xSpan, ySpan, 1);
  const scale = Math.min(Math.max(1, width - 48) / (xSpan || fallbackSpan),
    Math.max(1, height - 24 - bottomPadding) / (ySpan || fallbackSpan));
  return {
    x: bounds.xMin / 2 + bounds.xMax / 2,
    y: bounds.yMin / 2 + bounds.yMax / 2 - (bottomPadding - 24) / (2 * scale),
    scale,
  };
}

export function projectPlacementPoint([x, y]: PreviewPoint, camera: PreviewCamera, width: number, height: number): PreviewPoint {
  return [width / 2 + (x - camera.x) * camera.scale, height / 2 - (y - camera.y) * camera.scale];
}

export function panPlacementCamera(camera: PreviewCamera, dx: number, dy: number): PreviewCamera {
  return { ...camera, x: camera.x - dx / camera.scale, y: camera.y + dy / camera.scale };
}

export function zoomPlacementCamera(camera: PreviewCamera, factor: number, anchor: PreviewPoint, width: number, height: number): PreviewCamera {
  const scale = Math.max(1e-12, Math.min(1e12, camera.scale * factor));
  const [dx, dy] = [anchor[0] - width / 2, anchor[1] - height / 2];
  return { scale, x: camera.x + dx / camera.scale - dx / scale,
    y: camera.y - dy / camera.scale + dy / scale };
}

export function placementBoundsLabel(bounds: PreviewBounds, unit?: string | null) {
  const format = (value: number) => Number(value.toPrecision(6)).toString();
  return `X ${format(bounds.xMin)}–${format(bounds.xMax)}, Y ${format(bounds.yMin)}–${format(bounds.yMax)}${unit ? ` ${unit}` : ""}`;
}
