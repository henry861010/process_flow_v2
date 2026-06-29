"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MarkerType,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import {
  AlertCircle,
  ArrowLeft,
  Box,
  Boxes,
  Check,
  ChevronDown,
  FileJson,
  GitBranch,
  GitFork,
  Link2Off,
  Plus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { ProcessFlowGraph } from "@/components/process-flow-graph/process-flow-graph";
import { CoordinateListControl } from "@/components/process-flow-fields/coordinate-list-control";
import { coordinateListValueIsComplete } from "@/components/process-flow-fields/coordinate-list-value";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GeometryPreviewContext } from "@/components/geometry-preview/geometry-preview-panel";
import {
  createProcessFlowTemplateInstance,
  listProcessFlowTemplates,
  loadBootstrap,
} from "@/lib/process-flow-api";
import { cn } from "@/lib/utils";

const GEOMETRY_DRAG_TYPE = "application/process-flow-geometry";
const STEP_TEMPLATE_DRAG_TYPE = "application/process-flow-step-template";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[78px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20";

type GeometryPreviewPanelProps = {
  preview: GeometryPreviewContext;
  onClose: () => void;
};

const GeometryPreviewPanel = dynamic<GeometryPreviewPanelProps>(
  () =>
    import("@/components/geometry-preview/geometry-preview-panel").then(
      (module) => module.GeometryPreviewPanel,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/45 p-6 text-sm font-medium text-white">
        Loading geometry preview...
      </div>
    ),
  },
);

type FieldScope = "inputState" | "outputState" | "processParameter";
type ValueType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "materialRef"
  | "geometryRef"
  | "coordinates"
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
  | "coordinateList"
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
  program: string;
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
  description: string;
  owner: string;
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
  structureFormat: "standard";
  structure?: unknown;
};

type EditorMetadata = {
  technologyName: string;
  productInstanceName: string;
};

type InitialGeometryNodeData = Record<string, unknown> & {
  nodeKind: "initialGeometry";
  geometry: GeometryEntity | null;
  placeholderLabel?: string;
  placeholderSublabel?: string;
  isConnected?: boolean;
  onDelete?: (nodeId: string) => void;
};

type ProcessStepNodeData = Record<string, unknown> & {
  nodeKind: "processStep";
  stepRefId: string;
  template: ProcessStepTemplate;
  fieldValues: FieldValue[];
  geometryInputFields: FieldDefinition[];
  isReachable?: boolean;
  isComplete?: boolean;
  blockingFieldName?: string | null;
  onDelete?: (nodeId: string) => void;
  onEdit?: (nodeId: string) => void;
};

type FlowEdgeData = Record<string, unknown> & {
  sourceType: "geometryRef" | "stepOutput";
  sourceGeometryEntityId?: string;
  sourceStepRefId?: string;
  targetStepRefId: string;
  targetFieldId: string;
  slotLabel: string;
  sourceLabel: string;
  geometryViewVisible?: boolean;
  geometryViewDisabled?: boolean;
  geometryViewTitle?: string;
  onDelete?: (edgeId: string) => void;
  onGeometryView?: () => void;
};

type InitialGeometryFlowNode = Node<InitialGeometryNodeData, "initialGeometry">;
type ProcessStepFlowNode = Node<ProcessStepNodeData, "processStep">;
type FlowNode = InitialGeometryFlowNode | ProcessStepFlowNode;
type FlowEdge = Edge<FlowEdgeData, "dataFlow">;

type StepCompletion = {
  complete: boolean;
  blockingFieldName: string | null;
};

type GraphAnalysis = {
  connectedInitialNodeIds: Set<string>;
  reachableStepNodeIds: Set<string>;
  outsideFlowCount: number;
  flowStepCount: number;
  hasCycle: boolean;
  duplicateTargetSlots: string[];
  duplicateOutgoingSources: string[];
  invalidEdgeMessages: string[];
  stepCompletion: Map<string, StepCompletion>;
  validationMessage: string;
  canSave: boolean;
};

type LayoutResult = {
  stepPositions: Map<string, { x: number; y: number }>;
  initialPositions: Map<string, { x: number; y: number }>;
};

export function ProcessFlowTemplateEditor() {
  return (
    <ReactFlowProvider>
      <ProcessFlowTemplateEditorInner />
    </ReactFlowProvider>
  );
}

