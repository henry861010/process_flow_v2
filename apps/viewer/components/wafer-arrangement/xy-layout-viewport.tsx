"use client";

import * as React from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fitPlacementCamera, panPlacementCamera, zoomPlacementCamera } from "@/components/process-flow-fields/placement-preview-geometry";

const SIZE = 600;
type Bounds = { xMin: number; yMin: number; xMax: number; yMax: number };

export function XyLayoutViewport({ bounds, resetKey, label, subject, title, summary, children }: {
  bounds: Bounds; resetKey?: unknown; label: string; subject: string; title: string;
  summary: React.ReactNode; children: React.ReactNode;
}) {
  const helpId = React.useId();
  const fit = React.useCallback(() => fitPlacementCamera(bounds, SIZE, SIZE), [bounds]);
  const [camera, setCamera] = React.useState(fit);
  const viewport = React.useRef<SVGSVGElement>(null);
  const drag = React.useRef<{ x: number; y: number; pointer: number } | null>(null);
  React.useEffect(() => { setCamera(fit()); }, [fit, resetKey]);
  const zoom = React.useCallback((factor: number) => setCamera(current => zoomPlacementCamera(current, factor, [SIZE / 2, SIZE / 2], SIZE, SIZE)), []);

  React.useEffect(() => {
    const svg = viewport.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const anchor: [number, number] = [(event.clientX - rect.left) / rect.width * SIZE, (event.clientY - rect.top) / rect.height * SIZE];
      setCamera(current => zoomPlacementCamera(current, Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.005), anchor, SIZE, SIZE));
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, []);

  function keyboard(event: React.KeyboardEvent<SVGSVGElement>) {
    const offsets: Record<string, [number, number]> = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] };
    if (offsets[event.key]) {
      event.preventDefault();
      setCamera(current => panPlacementCamera(current, ...offsets[event.key]));
    } else if (["+", "=", "-", "Home"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Home") setCamera(fit()); else zoom(event.key === "-" ? 0.8 : 1.25);
    }
  }

  return <div className="min-w-0 rounded-md border bg-card">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div className="min-w-0 text-xs text-muted-foreground"><p>XY layout · X → · Y ↑</p><div className="mt-1 font-mono">{summary}</div></div>
      <div className="flex gap-1">
        <Button type="button" size="icon-sm" variant="outline" title="Zoom out" aria-label={`Zoom out ${subject}`} onClick={() => zoom(0.8)}><Minus aria-hidden="true" /></Button>
        <Button type="button" size="icon-sm" variant="outline" title="Zoom in" aria-label={`Zoom in ${subject}`} onClick={() => zoom(1.25)}><Plus aria-hidden="true" /></Button>
        <Button type="button" size="sm" variant="outline" aria-label={`Fit all ${subject}`} onClick={() => setCamera(fit())}><Maximize aria-hidden="true" />Fit all</Button>
      </div>
    </div>
    <svg ref={viewport} viewBox={`0 0 ${SIZE} ${SIZE}`} tabIndex={0} role="group" aria-label={label}
      aria-describedby={helpId} className="block aspect-square w-full touch-none select-none rounded-b-md bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onKeyDown={keyboard}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        const scale = SIZE / event.currentTarget.getBoundingClientRect().width;
        setCamera(current => panPlacementCamera(current, (event.clientX - start.x) * scale, (event.clientY - start.y) * scale));
        drag.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <title>{title}</title>
      <g transform={`translate(${SIZE / 2},${SIZE / 2}) scale(${camera.scale},${-camera.scale}) translate(${-camera.x},${-camera.y})`}>{children}</g>
    </svg>
    <p id={helpId} className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground">Drag to pan. Ctrl/⌘ + wheel to zoom. Keyboard: arrows to pan, +/− to zoom, Home to fit.</p>
  </div>;
}
