import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SaveInformationDialog } from "./save-information-dialog";
const noop = () => {};
const props = { hasTarget: true,
  metadata: { name: "Flow", version: "v1", owner: "RD", description: "" }, onChange: noop,
  blockingIssues: [], configurationIssues: [], error: null, conflict: false,
  submitting: false, onReload: noop, onClose: noop, onSubmit: noop };
it("allows saving incomplete recipes and updates only the current flow", () => {
  const html = renderToStaticMarkup(<SaveInformationDialog {...props} configurationIssues={["Missing recipe"]} />);
  expect(html).toContain("Update flow"); expect(html).not.toContain("Save as new flow");
  expect(html).toContain("This flow can be saved"); expect(html).not.toContain("disabled=");
});
it("offers reload after a conflict without a save-as option", () => {
  const html = renderToStaticMarkup(<SaveInformationDialog {...props} conflict error="Revision conflict" />);
  expect(html).toContain("Reload saved flow"); expect(html).toContain("Your edits are preserved");
  expect(html).not.toContain("Save as new flow");
});
