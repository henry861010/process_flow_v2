import { apiFetch } from "@/lib/process-flow-api";

const CLIENT_ID_STORAGE_KEY = "process-flow:cdb-export-client-id";

export type CdbExportJobStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceling"
  | "canceled";

export type CdbExportJob = {
  jobId: string;
  clientId: string;
  kind: "cdb";
  status: CdbExportJobStatus;
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

export type CreateCdbExportJobRequest = {
  clientId: string;
  geometryStructure: unknown;
  elementSize: number;
  outputPath: string;
  sourceLabel?: string | null;
};

export function getCdbExportClientId() {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existing) return existing;

  const generated =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `client-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 12)}`;
  window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
  return generated;
}

export async function createCdbExportJob(
  request: CreateCdbExportJobRequest,
): Promise<CdbExportJob> {
  const response = await apiFetch<{ job: CdbExportJob }>(
    "/api/geometry-preview/cdb-jobs",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
  return response.job;
}

export async function listCdbExportJobs(
  clientId: string,
): Promise<CdbExportJob[]> {
  const response = await apiFetch<{ jobs: CdbExportJob[] }>(
    `/api/export-jobs?clientId=${encodeURIComponent(clientId)}`,
  );
  return response.jobs;
}

export async function cancelCdbExportJob({
  clientId,
  jobId,
}: {
  clientId: string;
  jobId: string;
}): Promise<CdbExportJob> {
  const response = await apiFetch<{ job: CdbExportJob }>(
    `/api/export-jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ clientId }),
    },
  );
  return response.job;
}

