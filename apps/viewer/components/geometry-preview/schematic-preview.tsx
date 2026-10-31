"use client";

import * as React from "react";
import { AlertTriangle, Layers3, MousePointer2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  SchematicDocument,
  SchematicItem,
  SchematicRectangle,
  SchematicShape,
} from "./schematic-types";

const lengthFormatter = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 8,
});

export function formatSchematicLength(value: number, unit: string) {
  const displayUnit = ["um", "µm", "μm"].includes(unit) ? "µm" : unit;
  return `${lengthFormatter.format(value)} ${displayUnit}`.trim();
}

/** Only display coordinates and generic shapes are interpreted in the viewer. */
export function SchematicPreview({
  document,
  warnings = [],
}: {
  document: SchematicDocument | null;
  warnings?: string[];
}) {
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(null);

  if (!document || document.schemaVersion !== 1) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center text-sm text-muted-foreground" role="status">
          <Layers3 className="mx-auto h-6 w-6 text-primary" aria-hidden="true" />
          <p className="font-medium text-foreground">Cross section unavailable</p>
          <p>This snapshot has no supported schematic. You can still export its original geometry below.</p>
          {warnings.length > 0 ? (
            <ul className="space-y-2 rounded-md border p-3 text-left">
              {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>
          ) : null}
        </div>
      </div>
    );
  }

  const groups = new Map<string, SchematicItem[]>();
  for (const item of document.items) {
    const label = item.groupLabel || "Structure";
    const items = groups.get(label) ?? [];
    items.push(item);
    groups.set(label, items);
  }

  return (
    <div className="h-full overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
      <section className="flex min-h-[420px] flex-col lg:min-h-0" aria-label="Structure cross section">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-muted/25 px-4 py-3 md:px-5">
          <div>
            <h3 className="text-sm font-semibold">Cross section</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Schematic · not to scale</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MousePointer2 className="h-3.5 w-3.5" aria-hidden="true" />
            Select a layer to inspect
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-background p-4 lg:p-6">
          {document.shapes.length > 0 ? (
            <div
              className="flex min-h-full min-w-[640px] items-center"
              style={{ minWidth: Math.max(640, document.viewBox[2]) }}
            >
              <SchematicDrawing document={document} selectedItemId={selectedItemId} onSelect={setSelectedItemId} />
            </div>
          ) : (
            <p className="flex min-h-64 items-center justify-center text-center text-sm text-muted-foreground" role="status">
              This snapshot contains no visible structure.
            </p>
          )}
        </div>
        <div className="shrink-0 border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground md:px-5">
          Layer thicknesses and Z positions show actual snapshot values. Thin layers may be enlarged for readability.
        </div>
      </section>

      <aside className="border-t bg-muted/15 lg:overflow-y-auto lg:border-l lg:border-t-0" aria-label="Actual layer thicknesses">
        <div className="border-b bg-background px-4 py-4">
          <div className="text-xs font-medium text-muted-foreground">Total structure thickness</div>
          <div className="mt-1 font-mono text-2xl font-semibold tracking-tight">
            {formatSchematicLength(document.totalThickness, document.unit)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">From the lowest to the highest Z position</p>
        </div>

        <div className="space-y-4 p-3">
          {Array.from(groups, ([label, items]) => (
            <section key={label} aria-label={`${label} layer thicknesses`}>
              <h4 className="mb-2 break-words px-1 text-xs font-semibold text-muted-foreground">{label}</h4>
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.id}>
                    <SchematicItemButton item={item} unit={document.unit} selected={selectedItemId === item.id} onSelect={setSelectedItemId} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {document.notes.length > 0 ? (
            <section className="space-y-2 border-t px-1 pt-3" aria-label="Schematic notes">
              <h4 className="text-xs font-semibold">Reading this schematic</h4>
              <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                {document.notes.map((note, index) => <li key={index}>{note}</li>)}
              </ul>
            </section>
          ) : null}

          {document.warnings.length > 0 || warnings.length > 0 ? (
            <section className="space-y-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-amber-950" aria-label="Schematic warnings" role="status">
              <h4 className="flex items-center gap-2 text-xs font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Presentation notices</h4>
              <ul className="space-y-2 text-xs leading-relaxed">
                {[...document.warnings, ...warnings].map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function SchematicItemButton({
  item,
  unit,
  selected,
  onSelect,
}: {
  item: SchematicItem;
  unit: string;
  selected: boolean;
  onSelect: (itemId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      className={cn(
        "w-full rounded-md border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-transparent bg-background hover:border-border hover:bg-muted/50",
      )}
    >
      <span className="flex items-start justify-between gap-3 text-sm">
        <span className="min-w-0 break-words font-medium">{item.label}</span>
        <span className="shrink-0 whitespace-nowrap font-mono text-xs leading-5">{formatSchematicLength(item.thickness, unit)}</span>
      </span>
      <span className="mt-1 block break-words text-xs text-muted-foreground">{item.material || "Unspecified material"}</span>
      <span className="mt-1 block font-mono text-[11px] text-muted-foreground">Z {formatSchematicLength(item.zMin, unit)} → {formatSchematicLength(item.zMax, unit)}</span>
    </button>
  );
}

export function SchematicDrawing({
  document,
  selectedItemId,
  onSelect,
}: {
  document: SchematicDocument;
  selectedItemId: string | null;
  onSelect: (itemId: string) => void;
}) {
  const instanceId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const items = new Map(document.items.map((item) => [item.id, item]));
  const firstShapeIds = new Map<string, string>();
  for (const shape of document.shapes) {
    if (!firstShapeIds.has(shape.itemId)) firstShapeIds.set(shape.itemId, shape.id);
  }
  const titleId = `${instanceId}-title`;
  const descriptionId = `${instanceId}-description`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      viewBox={document.viewBox.join(" ")}
      preserveAspectRatio="xMidYMid meet"
      className="block h-auto min-h-[320px] w-full overflow-visible"
      style={{ aspectRatio: `${document.viewBox[2]} / ${document.viewBox[3]}` }}
    >
      <title id={titleId}>Structure cross section</title>
      <desc id={descriptionId}>Schematic, not to scale. Select a layer with a click, Enter, or Space to highlight its actual thickness in the adjacent list.</desc>
      <defs>
        {document.shapes.map((shape, index) => shape.clip ? (
          <clipPath key={shape.id} id={`${instanceId}-clip-${index}`} clipPathUnits="userSpaceOnUse">
            <path d={clipPathData(shape.clip)} clipRule="evenodd" fillRule="evenodd" />
          </clipPath>
        ) : null)}
      </defs>
      {document.shapes.map((shape, index) => {
        const item = items.get(shape.itemId);
        const selected = shape.itemId === selectedItemId;
        const interactive = Boolean(item) && firstShapeIds.get(shape.itemId) === shape.id;
        return (
          <g
            key={shape.id}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-hidden={interactive ? undefined : true}
            aria-pressed={interactive ? selected : undefined}
            aria-label={interactive && item ? `${item.groupLabel}, ${item.label}, ${formatSchematicLength(item.thickness, document.unit)}` : undefined}
            data-item-id={shape.itemId}
            data-selected={selected || undefined}
            onClick={item ? () => onSelect(shape.itemId) : undefined}
            onKeyDown={interactive ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(shape.itemId);
              }
            } : undefined}
            className={cn("outline-none focus-visible:[&>*]:stroke-primary focus-visible:[&>*]:stroke-[3px]", item && "cursor-pointer")}
            clipPath={shape.clip ? `url(#${instanceId}-clip-${index})` : undefined}
          >
            <SchematicPrimitive shape={shape} selected={selected} />
            {item ? <title>{`${item.label} · ${item.material} · ${formatSchematicLength(item.thickness, document.unit)}`}</title> : null}
          </g>
        );
      })}
      {document.shapes.map((shape, index) => {
        if (shape.kind !== "rect" || (shape.width ?? 0) < 96 || (shape.height ?? 0) < 36) return null;
        const item = items.get(shape.itemId);
        if (!item) return null;
        const x = (shape.x ?? 0) + (shape.width ?? 0) / 2;
        const y = (shape.y ?? 0) + (shape.height ?? 0) / 2;
        if (!shapeContainsPoint(shape, x, y) || document.shapes.slice(index + 1).some(
          (later) => later.itemId !== shape.itemId && shapeContainsPoint(later, x, y),
        )) return null;
        const limit = Math.max(8, Math.floor((shape.width ?? 0) / 6.5));
        const label = item.label.length > limit ? `${item.label.slice(0, limit - 1)}…` : item.label;
        return (
          <text
            key={`label-${shape.id}`}
            data-layer-label={item.id}
            x={x}
            y={y - 4}
            textAnchor="middle"
            className="fill-foreground text-[11px] font-medium"
            pointerEvents="none"
            aria-hidden="true"
          >
            <tspan x={x}>{label}</tspan>
            <tspan x={x} dy="16" className="font-mono">{formatSchematicLength(item.thickness, document.unit)}</tspan>
          </text>
        );
      })}
      {document.components.map((component) => (
        <text
          key={component.id}
          x={component.x + component.width / 2}
          y={Math.max(document.viewBox[1] + 14, component.y - 10)}
          textAnchor="middle"
          className="fill-foreground text-[12px] font-medium"
          pointerEvents="none"
        >
          {component.label}
        </text>
      ))}
    </svg>
  );
}

/** Labels only occupy visible areas; an ancestor slab may be covered by children. */
function shapeContainsPoint(shape: SchematicShape, x: number, y: number) {
  const inRectangle = (rect: SchematicRectangle) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
  if (shape.clip && (!inRectangle(shape.clip) || shape.clip.exclusions.some(inRectangle))) return false;
  if (shape.kind === "rect") {
    return inRectangle({ x: shape.x ?? 0, y: shape.y ?? 0, width: shape.width ?? 0, height: shape.height ?? 0 });
  }
  if (shape.kind === "circle") {
    return (x - (shape.cx ?? 0)) ** 2 + (y - (shape.cy ?? 0)) ** 2 <= (shape.r ?? 0) ** 2;
  }
  if (!shape.closed || !shape.points?.length) return false;
  let inside = false;
  for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
    const [xi, yi] = shape.points[i];
    const [xj, yj] = shape.points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function SchematicPrimitive({ shape, selected }: { shape: SchematicShape; selected: boolean }) {
  const style = {
    fill: shape.fill,
    stroke: selected ? "hsl(var(--primary))" : shape.stroke,
    strokeWidth: selected ? Math.max(3, shape.strokeWidth) : shape.strokeWidth,
    vectorEffect: "non-scaling-stroke" as const,
  };
  if (shape.kind === "rect") {
    return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...style} />;
  }
  if (shape.kind === "circle") {
    return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...style} />;
  }
  const points = shape.points ?? [];
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  return <path d={`${path}${shape.closed && points.length > 0 ? " Z" : ""}`} {...style} />;
}

function rectanglePath({ x, y, width, height }: SchematicRectangle) {
  return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
}

function clipPathData(clip: NonNullable<SchematicShape["clip"]>) {
  return [rectanglePath(clip), ...clip.exclusions.map(rectanglePath)].join(" ");
}
