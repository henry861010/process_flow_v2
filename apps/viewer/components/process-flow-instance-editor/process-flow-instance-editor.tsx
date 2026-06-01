"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  FileWarning,
  GitBranch,
  Layers3,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { ProcessFlowGraph } from "@/components/process-flow-graph/process-flow-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GEOMETRY_ENTITIES_STORAGE_KEY,
  PROCESS_FLOW_INSTANCES_STORAGE_KEY,
  PROCESS_FLOW_TEMPLATES_STORAGE_KEY,
  PROCESS_STEP_TEMPLATES_STORAGE_KEY,
} from "@/lib/home-local-storage";
import { cn } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

type FieldScope = "inputState" | "outputState" | "processParameter";
type ValueType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "materialRef"
  | "geometryRef"
  | "geometry"
  | "fieldGroupArray"
  | "string[]"
  | "integer[]"
  | "float[]"
  | "materialRef[]";
type ControlType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "repeater"
  | "geometry"
  | null;
type SelectionMode = "single" | "multiple" | null;

type StaticOption = {
  value: string | number;
  name: string;
  description?: string;
};

type OptionSource = {
  type: "static";
  options: StaticOption[];
};

type ValidationRule = {
  regex?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  exclusiveMax?: boolean;
};

type RepeatDefinition = {
  itemNameTemplate: string;
  indexBase: number;
  minItems?: number;
  maxItems?: number;
  itemFieldDefinitions: FieldDefinition[];
};

type FieldDefinition = {
  id: string;
  name: string;
  description?: string;
  scope: FieldScope;
  valueType: ValueType;
  controlType?: ControlType;
  selectionMode?: SelectionMode;
  unit?: string | null;
  optionSource?: OptionSource;
  validation?: ValidationRule;
  repeatDefinition?: RepeatDefinition;
};

type RepeatableGroupValue = {
  items: Array<{
    itemId: string;
    index: number;
    fieldValues: FieldValue[];
  }>;
};

type FieldValue = {
  fieldId: string;
  value: unknown;
};

type ProcessStepTemplate = {
  id: string;
  version: string;
  name: string;
  category: string;
  description: string;
  owner: string;
  fieldDefinitions: FieldDefinition[];
};

type SavedFlowEdge = {
  edgeId: string;
  source:
    | { sourceType: "geometryRef" }
    | { sourceType: "stepOutput"; stepRefId: string };
  target: {
    stepRefId: string;
    targetFieldId: string;
  };
};

type ProcessFlowTemplate = {
  id: string;
  name: string;
  version: string;
  description?: string;
  owner?: string;
  stepRefs: Array<{
    stepRefId: string;
    processStepTemplateId: string;
  }>;
  flowEdges: SavedFlowEdge[];
};

type StepValueSet = {
  stepRefId: string;
  processStepTemplateId: string;
  fieldValues: FieldValue[];
};

type ProcessFlowInstance = {
  id: string;
  name: string;
  processFlowTemplateId: string;
  stepValueSets: StepValueSet[];
};

type GeometryEntity = {
  id: string;
  category: string;
  name: string;
  version: string;
  owner: string;
  description: string;
  entityType: string;
  summary: string;
  structureFormat: string;
};

type DraftValidationStatus = "complete" | "incomplete" | "invalid";

type InitialGeometryNodeData = Record<string, unknown> & {
  nodeKind: "initialGeometry";
  sourceEdgeId: string;
  targetStepRefId: string;
  targetFieldId: string;
  targetFieldName: string;
  selectedGeometryEntityId: string | null;
  selectedGeometryDisplayName: string | null;
  validationStatus?: DraftValidationStatus;
  onPick?: (edgeId: string) => void;
};

type ProcessStepNodeData = Record<string, unknown> & {
  nodeKind: "processStep";
  stepRefId: string;
  processStepTemplateId: string;
  template: ProcessStepTemplate;
  fieldValues: FieldValue[];
  geometryInputFields: FieldDefinition[];
  validationStatus?: DraftValidationStatus;
  blockingFieldName?: string | null;
  onEdit?: (stepRefId: string) => void;
};

type FlowEdgeData = Record<string, unknown> & {
  sourceType: "geometryRef" | "stepOutput";
  sourceStepRefId?: string;
  sourceEdgeId?: string;
  targetStepRefId: string;
  targetFieldId: string;
  slotLabel: string;
  sourceLabel: string;
  readonlyTopology: true;
  onGeometryView?: () => void;
};

type InitialGeometryFlowNode = Node<
  InitialGeometryNodeData,
  "initialGeometry"
>;
type ProcessStepFlowNode = Node<ProcessStepNodeData, "processStep">;
type FlowNode = InitialGeometryFlowNode | ProcessStepFlowNode;
type FlowEdge = Edge<FlowEdgeData, "dataFlow">;

type StepCompletion = {
  complete: boolean;
  blockingFieldName: string | null;
};

type InstanceAnalysis = {
  validationMessage: string;
  canSave: boolean;
  templateSchemaError: string | null;
  flowStepCount: number;
  initialGeometryCount: number;
  initialGeometryCompleteCount: number;
  completeStepCount: number;
  stepCompletion: Map<string, StepCompletion>;
};

type GeometryPreviewState = {
  sourceLabel: string;
  slotLabel: string;
};

type LayoutResult = {
  stepPositions: Map<string, { x: number; y: number }>;
  initialPositions: Map<string, { x: number; y: number }>;
};

export function ProcessFlowInstanceEditor() {
  return (
    <ReactFlowProvider>
      <ProcessFlowInstanceEditorInner />
    </ReactFlowProvider>
  );
}

