"use client";

import * as React from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleStop,
  Database,
  Loader2,
  XCircle,
} from "lucide-react";

import {
  cancelCdbExportJob,
  getCdbExportClientId,
  listCdbExportJobs,
  type CdbExportJob,
  type CdbExportJobStatus,
} from "@/components/geometry-preview/cdb-export-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CdbExportJobsPanel({
  refreshKey,
  seedJob,
}: {
  refreshKey: number;
  seedJob: CdbExportJob | null;
}) {
  const [clientId, setClientId] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<CdbExportJob[]>([]);
  const [expanded, setExpanded] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setClientId(getCdbExportClientId());
  }, []);

  React.useEffect(() => {
    if (!seedJob) return;
    setJobs((current) => mergeJob(current, seedJob));
    setExpanded(true);
  }, [seedJob]);

  const loadJobs = React.useCallback(async () => {
    if (!clientId) return;
    try {
      const nextJobs = await listCdbExportJobs(clientId);
      setJobs(nextJobs);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load CDB export jobs.",
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

  async function cancelJob(job: CdbExportJob) {
    if (!clientId || !isCancelableStatus(job.status)) return;
    setJobs((current) =>
      current.map((candidate) =>
        candidate.jobId === job.jobId
          ? { ...candidate, status: "canceling", message: "Cancel requested." }
          : candidate,
      ),
    );
    try {
      const nextJob = await cancelCdbExportJob({ clientId, jobId: job.jobId });
      setJobs((current) => mergeJob(current, nextJob));
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Unable to cancel CDB export job.",
      );
      void loadJobs();
    }
  }

  if (jobs.length === 0 && !error) {
    return null;
  }

  const activeCount = jobs.filter((job) => isActiveStatus(job.status)).length;

  return (
    <aside className="fixed bottom-20 right-4 z-[70] w-[min(430px,calc(100vw-32px))] overflow-hidden rounded-md border bg-white shadow-viewport">
      <button
        type="button"
        className="flex w-full items-center gap-3 border-b bg-muted/40 px-3 py-2 text-left transition hover:bg-muted/70"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground [&_svg]:h-4 [&_svg]:w-4">
          <Database />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            CDB requests
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {activeCount > 0 ? `${activeCount} active` : `${jobs.length} recent`}
          </span>
        </span>
        <Badge variant={activeCount > 0 ? "signal" : "secondary"}>
          {activeCount > 0 ? "Running" : "Idle"}
        </Badge>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {expanded ? (
        <div className="max-h-[340px] space-y-2 overflow-y-auto p-2">
          {error ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
          {jobs.map((job) => (
            <CdbExportJobRow
              key={job.jobId}
              job={job}
              onCancel={() => cancelJob(job)}
            />
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function CdbExportJobRow({
  job,
  onCancel,
}: {
  job: CdbExportJob;
  onCancel: () => void;
}) {
  const cancelable = isCancelableStatus(job.status);
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="flex items-start gap-2">
        <JobStatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">
              {job.sourceLabel || "CDB export"}
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
          {job.status === "success" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatCount(job.elementCount)} elements, {formatCount(job.nodeCount)} nodes,{" "}
              {formatCount(job.componentCount)} comps
              {job.durationSeconds != null ? `, ${job.durationSeconds}s` : ""}
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
          onClick={onCancel}
        >
          <CircleStop />
        </Button>
      </div>
    </div>
  );
}

function JobStatusIcon({ status }: { status: CdbExportJobStatus }) {
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

function mergeJob(jobs: CdbExportJob[], job: CdbExportJob) {
  const withoutJob = jobs.filter((candidate) => candidate.jobId !== job.jobId);
  return [job, ...withoutJob].slice(0, 20);
}

function isActiveStatus(status: CdbExportJobStatus) {
  return status === "queued" || status === "running" || status === "canceling";
}

function isCancelableStatus(status: CdbExportJobStatus) {
  return status === "queued" || status === "running";
}

function badgeVariant(status: CdbExportJobStatus) {
  if (status === "success") return "signal";
  if (status === "failed") return "outline";
  if (status === "canceled") return "secondary";
  return "outline";
}

function statusLabel(status: CdbExportJobStatus) {
  if (status === "canceling") return "Canceling";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatCount(value: number | null) {
  return value == null ? "-" : value.toLocaleString();
}
