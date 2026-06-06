import { normalizeGeometryStructure } from "../data/schema.js";
import {
  geometryStructureToProcessGeometryState,
  processGeometryStateToGeometryStructure,
} from "./geometry-hydration.js";
import { GeometryKernelExecutionResult } from "./execution-result.js";
import { ProcessGeometryState } from "./process-geometry-state.js";
import { ProcessStepModuleResolver } from "./process-step-module-resolver.js";

/**
 * High-level facade for running a process flow against geometry data.
 *
 * The kernel loads flow definitions and geometry structures from repositories,
 * converts geometry JSON into a mutable ProcessGeometryState, executes each process-step
 * module, and returns a serializable result.
 */
export class GeometryKernel {
  /**
   * Create a kernel from repository-like objects.
   *
   * Every repository must expose `getById(id)`. The instance repository is only
   * required when `execute()` receives a process flow instance id.
   */
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

  /**
   * Execute all steps in a process flow instance.
   *
   * Steps run in dependency order based on `stepOutput` edges. Each process
   * module receives a context object containing `state`, normalized `values`,
   * metadata, and resolved geometry inputs.
   *
   * @param {string|object} processFlowInstanceOrId - Instance id or instance object.
   * @param {object} options
   * @param {?string} options.outputStepRefId - Return this step output instead of the terminal output.
   * @returns {Promise<GeometryKernelExecutionResult>}
   */
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
      const runtimeGeometryInputs = await this._resolveGeometryInputs({
        stepRef,
        stepTemplate,
        stepValueSet,
        processFlowTemplate,
        stepOutputs,
      });
      const inputGeometry = firstMapValue(runtimeGeometryInputs);
      const state = inputGeometry
        ? geometryInputToProcessGeometryState(inputGeometry)
        : newProcessGeometryState();
      const geometryInputs = serializeGeometryInputMap(runtimeGeometryInputs);
      const values = buildValues(stepTemplate.fieldDefinitions ?? [], fieldValues);
      const processModule = await this._moduleResolver.resolve(stepTemplate);
      const context = {
        kernel: this,
        state,
        values,
        rawFieldValues: fieldValues,
        stepRef,
        stepTemplate,
        stepValueSet,
        processFlowTemplate,
        processFlowInstance,
        geometryInputs,
        inputGeometry: firstMapValue(geometryInputs),
        value(fieldId) {
          return values[fieldId];
        },
        geometryState(fieldId) {
          const geometry = runtimeGeometryInputs.get(fieldId);
          return geometry === undefined
            ? null
            : geometryInputToProcessGeometryState(geometry);
        },
      };

