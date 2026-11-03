import * as React from "react";
import type { SchematicItem } from "./schematic-types";

const numberFormatter = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 });

export function formatSchematicLength(value: number, unit: string) {
  const displayUnit = ["um", "µm", "μm"].includes(unit) ? "µm" : unit;
  return `${numberFormatter.format(value)} ${displayUnit}`.trim();
}

export function formatSchematicDensity(values: readonly (number | null)[]) {
  return values.map((value) => value === null ? "Not specified" : `${numberFormatter.format(value)}%`).join(", ");
}

/** Coordinates are relative to the visible drawing viewport, not the SVG. */
export function schematicInspectorPosition(
  anchor: { x: number; y: number },
  viewport: { width: number; height: number },
  contentHeight: number,
) {
  const marginX = Math.min(12, Math.max(0, viewport.width / 2));
  const marginY = Math.min(12, Math.max(0, viewport.height / 2));
  const gap = 12;
  const width = Math.max(0, Math.min(288, viewport.width - marginX * 2));
  const maxHeight = Math.max(0, viewport.height - marginY * 2);
  const height = Math.max(0, Math.min(contentHeight, maxHeight));
  const left = anchor.x + gap + width <= viewport.width - marginX ? anchor.x + gap : anchor.x - gap - width;
  const top = anchor.y + gap + height <= viewport.height - marginY ? anchor.y + gap : anchor.y - gap - height;
  return {
    left: Math.max(marginX, Math.min(left, viewport.width - marginX - width)),
    top: Math.max(marginY, Math.min(top, viewport.height - marginY - height)),
    width,
    maxHeight,
  };
}

export function SchematicItemDetails({ item, unit }: { item: SchematicItem; unit: string }) {
  return (
    <div className="space-y-4 [overflow-wrap:anywhere]">
      <div className="pr-8">
        <p className="text-xs text-muted-foreground">{item.groupLabel || "Structure"}</p>
        <h4 className="mt-1 text-sm font-semibold">{item.label}</h4>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Material</dt>
        <dd className="min-w-0 font-medium">{item.material || "Unspecified material"}</dd>
        <dt className="text-muted-foreground">THK</dt>
        <dd className="min-w-0 font-mono tabular-nums">{formatSchematicLength(item.thickness, unit)}</dd>
        {item.densityValues != null ? (
          <>
            <dt className="text-muted-foreground">Density</dt>
            <dd className="min-w-0 font-mono tabular-nums">{formatSchematicDensity(item.densityValues) || "Not specified"}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
