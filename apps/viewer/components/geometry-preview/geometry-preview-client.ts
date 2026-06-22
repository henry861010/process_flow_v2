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

export type GeometryPreviewStepRequest = {
  geometryStructure: unknown;
};

export type GeometryPreviewStepResponse = {
  stepBase64: string;
};

export async function requestGeometryPreview(
  request: GeometryPreviewRequest,
  signal?: AbortSignal,
): Promise<GeometryPreviewResponse> {
  const response = await fetch("/api/geometry-preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload.message === "string"
        ? payload.message
        : "Unable to generate geometry preview.";
    throw new Error(message);
  }

  if (
    !payload ||
    typeof payload.glbBase64 !== "string" ||
    typeof payload.geometryEntityJson !== "object"
  ) {
    throw new Error("Geometry preview response is malformed.");
  }

  return payload as GeometryPreviewResponse;
}

export async function requestGeometryPreviewStep(
  request: GeometryPreviewStepRequest,
  signal?: AbortSignal,
): Promise<GeometryPreviewStepResponse> {
  const response = await fetch("/api/geometry-preview/step", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload.message === "string"
        ? payload.message
        : "Unable to generate STEP export.";
    throw new Error(message);
  }

  if (!payload || typeof payload.stepBase64 !== "string") {
    throw new Error("Geometry STEP response is malformed.");
  }

  return payload as GeometryPreviewStepResponse;
}
