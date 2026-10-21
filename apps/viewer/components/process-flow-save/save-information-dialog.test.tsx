import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SaveInformationDialog, type SaveInformationMode } from "./save-information-dialog";

const metadata = { name: "Example flow", version: "V1", owner: "engineer", description: "" };
function render(mode: SaveInformationMode, options: { blockingIssues?: string[]; configurationIssues?: string[]; submitting?: boolean; modern?: boolean } = {}) {
  return renderToStaticMarkup(<SaveInformationDialog mode={mode} template={metadata}
    instance={{ ...metadata, name: "Configured instance" }} submitting={options.submitting ?? false}
    onTemplateChange={() => {}} onInstanceChange={() => {}} onClose={() => {}} onSubmit={() => {}}
    onModeChange={options.modern === false ? undefined : () => {}}
    blockingIssues={options.blockingIssues} configurationIssues={options.configurationIssues} />);
}

describe("save flow dialog", () => {
  it("shows both save outcomes and independent metadata for the combined mode", () => {
    const html = render("template-and-instance");
    expect(html).toContain("Save flow");
    const combined = html.match(/<input\b[^>]+>/g)?.find((input) => input.includes('value="template-and-instance"'));
    expect(combined).toContain('checked=""');
    expect(html).toContain("Configured instance");
    expect(html).toContain("Template information");
    expect(html).toContain("Instance information");
  });
  it("blocks combined save with visible configuration requirements", () => {
    const html = render("template-and-instance", { configurationIssues: ["Panel needs a geometry binding."] });
    expect(html).toContain("Configuration needs attention");
    expect(html).toContain("Panel needs a geometry binding.");
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
  });
  it("allows template-only save with incomplete configuration and hides instance fields", () => {
    const html = render("template", { configurationIssues: ["Panel needs a geometry binding."] });
    expect(html).not.toContain("Instance information");
    expect(html).not.toContain("Configured instance");
    expect(html).not.toContain("Panel needs a geometry binding.");
    expect(html).not.toMatch(/type="submit"[^>]*disabled=""/);
  });
  it.each(["template", "template-and-instance"] as const)("blocks %s when topology or step availability is invalid", (mode) => {
    const html = render(mode, { blockingIssues: ["Remove disabled step Molding."] });
    expect(html).toContain("Remove disabled step Molding.");
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
  });
  it("prevents duplicate submission and keeps a named close control", () => {
    const html = render("template-and-instance", { submitting: true });
    expect(html).toContain("Saving…");
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
    expect(html).toContain('aria-label="Close save dialog"');
    // Focus is assigned by the dialog lifecycle after capturing the invoking button.
    expect(html).not.toContain('autofocus=""');
    const name = html.match(/<input\b[^>]+>/g)?.find((input) => input.includes('value="Example flow"'));
    expect(name).toContain('disabled=""');
  });
  it("retains the existing instance editor interface without outcome selection", () => {
    const html = render("instance", { modern: false });
    expect(html).toContain("Create instance");
    expect(html).not.toContain("save-mode");
    expect(html).not.toContain("Template information");
    expect(html).toContain("Configured instance");
  });
  it("blocks instance save with visible configuration requirements", () => {
    const html = render("instance", { configurationIssues: ["Panel needs a geometry binding."], modern: false });
    expect(html).toContain("Configuration needs attention");
    expect(html).toContain("Panel needs a geometry binding.");
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
  });
  it("makes name, version and owner required while description stays optional", () => {
    const html = render("template");
    expect(html.match(/required=""/g)).toHaveLength(3);
    expect(html).toContain('novalidate=""');
  });
});
