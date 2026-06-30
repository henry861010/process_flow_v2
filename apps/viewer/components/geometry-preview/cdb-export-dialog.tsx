"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Database, Loader2, X } from "lucide-react";

import {
  createCdbExportJob,
  getCdbExportClientId,
  type CdbExportJob,
} from "@/components/geometry-preview/cdb-export-client";
import { Button } from "@/components/ui/button";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function CdbExportDialog({
  geometryStructure,
  sourceLabel,
  onClose,
  onJobCreated,
}: {
  geometryStructure: unknown;
  sourceLabel: string;
  onClose: () => void;
  onJobCreated: (job: CdbExportJob) => void;
}) {
  const [portalReady, setPortalReady] = React.useState(false);
  const [elementSize, setElementSize] = React.useState("500");
  const [outputPath, setOutputPath] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setPortalReady(true);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const parsedElementSize = Number(elementSize);
    const trimmedOutputPath = outputPath.trim();
    const validationError = validateCdbExportForm(
      parsedElementSize,
      trimmedOutputPath,
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const job = await createCdbExportJob({
        clientId: getCdbExportClientId(),
        geometryStructure,
        elementSize: parsedElementSize,
        outputPath: trimmedOutputPath,
        sourceLabel,
      });
      onJobCreated(job);
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create CDB export job.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!portalReady) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/35"
        onClick={submitting ? undefined : onClose}
      />
      <form
        className="relative z-10 w-[min(520px,calc(100vw-32px))] overflow-hidden rounded-md border bg-background shadow-viewport"
        onSubmit={submit}
      >
        <header className="flex items-center justify-between gap-3 border-b bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground [&_svg]:h-4 [&_svg]:w-4">
              <Database />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">Export CDB</h3>
              <p className="truncate text-xs text-muted-foreground">
                {sourceLabel}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Close"
            disabled={submitting}
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="space-y-4 px-4 py-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Element size
            </span>
            <input
              className={inputClass}
              inputMode="decimal"
              value={elementSize}
              disabled={submitting}
              onChange={(event) => setElementSize(event.target.value)}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Output path
            </span>
            <input
              className={inputClass}
              value={outputPath}
              disabled={submitting}
              placeholder="/Users/henry/Desktop/model.cdb"
              onChange={(event) => setOutputPath(event.target.value)}
            />
          </label>

          {error ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t bg-white px-4 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <Database />}
            Export
          </Button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}

function validateCdbExportForm(elementSize: number, outputPath: string) {
  if (!Number.isFinite(elementSize) || elementSize <= 0) {
    return "Element size must be greater than 0.";
  }
  if (!outputPath) {
    return "Output path is required.";
  }
  if (!outputPath.startsWith("/")) {
    return "Output path must be absolute.";
  }
  if (!/\.cdb$/i.test(outputPath)) {
    return "Output path must use a .cdb file extension.";
  }
  return null;
}
