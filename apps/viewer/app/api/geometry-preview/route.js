import { GeometryKernel, InMemoryRepository } from "../../../../../src/kernel/index.js";
import {
  enqueueGeometryExport,
  isGeometryExportAbortError,
} from "./export-queue.js";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const payload = await request.json();
    const normalized = normalizePreviewRequest(payload);
    validatePreviewRequest(normalized);

    const kernel = new GeometryKernel({
      geometryRepository: new InMemoryRepository(normalized.geometries),
      processStepRepository: new InMemoryRepository(normalized.processStepTemplates),
      processFlowTemplateRepository: new InMemoryRepository([
        normalized.flowTemplate,
      ]),
      processFlowInstanceRepository: new InMemoryRepository([
        normalized.draftInstance,
      ]),
    });

    const preview = await kernel.executePreview({
      processFlowTemplate: normalized.flowTemplate,
      processFlowInstance: normalized.draftInstance,
      previewTarget: normalized.target,
    });
    const geometryStructure = preview.geometryStructure;
    const glbBytes = await enqueueGeometryExport({
      geometryStructure,
      format: "glb",
      priority: "high",
      signal: request.signal,
    });
    const geometryEntityJson = buildGeometryEntityDownload({
      geometryStructure,
      previewId: previewIdForTarget(normalized.target),
      sourceKind: preview.sourceKind,
      outputStepRefId: preview.outputStepRefId,
      sourceLabel: normalized.sourceLabel,
    });

    return Response.json({
      geometryEntityJson,
      glbBase64: Buffer.from(glbBytes).toString("base64"),
    });
  } catch (error) {
    if (isGeometryExportAbortError(error)) {
      return new Response(null, { status: 499 });
    }
    const message =
      error instanceof Error ? error.message : "Unable to generate geometry preview.";
    return Response.json({ message }, { status: 400 });
  }
}

function normalizePreviewRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Preview request body is required.");
  }

  const geometries = ensureGeometryStructures(
    expectArray(payload.geometries, "geometries"),
  );

  return {
    target: normalizePreviewTarget(payload),
    sourceLabel:
      typeof payload.sourceLabel === "string" ? payload.sourceLabel : null,
    flowTemplate: expectObject(payload.flowTemplate, "flowTemplate"),
    draftInstance: expectObject(payload.draftInstance, "draftInstance"),
    geometries,
    processStepTemplates: expectArray(
      payload.processStepTemplates,
      "processStepTemplates",
    ),
  };
}

function normalizePreviewTarget(payload) {
  if (payload.target && typeof payload.target === "object") {
    if (payload.target.type === "edge") {
      return {
        type: "edge",
        previewEdgeId: expectString(payload.target.previewEdgeId, "target.previewEdgeId"),
      };
    }
    if (payload.target.type === "stepOutput") {
      return {
        type: "stepOutput",
        stepRefId: expectString(payload.target.stepRefId, "target.stepRefId"),
      };
    }
  }

  if (typeof payload.previewEdgeId === "string") {
    return { type: "edge", previewEdgeId: payload.previewEdgeId };
  }

  throw new Error("Preview target is required.");
}

