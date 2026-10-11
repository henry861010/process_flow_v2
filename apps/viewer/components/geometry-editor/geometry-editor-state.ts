import type { GeometryEntityCreate } from "@/lib/process-flow/types";

export const EMPTY_STRUCTURE = {
  schemaVersion: "1.0.0",
  unitSystem: "um",
  root: { bodies: [], vias: [], circuits: [], bumps: [], children: [] },
};

export const BOX_STRUCTURE_EXAMPLE = {
  ...EMPTY_STRUCTURE,
  root: {
    ...EMPTY_STRUCTURE.root,
    bodies: [{
      material: "Si",
      geometry: { type: "BoxGeometry", bottom_left: [-10, -10, 0], top_right: [10, 10, 0], thk: 5 },
    }],
  },
};

export const GEOMETRY_ICONS = ["carrier.panel", "carrier.wafer", "die.stack", "die.piece"] as const;

export type GeometryEditorMetadata = {
  name: string;
  entityType: string;
  owner: string;
  category: string;
  dim: string;
  vendor: string;
  type1: string;
  type2: string;
  description: string;
  icon: string;
  iconScale: string;
};

export const EMPTY_METADATA: GeometryEditorMetadata = {
  name: "", entityType: "", owner: "", category: "", dim: "", vendor: "",
  type1: "", type2: "", description: "", icon: "", iconScale: "",
};

export type GeometryEditorErrors = Partial<Record<keyof GeometryEditorMetadata | "structure" | "form", string>>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseGeometryStructure(text: string): Record<string, unknown> {
  let structure: unknown;
  try {
    structure = JSON.parse(text);
  } catch (error) {
    throw new Error(`Enter valid JSON. ${error instanceof Error ? error.message : ""}`.trim());
  }
  if (!isObject(structure)) throw new Error("Geometry structure must be a JSON object.");
  if ("structure" in structure || "structureFormat" in structure) {
    throw new Error("Paste only the GeometryStructure, not the complete GeometryEntity.");
  }
  if (structure.schemaVersion !== "1.0.0") throw new Error('schemaVersion must be "1.0.0".');
  if (structure.unitSystem !== "um") throw new Error('unitSystem must be "um".');
  if (!isObject(structure.root)) throw new Error("root must be a container object.");
  return structure;
}

export function buildGeometryCreateRequest(metadata: GeometryEditorMetadata, text: string): {
  payload?: GeometryEntityCreate;
  errors: GeometryEditorErrors;
} {
  const errors: GeometryEditorErrors = {};
  for (const field of ["name", "entityType", "owner"] as const) {
    if (!metadata[field].trim()) errors[field] = `${{ name: "Name", entityType: "Entity type", owner: "Owner" }[field]} is required.`;
  }
  let structure: Record<string, unknown> | undefined;
  try {
    structure = parseGeometryStructure(text);
  } catch (error) {
    errors.structure = error instanceof Error ? error.message : "Invalid geometry structure.";
  }
  const icon = metadata.icon.trim();
  if (icon && !(GEOMETRY_ICONS as readonly string[]).includes(icon)) errors.icon = "Choose a supported icon.";
  const scaleText = metadata.iconScale.trim();
  const iconScale = scaleText ? Number(scaleText) : undefined;
  if (iconScale !== undefined && (!Number.isFinite(iconScale) || iconScale <= 0 || iconScale > 1)) {
    errors.iconScale = "Icon scale must be greater than 0 and at most 1.";
  }
  if (Object.keys(errors).length || !structure) return { errors };
  const payload: GeometryEntityCreate = {
    name: metadata.name.trim(), entityType: metadata.entityType.trim(), owner: metadata.owner.trim(),
    dim: metadata.dim.trim(), structureFormat: "standard", structure,
  };
  for (const field of ["category", "vendor", "type1", "type2", "description", "icon"] as const) {
    const value = metadata[field].trim();
    if (value) payload[field] = value;
  }
  if (iconScale !== undefined) payload.iconScale = iconScale;
  return { payload, errors };
}

export function geometryCreateRequestErrors(error: unknown): GeometryEditorErrors {
  const message = error instanceof Error ? error.message : "Unable to save geometry. Please try again.";
  if (/^structure(?:\.|:|Format:)/.test(message)) return { structure: message };
  const field = Object.keys(EMPTY_METADATA).find((key) => message.startsWith(`${key}:`));
  return field ? { [field]: message } : { form: message };
}

export function geometryClassificationSuggestions(geometries: { entityType: string; category?: string | null }[]) {
  const values = (field: "entityType" | "category") => [...new Set(
    geometries.map((item) => item[field]?.trim()).filter((value): value is string => Boolean(value)),
  )].sort();
  return { entityTypes: values("entityType"), categories: values("category") };
}
