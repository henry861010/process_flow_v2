import { apiFetch } from "@/lib/process-flow-api";

const CLIENT_ID_STORAGE_KEY = "process-flow:export-client-id";
const LEGACY_CLIENT_ID_STORAGE_KEY = "process-flow:cdb-export-client-id";

export type ExportJobKind = "cdb" | "json" | "step";

export type ExportJobStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "canceling"
  | "canceled";

export type ExportJob = {
  jobId: string;
  clientId: string;
  kind: ExportJobKind;
  status: ExportJobStatus;
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

export type CreateExportJobRequest = {
  clientId: string;
  kind: ExportJobKind;
  outputPath: string;
  sourceLabel?: string | null;
  geometryStructure?: unknown;
  geometryEntityJson?: unknown;
  elementSize?: number | null;
};

export type CdbExportJobStatus = ExportJobStatus;
export type CdbExportJob = ExportJob;
export type CreateCdbExportJobRequest = Omit<
  CreateExportJobRequest,
  "kind"
> & {
  geometryStructure: unknown;
  elementSize: number;
};

export function getExportClientId() {
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

export const getCdbExportClientId = getExportClientId;

export async function createExportJob(
  request: CreateExportJobRequest,
): Promise<ExportJob> {
  const response = await apiFetch<{ job: ExportJob }>(
    "/api/geometry-preview/export-jobs",
    {
      method: "POST",
      body: JSON.stringify(request),
    },
  );
  return response.job;
}

export async function createCdbExportJob(
  request: CreateCdbExportJobRequest,
): Promise<CdbExportJob> {
  return createExportJob({ ...request, kind: "cdb" });
}

export async function listExportJobs(clientId: string): Promise<ExportJob[]> {
  const response = await apiFetch<{ jobs: ExportJob[] }>(
    `/api/export-jobs?clientId=${encodeURIComponent(clientId)}`,
  );
  return response.jobs;
}

export const listCdbExportJobs = listExportJobs;

export async function cancelExportJob({
  clientId,
  jobId,
}: {
  clientId: string;
  jobId: string;
}): Promise<ExportJob> {
  const response = await apiFetch<{ job: ExportJob }>(
    `/api/export-jobs/${encodeURIComponent(jobId)}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({ clientId }),
    },
  );
  return response.job;
}

export const cancelCdbExportJob = cancelExportJob;