function validatePreviewRequest(request) {
  const { flowTemplate, draftInstance, target } = request;

  const stepTemplateById = new Map(
    request.processStepTemplates.map((stepTemplate) => [
      stepTemplate.id,
      stepTemplate,
    ]),
  );
  const stepRefsById = new Map(
    (flowTemplate.stepRefs ?? []).map((stepRef) => [stepRef.stepRefId, stepRef]),
  );
  const valueSetsByStepRef = new Map(
    (draftInstance.stepValueSets ?? []).map((valueSet) => [
      valueSet.stepRefId,
      valueSet,
    ]),
  );
  const geometryIds = new Set(request.geometries.map((geometry) => geometry.id));

  if (draftInstance.processFlowTemplateId !== flowTemplate.id) {
    throw new Error("Draft instance does not reference the preview flow template.");
  }
  if ((flowTemplate.stepRefs ?? []).length === 0) {
    throw new Error("Flow template has no process steps.");
  }

  for (const stepRef of flowTemplate.stepRefs ?? []) {
    const stepTemplate = stepTemplateById.get(stepRef.processStepTemplateId);
    if (!stepTemplate) {
      throw new Error(
        `Step template not found: ${stepRef.processStepTemplateId}`,
      );
    }
    if (!valueSetsByStepRef.has(stepRef.stepRefId)) {
      throw new Error(`Missing StepValueSet for ${stepRef.stepRefId}`);
    }
  }

  validateFlowEdges(flowTemplate, stepRefsById, stepTemplateById);
  if (hasStepOutputCycle(flowTemplate)) {
    throw new Error("Pre-flow must be acyclic.");
  }

  const completion = buildStepCompletionChecker({
    flowTemplate,
    stepRefsById,
    stepTemplateById,
    valueSetsByStepRef,
    geometryIds,
  });

  if (target.type === "stepOutput") {
    if (!stepRefsById.has(target.stepRefId)) {
      throw new Error(`Preview source step not found: ${target.stepRefId}`);
    }
    if (!hasInitialGeometryPath(flowTemplate, target.stepRefId)) {
      throw new Error("Preview step is not reachable from an initial geometry source.");
    }
    const sourceCompletion = completion(target.stepRefId, new Set());
    if (!sourceCompletion.complete) {
      throw new Error(sourceCompletion.message);
    }
    return;
  }

  const edge = (flowTemplate.flowEdges ?? []).find(
    (candidate) => candidate.edgeId === target.previewEdgeId,
  );
  if (!edge) {
    throw new Error(`Preview edge not found: ${target.previewEdgeId}`);
  }

  const targetStepRef = stepRefsById.get(edge.target?.stepRefId);
  const targetTemplate = targetStepRef
    ? stepTemplateById.get(targetStepRef.processStepTemplateId)
    : null;
  const targetField = targetTemplate?.fieldDefinitions?.find(
    (field) => field.id === edge.target?.targetFieldId,
  );
  if (!isGeometryField(targetField)) {
    throw new Error(`Preview edge ${edge.edgeId} does not target a geometry field.`);
  }

  if (edge.source?.sourceType === "geometryRef") {
    const value = fieldValue(
      valueSetsByStepRef.get(edge.target.stepRefId)?.fieldValues,
      edge.target.targetFieldId,
    );
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("Select initial geometry before previewing this edge.");
    }
    if (!geometryIds.has(value)) {
      throw new Error(`Selected geometry not found: ${value}`);
    }
    return;
  }

  if (edge.source?.sourceType !== "stepOutput") {
    throw new Error(`Unsupported preview source: ${edge.source?.sourceType}`);
  }
  if (!stepRefsById.has(edge.source.stepRefId)) {
    throw new Error(`Preview source step not found: ${edge.source.stepRefId}`);
  }

  const sourceCompletion = completion(edge.source.stepRefId, new Set());
  if (!sourceCompletion.complete) {
    throw new Error(sourceCompletion.message);
  }
}

function validateFlowEdges(flowTemplate, stepRefsById, stepTemplateById) {
  const targetSlotCounts = new Map();
  for (const edge of flowTemplate.flowEdges ?? []) {
    const targetStepRef = stepRefsById.get(edge.target?.stepRefId);
    if (!targetStepRef) {
      throw new Error(`Edge ${edge.edgeId} targets a missing step.`);
    }
    const targetTemplate = stepTemplateById.get(targetStepRef.processStepTemplateId);
    const targetField = targetTemplate?.fieldDefinitions?.find(
      (field) => field.id === edge.target?.targetFieldId,
    );
    if (!isGeometryField(targetField)) {
      throw new Error(`Edge ${edge.edgeId} target is not a geometry field.`);
    }
    if (
      edge.source?.sourceType === "stepOutput" &&
      !stepRefsById.has(edge.source.stepRefId)
    ) {
      throw new Error(`Edge ${edge.edgeId} source step is missing.`);
    }
    if (
      edge.source?.sourceType !== "stepOutput" &&
      edge.source?.sourceType !== "geometryRef"
    ) {
      throw new Error(`Edge ${edge.edgeId} has unsupported source type.`);
    }
    const key = `${edge.target.stepRefId}:${edge.target.targetFieldId}`;
    targetSlotCounts.set(key, (targetSlotCounts.get(key) ?? 0) + 1);
  }

  if ([...targetSlotCounts.values()].some((count) => count > 1)) {
    throw new Error("A target geometry slot has more than one incoming edge.");
  }
}