      const output = await processModule.execute(context);
      stepOutputs.set(stepRef.stepRefId, normalizeStepOutputState(output, state));
    }

    const terminalStepRefIds = findTerminalStepRefIds(stepRefsById, processFlowTemplate.flowEdges ?? []);
    const selectedStepRefId = options.outputStepRefId ?? terminalStepRefIds.at(-1);
    if (!selectedStepRefId) {
      throw new Error("Process flow does not contain an executable terminal step");
    }
    const selectedOutput = stepOutputs.get(selectedStepRefId);
    if (selectedOutput === undefined) {
      throw new Error(`No geometry output for terminal step ${selectedStepRefId}`);
    }
    const geometryStructure = processGeometryStateToGeometryStructure(selectedOutput);

    return new GeometryKernelExecutionResult({
      geometryStructure,
      stepOutputs: serializeStepOutputs(stepOutputs),
      terminalStepRefIds,
    });
  }

  /**
   * Execute the minimum preview path for one flow edge.
   *
   * GeometryRef edges resolve directly to the selected geometry entity. Step
   * output edges execute only the upstream closure required to produce the
   * source step output, leaving downstream draft fields out of scope.
   *
   * @param {object} input
   * @param {object} input.processFlowTemplate
   * @param {object} input.processFlowInstance
   * @param {object} input.previewTarget
   * @param {"edge"|"stepOutput"} input.previewTarget.type
   * @param {?string} input.previewTarget.previewEdgeId
   * @param {?string} input.previewTarget.stepRefId
   * @param {?string} input.previewEdgeId - Backward-compatible edge preview id.
   * @returns {Promise<{geometryStructure: object, sourceKind: string, outputStepRefId: ?string}>}
   */
  async executePreview(input = {}) {
    const processFlowTemplate = input.processFlowTemplate;
    const processFlowInstance = input.processFlowInstance;
    const previewTarget = normalizePreviewTarget(input);

    if (!processFlowTemplate || typeof processFlowTemplate !== "object") {
      throw new Error("processFlowTemplate is required for geometry preview");
    }
    if (!processFlowInstance || typeof processFlowInstance !== "object") {
      throw new Error("processFlowInstance is required for geometry preview");
    }
    if (!previewTarget) {
      throw new Error("preview target is required");
    }

    if (previewTarget.type === "stepOutput") {
      const outputStepRefId = previewTarget.stepRefId;
      const previewId = `step-output-${outputStepRefId}`;
      const includedStepRefIds = upstreamClosureStepRefIds(
        processFlowTemplate,
        outputStepRefId,
      );
      const previewTemplate = buildPreviewFlowTemplate(
        processFlowTemplate,
        includedStepRefIds,
        previewId,
      );
      const previewInstance = buildPreviewFlowInstance(
        processFlowInstance,
        previewTemplate,
        previewId,
      );
      const previewKernel = new GeometryKernel({
        geometryRepository: this._geometryRepository,
        processStepRepository: this._processStepRepository,
        processFlowTemplateRepository: objectRepository(previewTemplate),
        processFlowInstanceRepository: objectRepository(previewInstance),
        moduleResolver: this._moduleResolver,
      });
      const result = await previewKernel.execute(previewInstance, {
        outputStepRefId,
      });

      return {
        geometryStructure: result.geometry(),
        sourceKind: "stepOutput",
        outputStepRefId,
      };
    }

    const previewEdgeId = previewTarget.previewEdgeId;
    const previewEdge = (processFlowTemplate.flowEdges ?? []).find(
      (edge) => edge.edgeId === previewEdgeId,
    );
    if (!previewEdge) {
      throw new Error(`Preview edge not found: ${previewEdgeId}`);
    }

    if (previewEdge.source?.sourceType === "geometryRef") {
      const valueSet = findStepValueSet(
        processFlowInstance.stepValueSets ?? [],
        previewEdge.target?.stepRefId,
      );
      const geometryEntityId = findFieldValue(
        valueSet?.fieldValues ?? [],
        previewEdge.target?.targetFieldId,
      );
      if (typeof geometryEntityId !== "string" || geometryEntityId.trim() === "") {
        throw new Error(
          `Preview edge ${previewEdgeId} requires a selected geometry entity id`,
        );
      }
      const entity = await this._getByIdOrThrow(
        this._geometryRepository,
        geometryEntityId,
        "Geometry entity",
      );
      if (!entity.structure) {
        throw new Error(`Geometry entity ${geometryEntityId} is missing structure`);
      }
      return {
        geometryStructure: normalizeGeometryStructure(entity.structure),
        sourceKind: "geometryRef",
        outputStepRefId: null,
      };
    }

    if (previewEdge.source?.sourceType !== "stepOutput") {
      throw new Error(`Unsupported preview edge source: ${previewEdge.source?.sourceType}`);
    }

    const outputStepRefId = previewEdge.source.stepRefId;
    const includedStepRefIds = upstreamClosureStepRefIds(
      processFlowTemplate,
      outputStepRefId,
    );
    const previewTemplate = buildPreviewFlowTemplate(
      processFlowTemplate,
      includedStepRefIds,
      previewEdgeId,
    );
    const previewInstance = buildPreviewFlowInstance(
      processFlowInstance,
      previewTemplate,
      previewEdgeId,
    );
    const previewKernel = new GeometryKernel({
      geometryRepository: this._geometryRepository,
      processStepRepository: this._processStepRepository,
      processFlowTemplateRepository: objectRepository(previewTemplate),
      processFlowInstanceRepository: objectRepository(previewInstance),
      moduleResolver: this._moduleResolver,
    });
    const result = await previewKernel.execute(previewInstance, {
      outputStepRefId,
    });

    return {
      geometryStructure: result.geometry(),
      sourceKind: "stepOutput",
      outputStepRefId,
    };
  }

  /**
   * Resolve an instance object from either a direct object or a repository id.
   */
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

  /**
   * Resolve the geometry fields required by one process step.
   *
   * Inputs can come from an upstream step output, an inline geometry structure,
   * or a geometry entity id stored in the geometry repository.
   */
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
      if (isGeometryStructure(fieldValue)) {
        geometryInputs.set(field.id, normalizeGeometryStructure(fieldValue));
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
      geometryInputs.set(field.id, normalizeGeometryStructure(entity.structure));
    }

    return geometryInputs;
  }

  /**
   * Repository helper that keeps missing-id and not-found errors consistent.
   */
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

