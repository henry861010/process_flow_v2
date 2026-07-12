import {
  ApiRequestError,
  apiFetch,
  processFlowApiBaseUrl,
} from "@/lib/process-flow-api";
import type {
  FlowConfiguration,
  ProcessFlowTemplate,
} from "@/lib/process-flow/types";

export type GeometryPreviewTarget =
  | { type: "flowInput"; flowInputId: string }
  | { type: "stepOutput"; stepRefId: string; outputPortId?: string };

export type GeometryPreviewRequest = {
  target: GeometryPreviewTarget;
  sourceLabel?: string | null;
  flowTemplate?: ProcessFlowTemplate;
  processFlowTemplateId?: string;
  configuration: FlowConfiguration;
};

export type GeometryEntityDownload = {
  id: null;
  category: string | null;
  entityType: string;
  name: string;
  version: null;
  owner: null;
  description: string | null;
  structureFormat: "standard";
  structure: unknown;
};

export type GeometryPreviewResponse = {
  geometryEntityJson: GeometryEntityDownload;
  glbBase64: string;
};

export type GeometryPreviewSnapshot = {
  snapshotId: string;
  sourceKind: "flowInput" | "stepOutput";
  stepRefId: string | null;
  label: string;
  order: number;
  geometryHash: string;
  geometryEntityJson: GeometryEntityDownload;
  meshUrl: string;
  sectionUrl: string;
};

export type GeometryPreviewSession = {
  sessionId: string;
  initialSnapshotId: string;
  snapshots: GeometryPreviewSnapshot[];
};

export type GeometrySectionAxis = "x" | "y";

export type GeometrySectionRegion = {
  bodyId: string;
  sourceIds: string[];
  containerId: string;
  containerKey: string;
  material: string;
  bodyKind: "body" | "feature";
  featureType: string | null;
  approximationKind: "exact" | "envelope";
  area: number;
  outer: [number, number][];
  holes: [number, number][][];
};

export type GeometrySectionResponse = {
  snapshotId: string;
  geometryHash: string;
  unitSystem: string;
  axis: GeometrySectionAxis;
  position: number;
  regions: GeometrySectionRegion[];
};

export async function requestGeometryPreview(
  request: GeometryPreviewRequest,
  signal?: AbortSignal,
): Promise<GeometryPreviewResponse> {
  return apiFetch<GeometryPreviewResponse>("/api/geometry-preview", {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });
}

export async function requestGeometryPreviewSession(
  request: GeometryPreviewRequest,
  signal?: AbortSignal,
): Promise<GeometryPreviewSession> {
  return apiFetch<GeometryPreviewSession>("/api/preview-sessions", {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });
}

export async function requestGeometryPreviewModel(
  snapshot: GeometryPreviewSnapshot,
  signal?: AbortSignal,
) {
  const response = await fetch(apiUrl(snapshot.meshUrl), { signal });
  if (!response.ok) {
    throw new ApiRequestError(
      `Preview mesh request failed: ${response.status}`,
      response.status,
    );
  }
  return response.blob();
}

export async function requestGeometrySection(
  snapshot: GeometryPreviewSnapshot,
  axis: GeometrySectionAxis,
  position: number,
  signal?: AbortSignal,
): Promise<GeometrySectionResponse> {
  const url = new URL(apiUrl(snapshot.sectionUrl));
  url.searchParams.set("axis", axis);
  url.searchParams.set("position", String(position));
  return apiFetch<GeometrySectionResponse>(url.toString(), { signal });
}

function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${processFlowApiBaseUrl()}${normalizedPath}`;
}