function buildStepCompletionChecker({
  flowTemplate,
  stepRefsById,
  stepTemplateById,
  valueSetsByStepRef,
  geometryIds,
}) {
  const memo = new Map();

  return function isComplete(stepRefId, visiting) {
    const cached = memo.get(stepRefId);
    if (cached) return cached;

    if (visiting.has(stepRefId)) {
      return { complete: false, message: "Pre-flow must be acyclic." };
    }
    const stepRef = stepRefsById.get(stepRefId);
    const stepTemplate = stepRef
      ? stepTemplateById.get(stepRef.processStepTemplateId)
      : null;
    const valueSet = valueSetsByStepRef.get(stepRefId);
    if (!stepRef || !stepTemplate || !valueSet) {
      return { complete: false, message: `Step ${stepRefId} is incomplete.` };
    }

    visiting.add(stepRefId);
    for (const field of stepTemplate.fieldDefinitions ?? []) {
      const value = fieldValue(valueSet.fieldValues, field.id);
      if (isGeometryField(field)) {
        const incoming = (flowTemplate.flowEdges ?? []).filter(
          (edge) =>
            edge.target?.stepRefId === stepRefId &&
            edge.target?.targetFieldId === field.id,
        );
        if (incoming.length !== 1) {
          visiting.delete(stepRefId);
          return {
            complete: false,
            message: `${stepTemplate.name}: ${field.name} has no incoming geometry.`,
          };
        }
        const edge = incoming[0];
        if (edge.source?.sourceType === "geometryRef") {
          if (typeof value !== "string" || !geometryIds.has(value)) {
            visiting.delete(stepRefId);
            return {
              complete: false,
              message: `${stepTemplate.name}: select geometry for ${field.name}.`,
            };
          }
          continue;
        }
        const upstream = isComplete(edge.source.stepRefId, new Set(visiting));
        if (!upstream.complete) {
          visiting.delete(stepRefId);
          return upstream;
        }
        if (value !== null) {
          visiting.delete(stepRefId);
          return {
            complete: false,
            message: `${stepTemplate.name}: ${field.name} must be graph-provided.`,
          };
        }
        continue;
      }

      if (!isFieldValueComplete(field, value)) {
        visiting.delete(stepRefId);
        return {
          complete: false,
          message: `${stepTemplate.name}: ${field.name} is required.`,
        };
      }
    }

    visiting.delete(stepRefId);
    const complete = { complete: true, message: "Complete" };
    memo.set(stepRefId, complete);
    return complete;
  };
}

