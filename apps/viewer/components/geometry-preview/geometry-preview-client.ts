import { apiFetch } from "@/lib/process-flow-api";

export type GeometryPreviewTarget =
  | { type: "edge"; previewEdgeId: string }
  | { type: "stepOutput"; stepRefId: string };

export type GeometryPreviewRequest = {
  target: GeometryPreviewTarget;
  sourceLabel?: string | null;
  flowTemplate: unknown;
  draftInstance: unknown;
  geometries: unknown[];
  processStepTemplates: unknown[];
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
