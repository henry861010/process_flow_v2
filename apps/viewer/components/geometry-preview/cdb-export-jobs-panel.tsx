"use client";

import * as React from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Database,
  Download,
  FileJson,
  Loader2,
  XCircle,
} from "lucide-react";

import {
  cancelExportJob,
  getExportClientId,
  listExportJobs,
  type ExportJob,
  type ExportJobKind,
  type ExportJobStatus,
} from "@/components/geometry-preview/cdb-export-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ExportJobsPanel({
  refreshKey,
  seedJob,
}: {
  refreshKey: number;
  seedJob: ExportJob | null;
}) {
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<ExportJob[]>([]);
  const [expanded, setExpanded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hoveredJob, setHoveredJob] = React.useState<{
    jobId: string;
    top: number;
  } | null>(null);

  React.useEffect(() => {
    setClientId(getExportClientId());
  }, []);

  React.useEffect(() => {
    if (!seedJob) return;
    setJobs((current) => mergeJob(current, seedJob));
    setExpanded(true);
  }, [seedJob]);

  const loadJobs = React.useCallback(async () => {
    if (!clientId) return;
    try {
      const nextJobs = await listExportJobs(clientId);
      setJobs(nextJobs);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load export jobs.",
      );
    }
  }, [clientId]);

  React.useEffect(() => {
    void loadJobs();
  }, [loadJobs, refreshKey]);

  React.useEffect(() => {
    if (!clientId) return;
    const interval = window.setInterval(() => {
      void loadJobs();
    }, jobs.some((job) => isActiveStatus(job.status)) ? 1800 : 5000);
    return () => window.clearInterval(interval);
  }, [clientId, jobs, loadJobs]);

  async function cancelJob(job: ExportJob) {
    if (!clientId || !isCancelableStatus(job.status)) return;
    setJobs((current) =>
      current.map((candidate) =>
        candidate.jobId === job.jobId
          ? { ...candidate, status: "canceling", message: "Cancel requested." }
          : candidate,
      ),
    );
    try {
      const nextJob = await cancelExportJob({ clientId, jobId: job.jobId });
      setJobs((current) => mergeJob(current, nextJob));
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Unable to cancel export job.",
      );
      void loadJobs();
    }
  }

  const activeCount = jobs.filter((job) => isActiveStatus(job.status)).length;
  const hoveredJobDetails =
    hoveredJob == null
      ? null
      : jobs.find((job) => job.jobId === hoveredJob.jobId) ?? null;

  function showJobDetails(job: ExportJob, rect: DOMRect) {
    const popoverMaxHeight = Math.min(window.innerHeight * 0.7, 420);
    const top = Math.min(
      Math.max(rect.top - 8, 16),
      Math.max(16, window.innerHeight - popoverMaxHeight - 16),
    );
    setHoveredJob({ jobId: job.jobId, top });
  }

  if (!expanded) {
    return (
      <button
        type="button"
        className="fixed right-0 top-1/2 z-[80] flex h-16 w-10 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-l-md border border-r-0 bg-white text-muted-foreground shadow-viewport transition hover:bg-muted/50 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        aria-label="Open export requests"
        title="Open export requests"
        onClick={() => setExpanded(true)}
      >
        <ChevronLeft className="h-4 w-4" />
        <Download className="h-4 w-4" />
        {activeCount > 0 ? (
          <span className="absolute -left-1 top-2 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-white" />
        ) : null}
      </button>
    );
  }

  return (
    <>
      <aside className="fixed right-0 top-1/2 z-[80] flex max-h-[min(78vh,640px)] w-[min(420px,calc(100vw-16px))] -translate-y-1/2 flex-col overflow-hidden rounded-l-md border border-r-0 bg-white shadow-viewport">
        <header className="flex shrink-0 items-center gap-3 border-b bg-muted/30 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:h-4 [&_svg]:w-4">
            <Download />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              Export requests
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {activeCount > 0
                ? `${activeCount} active`
                : `${jobs.length} recent requests`}
            </span>
          </span>
          <Badge variant={activeCount > 0 ? "signal" : "secondary"}>
            {activeCount > 0 ? "Running" : "Idle"}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Collapse"
            onClick={() => setExpanded(false)}
          >
            <ChevronRight />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {error ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {jobs.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 px-3 py-8 text-center">
              <Download className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No export requests</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Exports created from preview will appear here.
              </p>
            </div>
          ) : null}
          {jobs.map((job) => (
            <ExportJobRow
              key={job.jobId}
              job={job}
              onCancel={() => cancelJob(job)}
              onHover={(rect) => showJobDetails(job, rect)}
              onHoverEnd={() => setHoveredJob(null)}
            />
          ))}
        </div>

        <footer className="shrink-0 border-t bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
          Showing the latest 20 requests for this browser.
        </footer>
      </aside>

      {hoveredJobDetails ? (
        <ExportJobDetailPopover
          job={hoveredJobDetails}
          top={hoveredJob?.top ?? 16}
        />
      ) : null}
    </>
  );
}

