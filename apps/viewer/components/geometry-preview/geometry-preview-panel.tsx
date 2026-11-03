"use client";

import * as React from "react";
import { Download, FileJson, Layers3, Loader2, X } from "lucide-react";

import {
  requestGeometryPreviewSession,
  type GeometryPreviewSession,
  type GeometryPreviewRequest,
  type GeometryPreviewSnapshot,
} from "@/components/geometry-preview/geometry-preview-client";
import { SchematicPreview } from "@/components/geometry-preview/schematic-preview";
import { ProcessExecutionWarnings } from "@/components/geometry-preview/process-execution-warnings";
import { FileExportDialog } from "@/components/geometry-preview/file-export-dialog";
import type {
  FileExportJob,
  FileExportKind,
} from "@/components/geometry-preview/file-export-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEditorDialogFocus } from "@/components/process-flow-save/editor-dialog";
import { cn } from "@/lib/utils";

export type GeometryPreviewContext = {
  previewId: string;
  sourceLabel: string;
  slotLabel: string;
  sourceKind: "flowInput" | "stepOutput";
  request: GeometryPreviewRequest;
};

type PanelState =
  | { status: "loading" }
  | { status: "ready"; session: GeometryPreviewSession }
  | { status: "error"; message: string };

export function GeometryPreviewPanel({
  preview,
  onClose,
  onFileExportJobCreated,
}: {
  preview: GeometryPreviewContext;
  onClose: () => void;
  onFileExportJobCreated?: (job: FileExportJob) => void;
}) {
  const [state, setState] = React.useState<PanelState>({ status: "loading" });
  const [fileExportDialogKind, setFileExportDialogKind] =
    React.useState<FileExportKind | null>(null);
  const panelRef = React.useRef<HTMLElement>(null);
  const titleId = React.useId();
  useEditorDialogFocus(panelRef, onClose, false);

  React.useEffect(() => {
    const controller = new AbortController();
    setFileExportDialogKind(null);
    setState({ status: "loading" });

    requestGeometryPreviewSession(preview.request, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setState({ status: "ready", session: response });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to generate geometry preview.",
        });
      });

    return () => {
      controller.abort();
    };
  }, [preview]);

  const targetSnapshot =
    state.status === "ready"
      ? state.session.snapshots.find(
          (snapshot) => snapshot.snapshotId === state.session.initialSnapshotId,
        ) ?? null
      : null;
  const ready = targetSnapshot !== null;

  function openFileExportDialog(kind: FileExportKind) {
    if (state.status !== "ready") return;
    setFileExportDialogKind(kind);
  }

  function handleFileExportJobCreated(job: FileExportJob) {
    onFileExportJobCreated?.(job);
  }

  return (
    <div className="fixed inset-0 z-50 p-3 sm:p-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 cursor-default bg-foreground/45"
        onClick={onClose}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 flex h-full flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b bg-white px-4 py-3 md:px-5">
          <div className="min-w-0">
            <div
              className={cn(
                "flex flex-wrap items-center gap-y-2",
                preview.sourceKind === "stepOutput" ? "gap-x-6" : "gap-x-2",
              )}
            >
              <h2 id={titleId}
                className={cn(
                  "min-w-0 max-w-full break-words font-semibold",
                  preview.sourceKind === "stepOutput"
                    ? "text-[1.6875rem] leading-9"
                    : "text-lg",
                )}
              >
                {preview.sourceKind === "stepOutput"
                  ? preview.sourceLabel
                  : "Geometry Preview"}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={state.status === "error" ? "outline" : "signal"}>
                  {state.status === "loading"
                    ? "Loading"
                    : state.status === "ready"
                      ? "Ready"
                      : "Error"}
                </Badge>
                <Badge variant="secondary">
                  {preview.sourceKind === "flowInput"
                    ? "Geometry Input"
                    : "Step output"}
                </Badge>
              </div>
            </div>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {preview.sourceKind === "stepOutput"
                ? preview.slotLabel
                : `${preview.sourceLabel} -> ${preview.slotLabel}`}
            </div>
          </div>
          <Button className="shrink-0" variant="ghost" size="icon" title="Close" aria-label="Close geometry preview" onClick={onClose}>
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1">
          {state.status === "loading" ? (
            <PreviewMessage icon={<Loader2 className="animate-spin" />}>
              Generating geometry preview...
            </PreviewMessage>
          ) : state.status === "error" ? (
            <PreviewMessage icon={<Layers3 />}>{state.message}</PreviewMessage>
          ) : (
            <GeometryPreviewSnapshotContent
              key={targetSnapshot?.snapshotId ?? "missing"}
              snapshot={targetSnapshot}
            />
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-white px-4 py-3">
          <Button
            variant="outline"
            disabled={!ready}
            onClick={() => openFileExportDialog("json")}
          >
            <FileJson />
            Export JSON
          </Button>
          <Button variant="outline" disabled={!ready} onClick={() => openFileExportDialog("step")}>
            <Download />Export STEP
          </Button>
          <Button
            variant="outline"
            disabled={!ready}
            onClick={() => openFileExportDialog("cdb")}
          >
            <Download />
            Export CDB
          </Button>
        </footer>
      </section>

      {fileExportDialogKind && targetSnapshot ? (
        <FileExportDialog
          kind={fileExportDialogKind}
          geometryStructure={targetSnapshot.geometryEntityJson.structure}
          geometryHash={targetSnapshot.geometryHash}
          geometryEntityJson={targetSnapshot.geometryEntityJson}
          sourceLabel={`${preview.sourceLabel} -> ${targetSnapshot.label}`}
          analyticsContext={preview.request.analyticsContext ?? {
            flowId: preview.request.flowId,
            sourceKind: preview.request.flow ? "inline_draft" : "flow",
          }}
          onClose={() => setFileExportDialogKind(null)}
          onJobCreated={handleFileExportJobCreated}
        />
      ) : null}
    </div>
  );
}

export function GeometryPreviewSnapshotContent({
  snapshot,
}: {
  snapshot: GeometryPreviewSnapshot | null;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ProcessExecutionWarnings warnings={snapshot?.executionWarnings} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <SchematicPreview
          document={snapshot?.schematic ?? null}
          warnings={snapshot?.schematicWarnings}
        />
      </div>
    </div>
  );
}

function PreviewMessage({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center text-sm text-muted-foreground [&_svg]:h-6 [&_svg]:w-6 [&_svg]:text-primary">
        {icon}
        <div>{children}</div>
      </div>
    </div>
  );
}
