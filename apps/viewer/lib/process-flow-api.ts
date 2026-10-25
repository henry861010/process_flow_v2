import type {
  GeometryEntity, FlowDraft, FlowDraftSummary, FlowDraftCreate,
  ProcessFlow, ProcessFlowCreate, ProcessFlowUpdate, FlowOrigin, ProcessStepTemplate,
} from "@/lib/process-flow/types";
import type {
  GeometryGeneratorDefinition,
  GeometryGeneratorPreview,
  GeometryMaterialization,
} from "@/components/geometry-generator/geometry-generator-contracts";

const DEFAULT_API_BASE_URL = "http://localhost:8000";

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export type BootstrapPayload = {
  processStepTemplates: ProcessStepTemplate[];
  processFlows: ProcessFlow[];
  geometries: GeometryEntity[];
  geometryGenerators: GeometryGeneratorDefinition[];
};

export function processFlowApiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL?.replace(/\/$/, "") ||
    DEFAULT_API_BASE_URL
  );
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const requestUrl = /^https?:\/\//i.test(path)
    ? path
    : `${processFlowApiBaseUrl()}${path}`;
  const response = await fetch(requestUrl, {
    ...init,
    headers,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = getApiErrorMessage(payload) ?? `API request failed: ${response.status}`;
    throw new ApiRequestError(message, response.status);
  }
  return payload as T;
}

function getApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.detail === "string") return record.detail;
  if (!Array.isArray(record.detail)) return null;

  const messages = record.detail.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const detail = item as Record<string, unknown>;
    if (typeof detail.msg !== "string") return [];
    const location = Array.isArray(detail.loc)
      ? detail.loc
          .filter((part) => part !== "body")
          .map(String)
          .join(".")
      : "";
    return [location ? `${location}: ${detail.msg}` : detail.msg];
  });
  return messages.length > 0 ? messages.join("; ") : null;
}

export async function loadBootstrap(): Promise<BootstrapPayload> {
  return apiFetch<BootstrapPayload>("/api/bootstrap");
}

export async function exportFixtureArchive(): Promise<void> {
  return downloadApiFile("/api/fixture-export", fixtureArchiveFilename(new Date()));
}

export type StepTemplateImportResult = {
  processStepTemplates: ProcessStepTemplate[];
  createdCount: number;
  updatedCount: number;
};

export async function exportProcessStepTemplates(): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return downloadApiFile("/api/process-step-templates/export", `process-step-templates-${timestamp}.json`);
}

export async function importProcessStepTemplates(file: File): Promise<StepTemplateImportResult> {
  return apiFetch<StepTemplateImportResult>("/api/process-step-templates/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: file,
  });
}

