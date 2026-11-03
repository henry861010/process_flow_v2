import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ExecutionWarning } from "./geometry-preview-client";
import { ProcessExecutionWarnings } from "./process-execution-warnings";

const warning: ExecutionWarning = {
  code: "joint_soh_preserved",
  stepRefId: "joint-1",
  stepLabel: "MR joint",
  message: "設定 SOH 為 10 µm，因接合間隙已有填充／支撐材料，實際 SOH 維持 56 µm。",
  details: {
    childId: "soc-1",
    requestedSoh: 10,
    actualSoh: 56,
    unit: "um",
    supportMaterials: ["Epoxy"],
  },
};

describe("process execution warnings", () => {
  it("renders nothing for legacy responses or an empty warning list", () => {
    expect(renderToStaticMarkup(<ProcessExecutionWarnings />)).toBe("");
    expect(renderToStaticMarkup(<ProcessExecutionWarnings warnings={[]} />)).toBe("");
  });

  it("names the source step and explains the preserved height as a polite status", () => {
    const markup = renderToStaticMarkup(<ProcessExecutionWarnings warnings={[warning]} />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Process warnings"');
    expect(markup).toContain("Process warnings");
    expect(markup).toContain("MR joint");
    expect(markup).toContain(warning.message);
    expect(markup).not.toContain('role="alert"');
    expect(markup).not.toContain("joint_soh_preserved");
  });

  it("keeps long lists bounded, keyboard scrollable and readable without truncation", () => {
    const warnings = Array.from({ length: 100 }, (_, index) => ({
      ...warning,
      stepRefId: `joint-${index}`,
      stepLabel: `Joint ${index}`,
      message: `${warning.message}${"VeryLongMaterial".repeat(20)}`,
    }));
    const markup = renderToStaticMarkup(<ProcessExecutionWarnings warnings={warnings} />);
    expect(markup.match(/<li\b/g)).toHaveLength(100);
    expect(markup).toContain("Joint 99");
    const section = markup.slice(0, markup.indexOf(">"));
    const classes = section.match(/class="([^"]+)"/)?.[1].split(" ") ?? [];
    for (const token of ["max-h-[30%]", "min-h-0", "shrink-0", "overflow-y-auto"])
      expect(classes).toContain(token);
    expect(section).toContain('tabindex="0"');
    expect(markup).toContain("[overflow-wrap:anywhere]");
    expect(markup).not.toContain("line-clamp");
  });

  it("escapes source and warning text and uses the source ID if its label is empty", () => {
    const markup = renderToStaticMarkup(<ProcessExecutionWarnings warnings={[{
      ...warning, stepLabel: "", stepRefId: "<joint>", message: "<script>alert('warning')</script>",
    }]} />);
    expect(markup).toContain("&lt;joint&gt;");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });
});