function ExportJobRow({
  job,
  onCancel,
  onHover,
  onHoverEnd,
}: {
  job: ExportJob;
  onCancel: () => void;
  onHover: (rect: DOMRect) => void;
  onHoverEnd: () => void;
}) {
  const cancelable = isCancelableStatus(job.status);
  return (
    <div
      className="rounded-md border bg-background px-3 py-2 outline-none transition hover:border-primary/40 hover:bg-muted/20 focus-within:border-primary/40 focus-within:bg-muted/20"
      title={jobDetailTitle(job)}
      onMouseEnter={(event) =>
        onHover(event.currentTarget.getBoundingClientRect())
      }
      onMouseMove={(event) =>
        onHover(event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={onHoverEnd}
      onPointerEnter={(event) =>
        onHover(event.currentTarget.getBoundingClientRect())
      }
      onPointerMove={(event) =>
        onHover(event.currentTarget.getBoundingClientRect())
      }
      onPointerLeave={onHoverEnd}
      onFocusCapture={(event) =>
        onHover(event.currentTarget.getBoundingClientRect())
      }
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          onHoverEnd();
        }
      }}
    >
      <div className="flex items-start gap-2">
        <JobStatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <JobKindIcon kind={job.kind} />
            <span className="truncate text-sm font-medium">
              {job.sourceLabel || `${kindLabel(job.kind)} export`}
            </span>
            <Badge
              variant={badgeVariant(job.status)}
              className={
                job.status === "failed"
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : undefined
              }
            >
              {statusLabel(job.status)}
            </Badge>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {job.outputPath}
          </p>
          {job.status === "success" && job.kind === "cdb" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatCount(job.elementCount)} elements, {formatCount(job.nodeCount)} nodes,{" "}
              {formatCount(job.componentCount)} comps
              {job.durationSeconds != null ? `, ${job.durationSeconds}s` : ""}
            </p>
          ) : null}
          {job.status === "success" && job.kind !== "cdb" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {job.durationSeconds != null
                ? `${kindLabel(job.kind)} export, ${job.durationSeconds}s`
                : `${kindLabel(job.kind)} export completed`}
            </p>
          ) : null}
          {job.message && job.status !== "success" ? (
            <p
              className={cn(
                "mt-1 line-clamp-2 text-xs",
                job.status === "failed" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {job.message}
            </p>
          ) : null}
          {job.warning ? (
            <p className="mt-1 line-clamp-2 text-xs text-amber-700">
              {job.warning}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="Cancel"
          disabled={!cancelable}
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
        >
          <CircleStop />
        </Button>
      </div>
    </div>
  );
}

function ExportJobDetailPopover({
  job,
  top,
}: {
  job: ExportJob;
  top: number;
}) {
  return (
    <div
      className="pointer-events-none fixed right-[432px] z-[90] hidden max-h-[min(70vh,420px)] w-[min(520px,calc(100vw-464px))] overflow-y-auto rounded-md border bg-white p-3 text-xs shadow-viewport md:block"
      style={{ top }}
    >
      <div className="flex items-start gap-2">
        <JobStatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <JobKindIcon kind={job.kind} />
            <h3 className="min-w-0 break-words text-sm font-semibold leading-5">
              {job.sourceLabel || `${kindLabel(job.kind)} export`}
            </h3>
            <Badge
              variant={badgeVariant(job.status)}
              className={
                job.status === "failed"
                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                  : undefined
              }
            >
              {statusLabel(job.status)}
            </Badge>
          </div>
          <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
            {job.outputPath}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-2">
        <JobDetailField label="Kind" value={kindLabel(job.kind)} />
        {job.kind === "cdb" ? (
          <>
            <JobDetailField
              label="Element size"
              value={formatNullableNumber(job.elementSize)}
            />
            <JobDetailField label="Mesh" value={formatMeshSummary(job)} />
          </>
        ) : null}
        <JobDetailField
          label="Duration"
          value={formatDuration(job.durationSeconds)}
        />
        <JobDetailField label="Created" value={formatDateTime(job.createdAt)} />
        <JobDetailField label="Started" value={formatDateTime(job.startedAt)} />
        <JobDetailField
          label="Finished"
          value={formatDateTime(job.finishedAt)}
        />
        <JobDetailField label="Job ID" value={job.jobId} mono />
        {job.message ? (
          <JobDetailField
            label="Message"
            value={job.message}
            tone={job.status === "failed" ? "destructive" : undefined}
          />
        ) : null}
        {job.warning ? (
          <JobDetailField label="Warning" value={job.warning} tone="warning" />
        ) : null}
      </div>
    </div>
  );
}

function JobDetailField({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "destructive" | "warning";
}) {
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div
        className={cn(
          "min-w-0 whitespace-pre-wrap break-words",
          mono ? "font-mono text-[11px]" : undefined,
          tone === "destructive" ? "text-destructive" : undefined,
          tone === "warning" ? "text-amber-700" : undefined,
        )}
      >
        {value || "-"}
      </div>
    </>
  );
}

function JobStatusIcon({ status }: { status: ExportJobStatus }) {
  const className = "mt-0.5 h-4 w-4 shrink-0";
  if (status === "success") {
    return <CheckCircle2 className={cn(className, "text-emerald-600")} />;
  }
  if (status === "failed") {
    return <XCircle className={cn(className, "text-destructive")} />;
  }
  if (status === "running" || status === "queued" || status === "canceling") {
    return <Loader2 className={cn(className, "animate-spin text-primary")} />;
  }
  return <CircleStop className={cn(className, "text-muted-foreground")} />;
}

function JobKindIcon({ kind }: { kind: ExportJobKind }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  if (kind === "json") return <FileJson className={className} />;
  if (kind === "cdb") return <Database className={className} />;
  return <Download className={className} />;
}

function mergeJob(jobs: ExportJob[], job: ExportJob) {
  const withoutJob = jobs.filter((candidate) => candidate.jobId !== job.jobId);
  return [job, ...withoutJob].slice(0, 20);
}

function isActiveStatus(status: ExportJobStatus) {
  return status === "queued" || status === "running" || status === "canceling";
}

function isCancelableStatus(status: ExportJobStatus) {
  return status === "queued" || status === "running";
}

function badgeVariant(status: ExportJobStatus) {
  if (status === "success") return "signal";
  if (status === "failed") return "outline";
  if (status === "canceled") return "secondary";
  return "outline";
}

function statusLabel(status: ExportJobStatus) {
  if (status === "canceling") return "Canceling";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function kindLabel(kind: ExportJobKind) {
  return kind.toUpperCase();
}

function formatCount(value: number | null) {
  return value == null ? "-" : value.toLocaleString();
}

function formatNullableNumber(value: number | null) {
  return value == null ? "-" : value.toLocaleString();
}

function formatDuration(value: number | null) {
  return value == null ? "-" : `${value.toLocaleString()}s`;
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatMeshSummary(job: ExportJob) {
  return `${formatCount(job.elementCount)} elements, ${formatCount(
    job.nodeCount,
  )} nodes, ${formatCount(job.componentCount)} comps`;
}

function jobDetailTitle(job: ExportJob) {
  const parts = [
    job.sourceLabel || `${kindLabel(job.kind)} export`,
    `Kind: ${kindLabel(job.kind)}`,
    `Status: ${statusLabel(job.status)}`,
    `Output: ${job.outputPath}`,
  ];
  if (job.kind === "cdb") {
    parts.push(`Element size: ${formatNullableNumber(job.elementSize)}`);
    parts.push(`Mesh: ${formatMeshSummary(job)}`);
  }
  if (job.durationSeconds != null) {
    parts.push(`Duration: ${formatDuration(job.durationSeconds)}`);
  }
  if (job.message) {
    parts.push(`Message: ${job.message}`);
  }
  if (job.warning) {
    parts.push(`Warning: ${job.warning}`);
  }
  return parts.join("\n");
}

export const CdbExportJobsPanel = ExportJobsPanel;
