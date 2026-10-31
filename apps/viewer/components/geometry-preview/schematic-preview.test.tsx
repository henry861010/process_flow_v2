import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatSchematicLength, SchematicDrawing, SchematicPreview } from "./schematic-preview";
import type { SchematicDocument } from "./schematic-types";

const document: SchematicDocument = {
  schemaVersion: 1,
  unit: "um",
  viewBox: [0, 0, 800, 400],
  shapes: [
    { id: "body-shape", itemId: "body", kind: "rect", fill: "#b8cde5", stroke: "#283549", strokeWidth: 1, x: 20, y: 160, width: 760, height: 120 },
    { id: "fill-shape", itemId: "fill", kind: "rect", fill: "#d4d9b3", stroke: "#283549", strokeWidth: 1, x: 20, y: 80, width: 760, height: 80,
      clip: { x: 20, y: 80, width: 760, height: 80, exclusions: [{ x: 250, y: 80, width: 150, height: 60 }] } },
    { id: "circle-a", itemId: "contact", kind: "circle", fill: "#f5c84d", stroke: "#7d681f", strokeWidth: 1, cx: 120, cy: 150, r: 10 },
    { id: "circle-b", itemId: "contact", kind: "circle", fill: "#f5c84d", stroke: "#7d681f", strokeWidth: 1, cx: 180, cy: 150, r: 10 },
    { id: "trace", itemId: "contact", kind: "path", fill: "none", stroke: "#f5c84d", strokeWidth: 4, points: [[90, 100], [200, 100], [200, 120]], closed: false },
  ],
  items: [
    { id: "body", label: "Support", material: "Glass", groupLabel: "Substrate", sourceIds: ["body-1"], zMin: -200, zMax: 0, thickness: 200 },
    { id: "fill", label: "Fill", material: "Epoxy", groupLabel: "Assembly", sourceIds: ["fill-1"], zMin: 0, zMax: 20, thickness: 20 },
    { id: "contact", label: "Contact", material: "Copper", groupLabel: "Assembly", sourceIds: ["contact-1"], zMin: 0, zMax: 5, thickness: 5 },
  ],
  components: [{ id: "component", label: "Component A", sourceIds: ["component-1"], x: 250, y: 80, width: 150, height: 60 }],
  totalThickness: 220,
  notes: ["Thin layers are enlarged."],
  warnings: ["A generic layer style was used."],
};

