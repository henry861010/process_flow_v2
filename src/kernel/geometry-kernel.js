import { normalizeGeometryDocument } from "../data/schema.js";
import {
  geometryDocumentToStatus,
  statusToGeometryDocument,
} from "./geometry-hydration.js";
import { GeometryKernelExecutionResult } from "./execution-result.js";
import { ProcessStepModuleResolver } from "./process-step-module-resolver.js";

export class GeometryKernel {
  constructor({
    geometryRepository,
    processFlowInstanceRepository = null,
    processFlowTemplateRepository,
    processStepRepository,
    moduleResolver = null,
  } = {}) {
    this._geometryRepository = requiredRepository(
      geometryRepository,
      "geometryRepository",
    );
    this._processFlowInstanceRepository = processFlowInstanceRepository;
    this._processFlowTemplateRepository = requiredRepository(
      processFlowTemplateRepository,
      "processFlowTemplateRepository",
    );
    this._processStepRepository = requiredRepository(
      processStepRepository,
      "processStepRepository",
    );
    this._moduleResolver = moduleResolver ?? new ProcessStepModuleResolver();
  }

  async execute(processFlowInstanceOrId, options = {}) {
    const processFlowInstance = await this._resolveProcessFlowInstance(
      processFlowInstanceOrId,
    );
    const processFlowTemplate = await this._getByIdOrThrow(
      this._processFlowTemplateRepository,
      processFlowInstance.processFlowTemplateId,
      "Process flow template",
    );

    const stepValueSetsByRefId = new Map(
      (processFlowInstance.stepValueSets ?? []).map((valueSet) => [
        valueSet.stepRefId,
        valueSet,
      ]),
    );
    const stepRefs = processFlowTemplate.stepRefs ?? [];
    const stepRefsById = new Map(stepRefs.map((stepRef) => [stepRef.stepRefId, stepRef]));
    const orderedStepRefs = topologicalStepRefs(stepRefs, processFlowTemplate.flowEdges ?? []);
    const stepOutputs = new Map();

    for (const stepRef of orderedStepRefs) {
      const stepTemplate = await this._getByIdOrThrow(
        this._processStepRepository,
        stepRef.processStepTemplateId,
        "Process step template",
      );
      const stepValueSet = stepValueSetsByRefId.get(stepRef.stepRefId);
      if (!stepValueSet) {
        throw new Error(`Missing StepValueSet for stepRefId ${stepRef.stepRefId}`);
      }

      const fieldValues = stepValueSet.fieldValues ?? [];
      const geometryInputs = await this._resolveGeometryInputs({
        stepRef,
        stepTemplate,
        stepValueSet,
        processFlowTemplate,
        stepOutputs,
      });
      const inputGeometry = firstMapValue(geometryInputs);
      const status = inputGeometry
        ? geometryDocumentToStatus(inputGeometry)
        : newStatus();
      const values = buildValues(stepTemplate.fieldDefinitions ?? [], fieldValues);
      const processModule = await this._moduleResolver.resolve(stepTemplate);
      const context = {
        kernel: this,
        status,
        values,
        rawFieldValues: fieldValues,
        stepRef,
        stepTemplate,
        stepValueSet,
        processFlowTemplate,
        processFlowInstance,
        geometryInputs,
        inputGeometry,
        value(fieldId) {
          return values[fieldId];
        },
        geometryStatus(fieldId) {
          const geometry = geometryInputs.get(fieldId);
          return geometry === undefined ? null : geometryDocumentToStatus(geometry);
        },
      };

      const output = await processModule.execute(context);
      stepOutputs.set(stepRef.stepRefId, normalizeStepOutput(output, status));
    }

    const terminalStepRefIds = findTerminalStepRefIds(stepRefsById, processFlowTemplate.flowEdges ?? []);
    const selectedStepRefId = options.outputStepRefId ?? terminalStepRefIds.at(-1);
    if (!selectedStepRefId) {
      throw new Error("Process flow does not contain an executable terminal step");
    }
    const geometryDocument = stepOutputs.get(selectedStepRefId);
    if (geometryDocument === undefined) {
      throw new Error(`No geometry output for terminal step ${selectedStepRefId}`);
    }

    return new GeometryKernelExecutionResult({
      geometryDocument,
      stepOutputs,
      terminalStepRefIds,
    });
  }

  async _resolveProcessFlowInstance(processFlowInstanceOrId) {
    if (typeof processFlowInstanceOrId !== "string") {
      return processFlowInstanceOrId;
    }
    if (!this._processFlowInstanceRepository) {
      throw new Error(
        "processFlowInstanceRepository is required when execute receives an id",
      );
    }
    return this._getByIdOrThrow(
      this._processFlowInstanceRepository,
      processFlowInstanceOrId,
      "Process flow instance",
    );
  }

