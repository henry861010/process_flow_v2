import { Badge } from "@/components/ui/badge";
import {
  geometryMetadataLine,
  type GeometryCardValue,
} from "@/components/process-flow-fields/geometry-card-metadata";

export { geometrySearchText } from "@/components/process-flow-fields/geometry-card-metadata";
export type { GeometryCardValue } from "@/components/process-flow-fields/geometry-card-metadata";

export function GeometryCardDetails({
  geometry,
  categoryPath,
}: {
  geometry: GeometryCardValue;
  categoryPath?: string | null;
}) {
  const dim = geometry.dim.trim();
  const metadata = geometryMetadataLine(geometry);

  return (
    <div className="min-w-0">
      <div className="line-clamp-2 text-base font-semibold leading-snug">
        {geometry.name}
      </div>
      {categoryPath ? (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {categoryPath}
        </div>
      ) : null}
      {dim ? (
        <div className="mt-1 truncate text-xs text-muted-foreground">{dim}</div>
      ) : null}
      {metadata ? (
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{metadata}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="outline">{geometry.entityType}</Badge>
      </div>
    </div>
  );
}
