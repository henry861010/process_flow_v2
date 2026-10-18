import * as React from "react";
import type { MeshControlSetRuleDetail } from "./file-export-client";
import {
  formatMeshControlLabel,
  formatResolvedCoordinate,
  type MeshInstanceNames,
} from "./mesh-control-presentation";

export function MeshResolvedRules({ details, customized, instanceNames }: {
  details: MeshControlSetRuleDetail[];
  customized: boolean;
  instanceNames: MeshInstanceNames;
}) {
  return (
    <div className="min-w-0 rounded-md border bg-muted/15 p-3">
      <p className="mb-2 text-xs font-semibold">{customized ? "Original resolved rules" : "Resolved rules"}</p>
      <ul className="space-y-2 text-xs text-muted-foreground">
        {details.map((detail, index) => {
          const regions = detail.resolvedRegions ?? [];
          const label = formatMeshControlLabel(detail.label, instanceNames, detail.sourceIds);
          const elementSize = detail.elementSize == null ? "—" : `${formatResolvedCoordinate(detail.elementSize)} µm`;
          return (
            <li key={`${detail.label}-${index}`} className="min-w-0 [overflow-wrap:anywhere] tabular-nums">
              <span className="font-medium text-foreground">{label}</span>
              {`: ${detail.method ?? "—"}, ${elementSize}, `}
              {regions.length ? (
                <>
                  {regions.map((region, regionIndex) => {
                    const point = (bound: "Min" | "Max") =>
                      `[${(["x", "y", "z"] as const).map(axis => formatResolvedCoordinate(region.bounds[`${axis}${bound}`])).join(",")}]`;
                    return (
                      <span key={regionIndex} aria-label={`${label} region ${regionIndex + 1} bounds`}
                        className={regionIndex ? "block" : undefined}>
                        {`${point("Min")} ~ ${point("Max")} µm`}
                      </span>
                    );
                  })}
                </>
              ) : (
                <>{formatResolvedCoordinate(detail.startZ)} ~ {formatResolvedCoordinate(detail.endZ)} µm</>
              )}
              {detail.status === "omitted" ? <span> (zero thickness, omitted)</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
