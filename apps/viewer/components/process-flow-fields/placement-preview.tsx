"use client";

import * as React from "react";
import { AlertCircle, Maximize, Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PlacementValidationSummary } from "@/lib/process-flow/placement-validation";
import type { PlacementDraft } from "./placement-list-control";
import {
  fitPlacementCamera, panPlacementCamera, placementBoundsLabel,
  placementPreviewGeometry, projectPlacementPoint, zoomPlacementCamera,
  type PreviewCamera, type PreviewPoint,
} from "./placement-preview-geometry";

const HEIGHT = 300;
const useClientLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

export function PlacementPreview({ placements, validation, unit, selectedIndex, resetKey, onSelect, onViewChange }: {
  placements: readonly PlacementDraft[];
  validation: PlacementValidationSummary;
  unit?: string | null;
  selectedIndex: number | null;
  resetKey: number;
  onSelect: (index: number) => void;
  onViewChange?: () => void;
}) {
  const geometry = React.useMemo(() => placementPreviewGeometry(placements, validation), [placements, validation]);
  const viewportRef = React.useRef<SVGSVGElement>(null);
  const helpRef = React.useRef<HTMLDetailsElement>(null);
  const [width, setWidth] = React.useState(560);
  const [camera, setCamera] = React.useState<PreviewCamera | null>(null);
  const instructionsId = React.useId();
  const drag = React.useRef<{
    pointerId: number; start: PreviewPoint; last: PreviewPoint; moved: boolean; index: number | null;
  } | null>(null);
  const bounds = geometry.bounds;
  const hasShapes = bounds !== null;
  const fittedCamera = bounds ? fitPlacementCamera(bounds, width, HEIGHT, 64) : null;
  const activeCamera = camera ?? fittedCamera;
  const activeCameraRef = React.useRef(activeCamera);
  activeCameraRef.current = activeCamera;

  React.useEffect(() => {
    const svg = viewportRef.current;
    if (!svg) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const closeHelp = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !helpRef.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      helpRef.current.open = false;
      helpRef.current.querySelector("summary")?.focus();
    };
    const closeOutside = (event: PointerEvent) => {
      if (helpRef.current?.open && !helpRef.current.contains(event.target as Node)) {
        helpRef.current.open = false;
      }
    };
    document.addEventListener("keydown", closeHelp, true);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      document.removeEventListener("keydown", closeHelp, true);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, []);

  // Freeze the initial fit while coordinates are edited. Only a new source/import
  // or the first drawable draft establishes a new view automatically.
  useClientLayoutEffect(() => {
    setCamera(fittedCamera);
    drag.current = null;
    // Bounds intentionally stay out: ordinary edits must preserve the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, hasShapes, width]);

  function fitAll() { onViewChange?.(); setCamera(fittedCamera); }
  function zoom(factor: number, anchor: PreviewPoint = [width / 2, HEIGHT / 2]) {
    onViewChange?.();
    setCamera((current) => {
      const base = current ?? activeCameraRef.current;
      return base ? zoomPlacementCamera(base, factor, anchor, width, HEIGHT) : null;
    });
  }

  React.useEffect(() => {
    const svg = viewportRef.current;
    if (!svg) return;
    // React's delegated wheel listener is passive; cancel only the explicit zoom gesture.
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !activeCameraRef.current) return;
      event.preventDefault();
      onViewChange?.();
      const rect = svg.getBoundingClientRect();
      const anchor: PreviewPoint = [(event.clientX - rect.left) * width / rect.width,
        (event.clientY - rect.top) * HEIGHT / rect.height];
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? HEIGHT : 1);
      const factor = Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002);
      setCamera((current) => {
        const base = current ?? activeCameraRef.current;
        return base ? zoomPlacementCamera(base, factor, anchor, width, HEIGHT) : null;
      });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [width, onViewChange]);

  function localPoint(event: React.PointerEvent<SVGSVGElement>): PreviewPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - rect.left) * width / rect.width, (event.clientY - rect.top) * HEIGHT / rect.height];
  }

  function handleKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget || !activeCamera) return;
    const offset: Record<string, PreviewPoint> = {
      ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40],
    };
    if (offset[event.key]) {
      event.preventDefault();
      onViewChange?.();
      const [dx, dy] = offset[event.key];
      setCamera((current) => panPlacementCamera(current ?? activeCamera, dx, dy));
    } else if (["+", "=", "-", "Home"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Home") fitAll();
      else zoom(event.key === "-" ? 1 / 1.25 : 1.25);
    }
  }

  return (
    <section aria-label="Placement layout preview" className="relative min-w-0 overflow-hidden rounded-md border bg-card">
      <div className="absolute bottom-2 right-2 z-10 flex gap-1 rounded-md bg-card/95 p-1 shadow-sm">
        <Button type="button" variant="outline" size="sm" aria-label="Zoom out placement layout" disabled={!hasShapes} onClick={() => zoom(1 / 1.25)}><Minus aria-hidden="true" /></Button>
        <Button type="button" variant="outline" size="sm" aria-label="Zoom in placement layout" disabled={!hasShapes} onClick={() => zoom(1.25)}><Plus aria-hidden="true" /></Button>
        <Button type="button" variant="outline" size="sm" disabled={!hasShapes} onClick={fitAll}><Maximize aria-hidden="true" />Fit all</Button>
      </div>
      <details ref={helpRef} className="absolute right-2 top-2 z-20">
        <summary className="flex size-8 cursor-pointer list-none items-center justify-center rounded-md bg-card/95 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <AlertCircle className="size-4" aria-hidden="true" />
          <span className="sr-only">Placement layout help</span>
        </summary>
        <div id={instructionsId} className="absolute right-0 top-full z-10 mt-2 w-64 max-w-[calc(100vw-6rem)] space-y-2 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md">
          <p>Drag to pan. Ctrl/⌘ + wheel to zoom. Fit all shows every shape.</p>
          <p>Focus the plot: arrow keys pan, +/− zoom, Home fits all. Select a shape to jump to its placement card.</p>
          <p>X points right; Y points up. Dashed outlines are invalid. Incomplete coordinates are not drawn; review the highlighted cards below.</p>
        </div>
      </details>
      <div className="relative">
        <svg
          ref={viewportRef}
          role="group"
          aria-label="Placement XY layout, X right and Y up"
          aria-describedby={instructionsId}
          tabIndex={0}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block h-[300px] w-full touch-none bg-background outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onKeyDown={handleKeyDown}
          onPointerDown={(event) => {
            if (event.button !== 0 || !activeCamera) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            const point = localPoint(event);
            const target = (event.target as Element).closest("[data-placement-index]");
            drag.current = { pointerId: event.pointerId, start: point, last: point, moved: false,
              index: target ? Number(target.getAttribute("data-placement-index")) : null };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const gesture = drag.current;
            if (!gesture || event.pointerId !== gesture.pointerId || !activeCamera) return;
            const point = localPoint(event);
            if (!gesture.moved && Math.hypot(point[0] - gesture.start[0], point[1] - gesture.start[1]) < 4) return;
            gesture.moved = true;
            onViewChange?.();
            const dx = point[0] - gesture.last[0], dy = point[1] - gesture.last[1];
            setCamera((current) => panPlacementCamera(current ?? activeCamera, dx, dy));
            gesture.last = point;
          }}
          onPointerUp={(event) => {
            const gesture = drag.current;
            if (!gesture || event.pointerId !== gesture.pointerId) return;
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
            if (!gesture.moved && gesture.index !== null) onSelect(gesture.index);
          }}
          onPointerCancel={() => { drag.current = null; }}
          onLostPointerCapture={() => { drag.current = null; }}
        >
          {activeCamera ? (() => {
            const [originX, originY] = projectPlacementPoint([0, 0], activeCamera, width, HEIGHT);
            return <g aria-hidden="true" className="stroke-muted-foreground/30" strokeDasharray="4 4">
              <line x1={0} x2={width} y1={originY} y2={originY} />
              <line x1={originX} x2={originX} y1={0} y2={HEIGHT} />
            </g>;
          })() : null}
          {activeCamera ? geometry.shapes.map((shape) => {
            const points = shape.points.map((point) => projectPlacementPoint(point, activeCamera, width, HEIGHT));
            const selected = shape.index === selectedIndex;
            const path = points.map(([x, y], index) => `${index ? "L" : "M"} ${x} ${y}`).join(" ") + " Z";
            return <g key={shape.index} data-placement-index={shape.index} className={`cursor-pointer ${shape.diagnostic ? "text-destructive" : "text-primary"}`}>
              <title>{`Placement ${shape.index + 1} · ${shape.type} · ${placementBoundsLabel(shape.bounds, unit)}${shape.diagnostic ? ` · Invalid: ${shape.diagnostic}` : ""}`}</title>
              <path d={path} fill={shape.diagnostic ? "none" : "currentColor"} fillOpacity={selected ? 0.35 : 0.12}
                stroke="currentColor" strokeWidth={selected ? 3 : 1.5} strokeDasharray={shape.diagnostic ? "5 3" : undefined}
                strokeLinejoin="round" pointerEvents="all" />
              {shape.bounds.xMin === shape.bounds.xMax && shape.bounds.yMin === shape.bounds.yMax
                ? <circle cx={points[0][0]} cy={points[0][1]} r={4} fill="none" stroke="currentColor" strokeDasharray="2 2" /> : null}
            </g>;
          }) : null}
        </svg>
        {!hasShapes ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
          {placements.length ? "Enter complete coordinates to preview placements." : "No placements"}
        </div> : null}
      </div>
    </section>
  );
}