  async _resolveGeometryInputs({
    stepRef,
    stepTemplate,
    stepValueSet,
    processFlowTemplate,
    stepOutputs,
  }) {
    const geometryInputs = new Map();
    const geometryFields = (stepTemplate.fieldDefinitions ?? []).filter(isGeometryField);

    for (const field of geometryFields) {
      const edge = findIncomingEdge(
        processFlowTemplate.flowEdges ?? [],
        stepRef.stepRefId,
        field.id,
      );

      if (edge?.source?.sourceType === "stepOutput") {
        const upstreamStepRefId = edge.source.stepRefId;
        const upstreamGeometry = stepOutputs.get(upstreamStepRefId);
        if (upstreamGeometry === undefined) {
          throw new Error(
            `Step ${stepRef.stepRefId}.${field.id} depends on missing output ${upstreamStepRefId}`,
          );
        }
        geometryInputs.set(field.id, upstreamGeometry);
        continue;
      }

      const fieldValue = findFieldValue(stepValueSet.fieldValues ?? [], field.id);
      if (isGeometryDocument(fieldValue)) {
        geometryInputs.set(field.id, normalizeGeometryDocument(fieldValue));
        continue;
      }
      if (typeof fieldValue !== "string" || fieldValue.trim() === "") {
        throw new Error(
          `Step ${stepRef.stepRefId}.${field.id} requires a geometry entity id`,
        );
      }

      const entity = await this._getByIdOrThrow(
        this._geometryRepository,
        fieldValue,
        "Geometry entity",
      );
      if (!entity.structure) {
        throw new Error(`Geometry entity ${fieldValue} is missing structure`);
      }
      geometryInputs.set(field.id, normalizeGeometryDocument(entity.structure));
    }

    return geometryInputs;
  }

  async _getByIdOrThrow(repository, id, label) {
    if (id === undefined || id === null || id === "") {
      throw new Error(`${label} id is required`);
    }
    const value = await repository.getById(id);
    if (value === null || value === undefined) {
      throw new Error(`${label} not found: ${id}`);
    }
    return value;
  }
}

function requiredRepository(repository, name) {
  if (!repository || typeof repository.getById !== "function") {
    throw new Error(`${name} with getById(id) is required`);
  }
  return repository;
}

function topologicalStepRefs(stepRefs, flowEdges) {
  const stepRefIds = new Set(stepRefs.map((stepRef) => stepRef.stepRefId));
  const incomingCounts = new Map(stepRefs.map((stepRef) => [stepRef.stepRefId, 0]));
  const outgoing = new Map(stepRefs.map((stepRef) => [stepRef.stepRefId, []]));

  for (const edge of flowEdges) {
    if (edge.source?.sourceType !== "stepOutput") continue;
    const source = edge.source.stepRefId;
    const target = edge.target?.stepRefId;
    if (!stepRefIds.has(source) || !stepRefIds.has(target)) continue;
    outgoing.get(source).push(target);
    incomingCounts.set(target, incomingCounts.get(target) + 1);
  }

  const queue = stepRefs
    .filter((stepRef) => incomingCounts.get(stepRef.stepRefId) === 0)
    .map((stepRef) => stepRef.stepRefId);
  const byId = new Map(stepRefs.map((stepRef) => [stepRef.stepRefId, stepRef]));
  const ordered = [];

  while (queue.length > 0) {
    const stepRefId = queue.shift();
    ordered.push(byId.get(stepRefId));
    for (const target of outgoing.get(stepRefId)) {
      incomingCounts.set(target, incomingCounts.get(target) - 1);
      if (incomingCounts.get(target) === 0) {
        queue.push(target);
      }
    }
  }

  if (ordered.length !== stepRefs.length) {
    throw new Error("Process flow contains a cycle in stepOutput edges");
  }

  return ordered;
}

function findTerminalStepRefIds(stepRefsById, flowEdges) {
  const sources = new Set(
    flowEdges
      .filter((edge) => edge.source?.sourceType === "stepOutput")
      .map((edge) => edge.source.stepRefId),
  );
  return Array.from(stepRefsById.keys()).filter((stepRefId) => !sources.has(stepRefId));
}

function findIncomingEdge(flowEdges, stepRefId, fieldId) {
  return flowEdges.find(
    (edge) =>
      edge.target?.stepRefId === stepRefId &&
      edge.target?.targetFieldId === fieldId,
  );
}

function findFieldValue(fieldValues, fieldId) {
  return fieldValues.find((fieldValue) => fieldValue.fieldId === fieldId)?.value;
}

function isGeometryField(field) {
  return field.valueType === "geometry" || field.valueType === "geometryRef";
}

function isGeometryDocument(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.hasOwn(value, "root") || Object.hasOwn(value, "bodies"))
  );
}

function buildValues(fieldDefinitions, fieldValues) {
  const result = {};
  for (const field of fieldDefinitions) {
    if (isGeometryField(field)) continue;
    const value = findFieldValue(fieldValues, field.id);
    result[field.id] = normalizeFieldValue(field, value);
  }
  return result;
}

function normalizeFieldValue(field, value) {
  if (field.valueType === "integer") {
    if (value === "" || value === null || value === undefined) return null;
    return Number.parseInt(value, 10);
  }
  if (field.valueType === "float") {
    if (value === "" || value === null || value === undefined) return null;
    return Number(value);
  }
  if (field.valueType === "boolean") {
    return value === true;
  }
  if (field.valueType === "fieldGroupArray") {
    return normalizeFieldGroupArray(field, value);
  }
  return value;
}

function normalizeFieldGroupArray(field, value) {
  if (!value || !Array.isArray(value.items)) return [];
  const childFields = field.repeatDefinition?.itemFieldDefinitions ?? [];
  return value.items.map((item) => {
    const normalized = {
      _itemId: item.itemId,
      _index: item.index,
    };
    for (const childField of childFields) {
      normalized[childField.id] = normalizeFieldValue(
        childField,
        findFieldValue(item.fieldValues ?? [], childField.id),
      );
    }
    return normalized;
  });
}

function firstMapValue(map) {
  for (const value of map.values()) return value;
  return null;
}

function normalizeStepOutput(output, fallbackStatus) {
  const resolvedOutput = output === undefined || output === null ? fallbackStatus : output;
  return statusToGeometryDocument(resolvedOutput);
}

function newStatus() {
  return geometryDocumentToStatus({
    key: "main",
    bodies: [],
    vias: [],
    circuits: [],
    bumps: [],
    children: [],
  });
}
