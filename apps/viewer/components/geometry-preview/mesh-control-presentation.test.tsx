import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MeshControlConfiguration, MeshControlSetRuleDetail } from "./file-export-client";
import { buildMeshControlConfiguration, draftsFromMeshControlConfiguration } from "./file-export-mesh-control";
import { collectMeshInstanceNames, formatMeshControlLabel, formatResolvedCoordinate } from "./mesh-control-presentation";
import { MeshResolvedRules } from "./mesh-resolved-rules";
import { defaultMeshSettingsDraft, loadMeshSettingsDraft, saveMeshSettingsDraft } from "./mesh-settings-drafts";

const socId = "container:container-carrier-wafer-child-2-soc-container-soc:d90b8e6d4ea3";
const otherSocId = "container:soc.[2]";
const hbmId = "container:hbm-1";
const geometry = { root: { id: "root", children: [
  { id: "wrapper", children: [{ id: socId, key: "soc", children: [{ id: hbmId, key: "hbm" }] }] },
  { id: otherSocId, key: "soc" },
] } };
const instances = collectMeshInstanceNames(geometry);
const generatedLabel = (id = socId, anchors = "x_min/y_min", key = "soc") => `${key} ${id} top corner ${anchors}`;
const regionDetail: MeshControlSetRuleDetail = {
  label: generatedLabel(), status: "applied", startZ: 862.333333333, endZ: 912.333333333,
  sourceIds: [socId], resolvedRegions: [{ sourceId: socId,
    bounds: { xMin: 975, xMax: 1025, yMin: 975, yMax: 1025, zMin: 862.333333333, zMax: 912.333333333 } }],
};

function render(details: MeshControlSetRuleDetail[], customized = false) {
  return renderToStaticMarkup(<MeshResolvedRules details={details} customized={customized} instanceNames={instances} />);
}

describe("mesh-control display names", () => {
  it("numbers nested instances in geometry order, separately for SoC and HBM", () => {
    expect([...instances.values()].map(instance => instance.name)).toEqual(["soc-1", "hbm-1", "soc-2"]);
    // Reordering or deleting controls does not renumber the remaining geometry.
    const labels = [otherSocId, socId].map(id => formatMeshControlLabel(generatedLabel(id), instances, [id]));
    expect(labels).toEqual(["soc-2 bottom-left", "soc-1 bottom-left"]);
    expect(formatMeshControlLabel(generatedLabel(otherSocId), instances, [otherSocId])).toBe(labels[0]);
    expect(formatMeshControlLabel(generatedLabel(hbmId, "x_max/y_max", "hbm"), instances, [hbmId])).toBe("hbm-1 top-right");
  });

  it.each([
    ["x_min/y_min", "bottom-left"], ["x_min/y_max", "top-left"],
    ["x_max/y_min", "bottom-right"], ["x_max/y_max", "top-right"],
  ])("maps %s to %s without changing the Z interpretation", (anchors, corner) => {
    expect(formatMeshControlLabel(generatedLabel(socId, anchors), instances, [socId])).toBe(`soc-1 ${corner}`);
  });

  it("only aliases exact generated names with matching sources and preserves custom names", () => {
    expect(formatMeshControlLabel("lsi_si", instances)).toBe("LSI Si");
    for (const label of ["LSI custom", "lsi_si revised", "soc-1 custom corner", `${generatedLabel()} edited`]) {
      expect(formatMeshControlLabel(label, instances, [socId])).toBe(label);
    }
    expect(formatMeshControlLabel(generatedLabel(), instances, [otherSocId])).toBe(generatedLabel());
    expect(formatMeshControlLabel(generatedLabel(), instances)).toBe(generatedLabel());
    expect(formatMeshControlLabel(generatedLabel("unknown"), instances, ["unknown"])).toBe(generatedLabel("unknown"));
  });

  it("handles missing structure and repeated container objects", () => {
    expect(collectMeshInstanceNames(null).size).toBe(0);
    expect(collectMeshInstanceNames({ root: {} }).size).toBe(0);
    const shared = { id: socId, key: "soc" };
    expect(collectMeshInstanceNames({ root: { children: [shared, shared, { id: socId, key: "soc" }] } }).size).toBe(1);
  });

  it.each([[975, "975"], [862.333333333, "862.333"], [912.33, "912.33"], [-377.5, "-377.5"], [-0.00001, "0"]])(
    "formats %s as %s", (value, expected) => expect(formatResolvedCoordinate(value)).toBe(expected),
  );
});

