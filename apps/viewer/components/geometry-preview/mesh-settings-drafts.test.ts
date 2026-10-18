import { describe, expect, it } from "vitest";
import type { MeshControlSetApplyResponse } from "./file-export-client";
import { changeCoordinateMode, MESH_CONTROL_METHODS, newMeshControlDraft } from "./file-export-mesh-control";
import {
  defaultMeshSettingsDraft, loadMeshSettingsDraft, MESH_SETTINGS_STORAGE_KEY, saveMeshSettingsDraft,
  needsResolvedRuleMetadata, restoreResolvedRuleMetadata,
  type MeshSettingsDraft,
} from "./mesh-settings-drafts";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); } };
}

function completeDraft(): MeshSettingsDraft {
  return {
    globalElementSize: " 125.00 ", symmetry: "upper_right_quarter", setCustomized: true,
    appliedSet: { id: "meshModel1", version: "old-version", label: "Saved set", description: "Original description" },
    setDetails: [{ label: "Focus", method: "3D_REGION", elementSize: 5, status: "applied", startZ: 0, endZ: 10, sourceIds: ["body:source"],
      resolvedRegions: [{ sourceId: "body:source", bounds: { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 10 } }] }],
    controls: MESH_CONTROL_METHODS.map((method, index) => {
      const control = changeCoordinateMode(newMeshControlDraft(), "reference");
      control.clientId = `saved-${index}`;
      control.method = method;
      control.referenceKind = "bump";
      control.referenceKey = "";
      control.referenceId = "bump:original-id";
      control.label = index === 0 ? "" : `Control ${index}`;
      control.startZ.value = "-";
      control.z.value = "1e";
      control.region.shape = index % 2 ? "polygon" : "box";
      control.region.polygon.loops.push([]); // A newly added, unfinished loop is valid draft data.
      control.inactiveCoordinates.region.box.min.x.value = "42.00";
      control.inactiveCoordinates.endZ.value = "";
      return control;
    }),
  };
}

