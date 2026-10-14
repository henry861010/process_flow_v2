import type {
  GeometryEntity,
  EditorDraft,
  EditorDraftSummary,
  EditorDraftCreate,
  ProcessFlowInstance,
  ProcessFlowInstanceCreate,
  ProcessFlowTemplate,
  ProcessFlowTemplateCreate,
  ProcessStepTemplate,
  TemplateInstanceCreateRequest,
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
  processFlowTemplates: ProcessFlowTemplate[];
  processFlowInstances: ProcessFlowInstance[];
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
  const response = await fetch(`${processFlowApiBaseUrl()}/api/fixture-export`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = getApiErrorMessage(payload) ?? `API request failed: ${response.status}`;
    throw new ApiRequestError(message, response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fixtureArchiveFilename(new Date());
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

export async function listProcessFlowTemplates<T>(): Promise<T[]> {
  return apiFetch<T[]>("/api/process-flow-templates");
}

export async function deleteProcessFlowTemplate(templateId: string): Promise<void> {
  await apiFetch<unknown>(`/api/process-flow-templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}

export async function deleteProcessFlowInstance(instanceId: string): Promise<void> {
  await apiFetch<unknown>(`/api/process-flow-instances/${encodeURIComponent(instanceId)}`, {
    method: "DELETE",
  });
}

export async function createProcessFlowTemplate(
  template: ProcessFlowTemplateCreate,
): Promise<ProcessFlowTemplate> {
  return apiFetch<ProcessFlowTemplate>("/api/process-flow-templates", {
    method: "POST",
    body: JSON.stringify(template),
  });
}

export async function updateProcessFlowTemplate<T>(
  templateId: string,
  template: T,
): Promise<T> {
  return apiFetch<T>(
    `/api/process-flow-templates/${encodeURIComponent(templateId)}`,
    {
      method: "PUT",
      body: JSON.stringify(template),
    },
  );
}

export async function createProcessFlowTemplateInstance(
  payload: TemplateInstanceCreateRequest,
): Promise<{
  processFlowTemplate: ProcessFlowTemplate;
  processFlowInstance: ProcessFlowInstance;
}> {
  return apiFetch("/api/process-flow-template-instances", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createProcessFlowInstance(
  instance: ProcessFlowInstanceCreate,
): Promise<ProcessFlowInstance> {
  return apiFetch<ProcessFlowInstance>("/api/process-flow-instances", {
    method: "POST",
    body: JSON.stringify(instance),
  });
}

export type EditorDraftKind = "template" | "instance";
function editorDraftPath(kind: EditorDraftKind, id?: string) {
  return `/api/process-flow-${kind}-drafts${id ? `/${encodeURIComponent(id)}` : ""}`;
}
function draftQuery(options: { templateId?: string; user?: string; search?: string; revision?: number }) {
  const query = new URLSearchParams();
  if (options.templateId) query.set("processFlowTemplateId", options.templateId);
  if (options.user) query.set("user", options.user);
  if (options.search) query.set("search", options.search);
  if (options.revision !== undefined) query.set("revision", String(options.revision));
  return query.size ? `?${query}` : "";
}
export async function listEditorDrafts(kind: EditorDraftKind, options: { templateId?: string; user?: string; search?: string }) {
  return apiFetch<EditorDraftSummary[]>(editorDraftPath(kind) + draftQuery(options));
}
export async function getEditorDraft(kind: EditorDraftKind, id: string, templateId?: string) {
  return apiFetch<EditorDraft>(editorDraftPath(kind, id) + draftQuery({ templateId }));
}
export async function saveEditorDraft(kind: EditorDraftKind, body: EditorDraftCreate, current?: Pick<EditorDraft, "id" | "revision">) {
  return apiFetch<EditorDraft>(editorDraftPath(kind, current?.id), {
    method: current ? "PUT" : "POST", body: JSON.stringify({ ...body, ...(current ? { revision: current.revision } : {}) }),
  });
}
export async function deleteEditorDraft(kind: EditorDraftKind, draft: EditorDraftSummary, templateId?: string) {
  await apiFetch<unknown>(editorDraftPath(kind, draft.id) + draftQuery({ templateId, revision: draft.revision }), { method: "DELETE" });
}
export async function commitTemplateEditorDraft(draft: Pick<EditorDraft, "id" | "revision">, body: ProcessFlowTemplateCreate) {
  return apiFetch<ProcessFlowTemplate>(editorDraftPath("template", draft.id) + "/commit", {
    method: "POST", body: JSON.stringify({ revision: draft.revision, processFlowTemplate: body }),
  });
}
export async function commitTemplateInstanceEditorDraft(
  draft: Pick<EditorDraft, "id" | "revision">,
  body: TemplateInstanceCreateRequest,
) {
  return apiFetch<{ processFlowTemplate: ProcessFlowTemplate; processFlowInstance: ProcessFlowInstance }>(
    editorDraftPath("template", draft.id) + "/commit",
    { method: "POST", body: JSON.stringify({ revision: draft.revision, ...body }) },
  );
}
export async function commitInstanceEditorDraft(draft: Pick<EditorDraft, "id" | "revision">, body: ProcessFlowInstanceCreate) {
  return apiFetch<ProcessFlowInstance>(editorDraftPath("instance", draft.id) + "/commit", {
    method: "POST", body: JSON.stringify({ revision: draft.revision, processFlowInstance: body }),
  });
}
