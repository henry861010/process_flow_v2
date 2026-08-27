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
  cancelFileExportJob,
  getFileExportClientId,
  listFileExportJobs,
  type FileExportJob,
  type FileExportKind,
  type FileExportStatus,
} from "@/components/geometry-preview/file-export-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FileExportJobsPanel({
  refreshKey,
  seedJob,
}: {
  refreshKey: number;
  seedJob: FileExportJob | null;
}) {
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<FileExportJob[]>([]);
  const [expanded, setExpanded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [clock, setClock] = React.useState(() => Date.now());
  const [hoveredJob, setHoveredJob] = React.useState<{
    jobId: string;
    top: number;
  } | null>(null);

  React.useEffect(() => {
    setClientId(getFileExportClientId());
  }, []);

  React.useEffect(() => {
    if (!seedJob) return;
    setJobs((current) => mergeJob(current, seedJob));
    setExpanded(true);
  }, [seedJob]);

  const loadJobs = React.useCallback(async () => {
    if (!clientId) return;
    try {
      const nextJobs = await listFileExportJobs(clientId);
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

  React.useEffect(() => {
    if (!jobs.some((job) => isActiveStatus(job.status))) return;
    setClock(Date.now());
    const interval = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [jobs]);

  async function cancelJob(job: FileExportJob) {
    if (!clientId || !isCancelableStatus(job.status)) return;
    setJobs((current) =>
      current.map((candidate) =>
        candidate.jobId === job.jobId
          ? { ...candidate, status: "canceling", message: "Cancel requested." }
          : candidate,
      ),
    );
    try {
      const nextJob = await cancelFileExportJob({ clientId, jobId: job.jobId });
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
  const activityAnnouncement = jobs
    .filter((job) => isActiveStatus(job.status))
    .map((job) =>
      `${job.sourceLabel || `${kindLabel(job.kind)} export`}: ${activeJobSummary(job, clock)}`,
    )
    .join(". ");

  function showJobDetails(job: FileExportJob, rect: DOMRect) {
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
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {activityAnnouncement}
      </span>
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
            <FileExportJobRow
              key={job.jobId}
              job={job}
              nowMs={clock}
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
        <FileExportJobDetailPopover
          job={hoveredJobDetails}
          top={hoveredJob?.top ?? 16}
          nowMs={clock}
        />
      ) : null}
    </>
  );
}

function FileExportJobRow({
  job,
  nowMs,
  onCancel,
  onHover,
  onHoverEnd,
}: {
  job: FileExportJob;
  nowMs: number;
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
          {job.status === "queued" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {job.queuePosition != null
                ? `Queue position ${job.queuePosition}`
                : "Waiting for an export slot"}
            </p>
          ) : null}
          {job.status === "running" ? (
            <JobProgressSummary job={job} nowMs={nowMs} />
          ) : null}
          {job.status === "canceling" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Cancel requested · {formatLiveRunElapsed(job, nowMs)} elapsed
            </p>
          ) : null}
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
          {job.message && job.status !== "success" && job.status !== "canceling" ? (
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

function JobProgressSummary({
  job,
  nowMs,
}: {
  job: FileExportJob;
  nowMs: number;
}) {
  const progress = job.progress;
  const hasDeterminateProgress =
    progress?.current != null && progress.total != null && progress.total > 0;
  const percentage = hasDeterminateProgress
    ? Math.min(100, Math.max(0, (progress.current! / progress.total!) * 100))
    : null;

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium text-foreground/80">
          {progress ? stageLabel(progress.stage) : "Starting export"}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {formatLiveRunElapsed(job, nowMs)}
        </span>
      </div>
      {progress?.message ? (
        <p className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          {progress.message}
        </p>
      ) : null}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role={hasDeterminateProgress ? "progressbar" : "status"}
        aria-label={progress ? `${stageLabel(progress.stage)} progress` : "Export activity"}
        aria-valuemin={hasDeterminateProgress ? 0 : undefined}
        aria-valuemax={hasDeterminateProgress ? progress?.total ?? undefined : undefined}
        aria-valuenow={hasDeterminateProgress ? progress?.current ?? undefined : undefined}
      >
        {percentage != null ? (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${percentage}%` }}
          />
        ) : (
          <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/60" />
        )}
      </div>
      {hasDeterminateProgress ? (
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {formatProgress(progress!)}
        </p>
      ) : null}
    </div>
  );
}

function FileExportJobDetailPopover({
  job,
  top,
  nowMs,
}: {
  job: FileExportJob;
  top: number;
  nowMs: number;
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
            <JobDetailField
              label="Model type"
              value={formatModelType(job.modelType)}
            />
            <JobDetailField label="Mesh" value={formatMeshSummary(job)} />
          </>
        ) : null}
        {job.status === "queued" ? (
          <JobDetailField
            label="Queue position"
            value={job.queuePosition == null ? "-" : job.queuePosition.toLocaleString()}
          />
        ) : null}
        {job.progress ? (
          <>
            <JobDetailField label="Stage" value={stageLabel(job.progress.stage)} />
            <JobDetailField
              label="Stage progress"
              value={formatProgress(job.progress)}
            />
            <JobDetailField
              label="Stage elapsed"
              value={formatElapsedFrom(job.progress.stageStartedAt, nowMs)}
            />
            <JobDetailField
              label="Last activity"
              value={formatDateTime(job.progress.updatedAt)}
            />
          </>
        ) : null}
        <JobDetailField
          label="Duration"
          value={
            isActiveStatus(job.status)
              ? `${formatLiveRunElapsed(job, nowMs)} elapsed`
              : formatDuration(job.durationSeconds)
          }
        />
        <JobDetailField label="Created" value={formatDateTime(job.createdAt)} />
        <JobDetailField label="Started" value={formatDateTime(job.startedAt)} />
        <JobDetailField
          label="Finished"
          value={formatDateTime(job.finishedAt)}
        />
        <JobDetailField label="Job ID" value={job.jobId} mono />
        <JobDetailField label="Log path" value={job.logPath} mono />
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

function JobStatusIcon({ status }: { status: FileExportStatus }) {
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

function JobKindIcon({ kind }: { kind: FileExportKind }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  if (kind === "json") return <FileJson className={className} />;
  if (kind === "cdb") return <Database className={className} />;
  return <Download className={className} />;
}

function mergeJob(jobs: FileExportJob[], job: FileExportJob) {
  const withoutJob = jobs.filter((candidate) => candidate.jobId !== job.jobId);
  return [job, ...withoutJob].slice(0, 20);
}

function isActiveStatus(status: FileExportStatus) {
  return status === "queued" || status === "running" || status === "canceling";
}

function isCancelableStatus(status: FileExportStatus) {
  return status === "queued" || status === "running";
}

function badgeVariant(status: FileExportStatus) {
  if (status === "success") return "signal";
  if (status === "failed") return "outline";
  if (status === "canceled") return "secondary";
  return "outline";
}

function statusLabel(status: FileExportStatus) {
  if (status === "canceling") return "Canceling";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function stageLabel(stage: NonNullable<FileExportJob["progress"]>["stage"]) {
  const labels = {
    preparing: "Preparing export",
    validating: "Checking geometry",
    analyzing_geometry: "Analyzing geometry",
    building_2d_mesh: "Building 2D mesh",
    building_3d_mesh: "Building 3D mesh",
    building_cad_model: "Building CAD model",
    writing_output: "Writing output",
    finalizing: "Finalizing files",
  } satisfies Record<NonNullable<FileExportJob["progress"]>["stage"], string>;
  return labels[stage];
}

function activeJobSummary(job: FileExportJob, nowMs: number) {
  if (job.status === "queued") {
    return job.queuePosition == null
      ? "Queued"
      : `Queued, position ${job.queuePosition}`;
  }
  if (job.status === "canceling") return "Cancel requested";
  if (job.progress) {
    const detail = formatProgress(job.progress);
    return `${stageLabel(job.progress.stage)}, ${detail}, ${formatLiveRunElapsed(job, nowMs)} elapsed`;
  }
  return `Running, ${formatLiveRunElapsed(job, nowMs)} elapsed`;
}

function formatProgress(progress: NonNullable<FileExportJob["progress"]>) {
  if (progress.current != null && progress.total != null) {
    const unit = progress.unit || "items";
    return `${progress.current.toLocaleString()} / ${progress.total.toLocaleString()} ${unit}`;
  }
  return progress.message || "In progress";
}

function formatLiveRunElapsed(job: FileExportJob, nowMs: number) {
  if (job.startedAt) {
    const startedAt = new Date(job.startedAt).getTime();
    const finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : nowMs;
    if (Number.isFinite(startedAt) && Number.isFinite(finishedAt)) {
      return formatCompactSeconds(Math.max(0, (finishedAt - startedAt) / 1000));
    }
  }
  return formatCompactSeconds(job.runElapsedSeconds || 0);
}

function formatElapsedFrom(value: string, nowMs: number) {
  const startedAt = new Date(value).getTime();
  return Number.isFinite(startedAt)
    ? formatCompactSeconds(Math.max(0, (nowMs - startedAt) / 1000))
    : "-";
}

function formatCompactSeconds(value: number) {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
  return `${remainder}s`;
}

function kindLabel(kind: FileExportKind) {
  return kind.toUpperCase();
}

function formatCount(value: number | null) {
  return value == null ? "-" : value.toLocaleString();
}

function formatNullableNumber(value: number | null) {
  return value == null ? "-" : value.toLocaleString();
}

function formatModelType(value: FileExportJob["modelType"]) {
  if (value === "Full_Model") return "Full Model";
  if (value === "Quarter_Model") return "Quarter Model";
  if (value === "Half_Model_X") return "Half Model (x-axis)";
  if (value === "Half_Model_Y") return "Half Model (y-axis)";
  return "-";
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

function formatMeshSummary(job: FileExportJob) {
  return `${formatCount(job.elementCount)} elements, ${formatCount(
    job.nodeCount,
  )} nodes, ${formatCount(job.componentCount)} comps`;
}

function jobDetailTitle(job: FileExportJob) {
  const parts = [
    job.sourceLabel || `${kindLabel(job.kind)} export`,
    `Kind: ${kindLabel(job.kind)}`,
    `Status: ${statusLabel(job.status)}`,
    `Output: ${job.outputPath}`,
  ];
  if (job.kind === "cdb") {
    parts.push(`Element size: ${formatNullableNumber(job.elementSize)}`);
    parts.push(`Model type: ${formatModelType(job.modelType)}`);
    parts.push(`Mesh: ${formatMeshSummary(job)}`);
  }
  if (job.queuePosition != null) {
    parts.push(`Queue position: ${job.queuePosition}`);
  }
  if (job.progress) {
    parts.push(`Stage: ${stageLabel(job.progress.stage)}`);
    parts.push(`Stage progress: ${formatProgress(job.progress)}`);
  }
  parts.push(`Log: ${job.logPath}`);
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