describe("mesh settings drafts", () => {
  it("uses defaults for a geometry with no saved draft", () => {
    expect(loadMeshSettingsDraft("new", memoryStorage())).toEqual({ draft: null, storageError: false });
    expect(defaultMeshSettingsDraft()).toEqual({ globalElementSize: "500", symmetry: "full", controls: [],
      appliedSet: null, setDetails: [], setCustomized: false });
  });

  it("round trips all methods, regions, references, inactive banks and incomplete strings without conversion", () => {
    const storage = memoryStorage();
    const draft = completeDraft();
    expect(saveMeshSettingsDraft("full-api-hash", draft, storage)).toBe(true);
    expect(loadMeshSettingsDraft("full-api-hash", storage)).toEqual({ draft, storageError: false });
    // Restored objects do not share mutable references with the source or later reads.
    loadMeshSettingsDraft("full-api-hash", storage).draft!.controls[0].label = "changed";
    expect(loadMeshSettingsDraft("full-api-hash", storage).draft).toEqual(draft);
  });

  it("isolates geometries, overwrites the last draft and retains deletion of all controls", () => {
    const storage = memoryStorage();
    const a = completeDraft();
    saveMeshSettingsDraft("A", a, storage);
    expect(loadMeshSettingsDraft("B", storage).draft).toBeNull();
    const b = { ...defaultMeshSettingsDraft(), globalElementSize: "200" };
    saveMeshSettingsDraft("B", b, storage);
    expect(loadMeshSettingsDraft("A", storage).draft).toEqual(a);
    const edited = { ...a, globalElementSize: "", controls: [] };
    saveMeshSettingsDraft("A", edited, storage);
    expect(loadMeshSettingsDraft("A", storage).draft).toEqual(edited);
    expect(loadMeshSettingsDraft("B", storage).draft).toEqual(b);
  });

  it("restores legacy metadata and null Z_POINT sizes without changing drafts", () => {
    const storage = memoryStorage();
    const draft = completeDraft();
    delete draft.setDetails[0].method;
    delete draft.setDetails[0].elementSize;
    draft.setDetails.push({ label: "Point", method: "Z_POINT", elementSize: null,
      status: "applied", startZ: -10, endZ: -10, sourceIds: [] });
    expect(saveMeshSettingsDraft("legacy", draft, storage)).toBe(true);
    expect(loadMeshSettingsDraft("legacy", storage)).toEqual({ draft, storageError: false });
  });

  it("keeps 20 recently used geometries and touches a restored draft when saved on open", () => {
    const storage = memoryStorage();
    for (let i = 0; i < 20; i++) saveMeshSettingsDraft(`hash-${i}`, defaultMeshSettingsDraft(), storage);
    const restored = loadMeshSettingsDraft("hash-0", storage).draft!;
    saveMeshSettingsDraft("hash-0", restored, storage);
    saveMeshSettingsDraft("hash-20", defaultMeshSettingsDraft(), storage);
    expect(loadMeshSettingsDraft("hash-0", storage).draft).toEqual(restored);
    expect(loadMeshSettingsDraft("hash-1", storage).draft).toBeNull();
    expect(JSON.parse(storage.getItem(MESH_SETTINGS_STORAGE_KEY)!).entries).toHaveLength(20);
  });

  it.each(["not JSON", "null", "[]", '{"version":2,"entries":[]}', '{"version":1,"entries":null}'])(
    "ignores corrupt or unsupported storage: %s", raw => {
      const storage = memoryStorage();
      storage.setItem(MESH_SETTINGS_STORAGE_KEY, raw);
      expect(loadMeshSettingsDraft("A", storage)).toEqual({ draft: null, storageError: false });
      expect(saveMeshSettingsDraft("A", defaultMeshSettingsDraft(), storage)).toBe(true);
      expect(loadMeshSettingsDraft("A", storage).draft).toEqual(defaultMeshSettingsDraft());
    },
  );

  it.each([
    (draft: any) => { delete draft.controls[0].inactiveCoordinates.region; },
    (draft: any) => { draft.controls[0].region.polygon.loops = [[{}]]; },
    (draft: any) => { draft.controls[0].startZ.anchor = "x_min"; },
    (draft: any) => { draft.controls[0].method = "UNKNOWN"; },
    (draft: any) => { draft.controls[0].coordinateMode = "unknown"; },
    (draft: any) => { draft.controls[1].clientId = draft.controls[0].clientId; },
    (draft: any) => { draft.symmetry = "unknown"; },
    (draft: any) => { draft.appliedSet.version = 1; },
    (draft: any) => { draft.setDetails[0].resolvedRegions[0].bounds = {}; },
    (draft: any) => { draft.setDetails[0].method = "UNKNOWN"; },
    (draft: any) => { draft.setDetails[0].elementSize = "5"; },
  ])("ignores a structurally invalid entry while preserving other geometries", corrupt => {
    const storage = memoryStorage();
    const invalid = completeDraft();
    corrupt(invalid);
    storage.setItem(MESH_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1,
      entries: [{ geometryHash: "bad", draft: invalid }, { geometryHash: "good", draft: defaultMeshSettingsDraft() }] }));
    expect(loadMeshSettingsDraft("bad", storage).draft).toBeNull();
    expect(loadMeshSettingsDraft("good", storage).draft).toEqual(defaultMeshSettingsDraft());
  });

  it("reports blocked storage and quota errors without throwing", () => {
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(loadMeshSettingsDraft("A", blocked)).toEqual({ draft: null, storageError: true });
    expect(saveMeshSettingsDraft("A", defaultMeshSettingsDraft(), blocked)).toBe(false);
    const full = { getItem: () => null, setItem() { throw new Error("quota"); } };
    expect(saveMeshSettingsDraft("A", completeDraft(), full)).toBe(false);
  });

  it("preserves cached set metadata without consulting the set registry", () => {
    const storage = memoryStorage();
    const draft = completeDraft();
    saveMeshSettingsDraft("same-geometry", draft, storage);
    expect(loadMeshSettingsDraft("same-geometry", storage).draft).toEqual(draft);
    const manual = { ...draft, appliedSet: null, setDetails: [], setCustomized: false };
    saveMeshSettingsDraft("same-geometry", manual, storage);
    expect(loadMeshSettingsDraft("same-geometry", storage).draft).toEqual(manual);
  });
});

