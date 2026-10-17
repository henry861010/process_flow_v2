import { buildLocation, buildRegion, draftLocation, newRegionDraft, regionDraftFromEntry, validateRegionDraft, type RegionDraft } from "./file-export-regions";
import type {
  MeshControlConfiguration,
  MeshControlEntry,
  CoordinateMode,
  MeshControlPayload,
  SymmetryMode,
} from "./file-export-client";

export type MeshControlMethod = MeshControlEntry["method"];
export type KeyedGeometryReference = {
  kind: "container" | "body";
  key: string;
};
export type ZLocationDraft = {
  anchor: "z_min" | "z_max";
  value: string;
};
export type CoordinatesDraft = {
  region: RegionDraft;
  startZ: ZLocationDraft;
  endZ: ZLocationDraft;
  z: ZLocationDraft;
};
export type MeshControlDraft = CoordinatesDraft & {
  clientId: string;
  coordinateMode: CoordinateMode;
  inactiveCoordinates: CoordinatesDraft;
  label: string;
  method: MeshControlMethod;
  referenceKind: string;
  referenceKey: string;
  referenceId: string;
  elementSize: string;
};

export const MESH_CONTROL_METHODS: MeshControlMethod[] = [
  "Z_SECTION_AVG",
  "Z_SECTION_TOP",
  "Z_SECTION_BOT",
  "Z_SECTION_CENTER",
  "Z_POINT",
  "3D_REGION",
];

export function collectKeyedGeometryReferences(
  structure: unknown,
): KeyedGeometryReference[] {
  const root = asRecord(structure)?.root;
  const references: KeyedGeometryReference[] = [];
  const uniqueReferences = new Set<string>();
  const visitedContainers = new Set<object>();

  function append(kind: KeyedGeometryReference["kind"], value: unknown) {
    if (typeof value !== "string") return;
    const key = value.trim();
    if (!key) return;

    const identity = `${kind}\u0000${key}`;
    if (uniqueReferences.has(identity)) return;
    uniqueReferences.add(identity);
    references.push({ kind, key });
  }

  function visitContainer(value: unknown) {
    const container = asRecord(value);
    if (!container || visitedContainers.has(container)) return;
    visitedContainers.add(container);

    append("container", container.key);
    if (Array.isArray(container.bodies)) {
      for (const bodyValue of container.bodies) {
        append("body", asRecord(bodyValue)?.key);
      }
    }
    if (Array.isArray(container.children)) {
      for (const child of container.children) visitContainer(child);
    }
  }

  visitContainer(root);
  return references.sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.key.localeCompare(right.key),
  );
}