function ProcessFlowInstanceEditorInner() {
  const router = useRouter();
  const reactFlow = useReactFlow<FlowNode, FlowEdge>();
  const [hydrated, setHydrated] = React.useState(false);
  const [templates, setTemplates] = React.useState<ProcessFlowTemplate[]>([]);
  const [stepTemplates, setStepTemplates] = React.useState<ProcessStepTemplate[]>(
    [],
  );
  const [geometries, setGeometries] = React.useState<GeometryEntity[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(
    null,
  );
  const [productInstanceName, setProductInstanceName] = React.useState("");
  const [nodes, setNodes] = React.useState<FlowNode[]>([]);
  const [edges, setEdges] = React.useState<FlowEdge[]>([]);
  const [editingStepRefId, setEditingStepRefId] = React.useState<string | null>(
    null,
  );
  const [pickingGeometryEdgeId, setPickingGeometryEdgeId] =
    React.useState<string | null>(null);
  const [geometryPreview, setGeometryPreview] =
    React.useState<GeometryPreviewState | null>(null);

  React.useEffect(() => {
    setTemplates(
      readStorageArray<ProcessFlowTemplate>(PROCESS_FLOW_TEMPLATES_STORAGE_KEY),
    );
    setStepTemplates(
      readStorageArray<ProcessStepTemplate>(PROCESS_STEP_TEMPLATES_STORAGE_KEY),
    );
    setGeometries(readStorageArray<GeometryEntity>(GEOMETRY_ENTITIES_STORAGE_KEY));
    setHydrated(true);
  }, []);

  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ?? null;

  const analysis = React.useMemo(
    () =>
      analyzeDraft(
        selectedTemplate,
        productInstanceName,
        nodes,
        stepTemplates,
        geometries,
      ),
    [geometries, nodes, productInstanceName, selectedTemplate, stepTemplates],
  );

  const hasDraftContent = React.useMemo(
    () => draftHasContent(selectedTemplate, productInstanceName, nodes),
    [nodes, productInstanceName, selectedTemplate],
  );

  const displayNodes = React.useMemo<FlowNode[]>(
    () =>
      nodes.map((node) => {
        if (isInitialGeometryNode(node)) {
          const complete =
            Boolean(node.data.selectedGeometryEntityId) &&
            geometries.some(
              (geometry) => geometry.id === node.data.selectedGeometryEntityId,
            );
          const nextNode: InitialGeometryFlowNode = {
            ...node,
            draggable: false,
            data: {
              ...node.data,
              graphMode: "view",
              displayLabel: node.data.selectedGeometryDisplayName ?? "Select geometry",
              displaySublabel: node.data.targetFieldName,
              pickId: node.data.sourceEdgeId,
              status: complete ? "complete" : "incomplete",
              validationStatus: complete ? "complete" : "incomplete",
              onPick: setPickingGeometryEdgeId,
            },
          };
          return nextNode;
        }

        const completion = analysis.stepCompletion.get(node.data.stepRefId) ?? {
          complete: false,
          blockingFieldName: null,
        };
        const nextNode: ProcessStepFlowNode = {
          ...node,
          draggable: false,
          data: {
            ...node.data,
            graphMode: "view",
            displaySublabel: node.data.stepRefId,
            editId: node.data.stepRefId,
            status: completion.complete ? "complete" : "incomplete",
            validationStatus: completion.complete ? "complete" : "incomplete",
            blockingFieldName: completion.blockingFieldName,
            onEdit: setEditingStepRefId,
          },
        };
        return nextNode;
      }),
    [analysis.stepCompletion, geometries, nodes],
  );

  const displayEdges = React.useMemo<FlowEdge[]>(
    () =>
      edges.map((edge) => {
        const targetNode = findProcessNodeById(nodes, edge.target);
        const sourceNode = nodes.find((node) => node.id === edge.source);
        const targetField = targetNode?.data.geometryInputFields.find(
          (field) => field.id === edge.data?.targetFieldId,
        );
        const sourceLabel = sourceNode ? sourceLabelForNode(sourceNode) : "Unknown";
        const nextEdge: FlowEdge = {
          ...edge,
          reconnectable: false,
          focusable: false,
          data: {
            sourceType: edge.data?.sourceType ?? "geometryRef",
            sourceStepRefId: edge.data?.sourceStepRefId,
            sourceEdgeId: edge.data?.sourceEdgeId,
            targetStepRefId: edge.data?.targetStepRefId ?? "",
            targetFieldId: edge.data?.targetFieldId ?? "",
            slotLabel: targetField?.name || edge.data?.targetFieldId || "slot",
            sourceLabel,
            graphMode: "view",
            readonlyTopology: true,
            onGeometryView: () =>
              setGeometryPreview({
                sourceLabel,
                slotLabel: targetField?.name || edge.data?.targetFieldId || "slot",
              }),
          },
        };
        return nextEdge;
      }),
    [edges, nodes],
  );

  const editingStepNode = React.useMemo(
    () => findProcessNodeByStepRef(nodes, editingStepRefId),
    [editingStepRefId, nodes],
  );

  const pickingGeometryNode = React.useMemo(
    () =>
      nodes.find(
        (node): node is InitialGeometryFlowNode =>
          isInitialGeometryNode(node) &&
          node.data.sourceEdgeId === pickingGeometryEdgeId,
      ) ?? null,
    [nodes, pickingGeometryEdgeId],
  );

  React.useEffect(() => {
    if (!selectedTemplateId || nodes.length === 0) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.18, duration: 220 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodes.length, reactFlow, selectedTemplateId]);

  function clearDraft() {
    setSelectedTemplateId(null);
    setProductInstanceName("");
    setNodes([]);
    setEdges([]);
    setEditingStepRefId(null);
    setPickingGeometryEdgeId(null);
    setGeometryPreview(null);
  }

  function requestTemplateChange(nextTemplateId: string) {
    if (nextTemplateId === (selectedTemplateId ?? "")) {
      return;
    }

    if (
      hasDraftContent &&
      !window.confirm(
        "Switching process flow template will discard the current draft values.",
      )
    ) {
      return;
    }

    if (!nextTemplateId) {
      clearDraft();
      return;
    }

    const template = templates.find((item) => item.id === nextTemplateId);
    if (!template) {
      return;
    }

    const draft = buildDraftFromTemplate(template, stepTemplates);
    setSelectedTemplateId(template.id);
    setProductInstanceName("");
    setNodes(draft.nodes);
    setEdges(draft.edges);
    setEditingStepRefId(null);
    setPickingGeometryEdgeId(null);
    setGeometryPreview(null);
  }

  function updateStepFieldValue(stepRefId: string, fieldId: string, value: unknown) {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (!isProcessStepNode(node) || node.data.stepRefId !== stepRefId) {
          return node;
        }
        const nextNode: ProcessStepFlowNode = {
          ...node,
          data: {
            ...node.data,
            fieldValues: updateFieldValue(node.data.fieldValues, fieldId, value),
          },
        };
        return nextNode;
      }),
    );
  }

  function updateRepeaterFieldValue(
    stepRefId: string,
    field: FieldDefinition,
    updater: (current: RepeatableGroupValue) => RepeatableGroupValue,
  ) {
    const node = findProcessNodeByStepRef(nodes, stepRefId);
    const currentValue = getFieldValue(node?.data.fieldValues ?? [], field.id);
    const baseValue: RepeatableGroupValue = isRepeatableGroupValue(currentValue)
      ? currentValue
      : (createDefaultFieldValue(field).value as RepeatableGroupValue);
    updateStepFieldValue(stepRefId, field.id, updater(clone(baseValue)));
  }

  function selectGeometryForEdge(edgeId: string, geometryId: string) {
    const geometry = geometries.find((item) => item.id === geometryId);
    const edge = edges.find((candidate) => candidate.id === edgeId);
    if (!geometry || !edge?.data) {
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (
          isInitialGeometryNode(node) &&
          node.data.sourceEdgeId === edgeId
        ) {
          const nextNode: InitialGeometryFlowNode = {
            ...node,
            data: {
              ...node.data,
              selectedGeometryEntityId: geometry.id,
              selectedGeometryDisplayName: geometry.name,
            },
          };
          return nextNode;
        }

        if (
          isProcessStepNode(node) &&
          node.data.stepRefId === edge.data?.targetStepRefId
        ) {
          const nextNode: ProcessStepFlowNode = {
            ...node,
            data: {
              ...node.data,
              fieldValues: updateFieldValue(
                node.data.fieldValues,
                edge.data.targetFieldId,
                geometry.id,
              ),
            },
          };
          return nextNode;
        }

        return node;
      }),
    );
    setPickingGeometryEdgeId(null);
  }

  function saveInstance() {
    if (!analysis.canSave || !selectedTemplate) {
      return;
    }

    const processFlowInstance: ProcessFlowInstance = {
      id: window.crypto.randomUUID(),
      name: productInstanceName.trim(),
      processFlowTemplateId: selectedTemplate.id,
      stepValueSets: selectedTemplate.stepRefs.map((stepRef) => {
        const node = findProcessNodeByStepRef(nodes, stepRef.stepRefId);
        return {
          stepRefId: stepRef.stepRefId,
          processStepTemplateId: stepRef.processStepTemplateId,
          fieldValues: node
            ? normalizeFieldValuesForSave(node, selectedTemplate, nodes)
            : [],
        };
      }),
    };

    const nextInstances = [
      ...readStorageArray<ProcessFlowInstance>(PROCESS_FLOW_INSTANCES_STORAGE_KEY),
      processFlowInstance,
    ];
    window.localStorage.setItem(
      PROCESS_FLOW_INSTANCES_STORAGE_KEY,
      JSON.stringify(nextInstances),
    );
    router.push("/");
  }

  if (!hydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading flow instance editor...
      </main>
    );
  }

  return (
    <main className="flex h-screen min-h-[720px] flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b bg-white px-5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold tracking-normal">
                Process Flow Instance Editor
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a product instance from an immutable flow template.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/">
              <ArrowLeft />
              Home
            </Link>
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-1 items-end gap-3 xl:grid-cols-[minmax(220px,1fr)_minmax(260px,1.1fr)_minmax(260px,1fr)]">
          <FormField label="Product / instance name" required>
            <input
              className={inputClass}
              value={productInstanceName}
              onChange={(event) => setProductInstanceName(event.target.value)}
              placeholder="Example: TV42 HBM4 qualification build"
            />
          </FormField>

          <FormField label="Process flow template">
            <select
              className={selectClass}
              value={selectedTemplateId ?? ""}
              disabled={templates.length === 0}
              onChange={(event) => requestTemplateChange(event.target.value)}
            >
              <option value="">
                {templates.length === 0
                  ? "No process flow templates"
                  : "Select template"}
              </option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} / {template.version}
                </option>
              ))}
            </select>
          </FormField>

          <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
            {selectedTemplate ? (
              <>
                <div className="truncate text-sm font-medium">
                  {selectedTemplate.name}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  version {selectedTemplate.version}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium">No template selected</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Choose a template to build a draft instance.
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="shrink-0 border-b bg-background px-5 py-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant={selectedTemplate ? "signal" : "outline"}>
            {selectedTemplate ? "template selected" : "template not selected"}
          </Badge>
          <Badge variant="outline">flow steps {analysis.flowStepCount}</Badge>
          <Badge variant="outline">
            initial geometries {analysis.initialGeometryCompleteCount}/
            {analysis.initialGeometryCount}
          </Badge>
          <Badge variant="outline">
            steps complete {analysis.completeStepCount}/{analysis.flowStepCount}
          </Badge>
          <span
            className={cn(
              "min-w-0 basis-full truncate sm:basis-auto sm:flex-1",
              analysis.canSave ? "text-emerald-700" : "text-muted-foreground",
            )}
          >
            {analysis.validationMessage}
          </span>
        </div>
      </section>

      <ProcessFlowGraph<FlowNode, FlowEdge>
        mode="view"
        nodes={displayNodes}
        edges={displayEdges}
        edgesReconnectable={false}
        elementsSelectable
        panOnScroll
        minZoom={0.35}
        maxZoom={1.45}
        defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
        showMiniMap={displayNodes.length > 0}
        miniMapNodeColor={(node) =>
          node.data.nodeKind === "initialGeometry" ? "#f59e0b" : "#0891b2"
        }
        onNodeClick={(_, node) => {
          if (node.data.nodeKind === "initialGeometry") {
            setPickingGeometryEdgeId(node.data.sourceEdgeId);
          }
          if (node.data.nodeKind === "processStep") {
            setEditingStepRefId(node.data.stepRefId);
          }
        }}
        emptyState={
          displayNodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-md rounded-md border border-dashed bg-white/90 px-5 py-4 text-center shadow-sm">
                <Layers3 className="mx-auto h-6 w-6 text-primary" />
                <h2 className="mt-3 text-sm font-semibold">Select a flow template</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  The graph appears here after a process flow template is selected.
                </p>
              </div>
            </div>
          ) : null
        }
      />

      <div className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-md border bg-white p-2 shadow-viewport">
        <Button variant="outline" onClick={clearDraft}>
          <RotateCcw />
          Abort
        </Button>
        <Button disabled={!analysis.canSave} onClick={saveInstance}>
          <Save />
          Save
        </Button>
      </div>

      {editingStepNode ? (
        <StepInstanceDialog
          node={editingStepNode}
          nodes={nodes}
          edges={edges}
          analysis={analysis}
          onClose={() => setEditingStepRefId(null)}
          onFieldChange={(fieldId, value) =>
            updateStepFieldValue(editingStepNode.data.stepRefId, fieldId, value)
          }
          onRepeaterChange={(field, updater) =>
            updateRepeaterFieldValue(
              editingStepNode.data.stepRefId,
              field,
              updater,
            )
          }
        />
      ) : null}

      {pickingGeometryNode ? (
        <GeometryPickerDialog
          node={pickingGeometryNode}
          geometries={geometries}
          onClose={() => setPickingGeometryEdgeId(null)}
          onSelect={(geometryId) =>
            selectGeometryForEdge(pickingGeometryNode.data.sourceEdgeId, geometryId)
          }
        />
      ) : null}

      {geometryPreview ? (
        <GeometryUnsupportedDialog
          preview={geometryPreview}
          onClose={() => setGeometryPreview(null)}
        />
      ) : null}
    </main>
  );
}

