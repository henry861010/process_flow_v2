"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileUp,
  Loader2,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  GdsTargetRegion,
} from "./gds-coordinate-geometry";

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
      defeaturedElements: number;
      nonOrthogonalRegions: number;
      topCellNames: string[];
      unsupportedElements: Record<string, number>;
      unresolvedReferences: number;
      cyclicReferences: number;
    }
  | { type: "error"; requestId: string; message: string };

type ImportSummary = Extract<GdsImportResponse, { type: "success" }>;
type CellNameFilterMode = "include" | "exclude";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-2.5 py-1.5 text-sm tabular-nums shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function GdsPlacementImport({
  unit,
  onImport,
}: {
  unit?: string | null;
  onImport: (regions: GdsTargetRegion[]) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const [gdsFile, setGdsFile] = React.useState<File | null>(null);
  const [layer, setLayer] = React.useState("");
  const [datatype, setDatatype] = React.useState("");
  const [cellNameFilterMode, setCellNameFilterMode] =
    React.useState<CellNameFilterMode>("include");
  const [cellNameFilterValue, setCellNameFilterValue] = React.useState("");
  const [defeature, setDefeature] = React.useState(false);
  const [minimumFeatureSize, setMinimumFeatureSize] = React.useState("");
  const [isImporting, setIsImporting] = React.useState(false);
  const [summary, setSummary] = React.useState<ImportSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const workerRef = React.useRef<Worker | null>(null);
  const activeRequestIdRef = React.useRef<string | null>(null);
  const panelId = React.useId();

  React.useEffect(
    () => () => {
      activeRequestIdRef.current = null;
      workerRef.current?.terminate();
    },
    [],
  );

  const parsedLayer = parseIntegerInput(layer);
  const parsedDatatype = parseIntegerInput(datatype);
  const parsedMinimumFeatureSize = parsePositiveNumberInput(minimumFeatureSize);
  const importDisabled =
    !gdsFile ||
    parsedLayer === null ||
    parsedDatatype === null ||
    (defeature && parsedMinimumFeatureSize === null);

  async function handleImport() {
    if (
      !gdsFile ||
      parsedLayer === null ||
      parsedDatatype === null ||
      (defeature && parsedMinimumFeatureSize === null)
    ) {
      return;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsImporting(true);
    setError(null);
    setSummary(null);
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    const filterValue = cellNameFilterValue.trim();
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
        onImport(event.data.regions);
        setSummary(event.data);
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
          layer: parsedLayer,
          datatype: parsedDatatype,
          unit,
          cellNameFilter: filterValue
            ? { mode: cellNameFilterMode, contains: filterValue }
            : undefined,
          defeature:
            defeature && parsedMinimumFeatureSize !== null
              ? { minimumFeatureSize: parsedMinimumFeatureSize }
              : undefined,
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
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronUp /> : <ChevronDown />}
        Import from GDS
      </Button>

      {expanded ? (
        <section
          id={panelId}
          className="rounded-md border bg-white p-3"
          aria-label="GDS placement import"
        >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_110px_110px]">
        <label className="min-w-0 text-sm">
          <span className="mb-1 block font-medium">GDS file</span>
          <input
            className={cn(
              inputClass,
              "h-auto file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium",
            )}
            type="file"
            accept=".gds,.gdsii,.strm,.stream,application/octet-stream"
            onChange={(event) => {
              setGdsFile(event.target.files?.[0] ?? null);
              setSummary(null);
              setError(null);
            }}
          />
        </label>
        <NumberField label="Layer" value={layer} onChange={setLayer} />
        <NumberField label="Datatype" value={datatype} onChange={setDatatype} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Cell name filter</span>
          <select
            className={inputClass}
            value={cellNameFilterMode}
            onChange={(event) => {
              setCellNameFilterMode(event.target.value as CellNameFilterMode);
              setSummary(null);
              setError(null);
            }}
          >
            <option value="include">Include</option>
            <option value="exclude">Exclude</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Cell name contains</span>
          <input
            className={inputClass}
            value={cellNameFilterValue}
            onChange={(event) => {
              setCellNameFilterValue(event.target.value);
              setSummary(null);
              setError(null);
            }}
          />
        </label>
      </div>
      <div className="mt-3 rounded-md border bg-muted/20 p-3">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            checked={defeature}
            onChange={(event) => {
              setDefeature(event.target.checked);
              setSummary(null);
              setError(null);
            }}
          />
          <span>
            <span className="block font-medium">Defeature</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Remove small non-axis-aligned boundaries before creating placements.
            </span>
          </span>
        </label>
        {defeature ? (
          <label className="mt-3 block max-w-xs text-sm">
            <span className="mb-1 block font-medium">
              Minimum feature size{unit ? ` (${unit})` : ""}
            </span>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="any"
              value={minimumFeatureSize}
              aria-invalid={parsedMinimumFeatureSize === null}
              onChange={(event) => {
                setMinimumFeatureSize(event.target.value);
                setSummary(null);
                setError(null);
              }}
            />
            <span
              className={cn(
                "mt-1 block text-xs",
                parsedMinimumFeatureSize === null
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {parsedMinimumFeatureSize === null
                ? "Enter a finite number greater than zero."
                : "Non-axis-aligned regions smaller than this in both directions will be removed."}
            </span>
          </label>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {gdsFile?.name ?? "No file selected"}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={importDisabled}
          aria-busy={isImporting}
          onClick={handleImport}
        >
          {isImporting ? <Loader2 className="animate-spin" /> : <FileUp />}
          Import and replace
        </Button>
      </div>
      {summary ? (
        <div className="mt-3 flex gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span>
            Imported {summary.regions.length} target regions from {summary.matchedElements} matching elements.
            {summary.duplicatesRemoved > 0
              ? ` ${summary.duplicatesRemoved} duplicates removed.`
              : ""}
            {summary.defeaturedElements > 0
              ? ` ${summary.defeaturedElements} small non-axis-aligned elements defeatured.`
              : ""}
          </span>
        </div>
      ) : null}
      {summary && summary.nonOrthogonalRegions > 0 ? (
        <div role="status" className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {summary.nonOrthogonalRegions} imported {summary.nonOrthogonalRegions === 1 ? "region has" : "regions have"} non-axis-aligned edges and may not be supported by the mesher.
          </span>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-3 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
        </section>
      ) : null}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        className={inputClass}
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function parseIntegerInput(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveNumberInput(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
