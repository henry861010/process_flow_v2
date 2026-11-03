import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GeometryPreviewSnapshot } from "./geometry-preview-client";
import { GeometryPreviewSnapshotContent } from "./geometry-preview-panel";
import type { SchematicDocument } from "./schematic-types";

const snapshot: GeometryPreviewSnapshot = {
  snapshotId: "molding-output",
  sourceKind: "stepOutput",
  stepRefId: "molding",
  label: "Molding",
  order: 2,
  geometryHash: "hash",
  geometryEntityJson: {
    id: null, category: null, entityType: "assembly", name: "Package", dim: "3d",
    owner: null, description: null, structureFormat: "standard", structure: {},
  },
  meshUrl: "/mesh",
  sectionUrl: "/section",
};
const executionWarnings = [{
  code: "joint_soh_preserved",
  stepRefId: "joint",
  stepLabel: "MR joint",
  message: "Requested SOH 10 µm; actual SOH remains 56 µm because support material is present.",
  details: { childId: "soc-1", requestedSoh: 10, actualSoh: 56, unit: "um" },
}];
const schematic: SchematicDocument = {
  schemaVersion: 1, unit: "um", viewBox: [0, 0, 800, 400],
  shapes: [], items: [], components: [], totalThickness: 56, notes: [], warnings: [],
};

describe("preview snapshot process warnings", () => {
  it("shows inherited warnings before the schematic and reserves the remaining space for it", () => {
    const markup = renderToStaticMarkup(<GeometryPreviewSnapshotContent snapshot={{
      ...snapshot, schematic, executionWarnings,
    }} />);
    expect(markup.indexOf('aria-label="Process warnings"')).toBeLessThan(markup.indexOf('aria-label="Structure cross section"'));
    expect(markup).toContain("MR joint");
    expect(markup).toContain("56 µm");
    expect(markup).toContain('class="flex h-full min-h-0 flex-col overflow-hidden"');
    expect(markup).toContain('class="min-h-0 flex-1 overflow-hidden"');
  });

  it.each([null, { ...schematic, schemaVersion: 2 } as unknown as SchematicDocument])(
    "keeps process warnings visible when the schematic is unavailable or unsupported",
    (document) => {
      const markup = renderToStaticMarkup(<GeometryPreviewSnapshotContent snapshot={{
        ...snapshot, schematic: document, executionWarnings, schematicWarnings: ["Builder failed."],
      }} />);
      expect(markup).toContain('aria-label="Process warnings"');
      expect(markup).toContain(executionWarnings[0].message);
      expect(markup).toContain("Cross section unavailable");
      expect(markup).toContain("Builder failed.");
      expect(markup).toContain("still export its original geometry");
    },
  );

  it("accepts snapshots from old servers without execution warnings", () => {
    const markup = renderToStaticMarkup(<GeometryPreviewSnapshotContent snapshot={{ ...snapshot, schematic }} />);
    expect(markup).toContain("Cross section");
    expect(markup).not.toContain("Process warnings");
  });
});
