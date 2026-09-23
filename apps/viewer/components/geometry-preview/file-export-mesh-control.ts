import type {
  MeshControlConfiguration,
  MeshControlEntry,
  MeshControlZLocation,
  SymmetryMode,
} from "./file-export-client";

export type MeshControlMethod = MeshControlEntry["method"];
export type KeyedGeometryReference = {
  kind: "container" | "body";
  key: string;
};
export type ZLocationDraft = {
  mode: "relative" | "absolute";
  anchor: "z_min" | "z_max";
  value: string;
};
export type MeshControlDraft = {
  clientId: string;
  method: MeshControlMethod;
  referenceKind: string;
  referenceKey: string;
  referenceId: string;
  elementSize: string;
  startZ: ZLocationDraft;
  endZ: ZLocationDraft;
  z: ZLocationDraft;
};

export const MESH_CONTROL_METHODS: MeshControlMethod[] = [
  "Z_SECTION_AVG",
  "Z_SECTION_TOP",
  "Z_SECTION_BOT",
  "Z_SECTION_CENTER",
  "Z_POINT",
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
    method: "Z_SECTION_AVG",
    referenceKind: "root",
    referenceKey: "",
    referenceId: "",
    elementSize: "10",
    startZ: { mode: "relative", anchor: "z_min", value: "0" },
    endZ: { mode: "relative", anchor: "z_max", value: "0" },
    z: { mode: "relative", anchor: "z_min", value: "0" },
  };
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

function buildMeshControlEntry(control: MeshControlDraft): MeshControlEntry {
  const reference = buildMeshControlReference(control);
  if (control.method === "Z_POINT") {
    return {
      method: control.method,
      reference,
      z: buildZLocation(control.z),
    };
  }
  return {
    method: control.method,
    reference,
    elementSize: Number(control.elementSize),
    startZ: buildZLocation(control.startZ),
    endZ: buildZLocation(control.endZ),
  };
}

function buildMeshControlReference(control: MeshControlDraft) {
  const kind = control.referenceKind.trim();
  const key = control.referenceKey.trim();
  const id = control.referenceId.trim();
  return {
    kind,
    ...(key ? { key } : {}),
    ...(id ? { id } : {}),
  };
}

function buildZLocation(location: ZLocationDraft): MeshControlZLocation {
  return location.mode === "relative"
    ? {
        mode: "relative",
        anchor: location.anchor,
        offset: Number(location.value),
      }
    : { mode: "absolute", value: Number(location.value) };
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