describe("legacy resolved summary metadata", () => {
  function savedSet() {
    const draft = completeDraft();
    draft.setDetails.push(
      { label: "Omitted section", method: "Z_SECTION_AVG", elementSize: 0,
        status: "omitted", startZ: 20, endZ: 20, sourceIds: [] },
      { label: "Carrier", method: "Z_POINT", elementSize: null,
        status: "applied", startZ: -10, endZ: -10, sourceIds: [] },
    );
    const response: MeshControlSetApplyResponse = {
      setId: draft.appliedSet!.id, setVersion: draft.appliedSet!.version, geometryHash: "same-geometry",
      meshControl: { schemaVersion: "1.0.0", unitSystem: "um", mesher: "process_flow_2_5d",
        globalElementSize: 1000, symmetry: "full", controls: [] },
      details: structuredClone(draft.setDetails),
    };
    draft.setDetails.forEach(detail => { delete detail.method; delete detail.elementSize; });
    return { draft, response };
  }

  it("backfills old summaries while preserving customized settings and incomplete control edits", () => {
    const { draft, response } = savedSet();
    const before = structuredClone(draft);
    const restored = restoreResolvedRuleMetadata(draft, response);
    expect(restored.setDetails).toEqual(response.details);
    expect(restored.controls).toBe(draft.controls);
    expect({ ...restored, setDetails: draft.setDetails }).toEqual(before);
    expect(draft).toEqual(before);
    expect(needsResolvedRuleMetadata(restored.setDetails)).toBe(false);
    expect(restoreResolvedRuleMetadata(restored, response)).toBe(restored);
    const storage = memoryStorage();
    saveMeshSettingsDraft("same-geometry", restored, storage);
    expect(loadMeshSettingsDraft("same-geometry", storage).draft).toEqual(restored);
  });

  it("fills only missing fields, retaining existing sizes and explicit null point sizes", () => {
    const { draft, response } = savedSet();
    draft.setDetails[0].elementSize = 7;
    draft.setDetails[2].elementSize = null;
    const restored = restoreResolvedRuleMetadata(draft, response);
    expect(restored.setDetails[0]).toMatchObject({ method: "3D_REGION", elementSize: 7 });
    expect(restored.setDetails[2]).toMatchObject({ method: "Z_POINT", elementSize: null });
  });

  it.each([
    (response: MeshControlSetApplyResponse) => { response.setId = "other-set"; },
    (response: MeshControlSetApplyResponse) => { response.setVersion = "new-version"; },
    (response: MeshControlSetApplyResponse) => { response.details.pop(); },
    (response: MeshControlSetApplyResponse) => { response.details.reverse(); },
    (response: MeshControlSetApplyResponse) => { response.details[0].sourceIds = ["other-body"]; },
    (response: MeshControlSetApplyResponse) => { response.details[0].resolvedRegions![0].bounds.xMin = -10; },
    (response: MeshControlSetApplyResponse) => { response.details[1].status = "applied"; },
    (response: MeshControlSetApplyResponse) => { delete response.details[0].method; },
  ])("keeps original summaries when the set or resolved rules no longer match", change => {
    const { draft, response } = savedSet();
    change(response);
    expect(restoreResolvedRuleMetadata(draft, response)).toBe(draft);
  });

  it("accepts null or absent optional region fields from older responses", () => {
    const { draft, response } = savedSet();
    response.details[1].resolvedRegions = null;
    delete draft.setDetails[0].resolvedRegions![0].sourceId;
    response.details[0].resolvedRegions![0].sourceId = null;
    expect(needsResolvedRuleMetadata(restoreResolvedRuleMetadata(draft, response).setDetails)).toBe(false);
  });
});
