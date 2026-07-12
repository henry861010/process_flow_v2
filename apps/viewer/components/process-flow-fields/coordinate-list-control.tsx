"use client";

import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileUp,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  analyzeCoordinateRows,
  emptyCoordinateRow,
  normalizeCoordinateRows,
  type CoordinateDraftCell,
  type CoordinateDraftRow,
  type CoordinateBounds,
} from "./coordinate-list-value";

type CoordinateListControlProps = {
  value: unknown;
  unit?: string | null;
  onChange: (value: unknown) => void;
};

type GdsImportResponse =
  | {
      type: "success";
      requestId: string;
      coordinates: CoordinateBounds[];
      matchedElements: number;
      duplicatesRemoved: number;
      topCellNames: string[];
      unsupportedElements: Record<string, number>;
      unresolvedReferences: number;
      cyclicReferences: number;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };

type ImportSummary = Extract<GdsImportResponse, { type: "success" }>;

const coordinateInputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function CoordinateListControl({
  value,
  unit,
  onChange,
}: CoordinateListControlProps) {
  const rows = React.useMemo(() => normalizeCoordinateRows(value), [value]);
  const diagnostics = React.useMemo(() => analyzeCoordinateRows(rows), [rows]);
  const [gdsFile, setGdsFile] = React.useState<File | null>(null);
  const [layer, setLayer] = React.useState("");
  const [datatype, setDatatype] = React.useState("");
  const [isImporting, setIsImporting] = React.useState(false);
  const [importSummary, setImportSummary] = React.useState<ImportSummary | null>(
    null,
  );
  const [importError, setImportError] = React.useState<string | null>(null);
  const workerRef = React.useRef<Worker | null>(null);

  React.useEffect(
    () => () => {
      workerRef.current?.terminate();
    },
    [],
  );

  const updateRows = (updater: (current: CoordinateDraftRow[]) => CoordinateDraftRow[]) => {
    onChange(updater(rows));
    setImportSummary(null);
  };

  const parsedLayer = parseIntegerInput(layer);
  const parsedDatatype = parseIntegerInput(datatype);
  const importDisabled =
    !gdsFile ||
    parsedLayer === null ||
    parsedDatatype === null ||
    isImporting;

  const handleImport = async () => {
    if (!gdsFile || parsedLayer === null || parsedDatatype === null) {
      return;
    }
    setIsImporting(true);
    setImportError(null);
    setImportSummary(null);
    workerRef.current?.terminate();

    const requestId = crypto.randomUUID();
    try {
      const buffer = await gdsFile.arrayBuffer();
      const worker = new Worker(
        new URL("./gds-coordinate-import.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<GdsImportResponse>) => {
        if (event.data.requestId !== requestId) {
          return;
        }
        worker.terminate();
        workerRef.current = null;
        setIsImporting(false);
        if (event.data.type === "error") {
          setImportError(event.data.message);
          return;
        }
        onChange(event.data.coordinates);
        setImportSummary(event.data);
      };
      worker.onerror = (event) => {
        worker.terminate();
        workerRef.current = null;
        setIsImporting(false);
        setImportError(event.message || "GDS import failed.");
      };
      worker.postMessage(
        {
          requestId,
          buffer,
          layer: parsedLayer,
          datatype: parsedDatatype,
          unit,
        },
        [buffer],
      );
    } catch (error) {
      setIsImporting(false);
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Tabs defaultValue="manual" className="min-w-0">
      <TabsList>
        <TabsTrigger value="manual">Manual</TabsTrigger>
        <TabsTrigger value="gds">GDS</TabsTrigger>
      </TabsList>

      <TabsContent value="manual">
        <div className="rounded-md border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div className="text-sm font-medium">
              {rows.length} {rows.length === 1 ? "coordinate" : "coordinates"}
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => updateRows((current) => [...current, emptyCoordinateRow()])}
            >
              <Plus />
              Add die
            </Button>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {rows.length === 0 ? (
              <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
                No coordinates
              </div>
            ) : (
              rows.map((row, index) => (
                <CoordinateRowEditor
                  key={index}
                  index={index}
                  row={row}
                  unit={unit}
                  invalid={diagnostics.invalidRowIndexes.includes(index)}
                  invalidBounds={diagnostics.invalidBoundsRowIndexes.includes(index)}
                  duplicate={diagnostics.duplicateRowIndexes.includes(index)}
                  onChange={(pointIndex, axisIndex, nextValue) =>
                    updateRows((current) =>
                      current.map((candidate, candidateIndex) =>
                        candidateIndex === index
                          ? candidate.map((point, currentPointIndex) =>
                              currentPointIndex === pointIndex
                                ? point.map((cell, currentAxisIndex) =>
                                    currentAxisIndex === axisIndex
                                      ? nextValue
                                      : cell,
                                  )
                                : point,
                            ) as CoordinateDraftRow
                          : candidate,
                      ),
                    )
                  }
                  onRemove={() =>
                    updateRows((current) =>
                      current.filter((_, candidateIndex) => candidateIndex !== index),
                    )
                  }
                />
              ))
            )}
          </div>
        </div>
        <CoordinateDiagnostics
          invalidRowIndexes={diagnostics.invalidRowIndexes}
          invalidBoundsRowIndexes={diagnostics.invalidBoundsRowIndexes}
          duplicateRowIndexes={diagnostics.duplicateRowIndexes}
        />
      </TabsContent>

      <TabsContent value="gds">
        <div className="rounded-md border bg-white p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_110px_110px]">
            <label className="min-w-0 text-sm">
              <span className="mb-1 block font-medium">GDS file</span>
              <input
                className={cn(
                  coordinateInputClass,
                  "h-auto file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium",
                )}
                type="file"
                accept=".gds,.gdsii,.strm,.stream,application/octet-stream"
                onChange={(event) => {
                  setGdsFile(event.target.files?.[0] ?? null);
                  setImportSummary(null);
                  setImportError(null);
                }}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Layer</span>
              <input
                className={coordinateInputClass}
                type="number"
                min={0}
                step={1}
                value={layer}
                onChange={(event) => setLayer(event.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Datatype</span>
              <input
                className={coordinateInputClass}
                type="number"
                min={0}
                step={1}
                value={datatype}
                onChange={(event) => setDatatype(event.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {gdsFile ? gdsFile.name : "No file selected"}
            </div>
            <Button type="button" disabled={importDisabled} onClick={handleImport}>
              {isImporting ? <Loader2 className="animate-spin" /> : <FileUp />}
              Import and replace
            </Button>
          </div>
        </div>
        <ImportFeedback summary={importSummary} error={importError} />
      </TabsContent>
    </Tabs>
  );
}

function CoordinateRowEditor({
  index,
  row,
  unit,
  invalid,
  invalidBounds,
  duplicate,
  onChange,
  onRemove,
}: {
  index: number;
  row: CoordinateDraftRow;
  unit?: string | null;
  invalid: boolean;
  invalidBounds: boolean;
  duplicate: boolean;
  onChange: (
    pointIndex: 0 | 1,
    axisIndex: 0 | 1,
    value: CoordinateDraftCell,
  ) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[52px_minmax(0,1fr)_36px] items-end gap-2 rounded-md border p-2 max-sm:grid-cols-[44px_minmax(0,1fr)_36px]",
        invalid || invalidBounds || duplicate
          ? "border-destructive/60 bg-destructive/5"
          : "bg-muted/10",
      )}
    >
      <div className="pb-2 text-xs font-medium text-muted-foreground">
        #{index + 1}
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-4">
        <CoordinateNumberInput
          label="Lower-left X"
          value={row[0][0]}
          unit={unit}
          onChange={(nextValue) => onChange(0, 0, nextValue)}
        />
        <CoordinateNumberInput
          label="Lower-left Y"
          value={row[0][1]}
          unit={unit}
          onChange={(nextValue) => onChange(0, 1, nextValue)}
        />
        <CoordinateNumberInput
          label="Upper-right X"
          value={row[1][0]}
          unit={unit}
          onChange={(nextValue) => onChange(1, 0, nextValue)}
        />
        <CoordinateNumberInput
          label="Upper-right Y"
          value={row[1][1]}
          unit={unit}
          onChange={(nextValue) => onChange(1, 1, nextValue)}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9"
        aria-label={`Remove coordinate ${index + 1}`}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
      {duplicate ? (
        <div className="col-span-3 text-xs text-destructive">
          Duplicate coordinate
        </div>
      ) : null}
      {invalid ? (
        <div className="col-span-3 text-xs text-destructive">
          All lower-left and upper-right values must be finite numbers
        </div>
      ) : null}
      {invalidBounds ? (
        <div className="col-span-3 text-xs text-destructive">
          Upper-right must be greater than lower-left on both axes
        </div>
      ) : null}
    </div>
  );
}

function CoordinateNumberInput({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: CoordinateDraftCell;
  unit?: string | null;
  onChange: (value: CoordinateDraftCell) => void;
}) {
  return (
    <label className="min-w-0 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          className={coordinateInputClass}
          type="number"
          step="any"
          value={value === "" ? "" : String(value)}
          onChange={(event) => onChange(parseCoordinateInput(event.target.value))}
        />
        {unit ? <span className="shrink-0">{unit}</span> : null}
      </div>
    </label>
  );
}

function CoordinateDiagnostics({
  invalidRowIndexes,
  invalidBoundsRowIndexes,
  duplicateRowIndexes,
}: {
  invalidRowIndexes: number[];
  invalidBoundsRowIndexes: number[];
  duplicateRowIndexes: number[];
}) {
  if (
    invalidRowIndexes.length === 0 &&
    invalidBoundsRowIndexes.length === 0 &&
    duplicateRowIndexes.length === 0
  ) {
    return null;
  }
  return (
    <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          {invalidRowIndexes.length > 0 ? (
            <div>Invalid rows: {formatRowIndexes(invalidRowIndexes)}</div>
          ) : null}
          {invalidBoundsRowIndexes.length > 0 ? (
            <div>
              Invalid bounds rows: {formatRowIndexes(invalidBoundsRowIndexes)}
            </div>
          ) : null}
          {duplicateRowIndexes.length > 0 ? (
            <div>Duplicate rows: {formatRowIndexes(duplicateRowIndexes)}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ImportFeedback({
  summary,
  error,
}: {
  summary: ImportSummary | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }
  if (!summary) {
    return null;
  }

  const unsupportedEntries = Object.entries(summary.unsupportedElements);
  return (
    <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="space-y-1">
          <div>
            Imported {summary.coordinates.length} coordinates from{" "}
            {summary.matchedElements} matching elements.
          </div>
          <div className="text-emerald-800">
            Top cells: {formatTopCells(summary.topCellNames)}
          </div>
          {summary.duplicatesRemoved > 0 ? (
            <div>{summary.duplicatesRemoved} duplicate coordinates removed.</div>
          ) : null}
          {unsupportedEntries.length > 0 ? (
            <div>
              Unsupported matched elements:{" "}
              {unsupportedEntries
                .map(([kind, count]) => `${kind} ${count}`)
                .join(", ")}
            </div>
          ) : null}
          {summary.unresolvedReferences > 0 ? (
            <div>{summary.unresolvedReferences} unresolved references skipped.</div>
          ) : null}
          {summary.cyclicReferences > 0 ? (
            <div>{summary.cyclicReferences} cyclic references skipped.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function parseCoordinateInput(value: string): CoordinateDraftCell {
  if (value.trim() === "") {
    return "";
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : "";
}

function parseIntegerInput(value: string) {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function formatRowIndexes(indexes: number[]) {
  return indexes.map((index) => index + 1).join(", ");
}

function formatTopCells(topCellNames: string[]) {
  if (topCellNames.length === 0) {
    return "none";
  }
  const visibleNames = topCellNames.slice(0, 4);
  const hiddenCount = topCellNames.length - visibleNames.length;
  return hiddenCount > 0
    ? `${visibleNames.join(", ")} +${hiddenCount}`
    : visibleNames.join(", ");
}