function StepInstanceDialog({
  node,
  nodes,
  edges,
  analysis,
  onClose,
  onFieldChange,
  onRepeaterChange,
}: {
  node: ProcessStepFlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  analysis: InstanceAnalysis;
  onClose: () => void;
  onFieldChange: (fieldId: string, value: unknown) => void;
  onRepeaterChange: (
    field: FieldDefinition,
    updater: (current: RepeatableGroupValue) => RepeatableGroupValue,
  ) => void;
}) {
  const completion = analysis.stepCompletion.get(node.data.stepRefId) ?? {
    complete: false,
    blockingFieldName: null,
  };
  const incomingEdges = edges.filter((edge) => edge.target === node.id);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close step editor"
        className="absolute inset-0 cursor-default bg-foreground/40"
        onClick={onClose}
      />
      <section
        className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(960px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">
                {node.data.template.name}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="max-w-[280px] truncate">
                  {node.data.stepRefId}
                </span>
                <Badge variant="signal">from template</Badge>
                <Badge variant={completion.complete ? "signal" : "outline"}>
                  {completion.complete ? "Complete" : "Incomplete"}
                </Badge>
              </div>
            </div>
            <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <section className="mb-5 rounded-md border bg-white">
            <div className="border-b px-4 py-3 text-sm font-semibold">
              Input mapping
            </div>
            <div className="divide-y">
              {node.data.geometryInputFields.map((field) => {
                const edge = incomingEdges.find(
                  (candidate) => candidate.targetHandle === field.id,
                );
                const fieldValue = getFieldValue(node.data.fieldValues, field.id);
                const sourceNode = edge
                  ? nodes.find((candidate) => candidate.id === edge.source)
                  : null;
                const edgeData = edge ? getFlowEdgeData(edge) : null;
                const isStepOutput = edgeData?.sourceType === "stepOutput";
                const mappedLabel = sourceNode
                  ? sourceLabelForNode(sourceNode)
                  : "Missing source";

                return (
                  <div
                    key={field.id}
                    className="grid grid-cols-[180px_1fr] items-center gap-3 px-4 py-3 text-sm max-md:grid-cols-1"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{field.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {field.id}
                      </div>
                    </div>
                    <div
                      className={cn(
                        "min-w-0 rounded-md border px-3 py-2",
                        edge ? "bg-muted/30" : "bg-destructive/5",
                      )}
                    >
                      <div className="truncate">
                        {edge ? `${field.name} <- ${mappedLabel}` : "No incoming edge"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {isStepOutput
                          ? "Graph-provided input, saved FieldValue.value is null."
                          : `Saved FieldValue.value is ${formatReadonlyValue(fieldValue)}.`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-md border bg-white">
            <div className="border-b px-4 py-3 text-sm font-semibold">
              Step values
            </div>
            <div className="divide-y">
              {node.data.template.fieldDefinitions.map((field) => {
                if (isGeometryField(field)) {
                  return null;
                }
                const fieldValue = getFieldValue(node.data.fieldValues, field.id);
                return (
                  <FieldValueEditor
                    key={field.id}
                    field={field}
                    value={fieldValue}
                    onChange={(value) => onFieldChange(field.id, value)}
                    onRepeaterChange={(updater) =>
                      onRepeaterChange(field, updater)
                    }
                  />
                );
              })}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function GeometryPickerDialog({
  node,
  geometries,
  onClose,
  onSelect,
}: {
  node: InitialGeometryFlowNode;
  geometries: GeometryEntity[];
  onClose: () => void;
  onSelect: (geometryId: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const groups = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = geometries.filter((geometry) => {
      if (!normalizedQuery) {
        return true;
      }
      return [
        geometry.name,
        geometry.id,
        geometry.version,
        geometry.category,
        geometry.entityType,
        geometry.summary,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
    return groupByCategory(filtered);
  }, [geometries, query]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close geometry picker"
        className="absolute inset-0 cursor-default bg-foreground/40"
        onClick={onClose}
      />
      <section
        className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(760px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Geometry picker</h2>
              <div className="mt-1 truncate text-sm text-muted-foreground">
                {node.data.targetStepRefId} / {node.data.targetFieldName}
              </div>
            </div>
            <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
              <X />
            </Button>
          </div>
          <label className="mt-4 flex items-center gap-2 rounded-md border bg-white px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              className="h-6 min-w-0 flex-1 bg-transparent text-sm outline-none"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search geometry"
            />
          </label>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {geometries.length === 0 ? (
            <div className="rounded-md border border-dashed bg-white px-4 py-8 text-center text-sm text-muted-foreground">
              No geometry entities in localStorage.
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-md border border-dashed bg-white px-4 py-8 text-center text-sm text-muted-foreground">
              No geometry matched the search.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <section key={group.category} className="rounded-md border bg-white">
                  <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                    <span className="truncate text-sm font-medium">
                      {group.category}
                    </span>
                    <Badge variant="secondary">{group.items.length}</Badge>
                  </div>
                  <div className="grid gap-2 p-2 md:grid-cols-2">
                    {group.items.map((geometry) => (
                      <button
                        key={geometry.id}
                        className={cn(
                          "rounded-md border bg-white p-3 text-left text-sm shadow-sm transition hover:border-primary hover:bg-muted/20",
                          node.data.selectedGeometryEntityId === geometry.id &&
                            "border-primary ring-2 ring-primary/20",
                        )}
                        onClick={() => onSelect(geometry.id)}
                      >
                        <div className="font-medium leading-snug">
                          {geometry.name}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {geometry.version} / {geometry.id}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="outline">{geometry.entityType}</Badge>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {geometry.summary}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function GeometryUnsupportedDialog({
  preview,
  onClose,
}: {
  preview: GeometryPreviewState;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close geometry view"
        className="absolute inset-0 cursor-default bg-foreground/40"
        onClick={onClose}
      />
      <section
        className="relative z-10 w-[min(520px,calc(100vw-32px))] rounded-md border bg-background shadow-viewport"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Geometry view</h2>
            <div className="mt-1 truncate text-sm text-muted-foreground">
              {preview.sourceLabel} {"->"} {preview.slotLabel}
            </div>
          </div>
          <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          geometry is not supported now
        </div>
      </section>
    </div>
  );
}

function FieldValueEditor({
  field,
  value,
  onChange,
  onRepeaterChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  onRepeaterChange: (
    updater: (current: RepeatableGroupValue) => RepeatableGroupValue,
  ) => void;
}) {
  if (field.valueType === "fieldGroupArray" && field.repeatDefinition) {
    const repeatValue = isRepeatableGroupValue(value)
      ? value
      : (createDefaultFieldValue(field).value as RepeatableGroupValue);
    const minItems = field.repeatDefinition.minItems ?? 0;
    const maxItems = field.repeatDefinition.maxItems ?? 99;

    return (
      <div className="px-4 py-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <FieldLabel field={field} />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={repeatValue.items.length <= minItems}
              onClick={() =>
                onRepeaterChange((current) => ({
                  ...current,
                  items: current.items.slice(0, -1),
                }))
              }
            >
              <Trash2 />
              Remove
            </Button>
            <Button
              size="sm"
              disabled={repeatValue.items.length >= maxItems}
              onClick={() =>
                onRepeaterChange((current) => addRepeatItem(current, field))
              }
            >
              <Plus />
              Add
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {repeatValue.items.map((item, itemIndex) => (
            <div key={item.itemId} className="rounded-md border bg-muted/20 p-3">
              <div className="mb-3 text-sm font-medium">
                {formatRepeatItemName(field, item.index)}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {field.repeatDefinition?.itemFieldDefinitions.map((child) => (
                  <ChildFieldEditor
                    key={child.id}
                    field={child}
                    value={getFieldValue(item.fieldValues, child.id)}
                    onChange={(nextValue) =>
                      onRepeaterChange((current) =>
                        updateRepeatChildValue(
                          current,
                          itemIndex,
                          child.id,
                          nextValue,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(180px,0.8fr)_minmax(240px,1.2fr)] gap-4 px-4 py-4 text-sm max-md:grid-cols-1">
      <FieldLabel field={field} />
      <PrimitiveControl field={field} value={value} onChange={onChange} />
    </div>
  );
}

function ChildFieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <div className="min-w-0">
      <FieldLabel field={field} compact />
      <div className="mt-2">
        <PrimitiveControl field={field} value={value} onChange={onChange} />
      </div>
    </div>
  );
}

function FieldLabel({
  field,
  compact,
}: {
  field: FieldDefinition;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
        {field.name}
      </div>
      <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
        <span>{field.id}</span>
        {field.unit ? <span>/ {field.unit}</span> : null}
      </div>
      {field.description && !compact ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {field.description}
        </p>
      ) : null}
    </div>
  );
}

function PrimitiveControl({
  field,
  value,
  onChange,
}: {
  field: FieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.controlType === "select" && field.optionSource?.options) {
    if (isArrayValueType(field.valueType)) {
      const selectedValues = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {field.optionSource.options.map((option) => {
            const optionValue = String(option.value);
            const checked = selectedValues.includes(optionValue);
            return (
              <label
                key={optionValue}
                className="flex min-w-[140px] items-start gap-2 rounded-md border bg-white px-3 py-2"
              >
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selectedValues, optionValue]
                      : selectedValues.filter((item) => item !== optionValue);
                    onChange(coerceArrayValue(next, field.valueType));
                  }}
                />
                <span>{option.name}</span>
              </label>
            );
          })}
        </div>
      );
    }

    return (
      <select
        className={selectClass}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(event) =>
          onChange(coercePrimitiveValue(event.target.value, field.valueType))
        }
      >
        <option value="">Select value</option>
        {field.optionSource.options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }

  if (field.controlType === "checkbox" && field.valueType === "boolean") {
    return (
      <label className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{Boolean(value) ? "True" : "False"}</span>
      </label>
    );
  }

  if (field.controlType === "checkbox" && field.optionSource?.options) {
    const selectedValues = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="flex flex-wrap gap-2">
        {field.optionSource.options.map((option) => {
          const optionValue = String(option.value);
          const checked = selectedValues.includes(optionValue);
          return (
            <label
              key={optionValue}
              className="flex min-w-[140px] items-start gap-2 rounded-md border bg-white px-3 py-2"
            >
              <input
                className="mt-1"
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selectedValues, optionValue]
                    : selectedValues.filter((item) => item !== optionValue);
                  onChange(
                    field.selectionMode === "multiple"
                      ? coerceArrayValue(next, field.valueType)
                      : coercePrimitiveValue(optionValue, field.valueType),
                  );
                }}
              />
              <span>{option.name}</span>
            </label>
          );
        })}
      </div>
    );
  }

  if (isNumericValueType(field.valueType)) {
    return (
      <div className="flex items-center gap-2">
        <input
          className={inputClass}
          type="number"
          step={isIntegerValueType(field.valueType) ? 1 : "any"}
          value={typeof value === "number" ? value : ""}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? ""
                : coercePrimitiveValue(event.target.value, field.valueType),
            )
          }
        />
        {field.unit ? (
          <span className="shrink-0 text-sm text-muted-foreground">
            {field.unit}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <input
      className={inputClass}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-2 text-sm font-medium leading-none">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </div>
      {children}
    </label>
  );
}

function buildDraftFromTemplate(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const stepTemplateById = new Map(
    stepTemplates.map((stepTemplate) => [stepTemplate.id, stepTemplate]),
  );
  const layout = computeTemplateLayout(template);
  const processNodes: ProcessStepFlowNode[] = template.stepRefs.flatMap((stepRef) => {
    const stepTemplate = stepTemplateById.get(stepRef.processStepTemplateId);
    if (!stepTemplate) {
      return [];
    }
    return [
      {
        id: stepNodeId(stepRef.stepRefId),
        type: "processStep",
        position: layout.stepPositions.get(stepRef.stepRefId) ?? { x: 320, y: 240 },
        draggable: false,
        data: {
          nodeKind: "processStep",
          stepRefId: stepRef.stepRefId,
          processStepTemplateId: stepRef.processStepTemplateId,
          template: stepTemplate,
          fieldValues: createInitialFieldValuesForStep(
            stepTemplate,
            template,
            stepRef.stepRefId,
          ),
          geometryInputFields: getGeometryInputFields(stepTemplate),
        },
      },
    ];
  });

  const processNodeIds = new Set(processNodes.map((node) => node.id));
  const initialNodes: InitialGeometryFlowNode[] = template.flowEdges.flatMap((edge) => {
    if (edge.source.sourceType !== "geometryRef") {
      return [];
    }
    if (!processNodeIds.has(stepNodeId(edge.target.stepRefId))) {
      return [];
    }
    const targetTemplate = findStepTemplateForStepRef(
      template,
      stepTemplates,
      edge.target.stepRefId,
    );
    const targetField = targetTemplate?.fieldDefinitions.find(
      (field) => field.id === edge.target.targetFieldId,
    );
    return [
      {
        id: initialNodeId(edge.edgeId),
        type: "initialGeometry",
        position: layout.initialPositions.get(edge.edgeId) ?? { x: 40, y: 240 },
        draggable: false,
        data: {
          nodeKind: "initialGeometry",
          sourceEdgeId: edge.edgeId,
          targetStepRefId: edge.target.stepRefId,
          targetFieldId: edge.target.targetFieldId,
          targetFieldName: targetField?.name ?? edge.target.targetFieldId,
          selectedGeometryEntityId: null,
          selectedGeometryDisplayName: null,
        },
      },
    ];
  });

  const allNodeIds = new Set([
    ...processNodes.map((node) => node.id),
    ...initialNodes.map((node) => node.id),
  ]);
  const flowEdges: FlowEdge[] = template.flowEdges.flatMap((edge) => {
    const targetNodeId = stepNodeId(edge.target.stepRefId);
    const sourceNodeId =
      edge.source.sourceType === "geometryRef"
        ? initialNodeId(edge.edgeId)
        : stepNodeId(edge.source.stepRefId);
    if (!allNodeIds.has(sourceNodeId) || !allNodeIds.has(targetNodeId)) {
      return [];
    }
    const targetTemplate = findStepTemplateForStepRef(
      template,
      stepTemplates,
      edge.target.stepRefId,
    );
    const targetField = targetTemplate?.fieldDefinitions.find(
      (field) => field.id === edge.target.targetFieldId,
    );
    return [
      {
        id: edge.edgeId,
        type: "dataFlow",
        source: sourceNodeId,
        target: targetNodeId,
        sourceHandle: "out",
        targetHandle: edge.target.targetFieldId,
        markerEnd: { type: MarkerType.ArrowClosed },
        reconnectable: false,
        data: {
          sourceType: edge.source.sourceType,
          sourceStepRefId:
            edge.source.sourceType === "stepOutput" ? edge.source.stepRefId : undefined,
          sourceEdgeId:
            edge.source.sourceType === "geometryRef" ? edge.edgeId : undefined,
          targetStepRefId: edge.target.stepRefId,
          targetFieldId: edge.target.targetFieldId,
          slotLabel: targetField?.name ?? edge.target.targetFieldId,
          sourceLabel: "",
          readonlyTopology: true,
        },
      },
    ];
  });

  return { nodes: [...initialNodes, ...processNodes], edges: flowEdges };
}

function computeTemplateLayout(template: ProcessFlowTemplate): LayoutResult {
  const stepOrder = new Map(
    template.stepRefs.map((stepRef, index) => [stepRef.stepRefId, index]),
  );
  const stepIds = template.stepRefs.map((stepRef) => stepRef.stepRefId);
  const stepSet = new Set(stepIds);
  const rank = new Map(stepIds.map((stepRefId) => [stepRefId, 1]));

  for (let pass = 0; pass < Math.max(1, stepIds.length); pass += 1) {
    template.flowEdges.forEach((edge) => {
      if (
        edge.source.sourceType !== "stepOutput" ||
        !stepSet.has(edge.source.stepRefId) ||
        !stepSet.has(edge.target.stepRefId)
      ) {
        return;
      }
      const sourceRank = rank.get(edge.source.stepRefId) ?? 1;
      const targetRank = rank.get(edge.target.stepRefId) ?? 1;
      if (targetRank <= sourceRank) {
        rank.set(edge.target.stepRefId, sourceRank + 1);
      }
    });
  }

  const mainPath = findLongestStepPath(template);
  const mainSet = new Set(mainPath);
  const lane = new Map<string, number>();
  mainPath.forEach((stepRefId) => lane.set(stepRefId, 0));

  const lanePattern = buildLanePattern(stepIds.length + 4);
  let lanePatternIndex = 0;
  const sortedNonMain = stepIds
    .filter((stepRefId) => !mainSet.has(stepRefId))
    .sort(
      (left, right) =>
        (rank.get(left) ?? 1) - (rank.get(right) ?? 1) ||
        (stepOrder.get(left) ?? 0) - (stepOrder.get(right) ?? 0) ||
        left.localeCompare(right),
    );

  sortedNonMain.forEach((stepRefId) => {
    const upstreamLanes = template.flowEdges
      .filter(
        (edge) =>
          edge.source.sourceType === "stepOutput" &&
          edge.target.stepRefId === stepRefId &&
          lane.has(edge.source.stepRefId) &&
          lane.get(edge.source.stepRefId) !== 0,
      )
      .map((edge) =>
        edge.source.sourceType === "stepOutput"
          ? lane.get(edge.source.stepRefId)
          : undefined,
      )
      .filter((value): value is number => typeof value === "number");

    if (upstreamLanes.length > 0) {
      lane.set(stepRefId, upstreamLanes[0]);
      return;
    }

    lane.set(stepRefId, lanePattern[lanePatternIndex] ?? lanePatternIndex + 1);
    lanePatternIndex += 1;
  });

  const stepPositions = new Map<string, { x: number; y: number }>();
  const initialPositions = new Map<string, { x: number; y: number }>();
  const xGap = 330;
  const yGap = 190;

  stepIds.forEach((stepRefId) => {
    stepPositions.set(stepRefId, {
      x: (rank.get(stepRefId) ?? 1) * xGap,
      y: 280 + (lane.get(stepRefId) ?? 0) * yGap,
    });
  });

  const occupiedLayoutCells = new Set<string>();
  stepIds.forEach((stepRefId) => {
    occupiedLayoutCells.add(
      layoutCellKey(rank.get(stepRefId) ?? 1, lane.get(stepRefId) ?? 0),
    );
  });

  const geometryEdgesByTarget = new Map<string, SavedFlowEdge[]>();
  template.flowEdges.forEach((edge) => {
    if (edge.source.sourceType !== "geometryRef") {
      return;
    }
    const key = edge.target.stepRefId;
    geometryEdgesByTarget.set(key, [...(geometryEdgesByTarget.get(key) ?? []), edge]);
  });

  geometryEdgesByTarget.forEach((group, targetStepRefId) => {
    const targetRank = rank.get(targetStepRefId) ?? 1;
    const targetLane = lane.get(targetStepRefId) ?? 0;
    const initialRank = Math.max(0, targetRank - 1);
    const laneOffsets = centeredInitialLaneOffsets(
      group.length,
      group.length + stepIds.length + 8,
    );

    group
      .slice()
      .sort((left, right) => left.edgeId.localeCompare(right.edgeId))
      .forEach((edge) => {
        const initialLane =
          laneOffsets
            .map((offset) => targetLane + offset)
            .find(
              (candidateLane) =>
                !occupiedLayoutCells.has(layoutCellKey(initialRank, candidateLane)),
            ) ?? targetLane;
        occupiedLayoutCells.add(layoutCellKey(initialRank, initialLane));
        initialPositions.set(edge.edgeId, {
          x: initialRank * xGap,
          y: 280 + initialLane * yGap,
        });
      });
  });

  normalizePositions(stepPositions, initialPositions);
  return { stepPositions, initialPositions };
}

function normalizePositions(
  stepPositions: Map<string, { x: number; y: number }>,
  initialPositions: Map<string, { x: number; y: number }>,
) {
  const positions = [...stepPositions.values(), ...initialPositions.values()];
  if (positions.length === 0) {
    return;
  }
  const minX = Math.min(...positions.map((position) => position.x));
  const minY = Math.min(...positions.map((position) => position.y));
  const dx = minX < 40 ? 40 - minX : 0;
  const dy = minY < 70 ? 70 - minY : 0;
  if (dx === 0 && dy === 0) {
    return;
  }
  stepPositions.forEach((position) => {
    position.x += dx;
    position.y += dy;
  });
  initialPositions.forEach((position) => {
    position.x += dx;
    position.y += dy;
  });
}

function findLongestStepPath(template: ProcessFlowTemplate) {
  const stepOrder = new Map(
    template.stepRefs.map((stepRef, index) => [stepRef.stepRefId, index]),
  );
  const stepIds = template.stepRefs.map((stepRef) => stepRef.stepRefId);
  const stepSet = new Set(stepIds);
  const adjacency = new Map<string, string[]>();
  template.flowEdges.forEach((edge) => {
    if (
      edge.source.sourceType !== "stepOutput" ||
      !stepSet.has(edge.source.stepRefId) ||
      !stepSet.has(edge.target.stepRefId)
    ) {
      return;
    }
    adjacency.set(edge.source.stepRefId, [
      ...(adjacency.get(edge.source.stepRefId) ?? []),
      edge.target.stepRefId,
    ]);
  });
  adjacency.forEach((targets, source) => {
    adjacency.set(
      source,
      targets.sort(
        (left, right) =>
          (stepOrder.get(left) ?? 0) - (stepOrder.get(right) ?? 0) ||
          left.localeCompare(right),
      ),
    );
  });

  const memo = new Map<string, string[]>();
  function dfs(stepRefId: string, visiting: Set<string>): string[] {
    const cached = memo.get(stepRefId);
    if (cached) {
      return cached;
    }
    if (visiting.has(stepRefId)) {
      return [stepRefId];
    }
    visiting.add(stepRefId);
    let best = [stepRefId];
    for (const target of adjacency.get(stepRefId) ?? []) {
      const candidate = [stepRefId, ...dfs(target, new Set(visiting))];
      if (compareStepPaths(candidate, best, stepOrder) < 0) {
        best = candidate;
      }
    }
    memo.set(stepRefId, best);
    return best;
  }

  let bestPath: string[] = [];
  stepIds.forEach((stepRefId) => {
    const candidate = dfs(stepRefId, new Set());
    if (bestPath.length === 0 || compareStepPaths(candidate, bestPath, stepOrder) < 0) {
      bestPath = candidate;
    }
  });
  return bestPath;
}

function compareStepPaths(
  left: string[],
  right: string[],
  stepOrder: Map<string, number>,
) {
  if (left.length !== right.length) {
    return right.length - left.length;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === rightValue) {
      continue;
    }
    if (leftValue === undefined) {
      return 1;
    }
    if (rightValue === undefined) {
      return -1;
    }
    const orderDiff =
      (stepOrder.get(leftValue) ?? Number.MAX_SAFE_INTEGER) -
      (stepOrder.get(rightValue) ?? Number.MAX_SAFE_INTEGER);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return leftValue.localeCompare(rightValue);
  }
  return 0;
}

function buildLanePattern(count: number) {
  const lanes: number[] = [];
  for (let index = 1; lanes.length < count; index += 1) {
    lanes.push(-index, index);
  }
  return lanes;
}

function centeredInitialLaneOffsets(groupSize: number, minimumCount: number) {
  const offsets: number[] = [];
  if (groupSize % 2 === 1) {
    offsets.push(0);
  }
  for (let distance = 1; offsets.length < minimumCount; distance += 1) {
    offsets.push(-distance, distance);
  }
  if (groupSize % 2 === 0) {
    offsets.push(0);
  }
  return offsets;
}

function layoutCellKey(rank: number, lane: number) {
  return `${rank}:${lane}`;
}

function analyzeDraft(
  selectedTemplate: ProcessFlowTemplate | null,
  productInstanceName: string,
  nodes: FlowNode[],
  stepTemplates: ProcessStepTemplate[],
  geometries: GeometryEntity[],
): InstanceAnalysis {
  const stepCompletion = selectedTemplate
    ? computeStepCompletion(selectedTemplate, nodes, geometries)
    : new Map<string, StepCompletion>();
  const initialGeometryNodes = nodes.filter(isInitialGeometryNode);
  const initialGeometryCompleteCount = initialGeometryNodes.filter((node) =>
    isSelectedGeometryValid(node, geometries),
  ).length;
  const templateSchemaError = selectedTemplate
    ? findTemplateSchemaError(selectedTemplate, stepTemplates)
    : null;
  const flowStepCount = selectedTemplate?.stepRefs.length ?? 0;
  const completeStepCount = selectedTemplate
    ? selectedTemplate.stepRefs.filter(
        (stepRef) => stepCompletion.get(stepRef.stepRefId)?.complete,
      ).length
    : 0;

  let validationMessage = "Ready to save";
  if (!selectedTemplate) {
    validationMessage = "Select a process flow template to start.";
  } else if (!productInstanceName.trim()) {
    validationMessage = "Product / instance name is required.";
  } else if (templateSchemaError) {
    validationMessage = templateSchemaError;
  } else {
    const incompleteInitial = initialGeometryNodes.find(
      (node) => !isSelectedGeometryValid(node, geometries),
    );
    const firstIncompleteStep = selectedTemplate.stepRefs.find(
      (stepRef) => !stepCompletion.get(stepRef.stepRefId)?.complete,
    );
    if (incompleteInitial) {
      validationMessage = `${incompleteInitial.data.targetStepRefId}: select geometry for ${incompleteInitial.data.targetFieldName}.`;
    } else if (firstIncompleteStep) {
      const node = findProcessNodeByStepRef(nodes, firstIncompleteStep.stepRefId);
      const completion = stepCompletion.get(firstIncompleteStep.stepRefId);
      validationMessage = `${node?.data.template.name ?? firstIncompleteStep.stepRefId}: ${completion?.blockingFieldName ?? "Field"} is required.`;
    }
  }

  return {
    validationMessage,
    canSave: validationMessage === "Ready to save",
    templateSchemaError,
    flowStepCount,
    initialGeometryCount: initialGeometryNodes.length,
    initialGeometryCompleteCount,
    completeStepCount,
    stepCompletion,
  };
}

function findTemplateSchemaError(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
) {
  if (template.stepRefs.length === 0) {
    return "Selected template has no flow steps.";
  }

  const stepRefsById = new Map<string, string>();
  const stepTemplateById = new Map(
    stepTemplates.map((stepTemplate) => [stepTemplate.id, stepTemplate]),
  );
  for (const stepRef of template.stepRefs) {
    if (stepRefsById.has(stepRef.stepRefId)) {
      return `Template has duplicate step ref: ${stepRef.stepRefId}.`;
    }
    stepRefsById.set(stepRef.stepRefId, stepRef.processStepTemplateId);
    if (!stepTemplateById.has(stepRef.processStepTemplateId)) {
      return `Step template ${stepRef.processStepTemplateId} could not be resolved.`;
    }
  }

  const targetSlotCounts = new Map<string, number>();
  const stepOutputCounts = new Map<string, number>();
  for (const edge of template.flowEdges) {
    const targetTemplateId = stepRefsById.get(edge.target.stepRefId);
    if (!targetTemplateId) {
      return `Edge ${edge.edgeId} targets a missing step ref.`;
    }
    const targetTemplate = stepTemplateById.get(targetTemplateId);
    const targetField = targetTemplate?.fieldDefinitions.find(
      (field) => field.id === edge.target.targetFieldId,
    );
    if (!targetField) {
      return `Edge ${edge.edgeId} targets a missing field.`;
    }
    if (!isGeometryField(targetField)) {
      return `Edge ${edge.edgeId} target field is not a geometry input.`;
    }

    const targetSlotKey = `${edge.target.stepRefId}:${edge.target.targetFieldId}`;
    targetSlotCounts.set(targetSlotKey, (targetSlotCounts.get(targetSlotKey) ?? 0) + 1);

    if (edge.source.sourceType === "stepOutput") {
      if (!stepRefsById.has(edge.source.stepRefId)) {
        return `Edge ${edge.edgeId} has a missing source step.`;
      }
      stepOutputCounts.set(
        edge.source.stepRefId,
        (stepOutputCounts.get(edge.source.stepRefId) ?? 0) + 1,
      );
    }
  }

  if (Array.from(targetSlotCounts.values()).some((count) => count > 1)) {
    return "A target geometry slot has more than one incoming edge.";
  }

  if (Array.from(stepOutputCounts.values()).some((count) => count > 1)) {
    return "A process step output has more than one outgoing edge.";
  }

  if (templateHasCycle(template)) {
    return "Template graph contains a cycle.";
  }

  for (const stepRef of template.stepRefs) {
    const stepTemplate = stepTemplateById.get(stepRef.processStepTemplateId);
    if (!stepTemplate) {
      continue;
    }
    for (const field of getGeometryInputFields(stepTemplate)) {
      const incoming = template.flowEdges.filter(
        (edge) =>
          edge.target.stepRefId === stepRef.stepRefId &&
          edge.target.targetFieldId === field.id,
      );
      if (incoming.length === 0) {
        return `${stepTemplate.name}: ${field.name} has no incoming flow edge.`;
      }
    }
  }

  return null;
}

function computeStepCompletion(
  template: ProcessFlowTemplate,
  nodes: FlowNode[],
  geometries: GeometryEntity[],
) {
  const stepNodes = nodes.filter(isProcessStepNode);
  const byStepRef = new Map(stepNodes.map((node) => [node.data.stepRefId, node]));
  const geometryIds = new Set(geometries.map((geometry) => geometry.id));
  const memo = new Map<string, StepCompletion>();

  function isComplete(stepRefId: string, visiting: Set<string>): StepCompletion {
    const cached = memo.get(stepRefId);
    if (cached) {
      return cached;
    }
    const node = byStepRef.get(stepRefId);
    if (!node) {
      return { complete: false, blockingFieldName: "Missing step" };
    }
    if (visiting.has(stepRefId)) {
      return { complete: false, blockingFieldName: "Cycle" };
    }
    visiting.add(stepRefId);

    function finish(result: StepCompletion) {
      visiting.delete(stepRefId);
      memo.set(stepRefId, result);
      return result;
    }

    for (const field of node.data.template.fieldDefinitions) {
      const value = getFieldValue(node.data.fieldValues, field.id);
      if (isGeometryField(field)) {
        const incoming = template.flowEdges.filter(
          (edge) =>
            edge.target.stepRefId === stepRefId &&
            edge.target.targetFieldId === field.id,
        );
        if (incoming.length !== 1) {
          return finish({ complete: false, blockingFieldName: field.name });
        }
        const edge = incoming[0];
        if (edge.source.sourceType === "geometryRef") {
          const initialNode = nodes.find(
            (candidate): candidate is InitialGeometryFlowNode =>
              isInitialGeometryNode(candidate) &&
              candidate.data.sourceEdgeId === edge.edgeId,
          );
          if (
            !initialNode?.data.selectedGeometryEntityId ||
            !geometryIds.has(initialNode.data.selectedGeometryEntityId)
          ) {
            return finish({ complete: false, blockingFieldName: field.name });
          }
          continue;
        }
        const upstream = isComplete(edge.source.stepRefId, new Set(visiting));
        if (!upstream.complete) {
          return finish({ complete: false, blockingFieldName: field.name });
        }
        if (value !== null) {
          return finish({ complete: false, blockingFieldName: field.name });
        }
        continue;
      }

      if (!isFieldValueComplete(field, value)) {
        return finish({ complete: false, blockingFieldName: field.name });
      }
    }

    return finish({ complete: true, blockingFieldName: null });
  }

  template.stepRefs.forEach((stepRef) => {
    memo.set(stepRef.stepRefId, isComplete(stepRef.stepRefId, new Set()));
  });

  return memo;
}

function templateHasCycle(template: ProcessFlowTemplate) {
  const stepIds = new Set(template.stepRefs.map((stepRef) => stepRef.stepRefId));
  const adjacency = new Map<string, string[]>();
  template.flowEdges.forEach((edge) => {
    if (
      edge.source.sourceType === "stepOutput" &&
      stepIds.has(edge.source.stepRefId) &&
      stepIds.has(edge.target.stepRefId)
    ) {
      adjacency.set(edge.source.stepRefId, [
        ...(adjacency.get(edge.source.stepRefId) ?? []),
        edge.target.stepRefId,
      ]);
    }
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(stepRefId: string): boolean {
    if (visiting.has(stepRefId)) {
      return true;
    }
    if (visited.has(stepRefId)) {
      return false;
    }
    visiting.add(stepRefId);
    for (const next of adjacency.get(stepRefId) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(stepRefId);
    visited.add(stepRefId);
    return false;
  }

  return Array.from(stepIds).some((stepRefId) => visit(stepRefId));
}

function draftHasContent(
  selectedTemplate: ProcessFlowTemplate | null,
  productInstanceName: string,
  nodes: FlowNode[],
) {
  if (!selectedTemplate) {
    return productInstanceName.trim().length > 0;
  }
  if (productInstanceName.trim().length > 0) {
    return true;
  }
  if (
    nodes.some(
      (node) =>
        isInitialGeometryNode(node) && node.data.selectedGeometryEntityId !== null,
    )
  ) {
    return true;
  }
  return nodes.some((node) => {
    if (!isProcessStepNode(node)) {
      return false;
    }
    const initialValues = createInitialFieldValuesForStep(
      node.data.template,
      selectedTemplate,
      node.data.stepRefId,
    );
    return JSON.stringify(node.data.fieldValues) !== JSON.stringify(initialValues);
  });
}

function normalizeFieldValuesForSave(
  node: ProcessStepFlowNode,
  template: ProcessFlowTemplate,
  nodes: FlowNode[],
) {
  const values = node.data.template.fieldDefinitions.map((field) => {
    const existing = node.data.fieldValues.find(
      (fieldValue) => fieldValue.fieldId === field.id,
    );
    return existing ? clone(existing) : createDefaultFieldValue(field);
  });

  template.flowEdges
    .filter((edge) => edge.target.stepRefId === node.data.stepRefId)
    .forEach((edge) => {
      if (edge.source.sourceType === "geometryRef") {
        const initialNode = nodes.find(
          (candidate): candidate is InitialGeometryFlowNode =>
            isInitialGeometryNode(candidate) &&
            candidate.data.sourceEdgeId === edge.edgeId,
        );
        setFieldValueInArray(
          values,
          edge.target.targetFieldId,
          initialNode?.data.selectedGeometryEntityId ?? "",
        );
      } else {
        setFieldValueInArray(values, edge.target.targetFieldId, null);
      }
    });

  return values;
}

function createInitialFieldValuesForStep(
  stepTemplate: ProcessStepTemplate,
  flowTemplate: ProcessFlowTemplate,
  stepRefId: string,
) {
  return stepTemplate.fieldDefinitions.map((field) => {
    if (!isGeometryField(field)) {
      return createDefaultFieldValue(field);
    }
    const incoming = flowTemplate.flowEdges.find(
      (edge) =>
        edge.target.stepRefId === stepRefId &&
        edge.target.targetFieldId === field.id,
    );
    return {
      fieldId: field.id,
      value: incoming?.source.sourceType === "stepOutput" ? null : "",
    };
  });
}

function createDefaultFieldValue(field: FieldDefinition): FieldValue {
  if (isGeometryField(field)) {
    return { fieldId: field.id, value: "" };
  }
  if (field.valueType === "boolean") {
    return { fieldId: field.id, value: false };
  }
  if (isArrayValueType(field.valueType)) {
    return { fieldId: field.id, value: [] };
  }
  if (field.valueType === "fieldGroupArray") {
    const minItems = field.repeatDefinition?.minItems ?? 0;
    let repeatValue: RepeatableGroupValue = { items: [] };
    for (let index = 0; index < minItems; index += 1) {
      repeatValue = addRepeatItem(repeatValue, field);
    }
    return { fieldId: field.id, value: repeatValue };
  }
  return { fieldId: field.id, value: "" };
}

function addRepeatItem(
  current: RepeatableGroupValue,
  field: FieldDefinition,
): RepeatableGroupValue {
  const indexBase = field.repeatDefinition?.indexBase ?? 1;
  const nextIndex = indexBase + current.items.length;
  return {
    ...current,
    items: [
      ...current.items,
      {
        itemId: `${field.id}_item_${nextIndex}`,
        index: nextIndex,
        fieldValues:
          field.repeatDefinition?.itemFieldDefinitions.map(createDefaultFieldValue) ??
          [],
      },
    ],
  };
}

function updateRepeatChildValue(
  current: RepeatableGroupValue,
  itemIndex: number,
  childFieldId: string,
  value: unknown,
): RepeatableGroupValue {
  return {
    ...current,
    items: current.items.map((item, index) => {
      if (index !== itemIndex) {
        return item;
      }
      return {
        ...item,
        fieldValues: updateFieldValue(item.fieldValues, childFieldId, value),
      };
    }),
  };
}

function updateFieldValue(fieldValues: FieldValue[], fieldId: string, value: unknown) {
  return fieldValues.some((fieldValue) => fieldValue.fieldId === fieldId)
    ? fieldValues.map((fieldValue) =>
        fieldValue.fieldId === fieldId ? { ...fieldValue, value } : fieldValue,
      )
    : [...fieldValues, { fieldId, value }];
}

function setFieldValueInArray(
  fieldValues: FieldValue[],
  fieldId: string,
  value: unknown,
) {
  const target = fieldValues.find((fieldValue) => fieldValue.fieldId === fieldId);
  if (target) {
    target.value = value;
  } else {
    fieldValues.push({ fieldId, value });
  }
}

function isFieldValueComplete(field: FieldDefinition, value: unknown): boolean {
  if (field.valueType === "boolean") {
    return typeof value === "boolean";
  }
  if (field.valueType === "fieldGroupArray") {
    if (!isRepeatableGroupValue(value)) {
      return false;
    }
    const minItems = field.repeatDefinition?.minItems ?? 0;
    const maxItems = field.repeatDefinition?.maxItems ?? Number.POSITIVE_INFINITY;
    if (value.items.length < minItems || value.items.length > maxItems) {
      return false;
    }
    const childFields = field.repeatDefinition?.itemFieldDefinitions ?? [];
    return value.items.every((item) =>
      childFields.every((child) =>
        isFieldValueComplete(child, getFieldValue(item.fieldValues, child.id)),
      ),
    );
  }
  if (isArrayValueType(field.valueType)) {
    if (!Array.isArray(value) || value.length === 0) {
      return false;
    }
    return value.every((item) => primitiveValueIsValid(field, item));
  }
  if (isNumericValueType(field.valueType)) {
    return primitiveValueIsValid(field, value);
  }
  return primitiveValueIsValid(field, value);
}

function primitiveValueIsValid(field: FieldDefinition, value: unknown) {
  if (isNumericValueType(field.valueType)) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return false;
    }
    if (isIntegerValueType(field.valueType) && !Number.isInteger(value)) {
      return false;
    }
    if (!passesNumericValidation(value, field.validation)) {
      return false;
    }
  } else if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  } else if (!passesStringValidation(value, field.validation)) {
    return false;
  }

  if (field.optionSource?.options) {
    const optionValues = new Set(
      field.optionSource.options.map((option) => String(option.value)),
    );
    return optionValues.has(String(value));
  }

  return true;
}

function passesNumericValidation(value: number, validation?: ValidationRule) {
  if (!validation) {
    return true;
  }
  if (typeof validation.min === "number") {
    if (validation.exclusiveMin ? value <= validation.min : value < validation.min) {
      return false;
    }
  }
  if (typeof validation.max === "number") {
    if (validation.exclusiveMax ? value >= validation.max : value > validation.max) {
      return false;
    }
  }
  return true;
}

function passesStringValidation(value: string, validation?: ValidationRule) {
  if (!validation) {
    return true;
  }
  if (
    typeof validation.minLength === "number" &&
    value.length < validation.minLength
  ) {
    return false;
  }
  if (
    typeof validation.maxLength === "number" &&
    value.length > validation.maxLength
  ) {
    return false;
  }
  if (validation.regex) {
    return new RegExp(validation.regex).test(value);
  }
  return true;
}

function getGeometryInputFields(template: ProcessStepTemplate) {
  return template.fieldDefinitions.filter(isGeometryField);
}

function isGeometryField(field: FieldDefinition) {
  return field.valueType === "geometryRef" || field.valueType === "geometry";
}

function isSelectedGeometryValid(
  node: InitialGeometryFlowNode,
  geometries: GeometryEntity[],
) {
  return (
    Boolean(node.data.selectedGeometryEntityId) &&
    geometries.some((geometry) => geometry.id === node.data.selectedGeometryEntityId)
  );
}

function getFieldValue(fieldValues: FieldValue[], fieldId: string) {
  return fieldValues.find((fieldValue) => fieldValue.fieldId === fieldId)?.value;
}

function isArrayValueType(valueType: ValueType) {
  return valueType.endsWith("[]");
}

function isNumericValueType(valueType: ValueType) {
  return (
    valueType === "integer" ||
    valueType === "integer[]" ||
    valueType === "float" ||
    valueType === "float[]"
  );
}

function isIntegerValueType(valueType: ValueType) {
  return valueType === "integer" || valueType === "integer[]";
}

function coercePrimitiveValue(value: string, valueType: ValueType) {
  if (value === "") {
    return "";
  }
  if (valueType === "integer") {
    return Number.parseInt(value, 10);
  }
  if (valueType === "float") {
    return Number.parseFloat(value);
  }
  return value;
}

function coerceArrayValue(values: string[], valueType: ValueType) {
  if (valueType === "integer[]") {
    return values.map((value) => Number.parseInt(value, 10));
  }
  if (valueType === "float[]") {
    return values.map((value) => Number.parseFloat(value));
  }
  return values;
}

function isRepeatableGroupValue(value: unknown): value is RepeatableGroupValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray((value as RepeatableGroupValue).items)
  );
}

function formatRepeatItemName(field: FieldDefinition, index: number) {
  return (
    field.repeatDefinition?.itemNameTemplate.replace("{{index}}", String(index)) ??
    `${field.name} ${index}`
  );
}

function formatReadonlyValue(value: unknown) {
  if (value === null) {
    return "null";
  }
  if (value === "" || value === undefined) {
    return "not selected";
  }
  return String(value);
}

function findProcessNodeById(
  nodes: FlowNode[],
  nodeId: string | null | undefined,
): ProcessStepFlowNode | null {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  return node && isProcessStepNode(node) ? node : null;
}

function findProcessNodeByStepRef(
  nodes: FlowNode[],
  stepRefId: string | null | undefined,
): ProcessStepFlowNode | null {
  const node = nodes.find(
    (candidate) =>
      isProcessStepNode(candidate) && candidate.data.stepRefId === stepRefId,
  );
  return node && isProcessStepNode(node) ? node : null;
}

function findStepTemplateForStepRef(
  flowTemplate: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  stepRefId: string,
) {
  const stepRef = flowTemplate.stepRefs.find(
    (candidate) => candidate.stepRefId === stepRefId,
  );
  return stepTemplates.find(
    (stepTemplate) => stepTemplate.id === stepRef?.processStepTemplateId,
  );
}

function getFlowEdgeData(edge: FlowEdge): FlowEdgeData {
  return edge.data as FlowEdgeData;
}

function isInitialGeometryNode(node: FlowNode): node is InitialGeometryFlowNode {
  return node.data.nodeKind === "initialGeometry";
}

function isProcessStepNode(node: FlowNode): node is ProcessStepFlowNode {
  return node.data.nodeKind === "processStep";
}

function sourceLabelForNode(node: FlowNode) {
  if (node.data.nodeKind === "initialGeometry") {
    return node.data.selectedGeometryDisplayName ?? "Initial geometry";
  }
  return `${node.data.template.name} output`;
}

function stepNodeId(stepRefId: string) {
  return `step:${stepRefId}`;
}

function initialNodeId(edgeId: string) {
  return `initial:${edgeId}`;
}

function groupByCategory<T extends { category: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const category = item.category || "uncategorized";
    groups.set(category, [...(groups.get(category) ?? []), item]);
  });
  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, groupItems]) => ({ category, items: groupItems }));
}

function readStorageArray<T>(key: string): T[] {
  const stored = window.localStorage.getItem(key);
  return stored ? (JSON.parse(stored) as T[]) : [];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