describe("schematic preview", () => {
  it("shows actual thicknesses, physical Z intervals and component labels", () => {
    const markup = renderToStaticMarkup(<SchematicPreview document={document} />);
    expect(markup).toContain("Schematic · not to scale");
    expect(markup).toContain("220 µm");
    expect(markup).toContain("200 µm");
    expect(markup).toContain("Z -200 µm → 0 µm");
    expect(markup).toContain("Glass");
    expect(markup).toContain("Component A");
    expect(markup).toContain("Thin layers are enlarged.");
    expect(markup).toContain("A generic layer style was used.");
    expect(markup).toContain("lg:grid-cols-[minmax(0,1fr)_340px]");
    expect(markup).toContain("min-w-[640px]");
  });

  it("honors generic primitive coordinates and material styles without distorting circles", () => {
    const markup = renderToStaticMarkup(<SchematicDrawing document={document} selectedItemId={null} onSelect={() => {}} />);
    expect(markup).toContain('viewBox="0 0 800 400"');
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(markup).toContain('<rect x="20" y="160" width="760" height="120" fill="#b8cde5"');
    expect(markup).toContain('<circle cx="120" cy="150" r="10"');
    expect(markup).toContain('<circle cx="180" cy="150" r="10"');
    expect(markup).toContain('d="M 90 100 L 200 100 L 200 120"');
    expect(markup).not.toContain("<ellipse");
    expect(markup).not.toContain('preserveAspectRatio="none"');
  });

  it("preserves readable diagram scale when many component variants require horizontal scrolling", () => {
    const wide = { ...document, viewBox: [0, 0, 3000, 400] } as SchematicDocument;
    const markup = renderToStaticMarkup(<SchematicPreview document={wide} />);
    expect(markup).toContain('min-width:3000px');
    expect(markup).toContain('viewBox="0 0 3000 400"');
  });

  it("labels visible layers with actual thickness without placing parent labels over child bodies", () => {
    const markup = renderToStaticMarkup(<SchematicDrawing document={document} selectedItemId={null} onSelect={() => {}} />);
    expect(markup).toContain('data-layer-label="body"');
    expect(markup).toContain('>Support</tspan>');
    expect(markup).toContain('>200 µm</tspan>');
    const covered = { ...document, shapes: [
      document.shapes[0],
      { id: "child", itemId: "fill", kind: "rect", x: 300, y: 180, width: 200, height: 80,
        fill: "#abc", stroke: "none", strokeWidth: 0 },
    ] } as SchematicDocument;
    const coveredMarkup = renderToStaticMarkup(<SchematicDrawing document={covered} selectedItemId={null} onSelect={() => {}} />);
    expect(coveredMarkup).not.toContain('data-layer-label="body"');
    expect(coveredMarkup).toContain('data-layer-label="fill"');
  });

  it("gives each item one keyboard target and highlights all shapes of the selected item", () => {
    const markup = renderToStaticMarkup(<SchematicDrawing document={document} selectedItemId="contact" onSelect={() => {}} />);
    expect(markup.match(/role="button"/g)).toHaveLength(3);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(3);
    expect(markup.match(/data-selected="true"/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="Assembly, Contact, 5 µm"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Enter, or Space");
  });

  it("clips excluded regions with an evenodd path and unique per-instance IDs", () => {
    const markup = renderToStaticMarkup(<><SchematicDrawing document={document} selectedItemId={null} onSelect={() => {}} /><SchematicDrawing document={document} selectedItemId={null} onSelect={() => {}} /></>);
    const ids = Array.from(markup.matchAll(/<clipPath id="([^"]+)"/g), (match) => match[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(markup).toContain(`clip-path="url(#${id})"`);
    expect(markup).toContain('clip-rule="evenodd" fill-rule="evenodd"');
    expect(markup).toContain('d="M 20 80 h 760 v 80 h -760 Z M 250 80 h 150 v 60 h -150 Z"');
  });

  it("explains absent/unsupported schematics and displays builder warnings without throwing", () => {
    const markup = renderToStaticMarkup(<SchematicPreview document={null} warnings={["Presentation builder failed."]} />);
    expect(markup).toContain("Cross section unavailable");
    expect(markup).toContain("still export its original geometry");
    expect(markup).toContain("Presentation builder failed.");
    const unsupported = { ...document, schemaVersion: 2 } as unknown as SchematicDocument;
    expect(renderToStaticMarkup(<SchematicPreview document={unsupported} />)).toContain("Cross section unavailable");
  });

  it("handles a completely removed structure and preserves fractional physical units", () => {
    const empty = { ...document, shapes: [], items: [], components: [], totalThickness: 0 };
    expect(renderToStaticMarkup(<SchematicPreview document={empty} />)).toContain("no visible structure");
    expect(formatSchematicLength(0.0000125, "um")).toBe("0.0000125 µm");
    expect(formatSchematicLength(0, "μm")).toBe("0 µm");
    expect(formatSchematicLength(0.02, "mm")).toBe("0.02 mm");
  });
});

describe("Flow Editor preview architecture", () => {
  it("requests only the snapshot session and exports its unchanged source structure", () => {
    const source = readFileSync(new URL("./geometry-preview-panel.tsx", import.meta.url), "utf8");
    expect(source).toContain("requestGeometryPreviewSession(preview.request, controller.signal)");
    expect(source).toContain("controller.abort()");
    expect(source).toContain("snapshot.snapshotId === state.session.initialSnapshotId");
    expect(source).toContain("geometryStructure={targetSnapshot.geometryEntityJson.structure}");
    expect(source).toContain("geometryEntityJson={targetSnapshot.geometryEntityJson}");
    expect(source).not.toMatch(/requestGeometryPreviewModel|requestGeometrySection|loadCadBlob|ViewerScene|PreviewCadWorkbench|three|geometry-feature-overlay/);
  });

  it("keeps process-specific rules and geometry access outside the renderer", () => {
    const source = readFileSync(new URL("./schematic-preview.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/wafer-dmy|soic|underfill|density|geometryEntityJson|processProgram|(?:body|container|node)\.key|@\/components\/viewer/);
    expect(source).toContain('event.key === "Enter" || event.key === " "');
  });
});
