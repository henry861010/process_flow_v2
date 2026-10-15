"use client";

import * as React from "react";
import { FileUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  createCsvColumnMapping,
  importRepeatableGroupCsv,
  inspectRepeatableGroupCsv,
  validateCsvColumnMapping,
  type CsvColumnMapping,
  type RepeatableGroupCsvInspection,
} from "@/lib/process-flow/repeatable-group-csv";
import type { ParameterDefinition, RepeatableGroupValue } from "@/lib/process-flow/types";

type PendingImport = {
  fileName: string;
  text: string;
  inspection: RepeatableGroupCsvInspection;
  definition: ParameterDefinition;
  value: unknown;
  request: object;
};

export function RepeatableGroupCsvImport({
  definition,
  value,
  disabled,
  onImport,
}: {
  definition: ParameterDefinition;
  value: unknown;
  disabled: boolean;
  onImport: (value: RepeatableGroupValue) => void;
}) {
  const [isImporting, setIsImporting] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState<PendingImport | null>(null);
  const [mapping, setMapping] = React.useState<CsvColumnMapping>({});
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const importButtonRef = React.useRef<HTMLButtonElement>(null);
  const mappingRef = React.useRef<HTMLDivElement>(null);
  const errorRef = React.useRef<HTMLParagraphElement>(null);
  const activeRequestRef = React.useRef<object | null>(null);
  const latestPropsRef = React.useRef({ definition, value, disabled, onImport });
  const descriptionId = React.useId();
  const mappingId = React.useId();
  const fields = definition.repeatDefinition!.itemParameterDefinitions;
  const mappingIssues = pending ? validateCsvColumnMapping(definition, pending.inspection.headers, mapping) : [];
  const selectedColumns = new Set(Object.values(mapping).filter((column) => column != null));
  const ignoredColumns = pending?.inspection.headers.filter((column) => !selectedColumns.has(column)) ?? [];

  React.useLayoutEffect(() => {
    latestPropsRef.current = { definition, value, disabled, onImport };
  });

  React.useLayoutEffect(() => {
    // Edits elsewhere invalidate both an in-flight read and a pending mapping.
    if (activeRequestRef.current) {
      activeRequestRef.current = null;
      setIsImporting(false);
      setPending(null);
      setMapping({});
      setError("");
      setStatus("CSV import cancelled because the group changed.");
    }
  }, [definition, value, disabled]);

  React.useEffect(() => () => {
    activeRequestRef.current = null;
  }, []);

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  React.useEffect(() => {
    if (pending) mappingRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
  }, [pending]);

  function cancelImport() {
    activeRequestRef.current = null;
    setIsImporting(false);
    setPending(null);
    setMapping({});
    setError("");
    setStatus("CSV import cancelled. Current items were kept.");
    importButtonRef.current?.focus();
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Clearing immediately allows selecting the same file again, even after an error.
    event.currentTarget.value = "";
    if (!file || disabled || isImporting) return;
    const request = {};
    const original = { definition, value };
    activeRequestRef.current = request;
    setIsImporting(true);
    setStatus("");
    setError("");
    setPending(null);
    setMapping({});

    function isCurrent() {
      const latest = latestPropsRef.current;
      return activeRequestRef.current === request && !latest.disabled &&
        latest.definition === original.definition && latest.value === original.value;
    }

    try {
      const text = await file.text();
      if (!isCurrent()) return;
      const inspection = inspectRepeatableGroupCsv(definition, text);
      setPending({ fileName: file.name, text, inspection, definition, value, request });
      setMapping(createCsvColumnMapping(definition, inspection.headers));
      setIsImporting(false);
      setStatus(`Read ${inspection.rows.length} items from ${file.name}. Review the column mapping, then confirm import.`);
    } catch (cause) {
      if (!isCurrent()) return;
      activeRequestRef.current = null;
      setIsImporting(false);
      setError(cause instanceof Error ? cause.message : "Unable to read the CSV file.");
    }
  }

  function confirmImport() {
    const latest = latestPropsRef.current;
    if (!pending || latest.disabled || activeRequestRef.current !== pending.request ||
        latest.definition !== pending.definition || latest.value !== pending.value || mappingIssues.length) return;
    setError("");
    try {
      const imported = importRepeatableGroupCsv(definition, pending.text, mapping);
      activeRequestRef.current = null;
      setPending(null);
      setMapping({});
      setStatus(`Imported ${imported.items.length} items from ${pending.fileName}. Previous items were replaced.`);
      latest.onImport(imported);
      importButtonRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import the CSV file.");
      // Repeated submission of the same invalid file must also restore error focus.
      errorRef.current?.focus();
    }
  }

  return (
    <div className="mb-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
        <div id={descriptionId} className="min-w-0 flex-1 text-xs text-muted-foreground">
          <p>CSV target fields (parameter keys):</p>
          <code className="mt-1 block break-all text-foreground">
            {fields.map((field) => field.id).join(",")}
          </code>
          <p className="mt-1">Choose a CSV, map its columns, then confirm to replace all current items. Optional fields may be omitted.</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          disabled={disabled || isImporting}
          onChange={importFile}
        />
        <Button
          ref={importButtonRef}
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label={`Import CSV for ${definition.name}`}
          aria-describedby={descriptionId}
          disabled={disabled || isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          {isImporting ? <Loader2 aria-hidden="true" className="animate-spin" /> : <FileUp aria-hidden="true" />}
          {isImporting ? "Reading CSV…" : pending ? "Choose another CSV" : "Import CSV"}
        </Button>
      </div>
      <p role="status" aria-atomic="true" className="mt-2 text-xs text-muted-foreground">
        {isImporting ? "Reading CSV…" : status}
      </p>
      {pending ? (
        <div ref={mappingRef} className="mt-3 min-w-0 border-t pt-3">
          <p className="break-words text-sm font-medium">Column mapping</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {pending.fileName} · {pending.inspection.rows.length} items
          </p>
          <div className="mt-3 space-y-3">
            {fields.map((field, index) => {
              const selectId = `${mappingId}-${index}`;
              const issue = mappingIssues.find((issue) => issue.key === field.id);
              return (
                <div key={field.id} className="grid min-w-0 gap-1.5 sm:grid-cols-2 sm:gap-x-3">
                  <label htmlFor={selectId} className="min-w-0 break-words text-sm">
                    <span className="font-medium">{field.name}</span>
                    <span className="ml-1 text-xs text-muted-foreground">({field.required !== false ? "Required" : "Optional"})</span>
                    <code className="mt-0.5 block break-all text-xs text-muted-foreground">{field.id}</code>
                  </label>
                  <div className="min-w-0">
                    <select
                      id={selectId}
                      value={mapping[field.id] ?? ""}
                      disabled={disabled}
                      aria-required={field.required !== false}
                      aria-invalid={!!issue}
                      aria-describedby={issue ? `${selectId}-error` : undefined}
                      className="h-9 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                      onChange={(event) => {
                        setMapping((previous) => ({ ...previous, [field.id]: event.target.value || null }));
                        setError("");
                      }}
                    >
                      <option value="">{field.required !== false ? "Choose CSV column" : "Do not import"}</option>
                      {pending.inspection.headers.map((column) => (
                        <option key={column} value={column} disabled={column !== mapping[field.id] && selectedColumns.has(column)}>
                          {column}
                        </option>
                      ))}
                    </select>
                    {issue ? <p id={`${selectId}-error`} className="mt-1 break-words text-xs text-destructive">{issue.message}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 break-words text-xs text-muted-foreground" role="status" aria-atomic="true">
            {ignoredColumns.length ? `Columns that will be ignored: ${ignoredColumns.join(", ")}.` : "All CSV columns are mapped."}
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={cancelImport}>Cancel</Button>
            <Button type="button" size="sm" disabled={disabled || mappingIssues.length > 0} onClick={confirmImport}>Confirm import</Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p ref={errorRef} role="alert" tabIndex={-1} className="mt-2 break-words rounded-sm text-xs text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {error}
        </p>
      ) : null}
    </div>
  );
}
