import { describe, expect, it } from "vitest";
import { buildMeshControlConfiguration, changeCoordinateMode, draftsFromMeshControlConfiguration, newMeshControlDraft, validateMeshControlDraft, type MeshControlDraft } from "./file-export-mesh-control";
import { buildRegion, newPolygonLoop, newRegionDraft, validateRegionDraft } from "./file-export-regions";

function regionControl() {
  return { ...newMeshControlDraft(), label: "Focus", method: "3D_REGION" as const };
}

describe("uniform mesh-control coordinate modes", () => {
  it("defaults to an absolute Box at size 5 with blank coordinates and no reference", () => {
    const draft = regionControl();
    expect(draft.coordinateMode).toBe("absolute");
    expect(validateMeshControlDraft("500", [draft])).toContain("finite number");
    for (const bound of ["min", "max"] as const) {
      for (const axis of ["x", "y", "z"] as const) {
        expect(draft.region.box[bound][axis].value).toBe("");
        draft.region.box[bound][axis].value = bound === "min" ? "0" : "10";
      }
    }
    expect(validateMeshControlDraft("500", [draft])).toBeNull();
    const entry = buildMeshControlConfiguration("500", "full", [draft]).controls[0];
    expect(entry).toMatchObject({ coordinateMode: "absolute", elementSize: 5,
      region: { type: "box", min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } } });
    expect(entry).not.toHaveProperty("reference");
    expect(JSON.stringify(entry)).not.toContain('"mode"');
  });

  it("roundtrips Reference Box and Absolute Polygon without losing values", () => {
    const box = changeCoordinateMode(regionControl(), "reference");
    box.region.box.min.x.value = "-100";
    box.region.box.max.z.value = "20";
    box.referenceKind = "body";
    box.referenceKey = "soc.si";
    box.referenceId = "body-1";
    const polygon = changeCoordinateMode(regionControl(), "absolute");
    polygon.region.shape = "polygon";
    polygon.region.elementSize = "2.5";
    polygon.region.polygon.loops = [[
      { x: { anchor: "x_min", value: "0" }, y: { anchor: "y_min", value: "0" } },
      { x: { anchor: "x_max", value: "10" }, y: { anchor: "y_min", value: "0" } },
      { x: { anchor: "x_min", value: "0" }, y: { anchor: "y_max", value: "10" } },
    ]];
    polygon.region.polygon.startZ.value = "-2";
    polygon.region.polygon.endZ.value = "20";
    expect(validateMeshControlDraft("500", [box, polygon])).toBeNull();
    const config = buildMeshControlConfiguration("500", "full", [box, polygon]);
    expect(config.controls[1]).toMatchObject({ coordinateMode: "absolute", region: { loops: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]], startZ: -2, endZ: 20 } });
    expect(config.controls[1]).not.toHaveProperty("reference");
    expect(buildMeshControlConfiguration("500", "full", draftsFromMeshControlConfiguration(config))).toEqual(config);
  });

  it("preserves independent mode drafts, current shape and element size without conversion", () => {
    let draft = changeCoordinateMode(regionControl(), "reference");
    draft.region.shape = "polygon";
    draft.region.elementSize = "2";
    draft.region.polygon.loops[0][0].x.value = "7";
    let absolute = changeCoordinateMode(draft, "absolute");
    expect(absolute.region.shape).toBe("polygon");
    expect(absolute.region.elementSize).toBe("2");
    expect(absolute.region.polygon.loops[0][0].x.value).toBe("");
    expect(absolute.startZ.value).toBe("");
    expect(validateMeshControlDraft("500", [absolute])).toContain("finite number");
    absolute.region.polygon.loops[0][0].x.value = "200";
    const reference = changeCoordinateMode(absolute, "reference");
    expect(reference.region.polygon.loops[0][0].x.value).toBe("7");
    absolute = changeCoordinateMode(reference, "absolute");
    expect(absolute.region.polygon.loops[0][0].x.value).toBe("200");
    expect(draft.region.polygon.loops[0][0].x.value).toBe("7");
  });

  it.each(["Z_SECTION_AVG", "Z_SECTION_TOP", "Z_SECTION_BOT", "Z_SECTION_CENTER", "Z_POINT"] as const)("applies one mode to %s and preserves both coordinate banks", method => {
    let draft: MeshControlDraft = { ...newMeshControlDraft(), label: "Z control", method };
    expect(draft.coordinateMode).toBe("absolute");
    expect([draft.startZ.value, draft.endZ.value, draft.z.value]).toEqual(["", "", ""]);
    draft = changeCoordinateMode(draft, "reference");
    draft.startZ.value = "7";
    draft.endZ.value = "9";
    draft.z.value = "8";
    let absolute = changeCoordinateMode(draft, "absolute");
    expect([absolute.startZ.value, absolute.endZ.value, absolute.z.value]).toEqual(["", "", ""]);
    absolute.startZ.value = "100";
    absolute.endZ.value = "200";
    absolute.z.value = "150";
    const config = buildMeshControlConfiguration("500", "full", [absolute]);
    const entry = config.controls[0];
    expect(entry).not.toHaveProperty("reference");
    expect(entry.coordinateMode).toBe("absolute");
    if (entry.method === "Z_POINT") { expect(entry.z).toBe(150); expect(entry).not.toHaveProperty("elementSize"); }
    else expect(entry).toMatchObject({ startZ: 100, endZ: 200 });
    expect(buildMeshControlConfiguration("500", "full", draftsFromMeshControlConfiguration(config))).toEqual(config);
    const restored = changeCoordinateMode(absolute, "reference");
    expect([restored.startZ.value, restored.endZ.value, restored.z.value]).toEqual(["7", "9", "8"]);
  });

  it("serializes only the active shape and keeps per-method fields intact", () => {
    const draft = regionControl();
    draft.region.box.min.x.value = "-30";
    draft.region.shape = "polygon";
    draft.region.polygon.loops[0][0].x.value = "4";
    expect(buildRegion(draft.region, "reference")).not.toHaveProperty("min");
    draft.region.shape = "box";
    expect(buildRegion(draft.region, "reference")).not.toHaveProperty("loops");
    expect(draft.region.box.min.x.value).toBe("-30");
    const section = { ...draft, method: "Z_SECTION_AVG" as const };
    expect(buildMeshControlConfiguration("500", "full", [section]).controls[0]).not.toHaveProperty("region");
    expect(buildMeshControlConfiguration("500", "full", [draft]).controls[0]).toHaveProperty("elementSize", 5);
  });

  it("creates loops in the selected mode and validates numeric fields and point counts", () => {
    expect(newPolygonLoop("absolute").flatMap(p => [p.x.value, p.y.value])).toEqual(["", "", "", "", "", ""]);
    expect(newPolygonLoop("reference")[0].x.value).toBe("0");
    const draft = newRegionDraft();
    draft.shape = "polygon";
    draft.polygon.loops.push(newPolygonLoop());
    draft.polygon.loops[1][1].x.value = "bad";
    expect(validateRegionDraft(draft)).toContain("loops[1][1].x");
    draft.polygon.loops[1].pop();
    expect(validateRegionDraft(draft)).toContain("three vertices");
    draft.polygon.loops = [];
    expect(validateRegionDraft(draft)).toContain("one loop");
  });
});
