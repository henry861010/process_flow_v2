type MeshInstance = { key: "soc" | "hbm"; name: string };
export type MeshInstanceNames = ReadonlyMap<string, MeshInstance>;

const CORNER_NAMES = {
  "x_min/y_min": "bottom-left",
  "x_min/y_max": "top-left",
  "x_max/y_min": "bottom-right",
  "x_max/y_max": "top-right",
} as const;

/** Number geometry instances, independently of control ordering or omissions. */
export function collectMeshInstanceNames(structure: unknown): MeshInstanceNames {
  const names = new Map<string, MeshInstance>();
  const counts = { soc: 0, hbm: 0 };
  const visited = new Set<object>();

  function visit(value: unknown) {
    const container = asRecord(value);
    if (!container || visited.has(container)) return;
    visited.add(container);
    const { id, key } = container;
    if ((key === "soc" || key === "hbm") && typeof id === "string" && id && !names.has(id)) {
      names.set(id, { key, name: `${key}-${++counts[key]}` });
    }
    if (Array.isArray(container.children)) container.children.forEach(visit);
  }

  visit(asRecord(structure)?.root);
  return names;
}

/** Display aliases only; never write these names back into labels or references. */
export function formatMeshControlLabel(
  label: string,
  instanceNames: MeshInstanceNames,
  sourceIds: readonly string[] = [],
): string {
  if (label === "lsi_si") return "LSI Si";
  for (const id of sourceIds) {
    const instance = instanceNames.get(id);
    if (!instance) continue;
    for (const [anchors, corner] of Object.entries(CORNER_NAMES)) {
      // Match the entire generated label and its source; custom labels stay intact.
      if (label === `${instance.key} ${id} top corner ${anchors}`) {
        return `${instance.name} ${corner}`;
      }
    }
  }
  return label;
}

export function formatResolvedCoordinate(value: number): string {
  return String(Number(value.toFixed(3)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
