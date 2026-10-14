import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StepTemplateDetails } from "./step-template-details";
import { stepPreviewPosition } from "./step-template-hover-preview";

function render(description = "Step description\nSecond line") {
  return renderToStaticMarkup(<StepTemplateDetails
    template={{ name: "Example step", description }}
  />);
}

describe("step preview details", () => {
  it("shows the step name and full description", () => {
    const html = render();
    expect(html).toContain("Example step");
    expect(html).toContain("Step description\nSecond line");
  });

  it("omits blank descriptions", () => {
    const html = render(" \n ");
    expect(html).toContain("Example step");
    expect(html).not.toContain("<p");
  });

  it("renders catalog text safely and retains wrapping for long descriptions", () => {
    const html = render("<script>test</script>" + "long-token".repeat(100));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("[overflow-wrap:anywhere]");
    expect(html).toContain("whitespace-pre-wrap");
  });
});

describe("step preview placement", () => {
  it("prefers the left of a right-side library card", () => {
    const position = stepPreviewPosition({ left: 1120, right: 1420, top: 200 }, { width: 1440, height: 900 }, 300);
    expect(position.left + position.width).toBeLessThan(1120);
    expect(position.top).toBe(200);
    expect(position.width).toBe(360);
    expect(position.maxHeight).toBe(420);
  });

  it("falls back to the right when the left side has insufficient space", () => {
    const position = stepPreviewPosition({ left: 20, right: 300, top: 20 }, { width: 1024, height: 768 }, 200);
    expect(position.left).toBeGreaterThan(300);
    expect(position.left + position.width).toBeLessThanOrEqual(1012);
  });

  it.each([
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 240 },
  ])("bounds long previews inside a $width × $height viewport", (viewport) => {
    const position = stepPreviewPosition({ left: viewport.width - 300, right: viewport.width - 12, top: viewport.height - 80 }, viewport, 1000);
    expect(position.left).toBeGreaterThanOrEqual(12);
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.left + position.width).toBeLessThanOrEqual(viewport.width - 12);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(viewport.height - 12);
    expect(position.width).toBeLessThanOrEqual(360);
    expect(position.maxHeight).toBeLessThanOrEqual(420);
  });
});
