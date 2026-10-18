import { describe, expect, it } from "vitest";
import { changeCoordinateMode, MESH_CONTROL_METHODS, newMeshControlDraft } from "./file-export-mesh-control";
import {
  defaultMeshSettingsDraft, loadMeshSettingsDraft, MESH_SETTINGS_STORAGE_KEY, saveMeshSettingsDraft,
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
    setDetails: [{ label: "Focus", status: "applied", startZ: 0, endZ: 10, sourceIds: ["body:source"],
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