function hasStepOutputCycle(flowTemplate) {
  const stepIds = new Set((flowTemplate.stepRefs ?? []).map((stepRef) => stepRef.stepRefId));
  const adjacency = new Map([...stepIds].map((stepRefId) => [stepRefId, []]));
  for (const edge of flowTemplate.flowEdges ?? []) {
    if (
      edge.source?.sourceType === "stepOutput" &&
      stepIds.has(edge.source.stepRefId) &&
      stepIds.has(edge.target?.stepRefId)
    ) {
      adjacency.get(edge.source.stepRefId).push(edge.target.stepRefId);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(stepRefId) {
    if (visiting.has(stepRefId)) return true;
    if (visited.has(stepRefId)) return false;
    visiting.add(stepRefId);
    for (const next of adjacency.get(stepRefId) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(stepRefId);
    visited.add(stepRefId);
    return false;
  }

  return [...stepIds].some((stepRefId) => visit(stepRefId));
}

function hasInitialGeometryPath(flowTemplate, targetStepRefId) {
  const queue = (flowTemplate.flowEdges ?? [])
    .filter((edge) => edge.source?.sourceType === "geometryRef")
    .map((edge) => edge.target?.stepRefId)
    .filter(Boolean);
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    if (current === targetStepRefId) {
      return true;
    }
    visited.add(current);
    (flowTemplate.flowEdges ?? [])
      .filter(
        (edge) =>
          edge.source?.sourceType === "stepOutput" &&
          edge.source.stepRefId === current,
      )
      .forEach((edge) => queue.push(edge.target?.stepRefId));
  }

  return false;
}

function isFieldValueComplete(field, value) {
  if (field.valueType === "boolean") return typeof value === "boolean";
  if (field.valueType === "integer") return Number.isInteger(value);
  if (field.valueType === "float") return typeof value === "number" && Number.isFinite(value);
  if (isArrayValueType(field.valueType)) return Array.isArray(value);
  if (field.valueType === "fieldGroupArray") {
    const items = Array.isArray(value?.items) ? value.items : null;
    if (!items) return false;
    const minItems = field.repeatDefinition?.minItems ?? 0;
    const maxItems = field.repeatDefinition?.maxItems ?? Number.POSITIVE_INFINITY;
    if (items.length < minItems || items.length > maxItems) return false;
    const childFields = field.repeatDefinition?.itemFieldDefinitions ?? [];
    return items.every((item) =>
      childFields.every((childField) =>
        isFieldValueComplete(
          childField,
          fieldValue(item.fieldValues, childField.id),
        ),
      ),
    );
  }
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function buildGeometryEntityDownload({
  geometryStructure,
  previewId,
  sourceKind,
  outputStepRefId,
  sourceLabel,
}) {
  const label = sourceLabel || outputStepRefId || previewId;
  const name = label.toLowerCase().endsWith("output")
    ? `Preview - ${label}`
    : `Preview - ${label} output`;
  return {
    id: null,
    category: "preview.generated",
    entityType: "preview",
    name,
    version: null,
    owner: null,
    description: `Generated geometry preview for ${previewId}; source kind ${sourceKind}.`,
    structureFormat: "standard",
    structure: geometryStructure,
  };
}

function previewIdForTarget(target) {
  return target.type === "edge"
    ? target.previewEdgeId
    : `step-output-${target.stepRefId}`;
}

function ensureGeometryStructures(geometries) {
  return geometries.map((geometry) => {
    if (geometry?.structure) return geometry;
    return {
      ...geometry,
      structureFormat: "standard",
      structure: fallbackStructureForGeometry(geometry),
    };
  });
}

function fallbackStructureForGeometry(geometry) {
  const normalized = `${geometry?.entityType ?? ""} ${geometry?.category ?? ""}`.toLowerCase();
  if (normalized.includes("wafer")) {
    return boxStructure("incoming-wafer", "glass", [-5000, -3500, 0], [5000, 3500, 0], 300);
  }
  if (normalized.includes("panel")) {
    return boxStructure("temporary-panel", "glass", [-6500, -4500, 0], [6500, 4500, 0], 450);
  }
  if (normalized.includes("substrate")) {
    return boxStructure("abf-substrate", "abf", [-3300, -3300, 0], [3300, 3300, 0], 260);
  }
  if (normalized.includes("interposer")) {
    return boxStructure("silicon-interposer", "silicon", [-2400, -1400, 0], [2400, 1400, 0], 120);
  }
  if (normalized.includes("memory")) {
    return boxStructure("memory-die", "silicon", [-950, -780, 0], [950, 780, 0], 80);
  }
  if (normalized.includes("die")) {
    return boxStructure("logic-die", "silicon", [-1200, -900, 0], [1200, 900, 0], 110);
  }
  return boxStructure("preview-geometry", "generic", [-1000, -1000, 0], [1000, 1000, 0], 100);
}

function boxStructure(key, material, bottomLeft, topRight, thk) {
  return {
    schemaVersion: "1.0.0",
    unitSystem: "um",
    root: {
      key,
      bodies: [
        {
          geometry: {
            type: "BoxGeometry",
            bottom_left: bottomLeft,
            top_right: topRight,
            thk,
          },
          material,
        },
      ],
      vias: [],
      circuits: [],
      bumps: [],
      children: [],
    },
  };
}

function isGeometryField(field) {
  return field?.valueType === "geometryRef" || field?.valueType === "geometry";
}

function isArrayValueType(valueType) {
  return (
    valueType === "string[]" ||
    valueType === "integer[]" ||
    valueType === "float[]" ||
    valueType === "materialRef[]"
  );
}

function fieldValue(fieldValues, fieldId) {
  return (fieldValues ?? []).find((fieldValue) => fieldValue.fieldId === fieldId)?.value;
}

function expectArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value;
}

function expectObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function expectString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}
