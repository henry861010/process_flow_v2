"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PlacementValidationSummary } from "@/lib/process-flow/placement-validation";
import { cn } from "@/lib/utils";
import type { GdsTargetRegion } from "./gds-coordinate-geometry";
import {
  duplicateGdsImportCriterionKeys,
  gdsImportCriterionKey,
  parseGdsIntegerInput,
  type CellNameFilterMode,
  type GdsImportCriterion,
} from "./gds-import-criteria";

export type CoordinatePair = [number, number];
export type CoordinateBounds = [CoordinatePair, CoordinatePair];
export type { GdsTargetRegion } from "./gds-coordinate-geometry";

type GdsImportResponse =
  | {
      type: "success";
      requestId: string;
      regions: GdsTargetRegion[];
      matchedElements: number;
      duplicatesRemoved: number;
      repairedElements: number;
      boundingBoxFallbacks: number;
      nonOrthogonalRegions: number;
      topCellNames: string[];
      unsupportedElements: Record<string, number>;
      unresolvedReferences: number;
      cyclicReferences: number;
    }
  | { type: "error"; requestId: string; message: string };

type ImportSummary = Extract<GdsImportResponse, { type: "success" }> & {
  validation: PlacementValidationSummary;
};

type GdsImportCriterionDraft = {
  id: number;
  layer: string;
  datatype: string;
  cellNameFilterMode: CellNameFilterMode;
  cellNameFilterValue: string;
};

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-2.5 py-1.5 text-sm tabular-nums shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function GdsPlacementImport({
  unit,
  onImport,
}: {
  unit?: string | null;
  onImport: (regions: GdsTargetRegion[]) => PlacementValidationSummary;
}) {
  const [portalReady, setPortalReady] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [gdsFile, setGdsFile] = React.useState<File | null>(null);
  const [criteria, setCriteria] = React.useState<GdsImportCriterionDraft[]>(() => [
    emptyCriterionDraft(0),
  ]);
  const [defeature, setDefeature] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const workerRef = React.useRef<Worker | null>(null);
  const activeRequestIdRef = React.useRef<string | null>(null);
  const nextCriterionIdRef = React.useRef(1);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const dialogRef = React.useRef<HTMLFormElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const isImportingRef = React.useRef(false);
  const dialogId = React.useId();
  const titleId = React.useId();
  const descriptionId = React.useId();

  isImportingRef.current = isImporting;

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  React.useEffect(() => {
    if (!dialogOpen) return;

    const trigger = triggerRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      fileInputRef.current?.focus();
    });
    const handleDialogKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!isImportingRef.current) setDialogOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleDialogKeyDown, true);
      trigger?.focus();
    };
  }, [dialogOpen]);

  React.useEffect(
    () => () => {
      activeRequestIdRef.current = null;
      workerRef.current?.terminate();
    },
    [],
  );

  const parsedCriteria = criteria.map(parseCriterionDraft);
  const completeCriteria = parsedCriteria.filter(
    (criterion): criterion is GdsImportCriterion => criterion !== null,
  );
  const duplicateKeys = duplicateGdsImportCriterionKeys(completeCriteria);
  const importCriteria =
    completeCriteria.length === criteria.length && duplicateKeys.size === 0
      ? completeCriteria
      : null;
  const importDisabled = !gdsFile || !importCriteria;

  function clearFeedback() {
    setSummary(null);
    setError(null);
  }

  function updateCriterion(
    id: number,
    update: Partial<Omit<GdsImportCriterionDraft, "id">>,
  ) {
    setCriteria((current) =>
      current.map((criterion) =>
        criterion.id === id ? { ...criterion, ...update } : criterion,
      ),
    );
    clearFeedback();
  }

  function addCriterion() {
    const id = nextCriterionIdRef.current;
    nextCriterionIdRef.current += 1;
    setCriteria((current) => [...current, emptyCriterionDraft(id)]);
    clearFeedback();
  }

  function removeCriterion(id: number) {
    setCriteria((current) =>
      current.length > 1
        ? current.filter((criterion) => criterion.id !== id)
        : current,
    );
    clearFeedback();
  }

  async function handleImport() {
    if (!gdsFile || !importCriteria) {
      return;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsImporting(true);
    setError(null);
    setSummary(null);
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    try {
      const buffer = await gdsFile.arrayBuffer();
      if (activeRequestIdRef.current !== requestId) return;
      const worker = new Worker(
        new URL("./gds-coordinate-import.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<GdsImportResponse>) => {
        if (
          event.data.requestId !== requestId ||
          activeRequestIdRef.current !== requestId
        ) {
          return;
        }
        worker.terminate();
        workerRef.current = null;
        activeRequestIdRef.current = null;
        setIsImporting(false);
        if (event.data.type === "error") {
          setError(event.data.message);
          return;
        }
        const validation = onImport(event.data.regions);
        setSummary({ ...event.data, validation });
        setDialogOpen(false);
      };
      worker.onerror = (event) => {
        if (activeRequestIdRef.current !== requestId) return;
        worker.terminate();
        workerRef.current = null;
        activeRequestIdRef.current = null;
        setIsImporting(false);
        setError(event.message || "GDS import failed.");
      };
      worker.postMessage(
        {
          requestId,
          buffer,
          criteria: importCriteria,
          unit,
          defeature: defeature || undefined,
        },
        [buffer],
      );
    } catch (reason) {
      if (activeRequestIdRef.current !== requestId) return;
      activeRequestIdRef.current = null;
      setIsImporting(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="space-y-2">
      <Button
        ref={triggerRef}
        type="button"
        size="sm"
        variant="outline"
        aria-controls={dialogId}
        aria-expanded={dialogOpen}
        aria-haspopup="dialog"
        onClick={() => {
          setError(null);
          setDialogOpen(true);
        }}
      >
        <FileUp />
        Import from GDS
      </Button>

      {summary ? (
        <div
          role={summary.validation.invalidPlacements > 0 ? "alert" : "status"}
          className={cn(
            "flex gap-2 rounded-md border p-2 text-xs",
            summary.validation.invalidPlacements > 0
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-emerald-200 bg-emerald-50 text-emerald-800",
          )}
        >
          {summary.validation.invalidPlacements > 0 ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          )}
          <span>
            Imported {summary.regions.length} target regions from {summary.matchedElements} matching elements.
            {summary.duplicatesRemoved > 0
              ? ` ${summary.duplicatesRemoved} duplicates removed.`
              : ""}
            {summary.repairedElements > 0
              ? ` ${summary.repairedElements} non-axis-aligned elements repaired.`
              : ""}
            {summary.boundingBoxFallbacks > 0
              ? ` ${summary.boundingBoxFallbacks} ${summary.boundingBoxFallbacks === 1 ? "element" : "elements"} used bounding-box fallback.`
              : ""}
            {summary.validation.invalidPlacements > 0
              ? ` ${summary.validation.invalidPlacements} of ${summary.validation.totalPlacements} imported ${summary.validation.totalPlacements === 1 ? "placement does" : "placements do"} not meet placement rules. Review the highlighted ${summary.validation.invalidPlacements === 1 ? "placement" : "placements"} below.`
              : ""}
          </span>
        </div>
      ) : null}
      {summary && summary.nonOrthogonalRegions > 0 ? (
        <div role="status" className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {summary.nonOrthogonalRegions} imported {summary.nonOrthogonalRegions === 1 ? "region has" : "regions have"} non-axis-aligned edges and may not be supported by the mesher.
          </span>
        </div>
      ) : null}

      {portalReady
        ? createPortal(
            <div
              aria-hidden={!dialogOpen}
              className={cn(
                "fixed inset-0 z-[100] flex items-center justify-center p-4",
                !dialogOpen && "hidden",
              )}
            >
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-foreground/40"
                onClick={isImporting ? undefined : () => setDialogOpen(false)}
              />
              <form
                ref={dialogRef}
                id={dialogId}
                aria-describedby={descriptionId}
                aria-labelledby={titleId}
                aria-modal="true"
                className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(900px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
                role="dialog"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!importDisabled) void handleImport();
                }}
              >
                <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FileUp className="h-5 w-5 text-primary" />
                      <h2 id={titleId} className="text-lg font-semibold">
                        Import placements from GDS
                      </h2>
                    </div>
                    <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
                      Choose the GDS patterns to import. A successful import replaces all current placements.
                    </p>
                  </div>
                  <Button
                    aria-label="Close GDS import dialog"
                    disabled={isImporting}
                    size="icon"
                    title="Close"
                    type="button"
                    variant="ghost"
                    onClick={() => setDialogOpen(false)}
                  >
                    <X />
                  </Button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                  <label className="block min-w-0 text-sm">
                    <span className="mb-1 block font-medium">GDS file</span>
                    <input
                      ref={fileInputRef}
                      className={cn(
                        inputClass,
                        "h-auto file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium",
                      )}
                      type="file"
                      accept=".gds,.gdsii,.strm,.stream,application/octet-stream"
                      onChange={(event) => {
                        setGdsFile(event.target.files?.[0] ?? null);
                        clearFeedback();
                      }}
                    />
                  </label>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {gdsFile?.name ?? "No file selected"}
                  </p>

                  <div className="mt-4 space-y-2" aria-label="GDS layer and datatype patterns">
                    {criteria.map((criterion, index) => {
                      const parsedLayer = parseGdsIntegerInput(criterion.layer);
                      const parsedDatatype = parseGdsIntegerInput(criterion.datatype);
                      const hasInvalidPair = parsedLayer === null || parsedDatatype === null;
                      const isDuplicate =
                        parsedLayer !== null &&
                        parsedDatatype !== null &&
                        duplicateKeys.has(gdsImportCriterionKey(parsedLayer, parsedDatatype));
                      const diagnostic = hasInvalidPair
                        ? "Layer and datatype must be non-negative integers."
                        : isDuplicate
                          ? "This layer/datatype pattern is duplicated."
                          : null;
                      const patternNumber = index + 1;

                      return (
                        <section
                          key={criterion.id}
                          className={cn(
                            "rounded-md border bg-muted/10 p-3",
                            diagnostic && "border-destructive/40",
                          )}
                          aria-label={`Pattern ${patternNumber}`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">Pattern {patternNumber}</span>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              disabled={criteria.length === 1}
                              aria-label={`Remove pattern ${patternNumber}`}
                              onClick={() => removeCriterion(criterion.id)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-[110px_110px_150px_minmax(0,1fr)]">
                            <NumberField
                              label="Layer"
                              ariaLabel={`Pattern ${patternNumber} layer`}
                              value={criterion.layer}
                              invalid={parsedLayer === null}
                              onChange={(layer) => updateCriterion(criterion.id, { layer })}
                            />
                            <NumberField
                              label="Datatype"
                              ariaLabel={`Pattern ${patternNumber} datatype`}
                              value={criterion.datatype}
                              invalid={parsedDatatype === null}
                              onChange={(datatype) =>
                                updateCriterion(criterion.id, { datatype })
                              }
                            />
                            <label className="text-sm">
                              <span className="mb-1 block font-medium">Cell name filter</span>
                              <select
                                className={inputClass}
                                aria-label={`Pattern ${patternNumber} cell name filter`}
                                value={criterion.cellNameFilterMode}
                                onChange={(event) =>
                                  updateCriterion(criterion.id, {
                                    cellNameFilterMode: event.target.value as CellNameFilterMode,
                                  })
                                }
                              >
                                <option value="include">Include</option>
                                <option value="exclude">Exclude</option>
                              </select>
                            </label>
                            <label className="min-w-0 text-sm">
                              <span className="mb-1 block font-medium">Cell name contains</span>
                              <input
                                className={inputClass}
                                aria-label={`Pattern ${patternNumber} cell name contains`}
                                value={criterion.cellNameFilterValue}
                                onChange={(event) =>
                                  updateCriterion(criterion.id, {
                                    cellNameFilterValue: event.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>
                          {diagnostic ? (
                            <p className="mt-2 text-xs text-destructive" role="alert">
                              {diagnostic}
                            </p>
                          ) : null}
                        </section>
                      );
                    })}
                    <div className="flex justify-end">
                      <Button type="button" size="sm" variant="outline" onClick={addCriterion}>
                        <Plus />
                        Add pattern
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-md border bg-muted/20 p-3">
                    <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                        checked={defeature}
                        onChange={(event) => {
                          setDefeature(event.target.checked);
                          clearFeedback();
                        }}
                      />
                      <span>
                        <span className="block font-medium">Defeature</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Repair non-axis-aligned boundaries into orthogonal placement outlines.
                        </span>
                      </span>
                    </label>
                  </div>

                  {error ? (
                    <div role="alert" className="mt-4 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  ) : null}
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-5 py-3">
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {gdsFile?.name ?? "No file selected"}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isImporting}
                      onClick={() => setDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={importDisabled}
                      aria-busy={isImporting}
                    >
                      {isImporting ? <Loader2 className="animate-spin" /> : <FileUp />}
                      Import and replace
                    </Button>
                  </div>
                </footer>
              </form>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function NumberField({
  label,
  ariaLabel,
  value,
  invalid,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        className={cn(inputClass, invalid && "border-destructive/50")}
        type="number"
        min={0}
        step={1}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function emptyCriterionDraft(id: number): GdsImportCriterionDraft {
  return {
    id,
    layer: "",
    datatype: "",
    cellNameFilterMode: "include",
    cellNameFilterValue: "",
  };
}

function parseCriterionDraft(
  criterion: GdsImportCriterionDraft,
): GdsImportCriterion | null {
  const layer = parseGdsIntegerInput(criterion.layer);
  const datatype = parseGdsIntegerInput(criterion.datatype);
  if (layer === null || datatype === null) return null;

  const contains = criterion.cellNameFilterValue.trim();
  return {
    layer,
    datatype,
    cellNameFilter: contains
      ? { mode: criterion.cellNameFilterMode, contains }
      : undefined,
  };
}
