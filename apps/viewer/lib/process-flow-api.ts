const DEFAULT_API_BASE_URL = "http://localhost:8000";

export type BootstrapPayload = {
  processStepTemplates: unknown[];
  processFlowTemplates: unknown[];
  processFlowInstances: unknown[];
  geometries: unknown[];
};

export function processFlowApiBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL?.replace(/\/$/, "") ||
    DEFAULT_API_BASE_URL
  );
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${processFlowApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload.message === "string"
        ? payload.message
        : `API request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function loadBootstrap(): Promise<BootstrapPayload> {
  return apiFetch<BootstrapPayload>("/api/admin/seed", {
    method: "POST",
    body: JSON.stringify({ mode: "ifEmpty" }),
  });
}

export async function resetPocData(): Promise<BootstrapPayload> {
  return apiFetch<BootstrapPayload>("/api/admin/seed", {
    method: "POST",
    body: JSON.stringify({ mode: "reset" }),
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

export async function createProcessFlowTemplateInstance<
  TTemplate,
  TInstance,
>(payload: {
  processFlowTemplate: TTemplate;
  processFlowInstance: TInstance;
}): Promise<{
  processFlowTemplate: TTemplate;
  processFlowInstance: TInstance;
}> {
  return apiFetch("/api/process-flow-template-instances", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createProcessFlowInstance<T>(instance: T): Promise<T> {
  return apiFetch<T>("/api/process-flow-instances", {
    method: "POST",
    body: JSON.stringify(instance),
  });
}
