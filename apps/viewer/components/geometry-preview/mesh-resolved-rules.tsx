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
          return (
            <li key={`${detail.label}-${index}`} className={regions.length ? "min-w-0 rounded-md border bg-white p-2.5" : "min-w-0"}>
              <span className="break-words font-medium text-foreground">{label}</span>
              {regions.length ? (
                <div className="mt-2 space-y-2">
                  {regions.map((region, regionIndex) => (
                    <dl key={regionIndex} aria-label={`${label} region ${regionIndex + 1} bounds`}
                      className={`space-y-1 ${regionIndex ? "border-t pt-2" : ""}`}>
                      {(["x", "y", "z"] as const).map(axis => (
                        <div key={axis} className="grid min-w-0 grid-cols-[0.75rem_minmax(0,1fr)] gap-x-2">
                          <dt>{axis.toUpperCase()}</dt>
                          <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1 tabular-nums">
                            <span className="break-all">{formatResolvedCoordinate(region.bounds[`${axis}Min`])}</span>
                            <span>→</span>
                            <span className="break-all">{formatResolvedCoordinate(region.bounds[`${axis}Max`])}</span>
                            <span>µm</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ))}
                </div>
              ) : (
                <>: {formatResolvedCoordinate(detail.startZ)} → {formatResolvedCoordinate(detail.endZ)} µm</>
              )}
              {detail.status === "omitted" ? <span> (zero thickness, omitted)</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
