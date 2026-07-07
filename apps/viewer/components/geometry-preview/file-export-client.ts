import { apiFetch } from "@/lib/process-flow-api";

const CLIENT_ID_STORAGE_KEY = "process-flow:export-client-id";
const LEGACY_CLIENT_ID_STORAGE_KEY = "process-flow:cdb-export-client-id";

export type FileExportKind = "cdb" | "json" | "step";

export type FileExportStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceling"
  | "canceled";

export type FileExportJob = {
  jobId: string;
  clientId: string;
  kind: FileExportKind;
  status: FileExportStatus;
  sourceLabel: string | null;
  outputPath: string;
  elementSize: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  nodeCount: number | null;
  elementCount: number | null;
  componentCount: number | null;
  message: string | null;
  warning: string | null;
};

export type CreateFileExportJobRequest = {
  clientId: string;
  kind: FileExportKind;
  outputPath: string;
  sourceLabel?: string | null;
  geometryStructure?: unknown;
  geometryEntityJson?: unknown;
  elementSize?: number | null;
};

export function getFileExportClientId() {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing =
    window.localStorage.getItem(CLIENT_ID_STORAGE_KEY) ||
    window.localStorage.getItem(LEGACY_CLIENT_ID_STORAGE_KEY);
  if (existing) {
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, existing);
    return existing;
  }

  const generated =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `client-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 12)}`;
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
  return generated;
}

export async function createFileExportJob(
  request: CreateFileExportJobRequest,
): Promise<FileExportJob> {
  const response = await apiFetch<{ job: FileExportJob }>(
    "/api/geometry-preview/export-jobs",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
  return response.job;
}

export async function listFileExportJobs(
  clientId: string,
): Promise<FileExportJob[]> {
  const response = await apiFetch<{ jobs: FileExportJob[] }>(
    `/api/export-jobs?clientId=${encodeURIComponent(clientId)}`,
  );
  return response.jobs;
}

export async function cancelFileExportJob({
  clientId,
  jobId,
}: {
  clientId: string;
  jobId: string;
}): Promise<FileExportJob> {
  const response = await apiFetch<{ job: FileExportJob }>(
    `/api/export-jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ clientId }),
    },
  );
  return response.job;
}
