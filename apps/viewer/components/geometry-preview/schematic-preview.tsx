"use client";

import * as React from "react";
import { AlertCircle, AlertTriangle, Layers3, MousePointer2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  SchematicDocument,
  SchematicRectangle,
  SchematicShape,
} from "./schematic-types";
import { schematicLabels, schematicTextColor } from "./schematic-labels";
import { formatSchematicLength, schematicInspectorPosition, SchematicItemDetails } from "./schematic-inspector";

export { formatSchematicLength } from "./schematic-inspector";

type SchematicSelection = {
  itemId: string;
  anchor: { x: number; y: number };
  trigger: SVGGElement;
  document: SchematicDocument;
};

/** Only display coordinates, generic shapes and source measurements are interpreted here. */
export function SchematicPreview({
  document,
  warnings = [],
}: {
  document: SchematicDocument | null;
  warnings?: string[];
}) {
  const [selection, setSelection] = React.useState<SchematicSelection | null>(null);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [position, setPosition] = React.useState<ReturnType<typeof schematicInspectorPosition> | null>(null);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLElement>(null);
  const notesButtonRef = React.useRef<HTMLButtonElement>(null);
  const notesRef = React.useRef<HTMLElement>(null);
  const inspectorId = React.useId();
  const notesId = React.useId();
  const selectedItem = selection?.document === document
    ? document?.items.find((item) => item.id === selection.itemId)
    : undefined;

  const closeInspector = React.useCallback((restoreFocus = false) => {
    if (restoreFocus && selection?.trigger.isConnected) selection.trigger.focus({ preventScroll: true });
    setSelection(null);
  }, [selection]);

  React.useEffect(() => { setSelection(null); setNotesOpen(false); }, [document]);

  React.useEffect(() => {
    if (!notesOpen) return;
    const viewport = viewportRef.current;
    const ownerDialog = viewport?.closest('[role="dialog"]');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Element)) return;
      const inOwner = ownerDialog
        ? event.target.closest('[role="dialog"]') === ownerDialog
        : viewport?.parentElement?.contains(event.target);
      if (!inOwner) return;
      event.preventDefault();
      event.stopPropagation();
      setNotesOpen(false);
      notesButtonRef.current?.focus({ preventScroll: true });
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || notesRef.current?.contains(event.target) || notesButtonRef.current?.contains(event.target)) return;
      setNotesOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [notesOpen]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    const card = cardRef.current;
    if (!selection || !selectedItem || !viewport || !card) return;
    setPosition(schematicInspectorPosition(selection.anchor,
      { width: viewport.clientWidth, height: viewport.clientHeight }, card.getBoundingClientRect().height));
  }, [selection, selectedItem]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!selection || !selectedItem || !viewport) return;
    const ownerDialog = viewport.closest('[role="dialog"]');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Element)) return;
      // The preview's dialog handles Escape at document capture. Intercept it
      // earlier, while leaving a nested export dialog in charge of its own keys.
      const inOwner = ownerDialog ? event.target.closest('[role="dialog"]') === ownerDialog : viewport.contains(event.target);
      if (!inOwner) return;
      event.preventDefault();
      event.stopPropagation();
      closeInspector(true);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !viewport.contains(event.target) || cardRef.current?.contains(event.target)) return;
      const shape = event.target.closest('[data-item-id]');
      if (shape && document?.items.some((item) => item.id === shape.getAttribute("data-item-id"))) return;
      closeInspector();
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && !viewport.contains(event.target) && !event.target.contains(viewport)) return;
      closeInspector();
    };
    const onResize = () => closeInspector();
    const size = { width: viewport.clientWidth, height: viewport.clientHeight };
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth !== size.width || viewport.clientHeight !== size.height) closeInspector();
    });
    observer.observe(viewport);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [selection, selectedItem, document, closeInspector]);

  function selectItem(itemId: string, event: React.MouseEvent<SVGGElement> | React.KeyboardEvent<SVGGElement>) {
    if (!document || !viewportRef.current) return;
    setNotesOpen(false);
    if (selectedItem?.id === itemId) { closeInspector(); return; }
    const viewport = viewportRef.current.getBoundingClientRect();
    const shape = event.currentTarget.getBoundingClientRect();
    const pointer = "clientX" in event && event.detail !== 0;
    const trigger = Array.from(viewportRef.current.querySelectorAll<SVGGElement>('[data-item-id][role="button"]'))
      .find((target) => target.getAttribute("data-item-id") === itemId) ?? event.currentTarget;
    setPosition(null);
    setSelection({ itemId, trigger, document, anchor: {
      x: (pointer ? event.clientX : shape.left + shape.width / 2) - viewport.left,
      y: (pointer ? event.clientY : shape.top + shape.height / 2) - viewport.top,
    } });
  }

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

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" aria-label="Structure cross section">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b bg-muted/25 px-4 py-3 md:px-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <h3 className="text-sm font-semibold">Cross section</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Schematic · not to scale</p>
          </div>
          <div className="border-l pl-4" aria-label="Total structure thickness">
            <p className="text-xs text-muted-foreground">Total structure thickness</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{formatSchematicLength(document.totalThickness, document.unit)}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MousePointer2 className="h-3.5 w-3.5" aria-hidden="true" />Select a feature to inspect
          </p>
          {document.notes.length > 0 ? (
            <button ref={notesButtonRef} type="button" aria-label="Reading this schematic" title="Reading this schematic"
              aria-expanded={notesOpen} aria-controls={notesOpen ? notesId : undefined}
              onClick={() => { setSelection(null); setNotesOpen((open) => !open); }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted aria-expanded:text-foreground">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <div ref={viewportRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-muted/30 p-2 md:p-3">
        {document.shapes.length > 0 ? (
          <div className="h-full min-h-0 min-w-0 w-full overflow-hidden rounded-xl border border-border/60 bg-white p-1 md:p-2">
            <SchematicDrawing document={document} selectedItemId={selectedItem?.id ?? null} onSelect={selectItem} inspectorId={inspectorId} />
          </div>
        ) : (
          <p className="flex h-full items-center justify-center p-3 text-center text-sm text-muted-foreground" role="status">
            This snapshot contains no visible structure.
          </p>
        )}
        {notesOpen ? (
          <section ref={notesRef} id={notesId} role="region" aria-label="Schematic notes"
            className="absolute right-2 top-2 z-10 max-h-[calc(100%-16px)] w-96 max-w-[calc(100%-16px)] overflow-y-auto rounded-lg border bg-background p-4 text-xs leading-relaxed text-muted-foreground shadow-lg md:right-3 md:top-3 md:max-h-[calc(100%-24px)] md:max-w-[calc(100%-24px)]">
            <h4 className="mb-2 pr-7 font-semibold text-foreground">Reading this schematic</h4>
            <button type="button" aria-label="Close schematic notes"
              onClick={() => { setNotesOpen(false); notesButtonRef.current?.focus({ preventScroll: true }); }}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <ul className="space-y-1 break-words">{document.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          </section>
        ) : null}
        {selectedItem ? (
          <section ref={cardRef} id={inspectorId} role="region" aria-label="Feature details" aria-live="polite"
            className="absolute z-10 max-w-[calc(100%-24px)] overflow-y-auto rounded-lg border bg-background p-4 shadow-lg"
            style={position ?? { left: 12, top: 12, width: 288, visibility: "hidden" }}>
            <button type="button" aria-label="Close feature details" onClick={() => closeInspector(true)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <SchematicItemDetails item={selectedItem} unit={document.unit} />
          </section>
        ) : null}
      </div>
      {document.warnings.length > 0 || warnings.length > 0 ? (
        <div className="max-h-[25%] shrink-0 space-y-3 overflow-y-auto border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground md:px-5">
          {document.warnings.length > 0 || warnings.length > 0 ? (
            <section className="space-y-2 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-amber-950" aria-label="Schematic warnings" role="status">
              <h4 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Presentation notices</h4>
              <ul className="space-y-1">{[...document.warnings, ...warnings].map((warning, index) => <li key={index}>{warning}</li>)}</ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function SchematicDrawing({
  document,
  selectedItemId,
  onSelect,
  inspectorId,
}: {
  document: SchematicDocument;
  selectedItemId: string | null;
  onSelect: (itemId: string, event: React.MouseEvent<SVGGElement> | React.KeyboardEvent<SVGGElement>) => void;
  inspectorId?: string;
}) {
  const instanceId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const items = new Map(document.items.map((item) => [item.id, item]));
  const firstShapeIds = new Map<string, string>();
  for (const shape of document.shapes) {
    if (!firstShapeIds.has(shape.itemId)) firstShapeIds.set(shape.itemId, shape.id);
  }
  const titleId = `${instanceId}-title`;
  const descriptionId = `${instanceId}-description`;
  const labels = React.useMemo(() => schematicLabels(document), [document]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      viewBox={document.viewBox.join(" ")}
      width={document.viewBox[2]}
      height={document.viewBox[3]}
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full font-sans"
    >
      <title id={titleId}>Structure cross section</title>
      <desc id={descriptionId}>Schematic, not to scale. Select a layer with a click, Enter, or Space to review its material, actual thickness and available density in a floating card.</desc>
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
            aria-expanded={interactive && inspectorId ? selected : undefined}
            aria-controls={interactive && selected ? inspectorId : undefined}
            aria-label={interactive && item ? `${item.groupLabel}, ${item.label}, ${formatSchematicLength(item.thickness, document.unit)}` : undefined}
            data-item-id={shape.itemId}
            data-selected={selected || undefined}
            onClick={item ? (event) => onSelect(shape.itemId, event) : undefined}
            onKeyDown={interactive ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(shape.itemId, event);
              }
            } : undefined}
            className={cn("outline-none", !selected && "focus-visible:[&>*]:stroke-[hsl(var(--schematic-selection))] focus-visible:[&>*]:stroke-[4px]", item && "cursor-pointer")}
            clipPath={shape.clip ? `url(#${instanceId}-clip-${index})` : undefined}
          >
            <SchematicPrimitive shape={shape} selected={selected} />
            {item ? <title>{`${item.label} · ${item.material} · ${formatSchematicLength(item.thickness, document.unit)}`}</title> : null}
          </g>
        );
      })}
      {labels.map((label) => (
        <text
          key={label.id}
          data-layer-label={label.component ? undefined : label.itemId}
          data-component-label={label.component ? label.id : undefined}
          x={label.x}
          y={label.y}
          textAnchor="middle"
          dominantBaseline="central"
          fill={schematicTextColor(label.background)}
          fontSize={label.fontSize}
          fontWeight={label.component ? 750 : 650}
          pointerEvents="none"
          aria-hidden="true"
        >
          {label.text}
          <title>{label.fullText}</title>
        </text>
      ))}
    </svg>
  );
}

function SchematicPrimitive({ shape, selected }: { shape: SchematicShape; selected: boolean }) {
  const appearance = {
    fill: shape.fill,
    stroke: selected ? "hsl(var(--schematic-selection))" : shape.stroke,
    strokeWidth: selected ? Math.max(4, shape.strokeWidth + 2) : shape.strokeWidth,
    vectorEffect: "non-scaling-stroke" as const,
    style: selected ? { filter: "drop-shadow(0 0 2px hsl(var(--schematic-selection) / 0.3))" } : undefined,
  };
  if (shape.kind === "rect") {
    return <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...appearance} />;
  }
  if (shape.kind === "circle") {
    return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...appearance} />;
  }
  const points = shape.points ?? [];
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  return <path d={`${path}${shape.closed && points.length > 0 ? " Z" : ""}`} {...appearance} />;
}

function rectanglePath({ x, y, width, height }: SchematicRectangle) {
  return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
}

function clipPathData(clip: NonNullable<SchematicShape["clip"]>) {
  return [rectanglePath(clip), ...clip.exclusions.map(rectanglePath)].join(" ");
}
