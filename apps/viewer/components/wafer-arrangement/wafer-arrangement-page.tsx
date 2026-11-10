"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, CircleDot, Download, Eye, FileJson, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EditorDialog } from "@/components/process-flow-save/editor-dialog";
import { exportWafer, previewWafer, type AxisPacking, type WaferPattern, type WaferExportResult } from "./wafer-arrangement-client";
import { emptyWaferDraft, newDummyLayer, validateWaferDraft, type WaferDraft } from "./wafer-arrangement-state";
import { DUMMY_COLORS, WaferPatternPreview } from "./wafer-pattern-preview";
import { CowDiePreview } from "./cow-die-preview";
import { useCowDieImport } from "./use-cow-die-import";

const inputClass = "h-9 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:bg-muted";
const format = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 });

function NumberField({ id, label, value, error, zeroAllowed, onChange }: {
  id: string; label: string; value: string; error?: string; zeroAllowed?: boolean; onChange: (value: string) => void;
}) {
  return <div className="min-w-0">
    <label htmlFor={id} className="mb-1 block text-xs font-medium">{label} <span className="font-normal text-muted-foreground">(µm)</span></label>
    <input id={id} type="number" required min={zeroAllowed ? 0 : 0.000001} step="any" value={value}
      aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className={inputClass}
      onChange={event => onChange(event.target.value)} />
    {error && <p id={`${id}-error`} className="mt-1 text-xs text-destructive">{error}</p>}
  </div>;
}

function SpacingSummary({ axis, name }: { axis: AxisPacking; name: string }) {
  return <p className="font-mono text-xs leading-5">{name}: {axis.count} per cell · A {axis.a === null ? "—" : format(axis.a)} · B {axis.b === null ? "—" : `${format(axis.b)}${axis.bMax !== axis.b ? `–${format(axis.bMax!)}` : ""}`} µm</p>;
}