function ProcessFlowTemplateEditorInner() {
  const router = useRouter();
  const reactFlow = useReactFlow<FlowNode, FlowEdge>();
  const [hydrated, setHydrated] = React.useState(false);
  const [metadata, setMetadata] = React.useState<EditorMetadata>({
    technologyName: "",
    productInstanceName: "",
  });
  const [stepTemplates, setStepTemplates] = React.useState<ProcessStepTemplate[]>(
    [],
  );
  const [flowTemplates, setFlowTemplates] = React.useState<ProcessFlowTemplate[]>([]);
  const [geometries, setGeometries] = React.useState<GeometryEntity[]>([]);
  const [nodes, setNodes] = React.useState<FlowNode[]>([]);
  const [edges, setEdges] = React.useState<FlowEdge[]>([]);
  const [editingStepNodeId, setEditingStepNodeId] = React.useState<string | null>(
    null,
  );
  const [geometryPreview, setGeometryPreview] =
    React.useState<GeometryPreviewContext | null>(null);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [openGeometryCategories, setOpenGeometryCategories] = React.useState<
    Record<string, boolean>
  >({});
  const [openStepCategories, setOpenStepCategories] = React.useState<
    Record<string, boolean>
  >({});
  const [templatePickerOpen, setTemplatePickerOpen] = React.useState(false);
  const [templateSearch, setTemplateSearch] = React.useState("");
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(
    null,
  );
  const [confirmingTemplateStart, setConfirmingTemplateStart] =
    React.useState(false);
  const [confirmingGraphClear, setConfirmingGraphClear] = React.useState(false);
  const [apiError, setApiError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    loadBootstrap()
      .then((payload) => {
        if (!active) return;
        setStepTemplates(payload.processStepTemplates as ProcessStepTemplate[]);
        setFlowTemplates(payload.processFlowTemplates as ProcessFlowTemplate[]);
        setGeometries(payload.geometries as GeometryEntity[]);
        setApiError(null);
      })
      .catch((error) => {
        if (!active) return;
        setApiError(error instanceof Error ? error.message : "Unable to load API data.");
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const analysis = React.useMemo(
    () => analyzeGraph(metadata, nodes, edges),
    [metadata, nodes, edges],
  );

  const deleteEdge = React.useCallback((edgeId: string) => {
    setEdges((currentEdges) => {
      const removedEdges = currentEdges.filter((edge) => edge.id === edgeId);
      if (removedEdges.length > 0) {
        clearTargetValuesForRemovedEdges(setNodes, removedEdges);
      }
      return currentEdges.filter((edge) => edge.id !== edgeId);
    });
  }, []);

  const deleteNode = React.useCallback((nodeId: string) => {
    setEdges((currentEdges) => {
      const removedEdges = currentEdges.filter(
        (edge) => edge.source === nodeId || edge.target === nodeId,
      );
      if (removedEdges.length > 0) {
        clearTargetValuesForRemovedEdges(setNodes, removedEdges, nodeId);
      }
      return currentEdges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      );
    });
    setNodes((currentNodes) => currentNodes.filter((node) => node.id !== nodeId));
    setEditingStepNodeId((current) => (current === nodeId ? null : current));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
  }, []);

  const openStepEditor = React.useCallback((nodeId: string) => {
    setEditingStepNodeId(nodeId);
    setSelectedNodeId(nodeId);
  }, []);

  const displayNodes = React.useMemo<FlowNode[]>(
    () =>
      nodes.map((node) => {
        if (isInitialGeometryNode(node)) {
          const geometry = node.data.geometry;
          const hasGeometry = isExplicitGeometryId(geometry?.id);
          const connected = analysis.connectedInitialNodeIds.has(node.id);
          const nextNode: InitialGeometryFlowNode = {
            ...node,
            data: {
              ...node.data,
              graphMode: "edit",
              displayLabel:
                geometry?.name ?? node.data.placeholderLabel ?? "Select geometry",
              displaySublabel:
                geometry?.entityType ??
                node.data.placeholderSublabel ??
                "Geometry required",
              status: connected && hasGeometry ? "complete" : "incomplete",
              isConnected: connected && hasGeometry,
              onDelete: deleteNode,
            },
          };
          return nextNode;
        }

        const completion = analysis.stepCompletion.get(node.id) ?? {
          complete: false,
          blockingFieldName: null,
        };
        const terminalPreviewVisible = isTerminalFinalPreviewVisible(
          node,
          edges,
          analysis.reachableStepNodeIds,
        );
        const terminalPreviewAvailability = getTerminalFinalPreviewAvailability(
          node,
          analysis,
        );
        const terminalSourceLabel = node.data.template.name;
        const nextNode: ProcessStepFlowNode = {
          ...node,
          data: {
            ...node.data,
            graphMode: "edit",
            editId: node.id,
            status: analysis.reachableStepNodeIds.has(node.id)
              ? completion.complete
                ? "complete"
                : "incomplete"
              : "outside",
            isReachable: analysis.reachableStepNodeIds.has(node.id),
            isComplete: completion.complete,
            blockingFieldName: completion.blockingFieldName,
            onDelete: deleteNode,
            onEdit: openStepEditor,
            terminalGeometryViewVisible: terminalPreviewVisible,
            terminalGeometryViewDisabled: !terminalPreviewAvailability.enabled,
            terminalGeometryViewTitle: terminalPreviewAvailability.enabled
              ? "Preview final geometry state"
              : terminalPreviewAvailability.reason,
            onTerminalGeometryView: () => {
              if (!terminalPreviewAvailability.enabled) return;
              setGeometryPreview({
                previewId: `final:${node.data.stepRefId}`,
                sourceLabel: terminalSourceLabel,
                slotLabel: "F",
                sourceKind: "stepOutput",
                request: {
                  target: { type: "stepOutput", stepRefId: node.data.stepRefId },
                  sourceLabel: terminalSourceLabel,
                  flowTemplate: buildDraftFlowTemplateForPreview(nodes, edges),
                  draftInstance: buildDraftInstanceForPreview(nodes, edges, metadata),
                  geometries,
                  processStepTemplates: stepTemplates,
                },
              });
            },
          },
        };
        return nextNode;
      }),
    [
      analysis,
      deleteNode,
      edges,
      geometries,
      metadata,
      nodes,
      openStepEditor,
      stepTemplates,
    ],
  );

  const displayEdges = React.useMemo<FlowEdge[]>(
    () =>
      edges.map((edge) => {
        const edgeData = edge.data;
        const targetNode = findProcessNode(nodes, edge.target);
        const sourceNode = nodes.find((node) => node.id === edge.source);
        const targetField = targetNode?.data.geometryInputFields.find(
          (field) => field.id === edgeData?.targetFieldId,
        );
        const sourceLabel = sourceNode ? sourceLabelForNode(sourceNode) : "Unknown";
        const slotLabel = targetField?.name || edgeData?.targetFieldId || "slot";
        const availability = getGeometryPreviewAvailability(
          edge,
          nodes,
          geometries,
          analysis,
        );
        const sourceKind = edgeData?.sourceType ?? "geometryRef";
        const nextEdge: FlowEdge = {
          ...edge,
          data: {
            sourceType: sourceKind,
            sourceGeometryEntityId: edgeData?.sourceGeometryEntityId,
            sourceStepRefId: edgeData?.sourceStepRefId,
            targetStepRefId: edgeData?.targetStepRefId ?? "",
            targetFieldId: edgeData?.targetFieldId ?? "",
            slotLabel,
            sourceLabel,
            graphMode: "edit",
            geometryViewVisible: true,
            geometryViewDisabled: !availability.enabled,
            geometryViewTitle: availability.enabled
              ? "Preview geometry state"
              : availability.reason,
            onDelete: deleteEdge,
            onGeometryView: () => {
              if (!availability.enabled) return;
              setGeometryPreview({
                previewId: edge.id,
                sourceLabel,
                slotLabel,
                sourceKind,
                request: {
                  target: { type: "edge", previewEdgeId: edge.id },
                  sourceLabel,
                  flowTemplate: buildDraftFlowTemplateForPreview(nodes, edges),
                  draftInstance: buildDraftInstanceForPreview(nodes, edges, metadata),
                  geometries,
                  processStepTemplates: stepTemplates,
                },
              });
            },
          },
        };
        return nextEdge;
      }),
    [analysis, deleteEdge, edges, geometries, metadata, nodes, stepTemplates],
  );

  const editingStepNode = React.useMemo(
    () => findProcessNode(nodes, editingStepNodeId),
    [editingStepNodeId, nodes],
  );

  const geometryGroups = React.useMemo(() => groupByCategory(geometries), [geometries]);
  const stepGroups = React.useMemo(
    () => groupByCategory(stepTemplates),
    [stepTemplates],
  );
  const selectedTemplate = React.useMemo(
    () =>
      flowTemplates.find((template) => template.id === selectedTemplateId) ?? null,
    [flowTemplates, selectedTemplateId],
  );
  const filteredFlowTemplates = React.useMemo(() => {
    const query = templateSearch.trim().toLowerCase();
    if (!query) {
      return flowTemplates;
    }
    return flowTemplates.filter((template) =>
      template.name.toLowerCase().includes(query),
    );
  }, [flowTemplates, templateSearch]);

  const onNodesChange = React.useCallback((changes: NodeChange<FlowNode>[]) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  }, []);

  const onEdgesChange = React.useCallback((changes: EdgeChange<FlowEdge>[]) => {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
  }, []);

  const isValidConnection = React.useCallback(
    (connection: Connection | FlowEdge) =>
      validateConnection(
        {
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle ?? null,
          targetHandle: connection.targetHandle ?? null,
        },
        nodes,
        edges,
      ).valid,
    [edges, nodes],
  );

  const onConnect = React.useCallback(
    (connection: Connection) => {
      const validation = validateConnection(connection, nodes, edges);
      if (!validation.valid || !connection.source || !connection.target) {
        return;
      }

      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = findProcessNode(nodes, connection.target);
      const targetField = targetNode?.data.geometryInputFields.find(
        (field) => field.id === connection.targetHandle,
      );

      if (!sourceNode || !targetNode || !targetField || !connection.targetHandle) {
        return;
      }

      const edgeId = uid("edge");
      const nextEdge = buildFlowEdge(edgeId, sourceNode, targetNode, targetField);

      setEdges((currentEdges) => {
        const replacedEdges = getConnectionReplacementEdges(
          currentEdges,
          sourceNode,
          targetNode.id,
          targetField.id,
        );
        if (replacedEdges.length > 0) {
          clearTargetValuesForRemovedEdges(setNodes, replacedEdges);
        }
        const replacedEdgeIds = new Set(replacedEdges.map((edge) => edge.id));
        return [
          ...currentEdges.filter((edge) => !replacedEdgeIds.has(edge.id)),
          nextEdge,
        ];
      });

      setStepFieldValue(
        setNodes,
        targetNode.id,
        targetField.id,
        sourceNode.data.nodeKind === "initialGeometry"
          ? sourceNode.data.geometry?.id ?? ""
          : null,
      );
    },
    [edges, nodes],
  );

  const onReconnect = React.useCallback(
    (oldEdge: FlowEdge, connection: Connection) => {
      if (connection.source !== oldEdge.source) {
        return;
      }

      const edgesForValidation = edges.filter((edge) => edge.id !== oldEdge.id);
      const validation = validateConnection(connection, nodes, edgesForValidation);
      if (!validation.valid || !connection.source || !connection.target) {
        return;
      }

      const sourceNode = nodes.find((node) => node.id === oldEdge.source);
      const targetNode = findProcessNode(nodes, connection.target);
      const targetField = targetNode?.data.geometryInputFields.find(
        (field) => field.id === connection.targetHandle,
      );

      if (!sourceNode || !targetNode || !targetField || !connection.targetHandle) {
        return;
      }

      const nextEdge = buildFlowEdge(oldEdge.id, sourceNode, targetNode, targetField);

      setEdges((currentEdges) => {
        const currentOldEdge = currentEdges.find((edge) => edge.id === oldEdge.id);
        if (!currentOldEdge) {
          return currentEdges;
        }
        const replacedEdges = getConnectionReplacementEdges(
          currentEdges,
          sourceNode,
          targetNode.id,
          targetField.id,
          oldEdge.id,
        );
        const oldTargetNeedsClear =
          currentOldEdge.target !== targetNode.id ||
          currentOldEdge.targetHandle !== targetField.id;
        const removedEdges = uniqueFlowEdges([
          ...(oldTargetNeedsClear ? [currentOldEdge] : []),
          ...replacedEdges,
        ]);
        if (removedEdges.length > 0) {
          clearTargetValuesForRemovedEdges(setNodes, removedEdges);
        }
        const replacedEdgeIds = new Set(replacedEdges.map((edge) => edge.id));
        return currentEdges
          .filter((edge) => edge.id === oldEdge.id || !replacedEdgeIds.has(edge.id))
          .map((edge) =>
            edge.id === oldEdge.id
              ? {
                  ...edge,
                  ...nextEdge,
                  selected: edge.selected,
                }
              : edge,
          );
      });

      setStepFieldValue(
        setNodes,
        targetNode.id,
        targetField.id,
        sourceNode.data.nodeKind === "initialGeometry"
          ? sourceNode.data.geometry?.id ?? ""
          : null,
      );
    },
    [edges, nodes],
  );

  const addGeometryNode = React.useCallback(
    (geometryId: string, position: { x: number; y: number }) => {
      const geometry = geometries.find((item) => item.id === geometryId);
      if (!geometry) {
        return;
      }
      const nodeId = uid("geom_node");
      const node: InitialGeometryFlowNode = {
        id: nodeId,
        type: "initialGeometry",
        position,
        data: {
          nodeKind: "initialGeometry",
          geometry,
        },
      };
      setNodes((currentNodes) => [...currentNodes, node]);
      setSelectedNodeId(nodeId);
    },
    [geometries],
  );

  const addStepNode = React.useCallback(
    (
      template: ProcessStepTemplate,
      position: { x: number; y: number },
      openEditorAfterCreate: boolean,
    ) => {
      const nodeId = uid("step_node");
      const stepRefId = uniqueStepRefId(template, nodes);
      const geometryInputFields = getGeometryInputFields(template);
      const node: ProcessStepFlowNode = {
        id: nodeId,
        type: "processStep",
        position,
        data: {
          nodeKind: "processStep",
          stepRefId,
          template,
          fieldValues: template.fieldDefinitions.map(createDefaultFieldValue),
          geometryInputFields,
        },
      };
      setNodes((currentNodes) => [...currentNodes, node]);
      setSelectedNodeId(nodeId);
      if (openEditorAfterCreate) {
        setEditingStepNodeId(nodeId);
      }
    },
    [nodes],
  );

  const addStepNearViewport = React.useCallback(
    (template: ProcessStepTemplate) => {
      const selectedNode = selectedNodeId
        ? nodes.find((node) => node.id === selectedNodeId)
        : null;
      if (selectedNode) {
        addStepNode(
          template,
          { x: selectedNode.position.x + 330, y: selectedNode.position.y },
          true,
        );
        return;
      }

      const maxX = nodes.reduce(
        (rightMost, node) => Math.max(rightMost, node.position.x),
        Number.NEGATIVE_INFINITY,
      );
      if (Number.isFinite(maxX)) {
        addStepNode(template, { x: maxX + 330, y: 160 }, true);
        return;
      }

      const pane = document.querySelector(".react-flow")?.getBoundingClientRect();
      const center = pane
        ? reactFlow.screenToFlowPosition({
            x: pane.left + pane.width / 2,
            y: pane.top + pane.height / 2,
          })
        : { x: 320, y: 180 };
      addStepNode(template, { x: center.x - 120, y: center.y - 60 }, true);
    },
    [addStepNode, nodes, reactFlow, selectedNodeId],
  );

  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const geometryId = event.dataTransfer.getData(GEOMETRY_DRAG_TYPE);
      const stepTemplateId = event.dataTransfer.getData(STEP_TEMPLATE_DRAG_TYPE);

      if (geometryId) {
        addGeometryNode(geometryId, position);
        return;
      }

      const template = stepTemplates.find((item) => item.id === stepTemplateId);
      if (template) {
        addStepNode(template, position, false);
      }
    },
    [addGeometryNode, addStepNode, reactFlow, stepTemplates],
  );

  const onDragOver = React.useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  function updateStepFieldValue(nodeId: string, fieldId: string, value: unknown) {
    setStepFieldValue(setNodes, nodeId, fieldId, value);
  }

  function updateRepeaterFieldValue(
    nodeId: string,
    field: FieldDefinition,
    updater: (current: RepeatableGroupValue) => RepeatableGroupValue,
  ) {
    const currentValue = getFieldValue(editingStepNode?.data.fieldValues ?? [], field.id);
    const baseValue = isRepeatableGroupValue(currentValue)
      ? currentValue
      : createDefaultFieldValue(field).value;
    setStepFieldValue(setNodes, nodeId, field.id, updater(baseValue as RepeatableGroupValue));
  }

  function unlinkInput(nodeId: string, fieldId: string) {
    const edge = edges.find(
      (candidate) => candidate.target === nodeId && candidate.targetHandle === fieldId,
    );
    if (edge) {
      deleteEdge(edge.id);
    }
  }

  function openTemplatePicker() {
    void listProcessFlowTemplates<ProcessFlowTemplate>()
      .then((templates) => {
        setFlowTemplates(templates);
        setApiError(null);
      })
      .catch((error) => {
        setApiError(error instanceof Error ? error.message : "Unable to load templates.");
      });
    setSelectedTemplateId(null);
    setTemplateSearch("");
    setConfirmingTemplateStart(false);
    setTemplatePickerOpen(true);
  }

  function closeTemplatePicker() {
    setTemplatePickerOpen(false);
    setConfirmingTemplateStart(false);
  }

  function requestStartFromTemplate() {
    if (!selectedTemplate) {
      return;
    }
    if (nodes.length > 0 || edges.length > 0) {
      setConfirmingTemplateStart(true);
      return;
    }
    startFromTemplate(selectedTemplate);
  }

  function startFromTemplate(template: ProcessFlowTemplate) {
    const draft = buildDraftGraphFromTemplate(template, stepTemplates);
    setNodes(draft.nodes);
    setEdges(draft.edges);
    setSelectedNodeId(null);
    setEditingStepNodeId(null);
    setGeometryPreview(null);
    setTemplatePickerOpen(false);
    setConfirmingTemplateStart(false);

    window.setTimeout(() => {
      reactFlow.fitView({ padding: 0.22, duration: 220 });
    }, 0);
  }

  function requestClearGraph() {
    if (nodes.length === 0 && edges.length === 0) {
      return;
    }
    setConfirmingGraphClear(true);
  }

  function clearGraph() {
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
    setEditingStepNodeId(null);
    setGeometryPreview(null);
    setConfirmingGraphClear(false);
  }

  async function saveFlow() {
    if (!analysis.canSave) {
      return;
    }

    const reachableStepNodes = nodes.filter(
      (node): node is ProcessStepFlowNode =>
        node.data.nodeKind === "processStep" &&
        analysis.reachableStepNodeIds.has(node.id),
    );
    const reachableNodeIds = new Set([
      ...Array.from(analysis.connectedInitialNodeIds),
      ...reachableStepNodes.map((node) => node.id),
    ]);
    const reachableEdges = edges.filter(
      (edge) => reachableNodeIds.has(edge.source) && reachableNodeIds.has(edge.target),
    );

    const timestamp = compactTimestamp();
    const technologyName = metadata.technologyName.trim();
    const instanceName = metadata.productInstanceName.trim() || technologyName;
    const flowTemplateId = `flow_tpl_${slugify(technologyName)}_${timestamp}`;
    const flowInstanceId = `flow_inst_${slugify(instanceName)}_${timestamp}`;

    const processFlowTemplate: ProcessFlowTemplate = {
      id: flowTemplateId,
      name: technologyName,
      version: "V1.0.0",
      description: "Custom process flow template snapshot created in browser.",
      owner: "local.user",
      stepRefs: reachableStepNodes.map((node) => ({
        stepRefId: node.data.stepRefId,
        processStepTemplateId: node.data.template.id,
      })),
      flowEdges: reachableEdges.map((edge) => {
        const data = getFlowEdgeData(edge);
        return {
          edgeId: edge.id,
          source:
            data.sourceType === "stepOutput" && data.sourceStepRefId
              ? {
                  sourceType: "stepOutput",
                  stepRefId: data.sourceStepRefId,
                }
              : { sourceType: "geometryRef" },
          target: {
            stepRefId: data.targetStepRefId,
            targetFieldId: data.targetFieldId,
          },
        };
      }),
    };

    const processFlowInstance: ProcessFlowInstance = {
      id: flowInstanceId,
      name: instanceName,
      processFlowTemplateId: flowTemplateId,
      stepValueSets: reachableStepNodes.map((node) => ({
        stepRefId: node.data.stepRefId,
        processStepTemplateId: node.data.template.id,
        fieldValues: normalizeFieldValuesForSave(node, reachableEdges),
      })),
    };

    await createProcessFlowTemplateInstance({
      processFlowTemplate,
      processFlowInstance,
    });

    const usedTemplateIds = new Set(
      reachableStepNodes.map((node) => node.data.template.id),
    );
    const usedGeometryIds = new Set<string>();
    reachableStepNodes.forEach((node) => {
      normalizeFieldValuesForSave(node, reachableEdges).forEach((fieldValue) => {
        if (typeof fieldValue.value === "string" && fieldValue.value.startsWith("geom_")) {
          usedGeometryIds.add(fieldValue.value);
        }
      });
    });

    downloadJson(`process_${slugify(instanceName)}.json`, {
      processFlowTemplate,
      processFlowInstance,
      processStepTemplates: stepTemplates.filter((template) =>
        usedTemplateIds.has(template.id),
      ),
      geometryRefs: geometries.filter((geometry) =>
        usedGeometryIds.has(geometry.id),
      ),
      categories: {
        processStepCategories: Array.from(
          new Set(reachableStepNodes.map((node) => node.data.template.category)),
        ).sort(),
        geometryCategories: Array.from(
          new Set(
            geometries.filter((geometry) => usedGeometryIds.has(geometry.id)).map(
              (geometry) => geometry.category,
            ),
          ),
        ).sort(),
      },
    });

    router.push("/");
  }

  if (!hydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading flow editor...
      </main>
    );
  }

  return (
    <main className="flex h-screen min-h-[760px] flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b bg-white px-5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold tracking-normal">
                Process Flow Template Editor
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a new topology snapshot from a blank graph or an existing template.
            </p>
            {apiError ? (
              <p className="mt-1 text-sm text-destructive">{apiError}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft />
                Home
              </Link>
            </Button>
            <Button variant="outline" onClick={openTemplatePicker}>
              <GitFork />
              Start from template
            </Button>
            <Button
              variant="outline"
              disabled={nodes.length === 0 && edges.length === 0}
              onClick={requestClearGraph}
            >
              <Trash2 />
              Clear
            </Button>
            <Button disabled={!analysis.canSave} onClick={() => void saveFlow()}>
              <Save />
              Save
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 items-end gap-3 xl:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto]">
          <FormField label="Technology name" required>
            <input
              className={inputClass}
              value={metadata.technologyName}
              onChange={(event) =>
                setMetadata((current) => ({
                  ...current,
                  technologyName: event.target.value,
                }))
              }
              placeholder="Example: HBM4 glass carrier flow"
            />
          </FormField>
          <FormField label="Product / instance name">
            <input
              className={inputClass}
              value={metadata.productInstanceName}
              onChange={(event) =>
                setMetadata((current) => ({
                  ...current,
                  productInstanceName: event.target.value,
                }))
              }
              placeholder="Falls back to technology name"
            />
          </FormField>
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
            {analysis.canSave ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive" />
            )}
            <span
              className={cn(
                "max-w-[460px] truncate",
                analysis.canSave ? "text-emerald-700" : "text-destructive",
              )}
            >
              {analysis.validationMessage}
            </span>
          </div>
        </div>
      </header>

      <section className="shrink-0 border-b bg-background px-5 py-2">
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="signal">flow steps {analysis.flowStepCount}</Badge>
          <Badge variant={analysis.outsideFlowCount > 0 ? "outline" : "secondary"}>
            outside flow {analysis.outsideFlowCount}
          </Badge>
          <Badge variant="outline">nodes {nodes.length}</Badge>
          <Badge variant="outline">edges {edges.length}</Badge>
          <span className="truncate text-muted-foreground">
            {analysis.validationMessage}
          </span>
        </div>
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[280px_minmax(540px,1fr)_320px] lg:overflow-hidden">
        <aside className="min-h-[240px] border-r bg-white lg:min-h-0">
          <PaletteHeader icon={<Boxes className="h-4 w-4" />} title="Geometry library" />
          <div className="h-[240px] overflow-y-auto p-3 lg:h-[calc(100%-49px)]">
            <div className="flex flex-col gap-3">
              {geometryGroups.map((group) => (
                <PaletteGroup
                  key={group.category}
                  category={group.category}
                  count={group.items.length}
                  open={openGeometryCategories[group.category] === true}
                  onToggle={() =>
                    setOpenGeometryCategories((current) => ({
                      ...current,
                      [group.category]: current[group.category] !== true,
                    }))
                  }
                >
                  {group.items.map((geometry) => (
                    <GeometryPaletteItem key={geometry.id} geometry={geometry} />
                  ))}
                </PaletteGroup>
              ))}
            </div>
          </div>
        </aside>

        <ProcessFlowGraph<FlowNode, FlowEdge>
          mode="edit"
          nodes={displayNodes}
          edges={displayEdges}
          className="min-h-[560px] lg:min-h-0"
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          isValidConnection={isValidConnection}
          edgesReconnectable
          reconnectRadius={14}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
            if (node.data.nodeKind === "processStep") {
              setEditingStepNodeId(node.id);
            }
          }}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          minZoom={0.35}
          maxZoom={1.4}
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
          miniMapNodeColor={(node) =>
            node.data.nodeKind === "initialGeometry" ? "#0f766e" : "#0891b2"
          }
        />

        <aside className="min-h-[280px] border-l bg-white lg:min-h-0">
          <PaletteHeader
            icon={<FileJson className="h-4 w-4" />}
            title="Process step templates"
          />
          <div className="h-[280px] overflow-y-auto p-3 lg:h-[calc(100%-49px)]">
            {stepTemplates.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                No process step templates from API.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {stepGroups.map((group) => (
                  <PaletteGroup
                    key={group.category}
                    category={group.category}
                    count={group.items.length}
                    open={openStepCategories[group.category] === true}
                    onToggle={() =>
                      setOpenStepCategories((current) => ({
                        ...current,
                        [group.category]: current[group.category] !== true,
                      }))
                    }
                  >
                    {group.items.map((template) => (
                      <StepTemplatePaletteItem
                        key={template.id}
                        template={template}
                        onAdd={() => addStepNearViewport(template)}
                      />
                    ))}
                  </PaletteGroup>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>

      {templatePickerOpen ? (
        <StartFromTemplateDialog
          templates={filteredFlowTemplates}
          totalTemplateCount={flowTemplates.length}
          search={templateSearch}
          selectedTemplateId={selectedTemplateId}
          confirmingReplace={confirmingTemplateStart}
          onSearchChange={setTemplateSearch}
          onSelectTemplate={setSelectedTemplateId}
          onCancel={closeTemplatePicker}
          onStart={requestStartFromTemplate}
          onCancelReplace={() => setConfirmingTemplateStart(false)}
          onConfirmReplace={() => {
            if (selectedTemplate) {
              startFromTemplate(selectedTemplate);
            }
          }}
        />
      ) : null}

      {confirmingGraphClear ? (
        <ClearGraphDialog
          onCancel={() => setConfirmingGraphClear(false)}
          onConfirm={clearGraph}
        />
      ) : null}

      {editingStepNode ? (
        <StepInstanceDialog
          node={editingStepNode}
          edges={edges}
          nodes={nodes}
          analysis={analysis}
          geometries={geometries}
          onClose={() => setEditingStepNodeId(null)}
          onFieldChange={(fieldId, value) =>
            updateStepFieldValue(editingStepNode.id, fieldId, value)
          }
          onRepeaterChange={(field, updater) =>
            updateRepeaterFieldValue(editingStepNode.id, field, updater)
          }
          onUnlink={(fieldId) => unlinkInput(editingStepNode.id, fieldId)}
        />
      ) : null}

      {geometryPreview ? (
        <GeometryPreviewPanel
          preview={geometryPreview}
          onClose={() => setGeometryPreview(null)}
        />
      ) : null}
    </main>
  );
}

function PaletteHeader({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex h-12 items-center gap-2 border-b px-3 text-sm font-semibold">
      {icon}
      {title}
    </div>
  );
}

function PaletteGroup({
  category,
  count,
  open,
  onToggle,
  children,
}: {
  category: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border bg-white">
      <button
        className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-left text-sm"
        onClick={onToggle}
      >
        <span className="min-w-0 truncate font-medium">{category}</span>
        <span className="flex shrink-0 items-center gap-2">
          <Badge variant="secondary">{count}</Badge>
          <ChevronDown
            className={cn("h-4 w-4 transition", !open && "-rotate-90")}
          />
        </span>
      </button>
      {open ? <div className="flex flex-col gap-2 p-2">{children}</div> : null}
    </section>
  );
}

function GeometryPaletteItem({ geometry }: { geometry: GeometryEntity }) {
  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(GEOMETRY_DRAG_TYPE, geometry.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab rounded-md border bg-white p-3 text-sm shadow-sm transition hover:border-primary/60 hover:bg-muted/20 active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <Box className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="line-clamp-2 font-medium leading-snug">{geometry.name}</div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {geometry.entityType} / {geometry.id}
          </div>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {geometry.description}
      </p>
    </div>
  );
}

function StepTemplatePaletteItem({
  template,
  onAdd,
}: {
  template: ProcessStepTemplate;
  onAdd: () => void;
}) {
  const repeaterCount = template.fieldDefinitions.filter(
    (field) => field.valueType === "fieldGroupArray",
  ).length;
  const geometryInputCount = getGeometryInputFields(template).length;
  const disabled = geometryInputCount === 0;

  return (
    <button
      draggable={!disabled}
      disabled={disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData(STEP_TEMPLATE_DRAG_TYPE, template.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={onAdd}
      className="w-full rounded-md border bg-white p-3 text-left text-sm shadow-sm transition hover:border-primary/60 hover:bg-muted/20 disabled:cursor-not-allowed disabled:opacity-50"
      title={
        disabled
          ? "This template has no top-level geometryRef input slot."
          : "Click to add, or drag to the whiteboard"
      }
    >
      <div className="font-medium leading-snug">{template.name}</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {template.version} / {template.fieldDefinitions.length} fields
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="outline">{geometryInputCount} geometry slots</Badge>
        {repeaterCount > 0 ? <Badge variant="signal">repeater</Badge> : null}
      </div>
    </button>
  );
}

function StartFromTemplateDialog({
  templates,
  totalTemplateCount,
  search,
  selectedTemplateId,
  confirmingReplace,
  onSearchChange,
  onSelectTemplate,
  onCancel,
  onStart,
  onCancelReplace,
  onConfirmReplace,
}: {
  templates: ProcessFlowTemplate[];
  totalTemplateCount: number;
  search: string;
  selectedTemplateId: string | null;
  confirmingReplace: boolean;
  onSearchChange: (value: string) => void;
  onSelectTemplate: (templateId: string) => void;
  onCancel: () => void;
  onStart: () => void;
  onCancelReplace: () => void;
  onConfirmReplace: () => void;
}) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (confirmingReplace) {
          onCancelReplace();
          return;
        }
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [confirmingReplace, onCancel, onCancelReplace]);

  const emptyMessage =
    totalTemplateCount === 0 ? "No templates found" : "No matching templates";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close start from template"
        className="absolute inset-0 cursor-default bg-foreground/40"
        onClick={onCancel}
      />
      <section
        className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b bg-white px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">Start from template</h2>
            </div>
            <Button variant="ghost" size="icon" title="Close" onClick={onCancel}>
              <X />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className={cn(inputClass, "pl-9")}
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search templates"
              autoFocus
            />
          </label>

          <div className="mt-4 overflow-hidden rounded-md border bg-white">
            {templates.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            ) : (
              <div className="max-h-[320px] divide-y overflow-y-auto">
                {templates.map((template) => {
                  const selected = template.id === selectedTemplateId;
                  return (
                    <button
                      key={template.id}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition hover:bg-muted/40",
                        selected && "bg-primary/10 text-primary",
                      )}
                      onClick={() => onSelectTemplate(template.id)}
                    >
                      <span className="min-w-0 truncate font-medium">
                        {template.name}
                      </span>
                      {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t bg-white px-5 py-4">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!selectedTemplateId} onClick={onStart}>
            Start
          </Button>
        </footer>

        {confirmingReplace ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 p-5 backdrop-blur-sm">
            <section className="w-full max-w-md rounded-md border bg-white p-5 shadow-viewport">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">Replace current draft?</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    Starting from a template will replace the current draft graph.
                  </p>
                </div>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" onClick={onCancelReplace}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={onConfirmReplace}>
                  Replace draft
                </Button>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ClearGraphDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Cancel clear graph"
        className="absolute inset-0 cursor-default bg-foreground/40"
        onClick={onCancel}
      />
      <section
        className="relative z-10 w-[min(420px,calc(100vw-32px))] rounded-md border bg-white p-5 shadow-viewport"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Clear graph?</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Clearing removes all steps, initial geometry nodes, edges, and step
              values from the current draft graph.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Clear
          </Button>
        </div>
      </section>
    </div>
  );
}

function StepInstanceDialog({
  node,
  nodes,
  edges,
  analysis,
  geometries,
  onClose,
  onFieldChange,
  onRepeaterChange,
  onUnlink,
}: {
  node: ProcessStepFlowNode;
  nodes: FlowNode[];
  edges: FlowEdge[];
  analysis: GraphAnalysis;
  geometries: GeometryEntity[];
  onClose: () => void;
  onFieldChange: (fieldId: string, value: unknown) => void;
  onRepeaterChange: (
    field: FieldDefinition,
    updater: (current: RepeatableGroupValue) => RepeatableGroupValue,
  ) => void;
  onUnlink: (fieldId: string) => void;
}) {
  const completion = analysis.stepCompletion.get(node.id) ?? {
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
              <h2 className="truncate text-lg font-semibold">{node.data.template.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="max-w-[280px] truncate">{node.data.stepRefId}</span>
                <Badge variant={node.data.isReachable ? "signal" : "outline"}>
                  {node.data.isReachable ? "in flow" : "outside flow"}
                </Badge>
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

                return (
                  <div
                    key={field.id}
                    className="grid grid-cols-[180px_1fr_auto] items-center gap-3 px-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{field.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {field.id}
                      </div>
                    </div>
                    {edge ? (
                      <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
                        <div className="truncate">
                          {field.name} &lt;-{" "}
                          {sourceNode ? sourceLabelForNode(sourceNode) : "Unknown source"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {isStepOutput
                            ? "Graph-provided input, saved FieldValue.value is null."
                            : `Saved FieldValue.value is ${String(fieldValue || edgeData?.sourceGeometryEntityId)}.`}
                        </div>
                      </div>
                    ) : (
                      <select
                        className={selectClass}
                        value={typeof fieldValue === "string" ? fieldValue : ""}
                        onChange={(event) => onFieldChange(field.id, event.target.value)}
                      >
                        <option value="">Select geometry entity</option>
                        {geometries.map((geometry) => (
                          <option key={geometry.id} value={geometry.id}>
                            {geometry.name} / {geometry.id}
                          </option>
                        ))}
                      </select>
                    )}
                    {edge ? (
                      <Button
                        variant="outline"
                        size="sm"
                        title="Unlink input"
                        onClick={() => onUnlink(field.id)}
                      >
                        <Link2Off />
                        Unlink
                      </Button>
                    ) : (
                      <Badge variant={fieldValue ? "signal" : "outline"}>
                        {fieldValue ? "selected" : "unmapped"}
                      </Badge>
                    )}
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
                    onRepeaterChange={(updater) => onRepeaterChange(field, updater)}
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
                      onRepeaterChange((current) => updateRepeatChildValue(
                        current,
                        itemIndex,
                        child.id,
                        nextValue,
                      ))
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
  if (field.valueType === "coordinates" || field.controlType === "coordinateList") {
    return (
      <CoordinateListControl value={value} unit={field.unit} onChange={onChange} />
    );
  }

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
          <span className="shrink-0 text-sm text-muted-foreground">{field.unit}</span>
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

function buildDraftGraphFromTemplate(
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
        id: importedStepNodeId(stepRef.stepRefId),
        type: "processStep",
        position: layout.stepPositions.get(stepRef.stepRefId) ?? { x: 320, y: 240 },
        data: {
          nodeKind: "processStep",
          stepRefId: stepRef.stepRefId,
          template: stepTemplate,
          fieldValues: stepTemplate.fieldDefinitions.map(createDefaultFieldValue),
          geometryInputFields: getGeometryInputFields(stepTemplate),
        },
      },
    ];
  });

  const processNodeByStepRefId = new Map(
    processNodes.map((node) => [node.data.stepRefId, node]),
  );

  template.flowEdges.forEach((edge) => {
    if (edge.source.sourceType !== "stepOutput") {
      return;
    }
    const targetNode = processNodeByStepRefId.get(edge.target.stepRefId);
    if (!targetNode) {
      return;
    }
    setFieldValueInArray(targetNode.data.fieldValues, edge.target.targetFieldId, null);
  });

  const initialNodes: InitialGeometryFlowNode[] = template.flowEdges.flatMap((edge) => {
    if (edge.source.sourceType !== "geometryRef") {
      return [];
    }
    const targetNode = processNodeByStepRefId.get(edge.target.stepRefId);
    const targetField = targetNode?.data.geometryInputFields.find(
      (field) => field.id === edge.target.targetFieldId,
    );
    if (!targetNode || !targetField) {
      return [];
    }
    return [
      {
        id: importedInitialNodeId(edge.edgeId),
        type: "initialGeometry",
        position: layout.initialPositions.get(edge.edgeId) ?? { x: 40, y: 240 },
        data: {
          nodeKind: "initialGeometry",
          geometry: null,
          placeholderLabel: "Select geometry",
          placeholderSublabel: targetField.name,
        },
      },
    ];
  });

  const nodeIds = new Set([
    ...processNodes.map((node) => node.id),
    ...initialNodes.map((node) => node.id),
  ]);
  const usedEdgeIds = new Set<string>();
  const flowEdges: FlowEdge[] = template.flowEdges.flatMap((edge, index) => {
    const targetNode = processNodeByStepRefId.get(edge.target.stepRefId);
    const targetField = targetNode?.data.geometryInputFields.find(
      (field) => field.id === edge.target.targetFieldId,
    );
    if (!targetNode || !targetField) {
      return [];
    }

    const sourceNodeId =
      edge.source.sourceType === "geometryRef"
        ? importedInitialNodeId(edge.edgeId)
        : importedStepNodeId(edge.source.stepRefId);
    if (!nodeIds.has(sourceNodeId)) {
      return [];
    }

    const sourceNode =
      edge.source.sourceType === "geometryRef"
        ? initialNodes.find((node) => node.id === sourceNodeId)
        : processNodeByStepRefId.get(edge.source.stepRefId);
    if (!sourceNode) {
      return [];
    }

    return [
      {
        id: uniqueImportedEdgeId(edge.edgeId, index, usedEdgeIds),
        type: "dataFlow",
        source: sourceNodeId,
        target: targetNode.id,
        sourceHandle: "out",
        targetHandle: targetField.id,
        markerEnd: { type: MarkerType.ArrowClosed },
        reconnectable: "target",
        data: {
          sourceType: edge.source.sourceType,
          sourceGeometryEntityId: undefined,
          sourceStepRefId:
            edge.source.sourceType === "stepOutput" ? edge.source.stepRefId : undefined,
          targetStepRefId: targetNode.data.stepRefId,
          targetFieldId: targetField.id,
          slotLabel: targetField.name,
          sourceLabel: sourceLabelForNode(sourceNode),
          geometryViewVisible: true,
        },
      },
    ];
  });

  return { nodes: [...initialNodes, ...processNodes], edges: flowEdges };
}

function importedStepNodeId(stepRefId: string) {
  return `import_step_${safeGraphId(stepRefId)}`;
}

function importedInitialNodeId(edgeId: string) {
  return `import_geom_${safeGraphId(edgeId)}`;
}

function uniqueImportedEdgeId(
  edgeId: string,
  index: number,
  usedEdgeIds: Set<string>,
) {
  const base = `import_${safeGraphId(edgeId || `edge_${index + 1}`)}`;
  let candidate = base;
  let suffix = 2;
  while (usedEdgeIds.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  usedEdgeIds.add(candidate);
  return candidate;
}

function safeGraphId(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "item"
  );
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
  stepIds
    .filter((stepRefId) => !mainSet.has(stepRefId))
    .sort(
      (left, right) =>
        (rank.get(left) ?? 1) - (rank.get(right) ?? 1) ||
        (stepOrder.get(left) ?? 0) - (stepOrder.get(right) ?? 0) ||
        left.localeCompare(right),
    )
    .forEach((stepRefId) => {
      const upstreamLane = template.flowEdges
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
        .find((value): value is number => typeof value === "number");

      if (typeof upstreamLane === "number") {
        lane.set(stepRefId, upstreamLane);
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

  normalizeTemplateLayoutPositions(stepPositions, initialPositions);
  return { stepPositions, initialPositions };
}

function normalizeTemplateLayoutPositions(
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

function buildFlowEdge(
  edgeId: string,
  sourceNode: FlowNode,
  targetNode: ProcessStepFlowNode,
  targetField: FieldDefinition,
): FlowEdge {
  return {
    id: edgeId,
    type: "dataFlow",
    source: sourceNode.id,
    target: targetNode.id,
    sourceHandle: "out",
    targetHandle: targetField.id,
    markerEnd: { type: MarkerType.ArrowClosed },
    reconnectable: "target",
    data: {
      sourceType:
        sourceNode.data.nodeKind === "initialGeometry" ? "geometryRef" : "stepOutput",
      sourceGeometryEntityId:
        sourceNode.data.nodeKind === "initialGeometry"
          ? sourceNode.data.geometry?.id
          : undefined,
      sourceStepRefId:
        sourceNode.data.nodeKind === "processStep" ? sourceNode.data.stepRefId : undefined,
      targetStepRefId: targetNode.data.stepRefId,
      targetFieldId: targetField.id,
      slotLabel: targetField.name,
      sourceLabel: sourceLabelForNode(sourceNode),
      geometryViewVisible: true,
    },
  };
}

function getConnectionReplacementEdges(
  edges: FlowEdge[],
  sourceNode: FlowNode,
  targetNodeId: string,
  targetFieldId: string,
  excludedEdgeId?: string,
) {
  const replacements = new Map<string, FlowEdge>();
  edges.forEach((edge) => {
    if (edge.id === excludedEdgeId) {
      return;
    }
    const replacesTargetSlot =
      edge.target === targetNodeId && edge.targetHandle === targetFieldId;
    const replacesSourceOutgoing = edge.source === sourceNode.id;
    if (replacesTargetSlot || replacesSourceOutgoing) {
      replacements.set(edge.id, edge);
    }
  });
  return Array.from(replacements.values());
}

function uniqueFlowEdges(edges: FlowEdge[]) {
  return Array.from(new Map(edges.map((edge) => [edge.id, edge])).values());
}

function analyzeGraph(
  metadata: EditorMetadata,
  nodes: FlowNode[],
  edges: FlowEdge[],
): GraphAnalysis {
  const connectedInitialNodeIds = new Set(
    nodes
      .filter((node) => node.data.nodeKind === "initialGeometry")
      .filter((node) => edges.some((edge) => edge.source === node.id))
      .map((node) => node.id),
  );
  const reachableStepNodeIds = computeReachableSteps(connectedInitialNodeIds, edges);
  const stepNodes = nodes.filter(
    (node): node is ProcessStepFlowNode => node.data.nodeKind === "processStep",
  );
  const stepCompletion = computeStepCompletion(stepNodes, edges, reachableStepNodeIds);
  const duplicateTargetSlots = findDuplicateTargetSlots(edges);
  const duplicateOutgoingSources = findDuplicateOutgoingSources(nodes, edges);
  const invalidEdgeMessages = findInvalidEdges(nodes, edges);
  const hasCycle = graphHasCycle(nodes, edges);
  const unconnectedInitial = nodes.find(
    (node) =>
      isInitialGeometryNode(node) &&
      !connectedInitialNodeIds.has(node.id),
  ) as InitialGeometryFlowNode | undefined;
  const firstGeometryError = findFirstGeometryInputError(
    stepNodes,
    edges,
    reachableStepNodeIds,
  );
  const firstIncompleteStep = stepNodes.find((node) => {
    if (!reachableStepNodeIds.has(node.id)) {
      return false;
    }
    return !(stepCompletion.get(node.id)?.complete ?? false);
  });

  let validationMessage = "Ready to save";
  if (!metadata.technologyName.trim()) {
    validationMessage = "Technology name is required.";
  } else if (connectedInitialNodeIds.size === 0) {
    validationMessage = "Connect at least one initial geometry root.";
  } else if (unconnectedInitial) {
    validationMessage = `Connect or delete unconnected initial geometry: ${initialGeometryLabel(unconnectedInitial)}.`;
  } else if (hasCycle) {
    validationMessage = "Graph contains a cycle.";
  } else if (duplicateTargetSlots.length > 0) {
    validationMessage = "A target geometry slot has more than one incoming edge.";
  } else if (duplicateOutgoingSources.length > 0) {
    validationMessage = "A source node has more than one outgoing edge.";
  } else if (invalidEdgeMessages.length > 0) {
    validationMessage = invalidEdgeMessages[0];
  } else if (firstGeometryError) {
    validationMessage = firstGeometryError;
  } else if (firstIncompleteStep) {
    const completion = stepCompletion.get(firstIncompleteStep.id);
    validationMessage = `${firstIncompleteStep.data.template.name}: ${completion?.blockingFieldName ?? "Field"} is required.`;
  }

  return {
    connectedInitialNodeIds,
    reachableStepNodeIds,
    outsideFlowCount: stepNodes.filter((node) => !reachableStepNodeIds.has(node.id))
      .length,
    flowStepCount: reachableStepNodeIds.size,
    hasCycle,
    duplicateTargetSlots,
    duplicateOutgoingSources,
    invalidEdgeMessages,
    stepCompletion,
    validationMessage,
    canSave: validationMessage === "Ready to save",
  };
}

function computeReachableSteps(
  initialNodeIds: Set<string>,
  edges: FlowEdge[],
): Set<string> {
  const reachable = new Set<string>();
  const queue = Array.from(initialNodeIds);

  while (queue.length > 0) {
    const sourceId = queue.shift();
    if (!sourceId) {
      continue;
    }
    edges
      .filter((edge) => edge.source === sourceId)
      .forEach((edge) => {
        if (!reachable.has(edge.target)) {
          reachable.add(edge.target);
          queue.push(edge.target);
        }
      });
  }

  return reachable;
}

function computeStepCompletion(
  stepNodes: ProcessStepFlowNode[],
  edges: FlowEdge[],
  reachableStepNodeIds: Set<string>,
): Map<string, StepCompletion> {
  const byId = new Map(stepNodes.map((node) => [node.id, node]));
  const memo = new Map<string, StepCompletion>();

  function isComplete(nodeId: string, visiting = new Set<string>()): StepCompletion {
    const cached = memo.get(nodeId);
    if (cached) {
      return cached;
    }
    const node = byId.get(nodeId);
    if (!node) {
      return { complete: false, blockingFieldName: "Missing source step" };
    }
    if (visiting.has(nodeId)) {
      return { complete: false, blockingFieldName: "Cycle" };
    }
    visiting.add(nodeId);

    for (const field of node.data.template.fieldDefinitions) {
      const value = getFieldValue(node.data.fieldValues, field.id);
      if (isGeometryField(field)) {
        const edge = edges.find(
          (candidate) =>
            candidate.target === node.id && candidate.targetHandle === field.id,
        );
        const edgeData = edge ? getFlowEdgeData(edge) : null;
        if (edgeData?.sourceType === "geometryRef") {
          if (!isExplicitGeometryId(edgeData.sourceGeometryEntityId)) {
            const result = { complete: false, blockingFieldName: field.name };
            memo.set(nodeId, result);
            return result;
          }
          continue;
        }
        if (edge && edgeData?.sourceType === "stepOutput") {
          if (!reachableStepNodeIds.has(edge.source)) {
            const result = { complete: false, blockingFieldName: field.name };
            memo.set(nodeId, result);
            return result;
          }
          const upstream = isComplete(edge.source, new Set(visiting));
          if (!upstream.complete) {
            const result = { complete: false, blockingFieldName: field.name };
            memo.set(nodeId, result);
            return result;
          }
          continue;
        }
        if (!isExplicitGeometryId(value)) {
          const result = { complete: false, blockingFieldName: field.name };
          memo.set(nodeId, result);
          return result;
        }
        continue;
      }

      if (!isFieldValueComplete(field, value)) {
        const result = { complete: false, blockingFieldName: field.name };
        memo.set(nodeId, result);
        return result;
      }
    }

    const result = { complete: true, blockingFieldName: null };
    memo.set(nodeId, result);
    return result;
  }

  stepNodes.forEach((node) => {
    memo.set(node.id, isComplete(node.id));
  });

  return memo;
}

function findFirstGeometryInputError(
  stepNodes: ProcessStepFlowNode[],
  edges: FlowEdge[],
  reachableStepNodeIds: Set<string>,
) {
  for (const node of stepNodes) {
    if (!reachableStepNodeIds.has(node.id)) {
      continue;
    }
    for (const field of node.data.geometryInputFields) {
      const edge = edges.find(
        (candidate) => candidate.target === node.id && candidate.targetHandle === field.id,
      );
      const value = getFieldValue(node.data.fieldValues, field.id);
      const edgeData = edge ? getFlowEdgeData(edge) : null;
      if (edgeData?.sourceType === "geometryRef" && !isExplicitGeometryId(edgeData.sourceGeometryEntityId)) {
        return `${node.data.template.name}: ${field.name} needs a geometry entity id.`;
      }
      if (!edge && value === null) {
        return `${node.data.template.name}: ${field.name} cannot be null without an upstream step output.`;
      }
      if (!edge && !isExplicitGeometryId(value)) {
        return `${node.data.template.name}: select geometry for ${field.name}.`;
      }
    }
  }
  return null;
}

function findDuplicateTargetSlots(edges: FlowEdge[]) {
  const counts = new Map<string, number>();
  edges.forEach((edge) => {
    const key = `${edge.target}:${edge.targetHandle ?? ""}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([key]) => key);
}

function findDuplicateOutgoingSources(nodes: FlowNode[], edges: FlowEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const counts = new Map<string, number>();
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source)) {
      return;
    }
    counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([nodeId]) => nodeId);
}

function findInvalidEdges(nodes: FlowNode[], edges: FlowEdge[]) {
  const messages: string[] = [];
  edges.forEach((edge) => {
    const source = nodes.find((node) => node.id === edge.source);
    const target = findProcessNode(nodes, edge.target);
    if (!source) {
      messages.push(`Edge ${edge.id} has a missing source.`);
      return;
    }
    if (!target) {
      messages.push(`Edge ${edge.id} must target a process step.`);
      return;
    }
    const targetField = target.data.geometryInputFields.find(
      (field) => field.id === getFlowEdgeData(edge).targetFieldId,
    );
    if (!targetField) {
      messages.push(`Edge ${edge.id} targets an invalid geometry input slot.`);
    }
  });
  return messages;
}

function graphHasCycle(nodes: FlowNode[], edges: FlowEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return;
    }
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(nodeId: string): boolean {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }

  return Array.from(nodeIds).some((nodeId) => visit(nodeId));
}

function validateConnection(
  connection: Connection,
  nodes: FlowNode[],
  edges: FlowEdge[],
): { valid: boolean; reason?: string } {
  if (!connection.source || !connection.target || !connection.targetHandle) {
    return { valid: false, reason: "Missing source or target slot." };
  }
  if (connection.source === connection.target) {
    return { valid: false, reason: "Source cannot equal target." };
  }

  const source = nodes.find((node) => node.id === connection.source);
  const target = findProcessNode(nodes, connection.target);
  if (!source || !target) {
    return { valid: false, reason: "Target must be a process step." };
  }

  const targetField = target.data.geometryInputFields.find(
    (field) => field.id === connection.targetHandle,
  );
  if (!targetField) {
    return { valid: false, reason: "Target slot must be a top-level geometryRef field." };
  }

  const edgesAfterReplacement = edges.filter(
    (edge) =>
      edge.source !== connection.source &&
      !(edge.target === connection.target && edge.targetHandle === connection.targetHandle),
  );
  if (hasPath(connection.target, connection.source, edgesAfterReplacement)) {
    return { valid: false, reason: "Connection would create a cycle." };
  }

  return { valid: true };
}

function hasPath(sourceId: string, targetId: string, edges: FlowEdge[]) {
  const queue = [sourceId];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    if (current === targetId) {
      return true;
    }
    visited.add(current);
    edges
      .filter((edge) => edge.source === current)
      .forEach((edge) => queue.push(edge.target));
  }
  return false;
}

function normalizeFieldValuesForSave(node: ProcessStepFlowNode, edges: FlowEdge[]) {
  const values = node.data.template.fieldDefinitions.map((field) => {
    const existing = node.data.fieldValues.find((value) => value.fieldId === field.id);
    return existing ? clone(existing) : createDefaultFieldValue(field);
  });

  node.data.geometryInputFields.forEach((field) => {
    const edge = edges.find(
      (candidate) => candidate.target === node.id && candidate.targetHandle === field.id,
    );
    const edgeData = edge ? getFlowEdgeData(edge) : null;
    if (edgeData?.sourceType === "geometryRef") {
      setFieldValueInArray(values, field.id, edgeData.sourceGeometryEntityId ?? "");
    } else if (edgeData?.sourceType === "stepOutput") {
      setFieldValueInArray(values, field.id, null);
    }
  });

  return values;
}

function buildDraftFlowTemplateForPreview(
  nodes: FlowNode[],
  edges: FlowEdge[],
): ProcessFlowTemplate {
  const stepNodes = nodes.filter(isProcessStepNode);
  const stepNodeIds = new Set(stepNodes.map((node) => node.id));

  return {
    id: "preview_template_draft",
    name: "Preview template draft",
    version: "V1.0.0",
    description: "In-memory process flow template draft used for geometry preview.",
    owner: "local.user",
    stepRefs: stepNodes.map((node) => ({
      stepRefId: node.data.stepRefId,
      processStepTemplateId: node.data.template.id,
    })),
    flowEdges: edges.flatMap((edge) => {
      const targetNode = findProcessNode(nodes, edge.target);
      if (!targetNode) return [];
      const data = getFlowEdgeData(edge);
      const sourceNode = nodes.find((node) => node.id === edge.source);
      const source =
        data.sourceType === "stepOutput"
          ? stepOutputSourceForPreview(data, sourceNode, stepNodeIds)
          : { sourceType: "geometryRef" as const };
      if (!source) return [];
      return [
        {
          edgeId: edge.id,
          source,
          target: {
            stepRefId: targetNode.data.stepRefId,
            targetFieldId: data.targetFieldId,
          },
        },
      ];
    }),
  };
}

function buildDraftInstanceForPreview(
  nodes: FlowNode[],
  edges: FlowEdge[],
  metadata: EditorMetadata,
): ProcessFlowInstance {
  const stepNodes = nodes.filter(isProcessStepNode);
  const name =
    metadata.productInstanceName.trim() ||
    metadata.technologyName.trim() ||
    "Preview draft";

  return {
    id: "preview_instance_draft",
    name,
    processFlowTemplateId: "preview_template_draft",
    stepValueSets: stepNodes.map((node) => ({
      stepRefId: node.data.stepRefId,
      processStepTemplateId: node.data.template.id,
      fieldValues: normalizeFieldValuesForSave(node, edges),
    })),
  };
}

function stepOutputSourceForPreview(
  data: FlowEdgeData,
  sourceNode: FlowNode | undefined,
  stepNodeIds: Set<string>,
): { sourceType: "stepOutput"; stepRefId: string } | null {
  if (data.sourceStepRefId) {
    return { sourceType: "stepOutput", stepRefId: data.sourceStepRefId };
  }
  if (sourceNode && isProcessStepNode(sourceNode) && stepNodeIds.has(sourceNode.id)) {
    return { sourceType: "stepOutput", stepRefId: sourceNode.data.stepRefId };
  }
  return null;
}

function getGeometryPreviewAvailability(
  edge: FlowEdge,
  nodes: FlowNode[],
  geometries: GeometryEntity[],
  analysis: GraphAnalysis,
) {
  if (analysis.hasCycle) {
    return { enabled: false, reason: "Resolve the graph cycle first" };
  }
  if (analysis.duplicateTargetSlots.length > 0) {
    return { enabled: false, reason: "Resolve duplicate target slots first" };
  }
  if (analysis.invalidEdgeMessages.length > 0) {
    return { enabled: false, reason: analysis.invalidEdgeMessages[0] };
  }

  const data = getFlowEdgeData(edge);
  if (data.sourceType === "geometryRef") {
    if (!data.sourceGeometryEntityId) {
      return { enabled: false, reason: "Select initial geometry first" };
    }
    if (!geometries.some((geometry) => geometry.id === data.sourceGeometryEntityId)) {
      return { enabled: false, reason: "Selected geometry no longer exists" };
    }
    return { enabled: true, reason: "Preview geometry state" };
  }

  const sourceStep = findProcessNode(nodes, edge.source);
  if (!sourceStep) {
    return { enabled: false, reason: "Preview source step is missing" };
  }
  const completion = analysis.stepCompletion.get(sourceStep.id);
  if (!completion?.complete) {
    return { enabled: false, reason: "Complete upstream fields first" };
  }
  return { enabled: true, reason: "Preview geometry state" };
}

function isTerminalFinalPreviewVisible(
  node: ProcessStepFlowNode,
  edges: FlowEdge[],
  reachableStepNodeIds: Set<string>,
) {
  return (
    reachableStepNodeIds.has(node.id) &&
    !edges.some((edge) => edge.source === node.id)
  );
}

function getTerminalFinalPreviewAvailability(
  node: ProcessStepFlowNode,
  analysis: GraphAnalysis,
) {
  if (analysis.hasCycle) {
    return { enabled: false, reason: "Resolve the graph cycle first" };
  }
  if (analysis.duplicateTargetSlots.length > 0) {
    return { enabled: false, reason: "Resolve duplicate target slots first" };
  }
  if (analysis.invalidEdgeMessages.length > 0) {
    return { enabled: false, reason: analysis.invalidEdgeMessages[0] };
  }
  if (!analysis.reachableStepNodeIds.has(node.id)) {
    return { enabled: false, reason: "Connect an initial geometry first" };
  }

  const completion = analysis.stepCompletion.get(node.id);
  if (!completion?.complete) {
    return { enabled: false, reason: "Complete upstream fields first" };
  }
  return { enabled: true, reason: "Preview final geometry state" };
}

function clearTargetValuesForRemovedEdges(
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>,
  removedEdges: FlowEdge[],
  deletedNodeId?: string,
) {
  const targetPairs = removedEdges
    .filter((edge) => edge.target !== deletedNodeId)
    .map((edge) => ({
      nodeId: edge.target,
      fieldId: getFlowEdgeData(edge).targetFieldId,
    }));
  if (targetPairs.length === 0) {
    return;
  }
  setNodes((currentNodes) =>
    currentNodes.map((node) => {
      if (!isProcessStepNode(node)) {
        return node;
      }
      const fieldIds = targetPairs
        .filter((pair) => pair.nodeId === node.id)
        .map((pair) => pair.fieldId);
      if (fieldIds.length === 0) {
        return node;
      }
      const nextNode: ProcessStepFlowNode = {
        ...node,
        data: {
          ...node.data,
          fieldValues: node.data.fieldValues.map((fieldValue) =>
            fieldIds.includes(fieldValue.fieldId)
              ? { ...fieldValue, value: "" }
              : fieldValue,
          ),
        },
      };
      return nextNode;
    }),
  );
}

function setStepFieldValue(
  setNodes: React.Dispatch<React.SetStateAction<FlowNode[]>>,
  nodeId: string,
  fieldId: string,
  value: unknown,
) {
  setNodes((currentNodes) =>
    currentNodes.map((node) => {
      if (node.id !== nodeId || !isProcessStepNode(node)) {
        return node;
      }
      const fieldValues = node.data.fieldValues.some(
        (fieldValue) => fieldValue.fieldId === fieldId,
      )
        ? node.data.fieldValues.map((fieldValue) =>
            fieldValue.fieldId === fieldId ? { ...fieldValue, value } : fieldValue,
          )
        : [...node.data.fieldValues, { fieldId, value }];
      const nextNode: ProcessStepFlowNode = {
        ...node,
        data: { ...node.data, fieldValues },
      };
      return nextNode;
    }),
  );
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

function createDefaultFieldValue(field: FieldDefinition): FieldValue {
  if (isGeometryField(field)) {
    return { fieldId: field.id, value: "" };
  }
  if (field.valueType === "coordinates") {
    return { fieldId: field.id, value: [] };
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
        itemId: uid(`${field.id}_item`),
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
      const fieldValues = item.fieldValues.some(
        (fieldValue) => fieldValue.fieldId === childFieldId,
      )
        ? item.fieldValues.map((fieldValue) =>
            fieldValue.fieldId === childFieldId
              ? { ...fieldValue, value }
              : fieldValue,
          )
        : [...item.fieldValues, { fieldId: childFieldId, value }];
      return { ...item, fieldValues };
    }),
  };
}

function isFieldValueComplete(field: FieldDefinition, value: unknown): boolean {
  if (field.valueType === "boolean") {
    return typeof value === "boolean";
  }
  if (field.valueType === "coordinates") {
    return coordinateListValueIsComplete(value);
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
    return Array.isArray(value) && value.length > 0;
  }
  if (isNumericValueType(field.valueType)) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return false;
    }
    return passesNumericValidation(value, field.validation);
  }
  return typeof value === "string" && value.trim().length > 0;
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

function getGeometryInputFields(template: ProcessStepTemplate) {
  return template.fieldDefinitions.filter(isGeometryField);
}

function isGeometryField(field: FieldDefinition) {
  return field.valueType === "geometryRef";
}

function getFieldValue(fieldValues: FieldValue[], fieldId: string) {
  return fieldValues.find((fieldValue) => fieldValue.fieldId === fieldId)?.value;
}

function isExplicitGeometryId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
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

function findProcessNode(
  nodes: FlowNode[],
  nodeId: string | null | undefined,
): ProcessStepFlowNode | null {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  return node && isProcessStepNode(node) ? node : null;
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
  if (isInitialGeometryNode(node)) {
    return initialGeometryLabel(node);
  }
  return `${node.data.template.name} output`;
}

function initialGeometryLabel(node: InitialGeometryFlowNode) {
  return node.data.geometry?.name ?? node.data.placeholderLabel ?? "Select geometry";
}

function uniqueStepRefId(template: ProcessStepTemplate, nodes: FlowNode[]) {
  const base = slugify(template.name || template.id || "step").replace(/-/g, "_");
  const existing = new Set(
    nodes
      .filter((node): node is ProcessStepFlowNode => node.data.nodeKind === "processStep")
      .map((node) => node.data.stepRefId),
  );
  let index = 1;
  let candidate = `${base}_${index}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `${base}_${index}`;
  }
  return candidate;
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

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "custom-flow";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