/**
 * Validate that a repository-like object supports the kernel read API.
 */
function requiredRepository(repository, name) {
  if (!repository || typeof repository.getById !== "function") {
    throw new Error(`${name} with getById(id) is required`);
  }
  return repository;
}

/**
 * Return step references in a safe execution order.
 *
 * Only `stepOutput` edges create execution dependencies. Geometry-ref edges
 * point to external inputs and do not affect ordering.
 */
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

/**
 * Terminal steps are steps whose output is not consumed by another step.
 */
function findTerminalStepRefIds(stepRefsById, flowEdges) {
  const sources = new Set(
    flowEdges
      .filter((edge) => edge.source?.sourceType === "stepOutput")
      .map((edge) => edge.source.stepRefId),
  );
  return Array.from(stepRefsById.keys()).filter((stepRefId) => !sources.has(stepRefId));
}

/**
 * Find the flow edge connected to one step field.
 */
function findIncomingEdge(flowEdges, stepRefId, fieldId) {
  return flowEdges.find(
    (edge) =>
      edge.target?.stepRefId === stepRefId &&
      edge.target?.targetFieldId === fieldId,
  );
}

/**
 * Find the raw value selected for one field in a StepValueSet.
 */
function findFieldValue(fieldValues, fieldId) {
  return fieldValues.find((fieldValue) => fieldValue.fieldId === fieldId)?.value;
}

/**
 * Find one StepValueSet by flow-local step ref id.
 */
function findStepValueSet(stepValueSets, stepRefId) {
  return stepValueSets.find((valueSet) => valueSet.stepRefId === stepRefId);
}

/**
 * Geometry fields are handled separately because they become state inputs.
 */
function isGeometryField(field) {
  return field.valueType === "geometry" || field.valueType === "geometryRef";
}

/**
 * Detect inline geometry structures passed directly in a field value.
 */
function isGeometryStructure(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.hasOwn(value, "root") || Object.hasOwn(value, "bodies"))
  );
}

/**
 * Build the `values` object passed to a process-step module.
 *
 * Geometry fields are skipped because they are provided through `state` and
 * `geometryInputs`. Other fields are normalized by declared value type.
 */
function buildValues(fieldDefinitions, fieldValues) {
  const result = {};
  for (const field of fieldDefinitions) {
    if (isGeometryField(field)) continue;
    const value = findFieldValue(fieldValues, field.id);
    result[field.id] = normalizeFieldValue(field, value);
  }
  return result;
}

/**
 * Convert form-style field values into process-step-friendly JavaScript values.
 */
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

/**
 * Convert repeater field payloads into an array of normalized item objects.
 */
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

/**
 * Return the first geometry input for steps with a single main geometry field.
 */
function firstMapValue(map) {
  for (const value of map.values()) return value;
  return null;
}

/**
 * Convert a process module return value into a runtime state.
 *
 * If the module returns nothing, the mutated fallback state is used as output.
 */
function normalizeStepOutputState(output, fallbackState) {
  const resolvedOutput = output === undefined || output === null ? fallbackState : output;
  return geometryInputToProcessGeometryState(resolvedOutput);
}

function geometryInputToProcessGeometryState(value) {
  if (value instanceof ProcessGeometryState) {
    return value.clone();
  }
  if (value?.toGeometryStructure && typeof value.toGeometryStructure === "function") {
    return geometryStructureToProcessGeometryState(value.toGeometryStructure());
  }
  return geometryStructureToProcessGeometryState(value);
}

