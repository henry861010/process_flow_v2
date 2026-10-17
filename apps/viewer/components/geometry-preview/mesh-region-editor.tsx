"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CoordinateMode } from "./file-export-client";
import { Button } from "@/components/ui/button";
import { newPolygonLoop, type Axis, type LocationDraft, type RegionDraft } from "./file-export-regions";

const inputClass = "h-8 w-full min-w-0 rounded-md border border-input bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted disabled:text-muted-foreground";

function LocationInput<A extends Axis>({ axis, label, title = axis.toUpperCase(), path, value, mode, error, onChange }: {
  axis: A; label: string; title?: string; path: string; value: LocationDraft<A>; mode: CoordinateMode; error?: string;
  onChange: (next: LocationDraft<A>) => void;
}) {
  const invalid = !!error?.includes(path);
  return <fieldset aria-label={label} className="min-w-0 space-y-2">
    <legend className="mb-1 font-mono text-xs font-semibold text-foreground">{title}</legend>
    {mode === "reference" && <label className="block min-w-0 space-y-1 text-[10px] text-muted-foreground">Anchor
      <select aria-label={`${label} anchor`} className={inputClass} value={value.anchor}
        onChange={e => onChange({ ...value, anchor: e.target.value as LocationDraft<A>["anchor"] })}>
        <option value={`${axis}_min`}>{axis}_min</option><option value={`${axis}_max`}>{axis}_max</option>
      </select>
    </label>}
    <label className="block min-w-0 space-y-1 text-[10px] text-muted-foreground">{mode === "reference" ? "Offset" : "Value"} (µm)
      <input className={`${inputClass} ${invalid ? "border-destructive" : ""}`} aria-label={`${label} value`}
        data-region-field={path} aria-invalid={invalid} inputMode="decimal" value={value.value}
        onChange={e => onChange({ ...value, value: e.target.value })} />
    </label>
  </fieldset>;
}

function CoordinateGroup({ label, axes, action, children }: {
  label: string; axes: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return <fieldset className="min-w-0 overflow-hidden rounded-md border bg-muted/10">
    <legend className="sr-only">{label}</legend>
    <div className="flex min-h-10 items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-xs font-semibold">{label}</span>
        <span aria-hidden="true" className="font-mono text-[10px] text-muted-foreground">{axes}</span>
      </div>
      {action}
    </div>
    {children}
  </fieldset>;
}

export function MeshRegionEditor({ value, mode, disabled, error, onChange }: {
  value: RegionDraft; mode: CoordinateMode; disabled: boolean; error?: string; onChange: (next: RegionDraft) => void;
}) {
  return <fieldset className="min-w-0 space-y-3 border-t pt-3" disabled={disabled}>
    <legend className="text-xs font-medium">3D region</legend>
    <p className="text-xs text-muted-foreground">Reference sets coordinates only. The region can extend beyond it. Element size applies to X, Y and Z.</p>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <label className="block max-w-xs space-y-1 text-xs">Shape
      <select className={inputClass} aria-label="Region shape" value={value.shape}
        onChange={e => onChange({ ...value, shape: e.target.value as RegionDraft["shape"] })}>
        <option value="box">Box</option><option value="polygon">Polygon</option>
      </select>
    </label>
    {value.shape === "box" ? <div className="space-y-3">
      {(["min", "max"] as const).map(bound => <CoordinateGroup key={bound}
        label={bound === "min" ? "Minimum point" : "Maximum point"} axes="(X, Y, Z)">
        <div className="grid min-w-0 grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {(["x", "y", "z"] as const).map(axis => <div key={axis} className="min-w-0 p-3">
            <LocationInput mode={mode} axis={axis} label={`${bound} ${axis.toUpperCase()}`}
              path={`region.${bound}.${axis}`} error={error} value={value.box[bound][axis]}
              onChange={next => onChange({ ...value, box: { ...value.box, [bound]: { ...value.box[bound], [axis]: next } } })} />
          </div>)}
        </div>
      </CoordinateGroup>)}
    </div> : <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Loops nested inside another loop form holes. Boundaries must not cross or touch.</p>
      {value.polygon.loops.map((loop, i) => <section key={i} className="min-w-0 space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between gap-2">
          <h6 className="text-xs font-semibold">Loop {i + 1}</h6>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove loop ${i + 1}`} disabled={value.polygon.loops.length <= 1}
            onClick={() => onChange({ ...value, polygon: { ...value.polygon, loops: value.polygon.loops.filter((_, n) => n !== i) } })}><Trash2 /></Button>
        </div>
        <div className="space-y-2">
          {loop.map((point, j) => <CoordinateGroup key={j} label={`Vertex ${j + 1}`} axes="(X, Y)" action={
            <Button type="button" variant="ghost" size="icon-sm" disabled={loop.length <= 3}
              aria-label={`Remove loop ${i + 1} vertex ${j + 1}`} onClick={() => onChange({ ...value, polygon: { ...value.polygon,
                loops: value.polygon.loops.map((l, li) => li !== i ? l : l.filter((_, pi) => pi !== j)) } })}><Trash2 /></Button>
          }>
            <div className="grid min-w-0 grid-cols-2 divide-x">
              {(["x", "y"] as const).map(axis => <div key={axis} className="min-w-0 p-3">
                <LocationInput mode={mode} axis={axis} label={`Loop ${i + 1} vertex ${j + 1} ${axis.toUpperCase()}`}
                  path={`region.loops[${i}][${j}].${axis}`} error={error} value={point[axis]}
                  onChange={next => onChange({ ...value, polygon: { ...value.polygon,
                    loops: value.polygon.loops.map((l, li) => li !== i ? l : l.map((p, pi) => pi !== j ? p : { ...p, [axis]: next })) } })} />
              </div>)}
            </div>
          </CoordinateGroup>)}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, polygon: { ...value.polygon,
          loops: value.polygon.loops.map((l, li) => li !== i ? l : [...l, { x: { anchor: "x_min", value: mode === "reference" ? "0" : "" }, y: { anchor: "y_min", value: mode === "reference" ? "0" : "" } }]) } })}><Plus />Add vertex</Button>
      </section>)}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...value, polygon: { ...value.polygon, loops: [...value.polygon.loops, newPolygonLoop(mode)] } })}><Plus />Add loop</Button>
      <CoordinateGroup label="Z range" axes="(Start, End)">
        <div className="grid min-w-0 grid-cols-2 divide-x">
          {(["startZ", "endZ"] as const).map(field => <div key={field} className="min-w-0 p-3">
            <LocationInput mode={mode} axis="z" title={field === "startZ" ? "Start Z" : "End Z"}
              label={field === "startZ" ? "Start Z" : "End Z"} path={`region.${field}`} error={error} value={value.polygon[field]}
              onChange={next => onChange({ ...value, polygon: { ...value.polygon, [field]: next } })} />
          </div>)}
        </div>
      </CoordinateGroup>
    </div>}
  </fieldset>;
}
