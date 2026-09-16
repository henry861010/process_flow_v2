import { describe, expect, it } from "vitest";

import {
  createEngineeringPreviewDrawingTransform,
  engineeringPreviewAspectRatioLimit,
} from "./engineering-preview-transform";

const drawingArea = {
  width: 560,
  height: 330,
  padding: { left: 70, right: 78, top: 30, bottom: 72 },
};

describe("engineering preview drawing transform", () => {
  it("expands a wide cross section to a 2:1 rendered aspect ratio", () => {
    const transform = createEngineeringPreviewDrawingTransform({
      ...drawingArea,
      bounds: { uMin: -6000, uMax: 6000, vMin: 0, vMax: 670 },
      maxRenderedAspectRatio: 2,
    });

    expect(transform.renderedWidth / transform.renderedHeight).toBeCloseTo(2);
    expect(transform.scaleV).toBeGreaterThan(transform.scaleU);
  });

  it("preserves physical scale when original aspect ratio is requested", () => {
    const transform = createEngineeringPreviewDrawingTransform({
      ...drawingArea,
      bounds: { uMin: -6000, uMax: 6000, vMin: 0, vMax: 670 },
    });

    expect(transform.scaleU).toBeCloseTo(transform.scaleV);
    expect(transform.renderedWidth / transform.renderedHeight).toBeCloseTo(
      12000 / 670,
    );
  });

  it("does not distort a view whose physical aspect ratio is already at most 2:1", () => {
    const transform = createEngineeringPreviewDrawingTransform({
      ...drawingArea,
      bounds: { uMin: -700, uMax: 700, vMin: -500, vMax: 500 },
      maxRenderedAspectRatio: 2,
    });

    expect(transform.scaleU).toBeCloseTo(transform.scaleV);
    expect(transform.renderedWidth / transform.renderedHeight).toBeCloseTo(1.4);
  });

  it("limits only the cross-section view while adjusted display is enabled", () => {
    expect(engineeringPreviewAspectRatioLimit("cross-section-x", false)).toBe(2);
    expect(
      engineeringPreviewAspectRatioLimit("cross-section-x", true),
    ).toBeUndefined();
    expect(engineeringPreviewAspectRatioLimit("top", false)).toBeUndefined();
    expect(engineeringPreviewAspectRatioLimit("top", true)).toBeUndefined();
  });
});
