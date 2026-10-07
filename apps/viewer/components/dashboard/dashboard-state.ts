import type {
  FileExportKind,
  FileExportProgress,
} from "../geometry-preview/file-export-client";

export type DashboardJob = {
  jobId: string;
  kind: FileExportKind;
  status: "queued" | "running" | "canceling";
  createdAt: string;
  startedAt: string | null;
  queuePosition: number | null;
  runElapsedSeconds: number | null;
  queueElapsedSeconds: number | null;
  progress: FileExportProgress | null;
};

export type DashboardSnapshot = {
  generatedAt: string;
  maxConcurrentJobs: number;
  runningCount: number;
  queuedCount: number;
  jobs: DashboardJob[];
};

export const stageLabels: Record<NonNullable<DashboardJob["progress"]>["stage"], string> = {
  preparing: "Preparing export",
  validating: "Checking geometry",
  analyzing_geometry: "Analyzing geometry",
  building_2d_mesh: "Building 2D mesh",
  building_3d_mesh: "Building 3D mesh",
  building_cad_model: "Building CAD model",
  writing_output: "Writing output",
  finalizing: "Finalizing files",
};

export function progressPercent(progress: DashboardJob["progress"]): number | null {
  if (!progress || progress.current == null || progress.total == null ||
      !Number.isFinite(progress.current) || !Number.isFinite(progress.total) ||
      progress.current < 0 || progress.total <= 0 || progress.current > progress.total) {
    return null;
  }
  return Math.round((progress.current / progress.total) * 100);
}

export function formatElapsed(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(remainder).padStart(2, "0")}s`;
  if (minutes > 0) return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
  return `${remainder}s`;
}

export function jobElapsed(job: DashboardJob, advanceSeconds: number): string {
  const base = job.status === "queued" ? job.queueElapsedSeconds : job.runElapsedSeconds;
  return formatElapsed(base == null ? null : base + advanceSeconds);
}
