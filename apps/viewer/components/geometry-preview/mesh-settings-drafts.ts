import type { MeshControlSetDefinition, MeshControlSetRuleDetail, SymmetryMode } from "./file-export-client";
import { MESH_CONTROL_METHODS, type MeshControlDraft } from "./file-export-mesh-control";

export const MESH_SETTINGS_STORAGE_KEY = "process-flow:mesh-settings-drafts";
const MAX_DRAFTS = 20;
type DraftStorage = Pick<Storage, "getItem" | "setItem">;

export type MeshSettingsDraft = {
  globalElementSize: string;
  symmetry: SymmetryMode;
  controls: MeshControlDraft[];
  appliedSet: MeshControlSetDefinition | null;
  setDetails: MeshControlSetRuleDetail[];
  setCustomized: boolean;
};

type StoredEntry = { geometryHash: string; draft: MeshSettingsDraft };

export function defaultMeshSettingsDraft(): MeshSettingsDraft {
  return { globalElementSize: "500", symmetry: "full", controls: [],
    appliedSet: null, setDetails: [], setCustomized: false };
}

export function loadMeshSettingsDraft(geometryHash: string, storage?: DraftStorage) {
  try {
    const entries = readEntries(storage ?? window.localStorage);
    return { draft: entries.find(entry => entry.geometryHash === geometryHash)?.draft ?? null, storageError: false };
  } catch {
    return { draft: null, storageError: true };
  }
}

/** Saves raw authoring strings, including incomplete inputs and inactive coordinates.
 * Entries are ordered by last use; restoring a dialog saves it again to touch its entry.
 */
export function saveMeshSettingsDraft(geometryHash: string, draft: MeshSettingsDraft, storage?: DraftStorage): boolean {
  try {
    const target = storage ?? window.localStorage;
    const entries = readEntries(target).filter(entry => entry.geometryHash !== geometryHash);
    target.setItem(MESH_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1,
      entries: [{ geometryHash, draft }, ...entries].slice(0, MAX_DRAFTS) }));
    return true;
  } catch {
    return false;
  }
}

function readEntries(storage: DraftStorage): StoredEntry[] {
  const raw = storage.getItem(MESH_SETTINGS_STORAGE_KEY);
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) return [];
  return value.entries.filter((entry): entry is StoredEntry =>
    isRecord(entry) && typeof entry.geometryHash === "string" && isMeshSettingsDraft(entry.draft));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: Record<string, unknown>, keys: string[]) {
  return keys.every(key => typeof value[key] === "string");
}

function isLocation(value: unknown, axis: string): boolean {
  return isRecord(value) && typeof value.value === "string"
    && (value.anchor === `${axis}_min` || value.anchor === `${axis}_max`);
}

function isPoint(value: unknown, axes: string[]): boolean {
  return isRecord(value) && axes.every(axis => isLocation(value[axis], axis));
}

function isRegion(value: unknown): boolean {
  if (!isRecord(value) || (value.shape !== "box" && value.shape !== "polygon")
    || typeof value.elementSize !== "string") return false;
  const { box, polygon } = value;
  return isRecord(box) && isPoint(box.min, ["x", "y", "z"]) && isPoint(box.max, ["x", "y", "z"])
    && isRecord(polygon) && isLocation(polygon.startZ, "z") && isLocation(polygon.endZ, "z")
    && Array.isArray(polygon.loops) && polygon.loops.every(loop =>
      Array.isArray(loop) && loop.every(point => isPoint(point, ["x", "y"])));
}

function isCoordinates(value: unknown): boolean {
  return isRecord(value) && isRegion(value.region) && isLocation(value.startZ, "z")
    && isLocation(value.endZ, "z") && isLocation(value.z, "z");
}

function isControl(value: unknown): boolean {
  return isRecord(value) && strings(value, ["clientId", "label", "referenceKind", "referenceKey", "referenceId", "elementSize"])
    && typeof value.method === "string" && MESH_CONTROL_METHODS.some(method => method === value.method)
    && (value.coordinateMode === "absolute" || value.coordinateMode === "reference")
    && isCoordinates(value) && isCoordinates(value.inactiveCoordinates);
}

function isDefinition(value: unknown): boolean {
  return value === null || (isRecord(value) && strings(value, ["id", "version", "label", "description"]));
}

function isBounds(value: unknown): boolean {
  return isRecord(value) && ["xMin", "xMax", "yMin", "yMax", "zMin", "zMax"].every(key =>
    typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isDetail(value: unknown): boolean {
  return isRecord(value) && typeof value.label === "string"
    && (value.status === "applied" || value.status === "omitted")
    && typeof value.startZ === "number" && Number.isFinite(value.startZ)
    && typeof value.endZ === "number" && Number.isFinite(value.endZ)
    && Array.isArray(value.sourceIds) && value.sourceIds.every(id => typeof id === "string")
    && (value.resolvedRegions == null || (Array.isArray(value.resolvedRegions) && value.resolvedRegions.every(region =>
      isRecord(region) && (region.sourceId == null || typeof region.sourceId === "string") && isBounds(region.bounds))));
}

function isMeshSettingsDraft(value: unknown): value is MeshSettingsDraft {
  if (!isRecord(value) || typeof value.globalElementSize !== "string"
    || !["full", "upper_half", "right_half", "upper_right_quarter"].some(mode => mode === value.symmetry)
    || !Array.isArray(value.controls) || !value.controls.every(isControl)
    || !isDefinition(value.appliedSet) || !Array.isArray(value.setDetails) || !value.setDetails.every(isDetail)
    || typeof value.setCustomized !== "boolean") return false;
  // Client IDs identify editable cards; duplicates would couple unrelated controls.
  return new Set(value.controls.map(control => control.clientId)).size === value.controls.length;
}
