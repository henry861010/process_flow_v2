"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import type { CowDiePattern, DieType, WaferRectangle } from "./wafer-arrangement-client";
import { DUMMY_COLORS, rectanglesPath } from "./wafer-pattern-preview";
import { XyLayoutViewport } from "./xy-layout-viewport";

const PAGE_SIZE = 50;

export function CowDiePreview({ pattern }: { pattern: CowDiePattern }) {
  const [hidden, setHidden] = React.useState<Set<DieType>>(() => new Set());
  const [expanded, setExpanded] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<WaferRectangle | null>(null);
  const dies = React.useMemo(() => pattern.dieLayers.flatMap(layer => layer.dies.map(die => ({ ...die, type: layer.type }))), [pattern]);
  const bounds = React.useMemo(() => [...dies.map(die => die.rectangle), ...(pattern.cowRectangle ? [pattern.cowRectangle] : [])].reduce((acc, [x0, y0, x1, y1]) => ({
    xMin: Math.min(acc.xMin, x0), yMin: Math.min(acc.yMin, y0), xMax: Math.max(acc.xMax, x1), yMax: Math.max(acc.yMax, y1),
  }), { xMin: 0, yMin: 0, xMax: 0, yMax: 0 }), [dies, pattern.cowRectangle]);
  const paths = React.useMemo(() => pattern.dieLayers.map(layer => rectanglesPath(layer.dies.map(die => die.rectangle))), [pattern]);
  const outside = React.useMemo(() => new Set(pattern.outOfBounds.map(die => `${die.type}:${die.id}`)), [pattern]);
  const outsidePath = React.useMemo(() => rectanglesPath(dies.filter(die => outside.has(`${die.type}:${die.id}`) && !hidden.has(die.type)).map(die => die.rectangle)), [dies, hidden, outside]);
  React.useEffect(() => { setPage(0); setSelected(null); }, [pattern]);

  return <>
    <XyLayoutViewport bounds={bounds} resetKey={pattern} label="Single COW die XY preview" subject="COW"
      title={`Single COW layout; ${pattern.totalDies} die; origin at COW center`}
      summary={`${pattern.totalDies.toLocaleString("en-US")} die per COW · origin (0, 0) · µm`}>
      <path d={`M${bounds.xMin},0H${bounds.xMax}M0,${bounds.yMin}V${bounds.yMax}`} className="stroke-slate-300" vectorEffect="non-scaling-stroke" fill="none" />
      {pattern.cowRectangle && <path d={rectanglesPath([pattern.cowRectangle])} className="fill-white/40 stroke-slate-600" vectorEffect="non-scaling-stroke" strokeWidth={1.5} />}
      {pattern.dieLayers.map((layer, index) => !hidden.has(layer.type) && <path key={layer.type} data-die-type={layer.type} d={paths[index]}
        fill={DUMMY_COLORS[layer.datatype - 1]} stroke={DUMMY_COLORS[layer.datatype - 1]} fillOpacity={0.25} vectorEffect="non-scaling-stroke" />)}
      <path d={outsidePath} className="stroke-destructive" fill="none" strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      {selected && <path d={rectanglesPath([selected])} className="stroke-foreground" fill="none" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />}
    </XyLayoutViewport>
    {!pattern.cowRectangle && <p className="mt-2 text-xs text-muted-foreground">Enter a valid COW size to show its boundary and check die placement.</p>}
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 rounded-md border bg-card p-3 text-xs">
      {pattern.dieLayers.map(layer => <label key={layer.type} className="flex flex-wrap items-center gap-2">
        <input type="checkbox" checked={!hidden.has(layer.type)} onChange={event => {
          setSelected(null);
          const checked = event.target.checked;
          setHidden(current => { const next = new Set(current); if (checked) next.delete(layer.type); else next.add(layer.type); return next; });
        }} />
        <span className="size-2.5 rounded-sm" style={{ backgroundColor: DUMMY_COLORS[layer.datatype - 1] }} aria-hidden="true" />
        {layer.type.toUpperCase()} <span className="font-mono text-muted-foreground">888:{layer.datatype} · {layer.count} die</span>
      </label>)}
      <p className="w-full text-muted-foreground">Visibility affects this viewer only. Export includes all die types.</p>
    </div>
    <details className="mt-3 min-w-0 rounded-md border bg-card p-3 text-xs" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer font-medium">Inspect die IDs and coordinates</summary>
      {expanded && <div className="mt-3 min-w-0">
        <ul className="space-y-2">{dies.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(die => <li key={`${die.type}:${die.id}`}>
          <button type="button" onClick={() => setSelected(die.rectangle)} className="w-full rounded border p-2 text-left focus-visible:ring-2 focus-visible:ring-ring">
            <span className="block break-all font-mono">{die.type.toUpperCase()} · {die.id}{outside.has(`${die.type}:${die.id}`) ? " · Outside COW" : ""}</span>
            <span className="mt-1 block break-all font-mono text-muted-foreground">({die.rectangle[0]}, {die.rectangle[1]}) → ({die.rectangle[2]}, {die.rectangle[3]}) µm</span>
          </button>
        </li>)}</ul>
        {dies.length > PAGE_SIZE && <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous die</Button>
          <span>{page + 1} / {Math.ceil(dies.length / PAGE_SIZE)}</span>
          <Button type="button" size="sm" variant="outline" disabled={(page + 1) * PAGE_SIZE >= dies.length} onClick={() => setPage(value => value + 1)}>Next die</Button>
        </div>}
      </div>}
    </details>
    {pattern.outOfBounds.length > 0 && <div role="alert" className="mt-3 break-words rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">
      <p className="font-semibold">Die outside COW · Export is blocked. Correct the JSON or COW size.</p>
      <ul className="mt-2 max-h-48 space-y-1 overflow-auto">{pattern.outOfBounds.map(die => <li key={`${die.type}:${die.id}`}>{die.message}</li>)}</ul>
    </div>}
    {pattern.warnings.length > 0 && <div role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">{pattern.warnings.map(message => <p key={message}>{message}</p>)}</div>}
  </>;
}
