import { apiFetch } from "@/lib/process-flow-api";
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