export function filterKeyedGeometryReferences(
  references: KeyedGeometryReference[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return references;

  return references.filter(
    (reference) =>
      reference.kind.toLocaleLowerCase().includes(normalizedQuery) ||
      reference.key.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function newMeshControlDraft(): MeshControlDraft {
  return {
    clientId: `mesh-control-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    label: "",
    coordinateMode: "absolute",
    ...newCoordinatesDraft("absolute"),
    inactiveCoordinates: newCoordinatesDraft("reference"),
    method: "Z_SECTION_AVG",
    referenceKind: "root",
    referenceKey: "",
    referenceId: "",
    elementSize: "10",
  };
}

function newCoordinatesDraft(mode: CoordinateMode): CoordinatesDraft {
  const value = mode === "reference" ? "0" : "";
  return { region: newRegionDraft(mode), startZ: { anchor: "z_min", value },
    endZ: { anchor: "z_max", value }, z: { anchor: "z_min", value } };
}

export function changeCoordinateMode(control: MeshControlDraft, mode: CoordinateMode): MeshControlDraft {
  if (mode === control.coordinateMode) return control;
  // Both coordinate banks belong to the same control; switching never converts units or positions.
  const { region, startZ, endZ, z } = control;
  return { ...control, ...control.inactiveCoordinates, coordinateMode: mode,
    region: { ...control.inactiveCoordinates.region, shape: region.shape, elementSize: region.elementSize },
    inactiveCoordinates: { region, startZ, endZ, z } };
}

export function buildMeshControlConfiguration(
  globalElementSize: string,
  symmetry: SymmetryMode,
  controls: MeshControlDraft[],
): MeshControlConfiguration {
  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    mesher: "process_flow_2_5d",
    globalElementSize: Number(globalElementSize),
    symmetry,
    controls: controls.map(buildMeshControlEntry),
  };
}

export function draftsFromMeshControlConfiguration(
  configuration: MeshControlConfiguration,
): MeshControlDraft[] {
  return configuration.controls.map((entry) => {
    const reference = entry.reference;
    const draft = changeCoordinateMode(newMeshControlDraft(), entry.coordinateMode);
    draft.label = entry.label ?? "";
    draft.method = entry.method;
    draft.referenceKind = reference?.kind ?? "root";
    draft.referenceKey = reference?.key ?? "";
    draft.referenceId = reference?.id ?? "";
    if (entry.method === "3D_REGION") {
      draft.region = regionDraftFromEntry(entry.region, entry.elementSize, entry.coordinateMode);
    } else if (entry.method === "Z_POINT") {
      draft.z = draftLocation(entry.z, "z");
    } else {
      draft.elementSize = String(entry.elementSize);
      draft.startZ = draftLocation(entry.startZ, "z");
      draft.endZ = draftLocation(entry.endZ, "z");
    }
    return draft;
  });
}

function buildPayload<M extends CoordinateMode>(control: MeshControlDraft, mode: M): MeshControlPayload<M> {
  const label = control.label.trim();
  if (control.method === "3D_REGION") {
    return { method: "3D_REGION", label, elementSize: Number(control.region.elementSize), region: buildRegion(control.region, mode) };
  }
  if (control.method === "Z_POINT") {
    return { method: "Z_POINT", label, z: buildLocation(control.z, mode) };
  }
  return { method: control.method, label, elementSize: Number(control.elementSize),
    startZ: buildLocation(control.startZ, mode), endZ: buildLocation(control.endZ, mode) };
}

function buildMeshControlEntry(control: MeshControlDraft): MeshControlEntry {
  if (control.coordinateMode === "absolute") {
    return { ...buildPayload(control, "absolute"), coordinateMode: "absolute" };
  }
  const reference = buildMeshControlReference(control);
  if (!reference) throw new Error("Reference is required in Reference mode.");
  return { ...buildPayload(control, "reference"), coordinateMode: "reference", reference };
}

export function meshControlDisplayLabel(control: MeshControlDraft, index: number): string {
  return control.label.trim() || `Control ${index + 1}`;
}

function buildMeshControlReference(control: MeshControlDraft) {
  const kind = control.referenceKind.trim();
  const key = control.referenceKey.trim();
  const id = control.referenceId.trim();
  if (!kind && !key && !id) return undefined;
  return {
    kind,
    ...(key ? { key } : {}),
    ...(id ? { id } : {}),
  };
}


export function validateMeshControlDraft(
  globalElementSize: string,
  controls: MeshControlDraft[],
) {
  if (!isPositiveFiniteInput(globalElementSize)) {
    return "Global element size must be greater than 0.";
  }
  for (const [index, control] of controls.entries()) {
    const label = `Control ${index + 1}`;
    if (!control.label.trim()) {
      return `${label} label is required.`;
    }
    if (control.coordinateMode === "reference" && !control.referenceKind.trim()) {
      return `${label} reference kind is required.`;
    }
    if (control.method === "3D_REGION") {
      const error = validateRegionDraft(control.region);
      if (error) return `${label} ${error}`;
      continue;
    }
    if (control.method === "Z_POINT") {
      if (!isFiniteInput(control.z.value)) {
        return `${label} Z position must be a finite number.`;
      }
      continue;
    }
    if (!isPositiveFiniteInput(control.elementSize)) {
      return `${label} element size must be greater than 0.`;
    }
    if (!isFiniteInput(control.startZ.value)) {
      return `${label} start Z must be a finite number.`;
    }
    if (!isFiniteInput(control.endZ.value)) {
      return `${label} end Z must be a finite number.`;
    }
  }
  return null;
}

function isFiniteInput(value: string) {
  return value.trim() !== "" && Number.isFinite(Number(value));
}

function isPositiveFiniteInput(value: string) {
  return isFiniteInput(value) && Number(value) > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