describe("resolved mesh rules", () => {
  it("renders one rule with three axis rows and no ID or duplicate Z summary", () => {
    const html = render([regionDetail]);
    expect(html).toContain("soc-1 bottom-left");
    expect(html).not.toContain(socId);
    expect(html).not.toContain("top corner");
    expect(html.match(/<li\b/g)).toHaveLength(1);
    expect(html.match(/<dt>/g)).toHaveLength(3);
    expect(html).toContain("<dt>X</dt>");
    expect(html).toContain("<dt>Y</dt>");
    expect(html).toContain("<dt>Z</dt>");
    expect(html.match(/862\.333/g)).toHaveLength(1);
    expect(html.match(/912\.333/g)).toHaveLength(1);
    expect(html).not.toContain("font-mono");
  });

  it("keeps all regions within one rule and distinguishes the original result after edits", () => {
    const secondRegion = { sourceId: otherSocId,
      bounds: { xMin: -200, xMax: -150, yMin: 10, yMax: 60, zMin: 100, zMax: 150 } };
    const html = render([{ ...regionDetail, resolvedRegions: [...regionDetail.resolvedRegions!, secondRegion] }], true);
    expect(html).toContain("Original resolved rules");
    expect(html.match(/<li\b/g)).toHaveLength(1);
    expect(html.match(/<dl\b/g)).toHaveLength(2);
    expect(html.match(/<dt>/g)).toHaveLength(6);
    expect(html).toContain("-200");
    expect(html).not.toContain(otherSocId);
  });

  it("keeps omitted rules and ordinary Z ranges without shifting source associations", () => {
    const html = render([
      { label: "lsi_si", status: "omitted", startZ: 100, endZ: 100, sourceIds: ["lsi"] },
      { label: "TD_uBump", status: "applied", startZ: 627.5, endZ: 727.5, sourceIds: ["bump"] },
      regionDetail,
    ]);
    expect(html).toContain("LSI Si");
    expect(html).not.toContain("lsi_si");
    expect(html).toContain("zero thickness, omitted");
    expect(html).toContain("627.5 → 727.5 µm");
    expect(html).toContain("soc-1 bottom-left");
    expect(html.match(/<li\b/g)).toHaveLength(3);
  });

  it("leaves stored drafts and exported labels, references and coordinates intact", () => {
    const configuration: MeshControlConfiguration = {
      schemaVersion: "1.0.0", unitSystem: "um", mesher: "process_flow_2_5d", globalElementSize: 1000, symmetry: "full",
      controls: [{ method: "3D_REGION", label: generatedLabel(), coordinateMode: "reference", elementSize: 5,
        reference: { kind: "container", id: socId }, region: { type: "box",
          min: { x: { anchor: "x_min", offset: -25 }, y: { anchor: "y_min", offset: -25 }, z: { anchor: "z_max", offset: -25 } },
          max: { x: { anchor: "x_min", offset: 25 }, y: { anchor: "y_min", offset: 25 }, z: { anchor: "z_max", offset: 25 } },
        } }, { method: "Z_SECTION_AVG", label: "lsi_si", coordinateMode: "absolute", elementSize: 40, startZ: 517.5, endZ: 717.5 }],
    };
    const drafts = draftsFromMeshControlConfiguration(configuration);
    const original = JSON.stringify(drafts);
    drafts.forEach(control => formatMeshControlLabel(control.label, instances, [control.referenceId]));
    render([regionDetail]);
    expect(JSON.stringify(drafts)).toBe(original);
    expect(buildMeshControlConfiguration("1000", "full", drafts)).toEqual(configuration);

    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const saved = { ...defaultMeshSettingsDraft(), globalElementSize: "1000", controls: drafts, setDetails: [regionDetail] };
    expect(saveMeshSettingsDraft("geometry", saved, storage)).toBe(true);
    const restored = loadMeshSettingsDraft("geometry", storage).draft!;
    expect(restored).toEqual(saved);
    expect(buildMeshControlConfiguration(restored.globalElementSize, restored.symmetry, restored.controls)).toEqual(configuration);
    expect(formatMeshControlLabel(restored.controls[0].label, instances, [restored.controls[0].referenceId])).toBe("soc-1 bottom-left");
  });
});