async function downloadApiFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`${processFlowApiBaseUrl()}${path}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = getApiErrorMessage(payload) ?? `API request failed: ${response.status}`;
    throw new ApiRequestError(message, response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function fixtureArchiveFilename(date: Date) {
  const timestamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `process-flow-fixtures-${timestamp}.zip`;
}

export async function resetPocData(): Promise<BootstrapPayload> {
  return apiFetch<BootstrapPayload>("/api/reset", {
    method: "POST",
  });
}

export async function resetPocDataFromZip(file: File): Promise<BootstrapPayload> {
  return apiFetch<BootstrapPayload>("/api/reset-from-zip", {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: file,
  });
}

export async function createGeometry(geometry: unknown): Promise<GeometryEntity> {
  return apiFetch<GeometryEntity>("/api/geometries", {
    method: "POST",
    body: JSON.stringify(geometry),
  });
}

export async function deleteGeometry(geometryId: string): Promise<void> {
  await apiFetch<unknown>(`/api/geometries/${encodeURIComponent(geometryId)}`, {
    method: "DELETE",
  });
}

export async function listGeometryGenerators(): Promise<GeometryGeneratorDefinition[]> {
  return apiFetch<GeometryGeneratorDefinition[]>("/api/geometry-generators");
}

export async function getGeometryGeneratorVersion(
  generatorId: string,
  version: number,
): Promise<GeometryGeneratorDefinition> {
  return apiFetch<GeometryGeneratorDefinition>(
    `/api/geometry-generators/${encodeURIComponent(generatorId)}/versions/${version}`,
  );
}

export async function previewGeneratedGeometry(
  generatorId: string,
  generatorVersion: number,
  parameters: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<GeometryGeneratorPreview> {
  return apiFetch<GeometryGeneratorPreview>(
    `/api/geometry-generators/${encodeURIComponent(generatorId)}/preview`,
    {
      method: "POST",
      body: JSON.stringify({ generatorVersion, parameters }),
      signal,
    },
  );
}

export async function materializeGeneratedGeometry(
  previewToken: string,
): Promise<GeometryMaterialization> {
  return apiFetch<GeometryMaterialization>("/api/geometry-materializations", {
    method: "POST",
    body: JSON.stringify({ previewToken }),
  });
}

export async function listProcessStepTemplates<T>(): Promise<T[]> {
  return apiFetch<T[]>("/api/process-step-templates");
}

export async function createProcessStepTemplate<T>(template: T): Promise<T> {
  return apiFetch<T>("/api/process-step-templates", {
    method: "POST",
    body: JSON.stringify(template),
  });
}

export async function updateProcessStepTemplate<T>(
  templateId: string,
  template: T,
): Promise<T> {
  return apiFetch<T>(
    `/api/process-step-templates/${encodeURIComponent(templateId)}`,
    {
      method: "PUT",
      body: JSON.stringify(template),
    },
  );
}

export async function getProcessFlow(id: string) {
  return apiFetch<ProcessFlow>(`/api/process-flows/${encodeURIComponent(id)}`);
}
export async function createProcessFlow(flow: ProcessFlowCreate) {
  return apiFetch<ProcessFlow>("/api/process-flows", { method: "POST", body: JSON.stringify(flow) });
}
export async function updateProcessFlow(id: string, flow: ProcessFlowUpdate) {
  return apiFetch<ProcessFlow>(`/api/process-flows/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(flow) });
}
export async function deleteProcessFlow(flow: Pick<ProcessFlow, "id" | "revision">) {
  return apiFetch<void>(`/api/process-flows/${encodeURIComponent(flow.id)}?revision=${flow.revision}`, { method: "DELETE" });
}
function draftPath(id?: string) { return `/api/process-flow-drafts${id ? `/${encodeURIComponent(id)}` : ""}`; }
export async function listFlowDrafts(options: { user?: string; search?: string } = {}) {
  const query = new URLSearchParams();
  if (options.user) query.set("user", options.user);
  if (options.search) query.set("search", options.search);
  return apiFetch<FlowDraftSummary[]>(draftPath() + (query.size ? `?${query}` : ""));
}
export async function getFlowDraft(id: string) { return apiFetch<FlowDraft>(draftPath(id)); }
export async function saveFlowDraft(body: FlowDraftCreate, current?: Pick<FlowDraft, "id" | "revision">) {
  return apiFetch<FlowDraft>(draftPath(current?.id), { method: current ? "PUT" : "POST",
    body: JSON.stringify({ ...body, ...(current ? { revision: current.revision } : {}) }) });
}
export async function deleteFlowDraft(draft: Pick<FlowDraft, "id" | "revision">) {
  return apiFetch<void>(`${draftPath(draft.id)}?revision=${draft.revision}`, { method: "DELETE" });
}
export async function commitFlowDraft(draft: Pick<FlowDraft, "id" | "revision">, flow: ProcessFlowCreate, target?: FlowOrigin) {
  return apiFetch<ProcessFlow>(draftPath(draft.id) + "/commit", {
    method: "POST", body: JSON.stringify({ revision: draft.revision, flow, ...(target ? { target } : {}) }),
  });
}
