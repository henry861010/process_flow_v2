"use client";

import * as React from "react";
import { FileUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { importRepeatableGroupCsv } from "@/lib/process-flow/repeatable-group-csv";
import type { ParameterDefinition, RepeatableGroupValue } from "@/lib/process-flow/types";

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
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const errorRef = React.useRef<HTMLParagraphElement>(null);
  const activeRequestRef = React.useRef<object | null>(null);
  const latestPropsRef = React.useRef({ definition, value, disabled, onImport });
  const descriptionId = React.useId();

  React.useLayoutEffect(() => {
    latestPropsRef.current = { definition, value, disabled, onImport };
  });

  React.useEffect(() => {
    // A change elsewhere in the editor invalidates an in-flight file read.
    if (activeRequestRef.current) {
      activeRequestRef.current = null;
      setIsImporting(false);
      setStatus("CSV import cancelled because the group changed.");
    }
  }, [definition, value, disabled]);

  React.useEffect(() => () => {
    activeRequestRef.current = null;
  }, []);

  React.useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Clearing immediately allows selecting the same file again, even after an error.
    event.currentTarget.value = "";
    if (!file || disabled || activeRequestRef.current) return;
    const request = {};
    const original = { definition, value };
    activeRequestRef.current = request;
    setIsImporting(true);
    setStatus("");
    setError("");

    function isCurrent() {
      const latest = latestPropsRef.current;
      return activeRequestRef.current === request && !latest.disabled &&
        latest.definition === original.definition && latest.value === original.value;
    }

    try {
      const text = await file.text();
      if (!isCurrent()) return;
      const imported = importRepeatableGroupCsv(definition, text);
      activeRequestRef.current = null;
      setIsImporting(false);
      setStatus(`Imported ${imported.items.length} items from ${file.name}. Previous items were replaced.`);
      latestPropsRef.current.onImport(imported);
    } catch (cause) {
      if (!isCurrent()) return;
      activeRequestRef.current = null;
      setIsImporting(false);
      setError(cause instanceof Error ? cause.message : "Unable to read the CSV file.");
    }
  }

  return (
    <div className="mb-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div id={descriptionId} className="min-w-0 flex-1 text-xs text-muted-foreground">
          <p>CSV headers (parameter keys):</p>
          <code className="mt-1 block break-all text-foreground">
            {definition.repeatDefinition!.itemParameterDefinitions.map((field) => field.id).join(",")}
          </code>
          <p className="mt-1">Each row becomes one item. Import replaces all current items. Optional fields may be omitted.</p>
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
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Import CSV for ${definition.name}`}
          aria-describedby={descriptionId}
          disabled={disabled || isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          {isImporting ? <Loader2 aria-hidden="true" className="animate-spin" /> : <FileUp aria-hidden="true" />}
          {isImporting ? "Importing…" : "Import CSV"}
        </Button>
      </div>
      <p role="status" aria-atomic="true" className="mt-2 text-xs text-muted-foreground">
        {isImporting ? "Reading CSV…" : status}
      </p>
      {error ? (
        <p ref={errorRef} role="alert" tabIndex={-1} className="mt-2 break-words rounded-sm text-xs text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {error}
        </p>
      ) : null}
    </div>
  );
}
