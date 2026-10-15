import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TargetFolderPath } from "./target-folder-path";

describe("dashboard target folder", () => {
  it("renders the complete selectable path with a job-specific copy control", () => {
    const path = `/exports/中文 folder/${"long-segment/".repeat(30)}`;
    const html = renderToStaticMarkup(<TargetFolderPath jobId="job-123" path={path} />);
    expect(html).toContain(path);
    expect(html).toContain("Target folder");
    expect(html).toContain('aria-label="Copy target folder for job job-123"');
    expect(html).toContain("select-text whitespace-pre-wrap break-all");
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
  });
});
