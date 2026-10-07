"use client";

import Link from "next/link";
import { Activity, ArrowLeft, Clock3, ListOrdered, RefreshCw, Timer, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { jobElapsed, progressPercent, stageLabels, type DashboardJob } from "./dashboard-state";
import { useDashboardJobs } from "./use-dashboard-jobs";

export function DashboardPage() {
  const { snapshot, refreshing, stale, error, advanceSeconds, refresh } = useDashboardJobs();
  const running = snapshot?.jobs.filter((job) => job.status !== "queued") ?? [];
  const queued = snapshot?.jobs.filter((job) => job.status === "queued") ?? [];
  const connection = stale ? "Updates paused" : snapshot ? "Live" : "Connecting";

  return (
    <main className="min-h-screen p-4 sm:p-5">
      <div className="mx-auto max-w-[1400px]">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
          <div className="flex items-center gap-3">
            <Button asChild size="icon" variant="outline">
              <Link href="/" aria-label="Back to home" title="Back to home"><ArrowLeft aria-hidden="true" /></Link>
            </Button>
            <div>
              <h1 className="text-xl font-semibold">Job dashboard</h1>
              <p className="mt-1 text-sm text-muted-foreground">Live export activity across the service.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={stale ? "border-amber-300 bg-amber-50 text-amber-900" : ""}>
              <span aria-hidden="true" className={cn("mr-2 h-2 w-2 rounded-full", stale ? "bg-amber-600" : snapshot ? "bg-primary" : "bg-slate-400")} />
              {connection}
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw aria-hidden="true" className={refreshing ? "motion-safe:animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        </header>

        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {connection}. {snapshot ? `${snapshot.runningCount} running, ${snapshot.queuedCount} queued.` : "Loading jobs."}
        </div>

        {stale || error ? (
          <div className="mt-5 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <WifiOff aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{snapshot ? "Showing last known status" : "Unable to connect"}</p>
              <p className="mt-1">{error ?? "Updates are delayed. Retrying automatically."} {snapshot ? "Elapsed times are paused until a fresh update arrives." : ""}</p>
            </div>
          </div>
        ) : null}

        <section aria-label="Export overview" className="my-5 grid gap-4 sm:grid-cols-3">
          <OverviewCard label="Running" icon={<Activity aria-hidden="true" className="h-4 w-4" />}>
            <p className="font-mono text-3xl tabular-nums">{snapshot?.runningCount ?? "—"}<span className="ml-2 text-base text-muted-foreground">/ {snapshot?.maxConcurrentJobs ?? "—"}</span></p>
            <p className="mt-2 text-xs text-muted-foreground">Concurrent exports, including canceling jobs</p>
          </OverviewCard>
          <OverviewCard label="Queued" icon={<ListOrdered aria-hidden="true" className="h-4 w-4" />}>
            <p className="font-mono text-3xl tabular-nums">{snapshot?.queuedCount ?? "—"}</p>
            <p className="mt-2 text-xs text-muted-foreground">Waiting for the next available slot</p>
          </OverviewCard>
          <OverviewCard label="Last updated" icon={<Clock3 aria-hidden="true" className="h-4 w-4" />}>
            <p className="font-mono text-xl tabular-nums">{snapshot ? <time dateTime={snapshot.generatedAt}>{new Date(snapshot.generatedAt).toLocaleTimeString()}</time> : "—"}</p>
            <p className="mt-2 text-xs text-muted-foreground">{stale ? "Status may have changed since this update" : "Refreshes every 2s when active · 5s when idle"}</p>
          </OverviewCard>
        </section>

        {!snapshot ? (
          <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground" aria-busy={refreshing}>
            {error ? "No job status available yet. Use Refresh to try again." : "Loading export jobs…"}
          </div>
        ) : (
          <div className="space-y-5">
            <JobSection title="Running jobs" jobs={running} queued={false} advanceSeconds={advanceSeconds} stale={stale} />
            <JobSection title="Waiting queue" jobs={queued} queued advanceSeconds={advanceSeconds} stale={stale} />
          </div>
        )}
      </div>
    </main>
  );
}

function OverviewCard({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">{icon}<h2 className="font-medium">{label}</h2></div>
      {children}
    </div>
  );
}

function JobSection({ title, jobs, queued, advanceSeconds, stale }: {
  title: string; jobs: DashboardJob[]; queued: boolean; advanceSeconds: number; stale: boolean;
}) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-md border bg-card shadow-sm">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        {queued ? <ListOrdered aria-hidden="true" className="h-4 w-4 text-muted-foreground" /> : <Activity aria-hidden="true" className="h-4 w-4 text-primary" />}
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge variant="secondary">{jobs.length}</Badge>
      </div>
      {jobs.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-medium">{queued ? "No jobs waiting" : "No jobs running"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{queued ? "New queued exports will appear here." : "Active CDB, STEP and JSON exports will appear here."}</p>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  {queued ? <th scope="col" className="w-20 px-4 py-3 font-medium">Position</th> : null}
                  <th scope="col" className="w-[32%] px-4 py-3 font-medium">Job</th>
                  <th scope="col" className="w-28 px-4 py-3 font-medium">Status</th>
                  {!queued ? <th scope="col" className="px-4 py-3 font-medium">Current stage</th> : null}
                  <th scope="col" className="w-40 px-4 py-3 font-medium">{queued ? "Waiting" : "Elapsed"}{stale ? " (paused)" : ""}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {jobs.map((job) => (
                  <tr key={job.jobId}>
                    {queued ? <td className="px-4 py-4 font-mono tabular-nums">#{job.queuePosition}</td> : null}
                    <td className="px-4 py-4"><JobIdentity job={job} /></td>
                    <td className="px-4 py-4"><JobStatus job={job} /></td>
                    {!queued ? <td className="px-4 py-4"><JobProgress job={job} /></td> : null}
                    <td className="px-4 py-4 font-mono tabular-nums">{jobElapsed(job, advanceSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y md:hidden">
            {jobs.map((job) => (
              <li key={job.jobId} className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{job.kind.toUpperCase()} export{queued ? ` · #${job.queuePosition}` : ""}</span>
                  <JobStatus job={job} />
                </div>
                <p className="break-all font-mono text-xs text-muted-foreground">{job.jobId}</p>
                {!queued ? <JobProgress job={job} /> : null}
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Timer aria-hidden="true" className="h-4 w-4" />
                  {queued ? "Waiting" : "Elapsed"}{stale ? " (paused)" : ""}
                  <span className="font-mono text-foreground tabular-nums">{jobElapsed(job, advanceSeconds)}</span>
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function JobIdentity({ job }: { job: DashboardJob }) {
  return <div><p className="font-medium">{job.kind.toUpperCase()} export</p><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{job.jobId}</p></div>;
}

function JobStatus({ job }: { job: DashboardJob }) {
  return <Badge variant="outline" className={job.status === "canceling" ? "border-amber-300 bg-amber-50 text-amber-900" : job.status === "running" ? "border-primary/30 bg-primary/5 text-primary" : ""}>
    {job.status === "canceling" ? "Canceling" : job.status === "running" ? "Running" : "Queued"}
  </Badge>;
}

function JobProgress({ job }: { job: DashboardJob }) {
  const progress = job.progress;
  const percent = progressPercent(progress);
  return (
    <div className="space-y-2">
      <p className="text-sm">{progress ? stageLabels[progress.stage] : "Starting export"}</p>
      {progress?.message ? <p className="break-words text-xs leading-5 text-muted-foreground">{progress.message}</p> : null}
      {percent != null && progress ? (
        <>
          <div role="progressbar" aria-label={`${job.kind.toUpperCase()} ${job.jobId} stage progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground"><span className="font-mono tabular-nums">{progress.current?.toLocaleString()} / {progress.total?.toLocaleString()}</span> {progress.unit ?? "items"} · {percent}% of stage</p>
        </>
      ) : <p className="text-xs text-muted-foreground">In progress</p>}
    </div>
  );
}
