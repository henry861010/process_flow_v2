import * as React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { formatSchematicLength, SchematicDrawing, SchematicPreview } from "./schematic-preview";
import { formatSchematicDensity, SchematicInspectorCard, SchematicItemDetails } from "./schematic-inspector";
import type { SchematicDocument } from "./schematic-types";
import { schematicLabels, schematicTextColor } from "./schematic-labels";

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
  it("uses the full width for the cross section, with collapsed reading notes and visible warnings", () => {
    const markup = renderToStaticMarkup(<SchematicPreview document={document} />);
    const drawingStart = markup.indexOf('role="group"');
    const drawingEnd = markup.indexOf("</svg>", drawingStart);
    expect(markup).toContain("Schematic · not to scale");
    expect(markup).toContain("220 µm");
    expect(drawingStart).toBeGreaterThan(0);
    expect(markup.indexOf("220 µm")).toBeLessThan(drawingStart);
    expect(markup).not.toContain("<text");
    expect(markup).not.toContain("Component A");
    expect(markup).toContain('aria-label="Reading this schematic"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('aria-label="Schematic notes"');
    expect(markup).not.toContain("Thin layers are enlarged.");
    expect(markup).toContain("A generic layer style was used.");
    expect(markup.indexOf("A generic layer style was used.")).toBeGreaterThan(drawingEnd);
    expect(markup).not.toContain("<aside");
    expect(markup).not.toContain("Actual layer thicknesses");
    expect(markup).not.toContain("340px");
    expect(markup).not.toContain("adjacent list");
    expect(markup).not.toContain("layer details");
    expect(markup).not.toContain("<dl");
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

  it.each([[3000, 400], [800, 2400]])("fits the complete %s × %s diagram into both available axes without diagram scrolling", (width, height) => {
    const diagram = { ...document, viewBox: [0, 0, width, height] } as SchematicDocument;
    const markup = renderToStaticMarkup(<SchematicPreview document={diagram} />);
    const classes = Array.from(markup.matchAll(/class="([^"]+)"/g), ([, value]) => value.split(" "));
    expect(markup).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(markup).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(markup).toContain(`width="${width}" height="${height}"`);
    expect(markup).toContain('class="block h-full w-full font-sans"');
    expect(classes.some((tokens) => ["relative", "flex-1", "min-h-0", "overflow-hidden"].every((token) => tokens.includes(token))))
      .toBe(true);
    expect(classes.some((tokens) => ["h-full", "w-full", "min-h-0", "min-w-0", "overflow-hidden", "bg-white"].every((token) => tokens.includes(token))))
      .toBe(true);
    expect(classes.some((tokens) => ["shrink-0", "max-h-[25%]", "overflow-y-auto"].every((token) => tokens.includes(token))))
      .toBe(true);
    expect(markup).not.toContain('class="block h-auto w-full font-sans"');
    expect(markup).not.toContain("flex-1 overflow-y-auto");
    expect(markup).not.toContain('min-width:');
    expect(markup).not.toContain('min-w-[640px]');
    expect(markup).not.toContain('min-h-[320px]');
  });

  it("preserves snapshot coordinates while both axes constrain the diagram's uniform scale", () => {
    for (const height of [240, 2400]) {
      const diagram = { ...document, viewBox: [0, 0, 800, height] } as SchematicDocument;
      const markup = renderToStaticMarkup(<SchematicDrawing document={diagram} selectedItemId={null} onSelect={() => {}} />);
      const svg = markup.slice(0, markup.indexOf(">"));
      expect(svg).toContain('width="800"');
      expect(svg).toContain(`height="${height}"`);
      expect(svg).toContain(`viewBox="0 0 800 ${height}"`);
      expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(svg).toContain('class="block h-full w-full font-sans"');
      expect(markup).toContain('<circle cx="120" cy="150" r="10"');
    }
  });

  it("leaves reserved horizontal space empty and exposes only current snapshot selection targets", () => {
    const diagram = { ...document, viewBox: [0, 0, 2400, 400] } as SchematicDocument;
    const markup = renderToStaticMarkup(<SchematicPreview document={diagram} />);
    expect(markup).toContain('viewBox="0 0 2400 400"');
    expect(markup).not.toContain("data-component-label=");
    expect(markup).not.toContain("data-layer-label=");
    expect(markup).not.toContain("<text");
    expect(markup.match(/role="button"/g)).toHaveLength(document.items.length);
    expect(markup.match(/data-item-id=/g)).toHaveLength(document.shapes.length);
  });

  it("can explicitly enable labels in exposed layer regions while keeping measurements in the details", () => {
    const markup = renderToStaticMarkup(<SchematicPreview document={document} showLabels />);
    expect(markup).toContain('data-layer-label="body"');
    expect(markup).toContain('>Support<title>');
    expect(markup).not.toContain('<tspan');
    const covered = { ...document, shapes: [
      document.shapes[0],
      { id: "child", itemId: "fill", kind: "rect", x: 300, y: 180, width: 200, height: 80,
        fill: "#abc", stroke: "none", strokeWidth: 0 },
    ] } as SchematicDocument;
    const coveredMarkup = renderToStaticMarkup(<SchematicDrawing document={covered} selectedItemId={null} onSelect={() => {}} showLabels />);
    const parentLabel = schematicLabels(covered).find((label) => label.itemId === "body");
    expect(parentLabel).toBeDefined();
    expect(parentLabel!.x).toBeLessThan(300);
    expect(coveredMarkup).toContain('data-layer-label="body"');
    expect(coveredMarkup).toContain('data-layer-label="fill"');
  });

  it("shows only producer-selected carrier and component labels by default", () => {
    const names = ["LSI", "SoC", "HBM", "DMY", "DMY"];
    const diagram: SchematicDocument = { ...document,
      components: names.map((name, index) => ({ id: `component-${index}`, label: name === "DMY" ? "Wafer DMY" : name,
        diagramLabel: name, sourceIds: [`source-${index}`], x: 40 + index * 140, y: 80, width: 120, height: 60 })),
      items: [{ ...document.items[0], diagramLabel: "Carrier" }, document.items[1], ...names.map((name, index) => ({
        ...document.items[0], id: `body-${index}`, label: `${name} silicon`, groupLabel: name === "DMY" ? "Wafer DMY" : name,
      }))],
      shapes: [document.shapes[0], document.shapes[1], ...names.map((_, index) => ({ ...document.shapes[0],
        id: `shape-${index}`, itemId: `body-${index}`, x: 40 + index * 140, y: 80, width: 120, height: 60,
      }))],
    };
    const labels = schematicLabels(diagram, "primary");
    expect(labels.map((label) => label.text)).toEqual([...names, "Carrier"]);
    for (const label of labels.filter((label) => label.component)) {
      expect(label.y).toBe(110);
    }
    const markup = renderToStaticMarkup(<SchematicPreview document={diagram} />);
    expect(markup.match(/data-component-label=/g)).toHaveLength(5);
    expect(markup.match(/data-layer-label=/g)).toHaveLength(1);
    expect(markup).toContain('>Carrier<title>Support</title>');
    expect(markup).not.toContain('>Fill<title>');
    expect(renderToStaticMarkup(<SchematicPreview document={diagram} showLabels={false} />)).not.toContain("<text");
  });

  it("centers component names inside visible bodies with contrasting text and no duplicate layer name", () => {
    const component = { ...document, shapes: [
      { ...document.shapes[0], x: 250, y: 80, width: 150, height: 60, fill: "#424547" },
    ], items: [{ ...document.items[0], groupLabel: "Component A" }] } as SchematicDocument;
    const labels = schematicLabels(component);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ component: true, text: "Component A", x: 325, y: 110, background: "#424547" });
    const markup = renderToStaticMarkup(<SchematicDrawing document={component} selectedItemId={null} onSelect={() => {}} showLabels />);
    expect(markup).toContain('data-component-label="component"');
    expect(markup).toContain('fill="#ffffff"');
    expect(markup).not.toContain('data-layer-label="body"');
    expect(schematicTextColor("#006b57")).toBe("#ffffff");
    expect(schematicTextColor("#bcbcbc")).toBe("#111827");
    expect(schematicTextColor("#ffcf00")).toBe("#111827");
    expect(schematicTextColor("#fff")).toBe("#111827");
  });

  it("avoids clipped holes and fully hidden parent slabs when placing labels", () => {
    const clipped = { ...document, components: [], shapes: [{ ...document.shapes[0],
      clip: { x: 20, y: 160, width: 760, height: 120, exclusions: [{ x: 20, y: 160, width: 500, height: 120 }] },
    }] } as SchematicDocument;
    expect(schematicLabels(clipped)[0].x).toBeGreaterThan(520);
    const covered = { ...document, components: [], shapes: [document.shapes[0], {
      ...document.shapes[0], id: "cover", itemId: "fill",
    }] } as SchematicDocument;
    expect(schematicLabels(covered).some((label) => label.itemId === "body")).toBe(false);
    const window = { ...covered, shapes: [document.shapes[0], {
      ...covered.shapes[1], clip: { x: 20, y: 160, width: 760, height: 120,
        exclusions: [{ x: 250, y: 160, width: 300, height: 120 }] },
    }] } as SchematicDocument;
    const exposed = schematicLabels(window).find((label) => label.itemId === "body");
    expect(exposed).toMatchObject({ x: 400, y: 220 });
  });

  it("gives each item one keyboard target and highlights all shapes of the selected item", () => {
    const markup = renderToStaticMarkup(<SchematicDrawing document={document} selectedItemId="contact" inspectorId="feature-inspector" onSelect={() => {}} />);
    expect(markup.match(/role="button"/g)).toHaveLength(3);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(3);
    expect(markup.match(/data-selected="true"/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="Assembly, Contact, 5 µm"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(markup.match(/aria-controls="feature-inspector"/g)).toHaveLength(1);
    expect(markup).toContain("Enter, or Space");
  });

  it("does not associate a closed inspector with any keyboard target", () => {
    const markup = renderToStaticMarkup(<SchematicDrawing document={document} selectedItemId={null} inspectorId="feature-inspector" onSelect={() => {}} />);
    expect(markup).not.toContain('aria-expanded="true"');
    expect(markup).not.toContain('aria-controls="feature-inspector"');
    expect(markup.match(/role="button"/g)).toHaveLength(document.items.length);
  });

  it("keeps a filled circle row clipped and selectable as one thickness item", () => {
    const circles = Array.from({ length: 40 }, (_, index) => ({
      ...document.shapes[2], id: `contact-${index}`, cx: 30 + index * 19, r: 6,
      clip: { x: 20, y: 140, width: 760, height: 20,
        exclusions: [{ x: 250, y: 140, width: 150, height: 20 }] },
    }));
    const filled = { ...document, shapes: [document.shapes[0], ...circles] } as SchematicDocument;
    const markup = renderToStaticMarkup(<SchematicDrawing document={filled} selectedItemId="contact" onSelect={() => {}} />);
    expect(markup.match(/<circle /g)).toHaveLength(40);
    expect(markup.match(/data-selected="true"/g)).toHaveLength(40);
    expect(markup.match(/role="button"/g)).toHaveLength(2);
    expect(markup.match(/aria-label="Assembly, Contact, 5 µm"/g)).toHaveLength(1);
    expect(markup.match(/clip-path="url\(/g)).toHaveLength(40);
    expect(new Set(Array.from(markup.matchAll(/<clipPath id="([^"]+)"/g), (match) => match[1])).size).toBe(40);
    expect(markup).toContain('d="M 20 140 h 760 v 20 h -760 Z M 250 140 h 150 v 20 h -150 Z"');
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

describe("schematic feature details", () => {
  it.each([
    [[30], "30%"],
    [[30, 50], "30%, 50%"],
    [[0, 100], "0%, 100%"],
    [[0.125, 12.5], "0.125%, 12.5%"],
    [[null], "Not specified"],
    [[30, null], "30%, Not specified"],
  ] as const)("formats raw density percentages %j as %s", (values, expected) => {
    expect(formatSchematicDensity(values)).toBe(expected);
  });

  it("shows structure, feature, material and the snapshot's actual thickness", () => {
    const item = { ...document.items[2], thickness: 1.25, densityValues: [30, 50] };
    const markup = renderToStaticMarkup(<SchematicItemDetails item={item} unit="um" />);
    for (const value of ["Assembly", "Contact", "Material", "Copper", "THK", "1.25 µm", "Density", "30%, 50%"])
      expect(markup).toContain(value);
    expect(markup).not.toContain(">5 µm<");
    expect(renderToStaticMarkup(<SchematicItemDetails item={item} unit="mm" />)).toContain("1.25 mm");
  });

  it("omits density when the contract does not provide it and distinguishes missing density from zero", () => {
    const body = renderToStaticMarkup(<SchematicItemDetails item={document.items[0]} unit="um" />);
    expect(body).toContain("200 µm");
    expect(body).not.toContain("Density");
    expect(renderToStaticMarkup(<SchematicItemDetails item={{ ...document.items[0], densityValues: null }} unit="um" />))
      .not.toContain("Density");
    const missing = renderToStaticMarkup(<SchematicItemDetails item={{ ...document.items[2], material: "", densityValues: [null] }} unit="um" />);
    expect(missing).toContain("Unspecified material");
    expect(missing).toContain("Not specified");
    expect(missing).not.toContain("0%");
    const zero = renderToStaticMarkup(<SchematicItemDetails item={{ ...document.items[2], densityValues: [0] }} unit="um" />);
    expect(zero).toContain("0%");
    expect(zero).not.toContain("Not specified");
  });

  it("escapes material text and allows long names to wrap within the card", () => {
    const material = `<script>alert("material")</script>${"VeryLongMaterial".repeat(30)}`;
    const markup = renderToStaticMarkup(<SchematicItemDetails item={{ ...document.items[2], material }} unit="um" />);
    expect(markup).toContain("&lt;script&gt;alert(&quot;material&quot;)&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toMatch(/break-words|break-all|overflow-wrap/);
  });
});

describe("schematic inspector dock", () => {
  it("keeps the accessible feature card in normal flow with its own responsive scroll area", () => {
    const item = { ...document.items[2], densityValues: [30, 50] };
    const markup = renderToStaticMarkup(<SchematicInspectorCard id="contact-details" item={item} unit="um" onClose={() => {}} />);
    const section = markup.slice(0, markup.indexOf(">"));
    const sectionClasses = section.match(/class="([^"]+)"/)?.[1].split(" ") ?? [];
    expect(section).toContain('<section');
    expect(section).toContain('id="contact-details"');
    expect(section).toContain('role="region"');
    expect(section).toContain('aria-label="Feature details"');
    expect(section).toContain('aria-live="polite"');
    for (const token of ["relative", "min-h-0", "max-h-[40%]", "w-full", "shrink-0", "overflow-y-auto", "lg:max-h-full", "lg:w-72"])
      expect(sectionClasses).toContain(token);
    expect(sectionClasses).not.toContain("absolute");
    expect(section).not.toMatch(/style="[^"]*(?:left|top):/);
    expect(markup).toContain('aria-label="Close feature details"');
    expect(markup.match(/<button/g)).toHaveLength(1);
    for (const value of ["Assembly", "Contact", "Material", "Copper", "THK", "5 µm", "Density", "30%, 50%"])
      expect(markup).toContain(value);
  });

  it("preserves independent IDs and contents when multiple preview cards render", () => {
    const markup = renderToStaticMarkup(<>
      <SchematicInspectorCard id="support-details" item={document.items[0]} unit="um" onClose={() => {}} />
      <SchematicInspectorCard id="contact-details" item={{ ...document.items[2], densityValues: [0] }} unit="mm" onClose={() => {}} />
    </>);
    const ids = Array.from(markup.matchAll(/<section[^>]* id="([^"]+)"/g), (match) => match[1]);
    expect(ids).toEqual(["support-details", "contact-details"]);
    expect(markup.match(/role="region"/g)).toHaveLength(2);
    expect(markup.match(/aria-label="Close feature details"/g)).toHaveLength(2);
    expect(markup).toContain("200 µm");
    expect(markup).toContain("5 mm");
    expect(markup).toContain("0%");
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
    expect(source).not.toMatch(/wafer-dmy|soic|underfill|geometryEntityJson|processProgram|(?:body|container|node)\.key|@\/components\/viewer/);
    expect(source).toContain('event.key === "Enter" || event.key === " "');
  });
});
