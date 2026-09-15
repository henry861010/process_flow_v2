export type GeometryCardValue = {
  id: string;
  name: string;
  category?: string | null;
  entityType: string;
  dim: string;
  vendor?: string | null;
  type1?: string | null;
  type2?: string | null;
};

export function geometryMetadataLine(geometry: GeometryCardValue): string {
  return [geometry.vendor, geometry.type1, geometry.type2]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map((value) => value.trim())
    .join(" / ");
}

export function geometrySearchText(geometry: GeometryCardValue): string {
  return [
    geometry.name,
    geometry.id,
    geometry.category,
    geometry.entityType,
    geometry.dim,
    geometry.vendor,
    geometry.type1,
    geometry.type2,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join(" ");
}
