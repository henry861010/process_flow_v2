import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { summarizePlacementValidation } from "@/lib/process-flow/placement-validation";
import type { PlacementDraft } from "./placement-list-control";
import { PlacementPreview } from "./placement-preview";
import {
  fitPlacementCamera, panPlacementCamera, placementPreviewGeometry,
  projectPlacementPoint, zoomPlacementCamera,
} from "./placement-preview-geometry";

const base = { pose: { x: 0, y: 0, rotationZ: 0 }, anchor: "center" } as const;
function rectangle(x = -20, y = -10): PlacementDraft {
  return { ...base, targetRegion: { type: "rectangle", bottomLeftX: x, bottomLeftY: y, topRightX: x + 10, topRightY: y + 5 } };
}
function polygon(points: Array<[number | "", number | ""]>): PlacementDraft {
  return { ...base, targetRegion: { type: "polygon", points } };
}
function geometry(placements: PlacementDraft[]) {
  return placementPreviewGeometry(placements, summarizePlacementValidation(placements));
}
function render(placements: PlacementDraft[], selectedIndex: number | null = null) {
  return renderToStaticMarkup(<PlacementPreview placements={placements} validation={summarizePlacementValidation(placements)}
    selectedIndex={selectedIndex} unit="mm" resetKey={0} onSelect={() => {}} />);
}

describe("placement preview geometry", () => {
  it("keeps exact absolute rectangles and polygons, original indices and negative bounds", () => {
    const result = geometry([rectangle(), polygon([[0, 0], [7, 3], [0, 8]])]);
    expect(result.bounds).toEqual({ xMin: -20, yMin: -10, xMax: 7, yMax: 8 });
    expect(result.shapes.map((shape) => [shape.index, shape.type])).toEqual([[0, "rectangle"], [1, "polygon"]]);
    expect(result.shapes[0].points).toEqual([[-20, -10], [-10, -10], [-10, -5], [-20, -5]]);
    expect(result.shapes[1].points).toEqual([[0, 0], [7, 3], [0, 8]]);
  });

  it("omits incomplete drafts without treating blanks as zero; retains finite invalid outlines", () => {
    const incomplete = rectangle();
    if (incomplete.targetRegion.type === "rectangle") incomplete.targetRegion.topRightX = "";
    const result = geometry([incomplete, polygon([[0, 0], ["", 4], [3, 0]]),
      polygon([[0, 0], [4, 4], [0, 4], [4, 0]]), polygon([[1, 2]])]);
    expect(result.omitted).toBe(2);
    expect(result.shapes.map((shape) => shape.index)).toEqual([2, 3]);
    expect(result.shapes.every((shape) => shape.diagnostic !== null)).toBe(true);
    expect(geometry([polygon([])]).bounds).toBeNull();
    expect(geometry([])).toEqual({ shapes: [], bounds: null, omitted: 0 });
  });

  it("preserves equal XY scale, flips Y, and fits all shapes with padding", () => {
    const bounds = { xMin: -100, yMin: -50, xMax: 100, yMax: 50 };
    for (const width of [300, 560, 1000]) {
      const camera = fitPlacementCamera(bounds, width, 300);
      const a = projectPlacementPoint([-100, -50], camera, width, 300);
      const b = projectPlacementPoint([100, 50], camera, width, 300);
      expect(a[0]).toBeGreaterThanOrEqual(24);
      expect(b[0]).toBeLessThanOrEqual(width - 24);
      expect(b[1]).toBeGreaterThanOrEqual(24);
      expect(a[1]).toBeLessThanOrEqual(276);
      expect((b[0] - a[0]) / 200).toBeCloseTo((a[1] - b[1]) / 100);
    }
  });

  it("has finite cameras for point and flat drafts", () => {
    for (const bounds of [{ xMin: 4, xMax: 4, yMin: 2, yMax: 2 }, { xMin: -4, xMax: 4, yMin: 2, yMax: 2 }]) {
      const camera = fitPlacementCamera(bounds, 300, 300);
      expect(Object.values(camera).every(Number.isFinite)).toBe(true);
      expect(camera.scale).toBeGreaterThan(0);
    }
  });

  it("fits shapes above the overlaid bottom controls", () => {
    const bounds = { xMin: -10, yMin: -100, xMax: 10, yMax: 100 };
    const camera = fitPlacementCamera(bounds, 300, 300, 64);
    const top = projectPlacementPoint([0, 100], camera, 300, 300);
    const bottom = projectPlacementPoint([0, -100], camera, 300, 300);
    expect(top[1]).toBeCloseTo(24);
    expect(bottom[1]).toBeCloseTo(236);
  });

  it("pans in screen coordinates and keeps the zoom anchor fixed", () => {
    const camera = { x: -10, y: 20, scale: 2 };
    expect(panPlacementCamera(camera, 20, -10)).toEqual({ x: -20, y: 15, scale: 2 });
    const point: [number, number] = [40, 30];
    const anchor = projectPlacementPoint(point, camera, 560, 300);
    const zoomed = zoomPlacementCamera(camera, 1.25, anchor, 560, 300);
    expect(projectPlacementPoint(point, zoomed, 560, 300)).toEqual(anchor);
    expect(zoomed.scale).toBe(2.5);
  });
});

describe("placement preview presentation", () => {
  it("keeps the graph but hides placement-card instructions in read-only summaries", () => {
    const html = renderToStaticMarkup(<PlacementPreview placements={[rectangle()]}
      validation={summarizePlacementValidation([rectangle()])} selectedIndex={null}
      resetKey={0} onSelect={() => {}} readOnly />);
    expect(html).toContain('data-placement-index="0"');
    expect(html).not.toContain("jump to its placement card");
    expect(html).not.toContain("review the highlighted cards below");
    expect(html).toContain('data-placement-index="0" class="text-primary"');
    expect(html).toContain('pointer-events="none"');
  });

  it("shows empty and incomplete states without a stale shape", () => {
    expect(render([])).toContain("No placements");
    const html = render([polygon([["", ""], [0, 0], [1, 1]])]);
    expect(html).toContain("Enter complete coordinates");
    expect(html).not.toContain("data-placement-index");
  });

  it("keeps invalid outlines and hover details with instructions in a closed help disclosure", () => {
    const html = render([rectangle(), polygon([[0, 0], [4, 4], [0, 4], [4, 0]])], 1);
    expect(html).toContain('data-placement-index="1"');
    expect(html).toContain('fill="none"');
    expect(html).toContain('stroke-dasharray="5 3"');
    expect(html).toContain("self-intersect");
    expect(html).toContain("mm");
    expect(html).toContain("Placement 2");
    expect(html).toContain("Placement layout help");
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    expect(html).not.toContain("Placement number");
    expect(html).not.toContain("Locate card");
    expect(html).not.toContain("total ·");
    expect(html).not.toContain("<text");
    expect(html).not.toContain("<h3");
  });

  it("renders every one of 1,000 placements without sampling", () => {
    const placements = Array.from({ length: 1000 }, (_, index) => rectangle((index % 40) * 15, Math.floor(index / 40) * 10));
    const html = render(placements);
    expect(html.match(/data-placement-index=/g)).toHaveLength(1000);
    expect(html).toContain('data-placement-index="999"');
  });
});