export function WaferArrangementPage() {
  const [draft, setDraft] = React.useState(emptyWaferDraft);
  const dieImport = useCowDieImport(draft.cowSize);
  const [revision, setRevision] = React.useState(0);
  const [preview, setPreview] = React.useState<{ pattern: WaferPattern; revision: number } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [outputPath, setOutputPath] = React.useState("");
  const [pathError, setPathError] = React.useState<string | null>(null);
  const [exportResult, setExportResult] = React.useState<WaferExportResult | null>(null);
  const [visible, setVisible] = React.useState<boolean[]>([]);
  const [showCow, setShowCow] = React.useState(true);
  const [showBoundary, setShowBoundary] = React.useState(true);
  const [showCowGraph, setShowCowGraph] = React.useState(false);
  const request = React.useRef(0);
  const controller = React.useRef<AbortController | null>(null);
  const exportController = React.useRef<AbortController | null>(null);
  const dieFileInput = React.useRef<HTMLInputElement>(null);
  const cowGraphButton = React.useRef<HTMLButtonElement>(null);
  const nextLayer = React.useRef(1);
  const errorSummary = React.useRef<HTMLDivElement>(null);
  const stale = !!preview && preview.revision !== revision;
  const canExport = !!preview && !stale && preview.pattern.cowCount > 0 && !generating && !exporting && dieImport.ready;
  const enteredDiameter = Number(draft.allowableDiameter);
  const guideDiameter = Number.isFinite(enteredDiameter) && enteredDiameter > 0 && enteredDiameter < 300000 ? enteredDiameter : undefined;

  React.useEffect(() => {
    if (error || Object.keys(errors).length) errorSummary.current?.focus();
  }, [error, errors]);
  React.useEffect(() => () => { request.current++; controller.current?.abort(); exportController.current?.abort(); }, []);
  React.useEffect(() => {
    if (!showCowGraph) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [showCowGraph]);

  function update(updater: (current: WaferDraft) => WaferDraft) {
    request.current++;
    controller.current?.abort();
    setGenerating(false);
    setDraft(updater);
    setRevision(current => current + 1);
    setErrors({}); setError(null); setExportResult(null);
  }

  async function generate(event: React.FormEvent) {
    event.preventDefault();
    const checked = validateWaferDraft(draft);
    setErrors(checked.errors); setError(null); setExportResult(null);
    if (!checked.parameters) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const id = ++request.current;
    setGenerating(true);
    try {
      const pattern = await previewWafer(checked.parameters, abort.signal);
      if (request.current !== id) return;
      setPreview({ pattern, revision });
      setVisible(pattern.dummyLayers.map(() => true));
    } catch (failure) {
      if (request.current === id && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to generate pattern.");
    } finally {
      if (request.current === id) setGenerating(false);
    }
  }

  async function exportGds() {
    if (!canExport || !preview) return;
    if (!outputPath.trim() || !/\.gds$/i.test(outputPath.trim())) {
      setPathError("Enter an absolute output file path ending in .gds.");
      document.getElementById("gds-output-path")?.focus();
      return;
    }
    setPathError(null); setError(null); setExportResult(null); setExporting(true);
    const abort = new AbortController(); exportController.current = abort;
    try {
      const result = dieImport.hasFile
        ? await exportWafer(preview.pattern.normalizedParameters, outputPath.trim(), abort.signal, dieImport.json)
        : await exportWafer(preview.pattern.normalizedParameters, outputPath.trim(), abort.signal);
      if (!abort.signal.aborted) setExportResult(result);
    } catch (failure) {
      if (!abort.signal.aborted) setPathError(failure instanceof Error ? failure.message : "Unable to export GDS.");
    } finally {
      if (!abort.signal.aborted) setExporting(false);
    }
  }

  return <main className="min-h-screen bg-background text-foreground">
    <div className="mx-auto w-full max-w-7xl px-5 py-5 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b pb-5">
        <div><div className="flex items-center gap-2"><CircleDot className="size-5 text-primary" aria-hidden="true" /><h1 className="text-xl font-semibold">Wafer arrangement</h1></div>
          <p className="mt-1 text-sm text-muted-foreground">Arrange COW and wafer dummy die, then export a GDS pattern.</p></div>
        <Button asChild size="sm" variant="ghost"><Link href="/"><ArrowLeft aria-hidden="true" />Home</Link></Button>
      </header>
      <div className="grid items-start gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <form noValidate onSubmit={event => void generate(event)} className="min-w-0 space-y-4">
          {(error || Object.keys(errors).length > 0) && <div ref={errorSummary} tabIndex={-1} role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <p className="font-semibold">{error || "Check the highlighted parameters."}</p>
            {Object.entries(errors).length > 0 && <ul className="mt-2 space-y-1">{Object.entries(errors).map(([id, message]) => <li key={id}><a className="underline" href={`#${id}`} onClick={event => { event.preventDefault(); document.getElementById(id)?.focus(); }}>{message}</a></li>)}</ul>}
          </div>}
          <fieldset disabled={exporting} className="min-w-0 space-y-4 disabled:opacity-60">
            <section className="min-w-0 space-y-4 rounded-lg border bg-card p-4" aria-labelledby="cow-feature-heading">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-xs font-medium text-primary" aria-hidden="true">01</span>
                  <div><h2 id="cow-feature-heading" className="text-sm font-semibold">CoW feature</h2><p className="mt-0.5 text-xs text-muted-foreground">Size and die layout for one CoW.</p></div></div>
                <Badge variant="outline">µm</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">{(["x", "y"] as const).map(axis => <NumberField key={axis} id={`cow-size-${axis}`} label={`COW size ${axis.toUpperCase()}`} value={draft.cowSize[axis]} error={errors[`cow-size-${axis}`]}
                onChange={value => update(current => ({ ...current, cowSize: { ...current.cowSize, [axis]: value } }))} />)}</div>
              <div className="min-w-0 border-t pt-3">
                <div className="mb-2 flex items-center justify-between gap-2"><h3 id="die-json-heading" className="text-xs font-medium">Die layout JSON</h3><span className="text-xs text-muted-foreground">Optional</span></div>
                <input ref={dieFileInput} id="cow-die-json" hidden type="file" accept=".json,application/json" aria-label="COW die JSON file"
                  onChange={event => {
                    const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
                    if (file) { dieImport.choose(file); setExportResult(null); setPathError(null); }
                  }} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="outline" aria-describedby={dieImport.error ? "die-json-help die-json-status die-json-error" : "die-json-help die-json-status"}
                    onClick={() => dieFileInput.current?.click()}><FileJson aria-hidden="true" />Read JSON</Button>
                  <Button ref={cowGraphButton} type="button" size="sm" variant="outline" disabled={!dieImport.pattern} aria-label="CoW pattern graph" aria-haspopup="dialog"
                    onClick={() => setShowCowGraph(true)}><Eye aria-hidden="true" />Pattern graph</Button>
                </div>
                <p id="die-json-help" className="mt-2 text-xs leading-5 text-muted-foreground">Die coordinates use the CoW center as (0, 0), in µm.</p>
                <div id="die-json-status" role="status" aria-live="polite" className="mt-2 min-w-0 text-xs leading-5">
                  {dieImport.hasFile ? <>
                    <div className="flex min-w-0 items-start justify-between gap-2"><p className="min-w-0 break-all font-mono">{dieImport.fileName}</p>
                      <Button type="button" size="icon-sm" variant="ghost" className="-mr-1 -mt-1 shrink-0" title="Remove JSON" aria-label="Remove JSON" onClick={() => { dieImport.clear(); setShowCowGraph(false); setExportResult(null); setPathError(null); }}><Trash2 aria-hidden="true" /></Button></div>
                    <p className="text-muted-foreground">{dieImport.loading ? "Reading and checking die JSON…" : dieImport.pattern ? `${format(dieImport.pattern.totalDies)} die per CoW` : "Die JSON needs attention"}</p>
                  </> : <p className="text-muted-foreground">No JSON selected. Read a file to include die in the GDS.</p>}
                </div>
                {!!dieImport.pattern?.outOfBounds.length && <p role="alert" className="mt-2 text-xs leading-5 text-destructive">{format(dieImport.pattern.outOfBounds.length)} die outside CoW. Export is blocked. Open Pattern graph to inspect.</p>}
                {dieImport.error && <p id="die-json-error" role="alert" className="mt-2 break-words text-xs text-destructive">{dieImport.error}</p>}
              </div>
            </section>
            <section className="min-w-0 space-y-4 rounded-lg border bg-card p-4" aria-labelledby="wafer-arrangement-heading">
              <div className="flex items-center gap-2.5"><span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-xs font-medium text-primary" aria-hidden="true">02</span>
                <div><h2 id="wafer-arrangement-heading" className="text-sm font-semibold">Wafer arrangement</h2><p className="mt-0.5 text-xs text-muted-foreground">Wafer limits, spacing and dummy layers.</p></div></div>
              <div><NumberField id="diameter" label="Allowable wafer diameter" value={draft.allowableDiameter} error={errors.diameter} onChange={value => update(current => ({ ...current, allowableDiameter: value }))} />
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Less than 300000 µm. The circle updates as you type.</p></div>
              <div className="grid grid-cols-2 gap-3">{(["x", "y"] as const).map(axis => <NumberField key={axis} id={`cow-space-${axis}`} label={`COW-to-COW space ${axis.toUpperCase()}`} zeroAllowed value={draft.cowSpacing[axis]} error={errors[`cow-space-${axis}`]}
                onChange={value => update(current => ({ ...current, cowSpacing: { ...current.cowSpacing, [axis]: value } }))} />)}</div>
              <div><label htmlFor="arrange-type" className="mb-1 block text-xs font-medium">Arrange type</label>
                <select id="arrange-type" className={inputClass} value={draft.arrangeType} onChange={event => update(current => ({ ...current, arrangeType: event.target.value as WaferDraft["arrangeType"] }))}>
                  <option value="center">Center</option><option value="corner">Corner</option><option value="x_half">X half</option><option value="y_half">Y half</option>
                </select><p className="mt-1 text-xs leading-5 text-muted-foreground">Center aligns a COW center with the origin. Corner and half modes align gap centers. X/Y directions stay fixed.</p>
              </div>
              <section className="min-w-0 border-t pt-4" aria-labelledby="dummy-layers-heading">
                <div className="flex items-center justify-between gap-2"><h3 id="dummy-layers-heading" className="text-sm font-semibold">Dummy layers</h3>
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    const layer = newDummyLayer(`dummy-${++nextLayer.current}`);
                    update(current => ({ ...current, dummyLayers: [...current.dummyLayers, layer] }));
                  }}><Plus aria-hidden="true" />Add layer</Button></div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">Minimum spacing applies within each boundary COW cell. A is reserved on both sides before fitting die; B is the die gap, with B ≥ 3A.</p>
                {draft.dummyLayers.length === 0 && <p className="mt-3 text-xs text-muted-foreground">COW-only pattern. Add a layer to place dummy die.</p>}
                <div className="mt-3 space-y-3">{draft.dummyLayers.map((layer, index) => <div key={layer.id} className="min-w-0 rounded-md border bg-muted/20 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2"><span className="text-xs font-semibold">Layer {index + 1} <span className="ml-1 font-mono font-normal text-muted-foreground">413:{10 + index}</span></span>
                    <Button type="button" variant="ghost" size="icon-sm" title={`Remove dummy layer ${index + 1}`} aria-label={`Remove dummy layer ${index + 1}`} onClick={() => update(current => ({ ...current, dummyLayers: current.dummyLayers.filter(item => item.id !== layer.id) }))}><Trash2 aria-hidden="true" /></Button></div>
                  {(["size", "minSpacing"] as const).map(group => <div key={group} className="mb-3 grid grid-cols-2 gap-3 last:mb-0">{(["x", "y"] as const).map(axis => {
                    const id = `${layer.id}-${group === "size" ? "size" : "gap"}-${axis}`;
                    return <NumberField key={id} id={id} label={`${group === "size" ? "Size" : "Min. spacing"} ${axis.toUpperCase()}`} value={layer[group][axis]} error={errors[id]}
                      onChange={value => update(current => ({ ...current, dummyLayers: current.dummyLayers.map(item => item.id === layer.id ? { ...item, [group]: { ...item[group], [axis]: value } } : item) }))} />;
                  })}</div>)}
                </div>)}</div>
              </section>
              <Button type="submit" className="w-full" disabled={generating || exporting}>{generating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CircleDot aria-hidden="true" />}{generating ? "Generating…" : "Generate pattern"}</Button>
            </section>
          </fieldset>
        </form>

        <div className="min-w-0 space-y-4">
          <section aria-labelledby="pattern-heading" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="pattern-heading" className="text-sm font-semibold">Pattern preview</h2>
              <span role="status" className={`text-xs ${stale ? "text-amber-800" : "text-muted-foreground"}`}>{generating ? "Generating pattern…" : stale ? "Parameters changed · Generate to update" : preview ? "Pattern ready · 1 nm grid" : "Enter parameters to generate a pattern"}</span></div>
            {preview ? <>
              <div className="mb-3 grid grid-cols-3 gap-2">{[["Complete COW", format(preview.pattern.cowCount)], ["COW area", `${(preview.pattern.cowAreaUtilization * 100).toFixed(1)}%`], ["Dummy die", format(preview.pattern.dummyLayers.reduce((sum, layer) => sum + layer.count, 0))]].map(([label, value]) => <div key={label} className="min-w-0 rounded-md border bg-card px-3 py-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-all font-mono text-lg font-semibold">{value}</p></div>)}</div>
              <WaferPatternPreview pattern={preview.pattern} allowableDiameter={guideDiameter} visible={visible} showCow={showCow} showBoundary={showBoundary} />
              <div className="mt-3 rounded-md border bg-card p-3">
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={showCow} onChange={event => setShowCow(event.target.checked)} />COW <span className="font-mono text-muted-foreground">100:100</span></label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showBoundary} onChange={event => setShowBoundary(event.target.checked)} />Boundary cells</label></div>
                {preview.pattern.dummyLayers.map((layer, index) => <div key={layer.datatype} className="mt-3 border-t pt-3">
                  <label className="flex flex-wrap items-center gap-2 text-xs"><input type="checkbox" checked={!!visible[index]} onChange={event => setVisible(current => current.map((value, i) => i === index ? event.target.checked : value))} />
                    <span className="size-2.5 rounded-sm" style={{ backgroundColor: DUMMY_COLORS[index % DUMMY_COLORS.length] }} aria-hidden="true" />Dummy layer {index + 1} <span className="font-mono text-muted-foreground">413:{layer.datatype} · {format(layer.count)} die</span></label>
                  <div className="mt-2 text-muted-foreground"><SpacingSummary axis={layer.x} name="X" /><SpacingSummary axis={layer.y} name="Y" /></div>
                </div>)}
                <p className="mt-3 text-xs text-muted-foreground">Visibility affects this preview only. Export includes all configured layers.</p>
              </div>
              {preview.pattern.warnings.length > 0 && <div role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900">{preview.pattern.warnings.map(message => <p key={message}>{message}</p>)}</div>}
            </> : <><WaferPatternPreview allowableDiameter={guideDiameter} />
              <p className="mt-2 text-xs leading-5 text-muted-foreground">Enter an allowable diameter to update the outline. Set the COW and dummy dimensions, then generate a pattern.</p></>}
          </section>
          <section className="min-w-0 rounded-md border bg-card p-4" aria-labelledby="export-heading">
            <h2 id="export-heading" className="text-sm font-semibold">Export GDS</h2>
            <label htmlFor="gds-output-path" className="mb-1 mt-3 block text-xs font-medium">Output file path</label>
            <input id="gds-output-path" type="text" className={`${inputClass} font-mono`} value={outputPath} disabled={exporting}
              placeholder="/absolute/path/wafer-arrangement.gds" aria-invalid={!!pathError} aria-describedby="gds-path-help gds-path-error"
              onChange={event => { setOutputPath(event.target.value); setPathError(null); setExportResult(null); }} />
            <p id="gds-path-help" className="mt-2 text-xs leading-5 text-muted-foreground">Use an absolute path on the API computer. The folder must exist. Export replaces an existing file after writing succeeds.</p>
            <p id="gds-path-error" role={pathError ? "alert" : undefined} className="mt-1 break-words text-xs text-destructive">{pathError}</p>
            <Button type="button" className="mt-3" disabled={!canExport} onClick={() => void exportGds()}>{exporting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}{exporting ? "Exporting…" : "Export GDS"}</Button>
            <div role="status" aria-live="polite" className="mt-2 min-w-0 text-xs leading-5">{exportResult && <><p className="font-medium text-primary">GDS exported · {format(exportResult.totalRectangles)} rectangles</p><p className="select-text break-all font-mono">{exportResult.outputPath}</p>
              {exportResult.dieCounts && Object.entries(exportResult.dieCounts).some(([, count]) => count > 0) && <p className="mt-1 break-words">COW die on wafer: {Object.entries(exportResult.dieCounts).filter(([, count]) => count > 0).map(([type, count]) => `${type.toUpperCase()} ${format(count)}`).join(" · ")}</p>}</>}</div>
          </section>
        </div>
      </div>
    </div>
    {showCowGraph && <EditorDialog title="CoW pattern graph" description={dieImport.fileName} onClose={() => setShowCowGraph(false)} returnFocus={cowGraphButton} className="max-w-3xl">
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
        {dieImport.pattern ? <CowDiePreview pattern={dieImport.pattern} /> : <p role="status" className="text-sm text-muted-foreground">{dieImport.loading ? "Reading and checking die JSON…" : dieImport.error ?? "Read a JSON file to view its die layout."}</p>}
      </div>
    </EditorDialog>}
  </main>;
}