function serializeStepOutputs(stepOutputs) {
  const result = new Map();
  for (const [stepRefId, output] of stepOutputs) {
    result.set(stepRefId, processGeometryStateToGeometryStructure(output));
  }
  return result;
}

function serializeGeometryInputMap(geometryInputs) {
  const result = new Map();
  for (const [fieldId, input] of geometryInputs) {
    result.set(fieldId, processGeometryStateToGeometryStructure(input));
  }
  return result;
}

function normalizePreviewTarget(input) {
  const target = input.previewTarget;
  if (target?.type === "edge" && target.previewEdgeId) {
    return { type: "edge", previewEdgeId: target.previewEdgeId };
  }
  if (target?.type === "stepOutput" && target.stepRefId) {
    return { type: "stepOutput", stepRefId: target.stepRefId };
  }
  if (input.previewEdgeId) {
    return { type: "edge", previewEdgeId: input.previewEdgeId };
  }
  if (input.outputStepRefId) {
    return { type: "stepOutput", stepRefId: input.outputStepRefId };
  }
  return null;
}

/**
 * Create an empty ProcessGeometryState for steps that do not require geometry input.
 */
function newProcessGeometryState() {
  return geometryStructureToProcessGeometryState({
    key: "main",
    bodies: [],
    vias: [],
    circuits: [],
    bumps: [],
    children: [],
  }, {
    footprint: null,
  });
}

function upstreamClosureStepRefIds(processFlowTemplate, outputStepRefId) {
  const stepRefIds = new Set(
    (processFlowTemplate.stepRefs ?? []).map((stepRef) => stepRef.stepRefId),
  );
  if (!stepRefIds.has(outputStepRefId)) {
    throw new Error(`Preview source step not found: ${outputStepRefId}`);
  }

  const reverseDependencies = new Map();
  stepRefIds.forEach((stepRefId) => reverseDependencies.set(stepRefId, []));
  for (const edge of processFlowTemplate.flowEdges ?? []) {
    if (
      edge.source?.sourceType === "stepOutput" &&
      stepRefIds.has(edge.source.stepRefId) &&
      stepRefIds.has(edge.target?.stepRefId)
    ) {
      reverseDependencies.get(edge.target.stepRefId).push(edge.source.stepRefId);
    }
  }

  const included = new Set();
  const visiting = new Set();
  function visit(stepRefId) {
    if (included.has(stepRefId)) return;
    if (visiting.has(stepRefId)) {
      throw new Error("Process flow contains a cycle in preview upstream closure");
    }
    visiting.add(stepRefId);
    for (const upstream of reverseDependencies.get(stepRefId) ?? []) {
      visit(upstream);
    }
    visiting.delete(stepRefId);
    included.add(stepRefId);
  }

  visit(outputStepRefId);
  return included;
}

function buildPreviewFlowTemplate(processFlowTemplate, includedStepRefIds, previewEdgeId) {
  const stepRefs = (processFlowTemplate.stepRefs ?? []).filter((stepRef) =>
    includedStepRefIds.has(stepRef.stepRefId),
  );
  const flowEdges = (processFlowTemplate.flowEdges ?? []).filter((edge) => {
    if (!includedStepRefIds.has(edge.target?.stepRefId)) return false;
    return (
      edge.source?.sourceType === "geometryRef" ||
      includedStepRefIds.has(edge.source?.stepRefId)
    );
  });

  return {
    ...processFlowTemplate,
    id: `${processFlowTemplate.id ?? "flow"}__preview__${previewEdgeId}`,
    stepRefs,
    flowEdges,
  };
}

function buildPreviewFlowInstance(processFlowInstance, previewTemplate, previewEdgeId) {
  const includedStepRefIds = new Set(
    (previewTemplate.stepRefs ?? []).map((stepRef) => stepRef.stepRefId),
  );

  return {
    ...processFlowInstance,
    id: `${processFlowInstance.id ?? "instance"}__preview__${previewEdgeId}`,
    processFlowTemplateId: previewTemplate.id,
    stepValueSets: (processFlowInstance.stepValueSets ?? []).filter((valueSet) =>
      includedStepRefIds.has(valueSet.stepRefId),
    ),
  };
}

function objectRepository(item) {
  return {
    async getById(id) {
      return item?.id === id ? item : null;
    },
  };
}
