export type GeometryPreviewRequest = {
  previewEdgeId: string;
  sourceLabel?: string | null;
  flowTemplate: unknown;
  draftInstance: unknown;
  geometries: unknown[];
  processStepTemplates: unknown[];
};

export type GeometryEntityDownload = {
  id: null;
  category: string | null;
  name: string;
  version: null;
  owner: null;
  description: string | null;
  structureFormat: "standard";
  structure: unknown;
};

export type GeometryPreviewResponse = {
  geometryJson: GeometryEntityDownload;
  glbBase64: string;
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
    typeof payload.geometryJson !== "object"
  ) {
    throw new Error("Geometry preview response is malformed.");
  }

  return payload as GeometryPreviewResponse;
}
