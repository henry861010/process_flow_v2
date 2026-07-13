import type {
  GeometryEntity,
  ProcessFlowInstance,
  ProcessFlowTemplate,
  ProcessFlowWorkspace,
  ProcessStepTemplate,
} from "@/lib/process-flow/types";

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

export async function resetPocData(): Promise<BootstrapPayload> {
  return apiFetch<BootstrapPayload>("/api/reset", {
    method: "POST",
  });
}

export async function createGeometry(geometry: unknown): Promise<GeometryEntity> {
  return apiFetch<GeometryEntity>("/api/geometries", {
    method: "POST",
    body: JSON.stringify(geometry),
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

export async function deleteProcessStepTemplate(templateId: string): Promise<void> {
  await apiFetch<unknown>(`/api/process-step-templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}

export async function listProcessFlowTemplates<T>(): Promise<T[]> {
  return apiFetch<T[]>("/api/process-flow-templates");
}

export async function createProcessFlowTemplate<T>(template: T): Promise<T> {
  return apiFetch<T>("/api/process-flow-templates", {
    method: "POST",
    body: JSON.stringify(template),
  });
}

export async function createProcessFlowTemplateInstance<
  TTemplate,
  TInstanceCreate,
  TInstance = TInstanceCreate,
>(payload: {
  processFlowTemplate: TTemplate;
  processFlowInstance: TInstanceCreate;
}): Promise<{
  processFlowTemplate: TTemplate;
  processFlowInstance: TInstance;
}> {
  return apiFetch("/api/process-flow-template-instances", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createProcessFlowInstance<
  TCreate,
  TInstance = TCreate,
>(instance: TCreate): Promise<TInstance> {
  return apiFetch<TInstance>("/api/process-flow-instances", {
    method: "POST",
    body: JSON.stringify(instance),
  });
}

export type ProcessFlowWorkspaceCreate = Pick<
  ProcessFlowWorkspace,
  | "name"
  | "processFlowTemplateId"
  | "inputBindings"
  | "stepConfigurations"
  | "embeddedGeometries"
>;

export type ProcessFlowWorkspaceUpdate = Pick<
  ProcessFlowWorkspace,
  "name" | "revision" | "inputBindings" | "stepConfigurations" | "embeddedGeometries"
>;

export async function createProcessFlowWorkspace(
  workspace: ProcessFlowWorkspaceCreate,
) {
  return apiFetch<ProcessFlowWorkspace>("/api/process-flow-workspaces", {
    method: "POST",
    body: JSON.stringify(workspace),
  });
}

export async function getProcessFlowWorkspace(workspaceId: string) {
  return apiFetch<ProcessFlowWorkspace>(
    `/api/process-flow-workspaces/${encodeURIComponent(workspaceId)}`,
  );
}

export async function updateProcessFlowWorkspace(
  workspaceId: string,
  workspace: ProcessFlowWorkspaceUpdate,
) {
  return apiFetch<ProcessFlowWorkspace>(
    `/api/process-flow-workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: "PUT",
      body: JSON.stringify(workspace),
    },
  );
}

export async function commitProcessFlowWorkspace(
  workspaceId: string,
  request: { instanceId: string; instanceName: string; revision: number },
) {
  return apiFetch<{
    workspace: ProcessFlowWorkspace;
    processFlowInstance: ProcessFlowInstance;
  }>(`/api/process-flow-workspaces/${encodeURIComponent(workspaceId)}/commit`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}
