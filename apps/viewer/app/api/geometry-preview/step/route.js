import { normalizeGeometryStructure } from "../../../../../../src/data/schema.js";
import {
  enqueueGeometryExport,
  isGeometryExportAbortError,
} from "../export-queue.js";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const payload = await request.json();
    const geometryStructure = normalizeStepRequest(payload);
    const stepBytes = await enqueueGeometryExport({
      geometryStructure,
      format: "step",
      priority: "low",
      signal: request.signal,
    });

    return Response.json({
      stepBase64: Buffer.from(stepBytes).toString("base64"),
    });
  } catch (error) {
    if (isGeometryExportAbortError(error)) {
      return new Response(null, { status: 499 });
    }
    const message =
      error instanceof Error ? error.message : "Unable to generate STEP export.";
    return Response.json({ message }, { status: 400 });
  }
}

function normalizeStepRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("STEP export request body is required.");
  }
  if (!Object.hasOwn(payload, "geometryStructure")) {
    throw new Error("geometryStructure is required.");
  }
  return normalizeGeometryStructure(payload.geometryStructure);
}
