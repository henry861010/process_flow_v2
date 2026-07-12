"use client";

import * as React from "react";
import Link from "next/link";
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
  ArrowLeft,
  Box,
  Boxes,
  Check,
  CircleDot,
  Eye,
  FileJson,
  GitBranch,
  Layers3,
  Save,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import { CategoryLibraryBrowser } from "@/components/category-library/category-library-browser";
import { FileExportJobsPanel } from "@/components/geometry-preview/file-export-jobs-panel";
import type { FileExportJob } from "@/components/geometry-preview/file-export-client";
import {
  GeometryPreviewPanel,
  type GeometryPreviewContext,
} from "@/components/geometry-preview/geometry-preview-panel";
import {
  FlowInputAdvancedDisclosure,
  FlowInputAdvancedReadOnly,
  FlowInputBindingControl,
} from "@/components/process-flow-fields/flow-input-controls";
import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import {
  SaveInformationDialog,
  type InstanceSaveInformation,
  type SaveInformationMode,
  type TemplateSaveInformation,
} from "@/components/process-flow-save/save-information-dialog";
import {
  ProcessFlowGraph,
  type ProcessFlowGraphEdgeData,
  type ProcessFlowGraphNodeData,
} from "@/components/process-flow-graph/process-flow-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCategoryPath } from "@/lib/category-library";
import {
  createEmptyFlowConfiguration,
  getFlowInputReadiness,
  getStepExecutionReadiness,
  geometryForFlowInput,
  geometryMatchesFlowInput,
  isConfigurationComplete,
  type ConfigurationReadiness,
} from "@/lib/process-flow/configuration";
import {
  geometryInputDisplayName,
  geometryInputNodePresentation,
  geometryInputStatusLabel,
  stepReadinessStatusLabel,
} from "@/lib/process-flow/readiness-presentation";
import { computeTemplateLayout } from "@/lib/process-flow/template-layout";
import type {
  CatalogGeometryBinding,
  FlowConfiguration,
  FlowInputDefinition,
  GeometryEntity,
  ProcessFlowInstance,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  SavedFlowEdge,
  StepRef,
} from "@/lib/process-flow/types";
import { clone, normalizeStepLabel } from "@/lib/process-flow/utils";
import {
  createProcessFlowInstance,
  createProcessFlowTemplate,
  createProcessFlowTemplateInstance,
  loadBootstrap,
} from "@/lib/process-flow-api";
import { cn } from "@/lib/utils";

const STEP_TEMPLATE_DRAG_TYPE = "application/process-step-template-v2";
const GEOMETRY_DRAG_TYPE = "application/process-flow-geometry-v2";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[72px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted";

type TemplateMetadata = TemplateSaveInformation;

type FlowInputNodeData = ProcessFlowGraphNodeData & {
  nodeKind: "flowInput";
  definition: FlowInputDefinition;
};

type StepNodeData = ProcessFlowGraphNodeData & {
  nodeKind: "processStep";
  stepRef: StepRef;
  stepTemplate: ProcessStepTemplate;
};

type FlowInputNode = Node<FlowInputNodeData, "flowInput">;
type StepNode = Node<StepNodeData, "processStep">;
type FlowNode = FlowInputNode | StepNode;
type FlowEdge = Edge<ProcessFlowGraphEdgeData, "dataFlow">;

type EditableFlowInputPatch = Partial<
  Pick<
    FlowInputDefinition,
    "name" | "description" | "required" | "geometryConstraints"
  >
>;

type TemplateAnalysis = {
  error: string | null;
  missingPortKeys: Set<string>;
  hasCycle: boolean;
};

type PreviewAvailability =
  | { ok: true }
  | { ok: false; reason: string };

export function ProcessFlowTemplateEditor() {
  return (
    <ReactFlowProvider>
      <ProcessFlowTemplateEditorInner />
    </ReactFlowProvider>
  );
}

function ProcessFlowTemplateEditorInner() {
  const reactFlow = useReactFlow<FlowNode, FlowEdge>();
  const [hydrated, setHydrated] = React.useState(false);
  const [stepTemplates, setStepTemplates] = React.useState<ProcessStepTemplate[]>([]);
  const [flowTemplates, setFlowTemplates] = React.useState<ProcessFlowTemplate[]>([]);
  const [flowInstances, setFlowInstances] = React.useState<ProcessFlowInstance[]>([]);
  const [geometries, setGeometries] = React.useState<GeometryEntity[]>([]);
  const [metadata, setMetadata] = React.useState<TemplateMetadata>(newMetadata());
  const [instanceIdentity, setInstanceIdentity] = React.useState({ id: "", name: "" });
  const [configuration, setConfiguration] = React.useState<FlowConfiguration>(emptyConfiguration());
  const [nodes, setNodes] = React.useState<FlowNode[]>([]);
  const [edges, setEdges] = React.useState<FlowEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = React.useState<string | null>(null);
  const [pickerNodeId, setPickerNodeId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<GeometryPreviewContext | null>(null);
  const [savedTemplate, setSavedTemplate] = React.useState<ProcessFlowTemplate | null>(null);
  const [busyAction, setBusyAction] = React.useState<"template" | "instance" | null>(null);
  const [saveDialogMode, setSaveDialogMode] = React.useState<
    Extract<SaveInformationMode, "template" | "template-and-instance" | "instance"> | null
  >(null);
  const [saveDialogError, setSaveDialogError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [geometryCategoryPath, setGeometryCategoryPath] = React.useState<string[]>([]);
  const [geometrySearch, setGeometrySearch] = React.useState("");
  const [stepCategoryPath, setStepCategoryPath] = React.useState<string[]>([]);
  const [stepSearch, setStepSearch] = React.useState("");
  const [fileExportJobsRefreshKey, setFileExportJobsRefreshKey] = React.useState(0);
  const [seedFileExportJob, setSeedFileExportJob] = React.useState<FileExportJob | null>(null);

  React.useEffect(() => {
    let active = true;
    loadBootstrap()
      .then((payload) => {
        if (!active) return;
        setStepTemplates(payload.processStepTemplates);
        setFlowTemplates(payload.processFlowTemplates);
        setFlowInstances(payload.processFlowInstances);
        setGeometries(payload.geometries);
      })
      .catch((error) => {
        if (!active) return;
        setMessage({
          kind: "error",
          text: error instanceof Error ? error.message : "Unable to load API data.",
        });
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const topologyLocked = savedTemplate !== null;
  const draftTemplate = React.useMemo(
    () => buildTemplate(metadata, nodes, edges),
    [edges, metadata, nodes],
  );
  const analysis = React.useMemo(
    () => analyzeTemplate(draftTemplate, stepTemplates),
    [draftTemplate, stepTemplates],
  );
  const configurationComplete = React.useMemo(
    () =>
      !analysis.error &&
      isConfigurationComplete(draftTemplate, stepTemplates, configuration, geometries),
    [analysis.error, configuration, draftTemplate, geometries, stepTemplates],
  );
  const canSaveTemplate =
    hydrated && !topologyLocked && !busyAction && !analysis.error;
  const canSaveInstance =
    hydrated &&
    !busyAction &&
    !analysis.error &&
    configurationComplete;
  const editingNode = nodes.find((node) => node.id === editingNodeId) ?? null;
  const editingStepPreviewAvailability =
    editingNode && isStepNode(editingNode)
      ? previewAvailabilityFromReadiness(
          getStepExecutionReadiness(
            editingNode.data.stepRef.stepRefId,
            draftTemplate,
            stepTemplates,
            configuration,
            geometries,
          ),
        )
      : null;
  const pickerNode = nodes.find((node): node is FlowInputNode => node.id === pickerNodeId && isFlowInputNode(node)) ?? null;

  const displayNodes: FlowNode[] = nodes.map((node) => {
        if (isFlowInputNode(node)) {
          const geometry = geometryForFlowInput(
            configuration,
            node.data.definition.flowInputId,
            geometries,
          );
          const connected = edges.some((edge) => edge.source === node.id);
          const readiness = getFlowInputReadiness(
            draftTemplate,
            stepTemplates,
            configuration,
            geometries,
            node.data.definition.flowInputId,
          );
          const binding =
            configuration.inputBindings[node.data.definition.flowInputId];
          const presentation = geometryInputNodePresentation(
            node.data.definition.name,
            geometry?.name,
            readiness,
          );
          return {
            ...node,
            selected: node.id === selectedNodeId,
            data: {
              ...node.data,
              graphMode: topologyLocked ? "view" : "edit",
              ...presentation,
              icon: geometry?.icon,
              iconScale: geometry?.iconScale,
              status: connected ? readiness.status : "error",
              statusLabel: connected
                ? geometryInputStatusLabel(readiness, binding?.kind)
                : "Unused",
              pickId: node.id,
              onPick: setPickerNodeId,
              onDelete: topologyLocked ? undefined : deleteNode,
            },
          };
        }

        const readiness = getStepExecutionReadiness(
          node.data.stepRef.stepRefId,
          draftTemplate,
          stepTemplates,
          configuration,
          geometries,
        );
        const previewAvailability = previewAvailabilityFromReadiness(readiness);
        const terminal = !edges.some(
          (edge) => edge.source === node.id && getEdgeSourceKind(edge, nodes) === "stepOutput",
        );
        return {
          ...node,
          selected: node.id === selectedNodeId,
          data: {
            ...node.data,
            graphMode: topologyLocked ? "view" : "edit",
            displayLabel: stepLabel(node),
            displaySublabel: node.data.stepTemplate.name,
            editId: node.id,
            stepRefId: node.data.stepRef.stepRefId,
            template: node.data.stepTemplate,
            geometryInputPorts: node.data.stepTemplate.inputPorts.map((port) => ({
              id: port.portId,
              name: port.name,
            })),
            outputPortId: "result_geometry",
            status: readiness.status,
            statusLabel: stepReadinessStatusLabel(
              readiness,
              node.data.stepRef.stepRefId,
            ),
            onEdit: (nodeId) => {
              setSelectedNodeId(nodeId);
              setEditingNodeId(nodeId);
            },
            onDelete: topologyLocked ? undefined : deleteNode,
            terminalGeometryViewVisible: terminal,
            terminalGeometryViewDisabled: !previewAvailability.ok,
            terminalGeometryViewTitle: previewAvailability.ok
              ? "Preview result geometry"
              : previewAvailability.reason,
            onTerminalGeometryView: () => openStepPreview(node),
          },
        };
      });

  const displayEdges: FlowEdge[] = edges.map((edge) => {
        const sourceNode = nodes.find((node) => node.id === edge.source);
        const targetNode = nodes.find((node): node is StepNode => node.id === edge.target && isStepNode(node));
        const sourceKind = sourceNode && isFlowInputNode(sourceNode) ? "flowInput" : "stepOutput";
        const targetPort = targetNode?.data.stepTemplate.inputPorts.find(
          (port) => port.portId === edge.targetHandle,
        );
        const sourceStep = sourceNode && isStepNode(sourceNode) ? sourceNode : null;
        const sourceReadiness = sourceStep
          ? getStepExecutionReadiness(
              sourceStep.data.stepRef.stepRefId,
              draftTemplate,
              stepTemplates,
              configuration,
              geometries,
            )
          : sourceNode && isFlowInputNode(sourceNode)
            ? getFlowInputReadiness(
                draftTemplate,
                stepTemplates,
                configuration,
                geometries,
                sourceNode.data.definition.flowInputId,
              )
            : null;
        const previewAvailability = sourceStep && sourceReadiness
          ? previewAvailabilityFromReadiness(sourceReadiness)
          : null;
        return {
          ...edge,
          reconnectable: topologyLocked ? false : "target",
          data: {
            sourceKind,
            targetStepRefId: targetNode?.data.stepRef.stepRefId ?? "",
            targetInputPortId: edge.targetHandle ?? "",
            slotLabel: targetPort?.name ?? edge.targetHandle ?? "Input",
            sourceLabel: sourceNode ? nodeSourceLabel(sourceNode) : "Missing source",
            graphMode: topologyLocked ? "view" : "edit",
            status: sourceReadiness?.status ?? "error",
            geometryViewVisible: sourceKind === "stepOutput",
            geometryViewDisabled: previewAvailability ? !previewAvailability.ok : true,
            geometryViewTitle: previewAvailability?.ok
              ? "Preview geometry at this edge"
              : previewAvailability?.reason,
            onDelete: topologyLocked ? undefined : deleteEdge,
            onGeometryView: sourceStep ? () => openStepPreview(sourceStep) : undefined,
          },
        };
      });

  function updateMetadata(patch: Partial<TemplateMetadata>) {
    if (topologyLocked) return;
    setMetadata((current) => ({ ...current, ...patch }));
    setSaveDialogError(null);
    setMessage(null);
  }

  function updateInstanceIdentity(patch: Partial<InstanceSaveInformation>) {
    setInstanceIdentity((current) => ({ ...current, ...patch }));
    setSaveDialogError(null);
    setMessage(null);
  }

  function openSaveDialog(
    mode: Extract<SaveInformationMode, "template" | "template-and-instance" | "instance">,
  ) {
    setSaveDialogError(null);
    setMessage(null);
    setSaveDialogMode(mode);
  }

  function closeSaveDialog() {
    if (busyAction) return;
    setSaveDialogMode(null);
    setSaveDialogError(null);
  }

  function loadTemplateAsCopy(templateId: string) {
    const template = flowTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const graph = graphFromTemplate(template, stepTemplates);
    setMetadata({
      id: "",
      name: template.name,
      version: template.version,
      description: template.description ?? "",
      owner: template.owner ?? "",
    });
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setConfiguration(createEmptyFlowConfiguration(template, stepTemplates));
    setInstanceIdentity({ id: "", name: "" });
    setSelectedNodeId(null);
    setEditingNodeId(null);
    setSavedTemplate(null);
    setSaveDialogMode(null);
    setSaveDialogError(null);
    setMessage(null);
    requestAnimationFrame(() => reactFlow.fitView({ padding: 0.18, duration: 250 }));
  }

  function addFlowInput(
    position = defaultDropPosition(nodes),
    geometry?: GeometryEntity,
  ) {
    if (topologyLocked) return;
    const usedIds = new Set(
      nodes.filter(isFlowInputNode).map((node) => node.data.definition.flowInputId),
    );
    const flowInputId = nextId("flow_input", usedIds);
    const node: FlowInputNode = {
      id: internalId("flow-input"),
      type: "flowInput",
      position,
      data: {
        nodeKind: "flowInput",
        definition: {
          flowInputId,
          name: "Geometry input",
          description: "",
          dataType: "geometry",
          required: true,
        },
      },
    };
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
    if (geometry) {
      setConfiguration((current) => ({
        ...current,
        inputBindings: {
          ...current.inputBindings,
          [flowInputId]: { kind: "catalog", geometryId: geometry.id },
        },
      }));
    }
  }

  function addStepTemplate(
    template: ProcessStepTemplate,
    position = defaultDropPosition(nodes),
  ) {
    if (topologyLocked) return;
    const usedIds = new Set(nodes.filter(isStepNode).map((node) => node.data.stepRef.stepRefId));
    const stepRefId = nextId(slugId(template.name) || "step", usedIds);
    const node: StepNode = {
      id: internalId("step"),
      type: "processStep",
      position,
      data: {
        nodeKind: "processStep",
        stepRef: {
          stepRefId,
          stepLabel: template.name,
          processStepTemplateId: template.id,
        },
        stepTemplate: template,
      },
    };
    setNodes((current) => [...current, node]);
    setConfiguration((current) => ({
      ...current,
      stepConfigurations: {
        ...current.stepConfigurations,
        [stepRefId]: createEmptyFlowConfiguration(
          {
            schemaVersion: 2,
            id: "temporary",
            name: "temporary",
            version: "temporary",
            flowInputs: [],
            stepRefs: [node.data.stepRef],
            flowEdges: [],
          },
          [template],
        ).stepConfigurations[stepRefId],
      },
    }));
    setSelectedNodeId(node.id);
  }

  function deleteNode(nodeId: string) {
    if (topologyLocked) return;
    const node = nodes.find((item) => item.id === nodeId);
    setNodes((current) => current.filter((item) => item.id !== nodeId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    );
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setEditingNodeId((current) => (current === nodeId ? null : current));
    if (!node) return;
    setConfiguration((current) => {
      if (isFlowInputNode(node)) {
        const nextBindings = { ...current.inputBindings };
        delete nextBindings[node.data.definition.flowInputId];
        return { ...current, inputBindings: nextBindings };
      }
      const nextStepConfigurations = { ...current.stepConfigurations };
      delete nextStepConfigurations[node.data.stepRef.stepRefId];
      return { ...current, stepConfigurations: nextStepConfigurations };
    });
  }

  function deleteEdge(edgeId: string) {
    if (topologyLocked) return;
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
  }

  function handleNodesChange(changes: NodeChange<FlowNode>[]) {
    const accepted = topologyLocked
      ? changes.filter((change) => change.type === "select")
      : changes;
    setNodes((current) => applyNodeChanges(accepted, current));
  }

  function handleEdgesChange(changes: EdgeChange<FlowEdge>[]) {
    if (topologyLocked) return;
    setEdges((current) => applyEdgeChanges(changes, current));
  }

  function handleConnect(connection: Connection) {
    if (topologyLocked) return;
    setEdges((current) => {
      if (!validConnection(connection, nodes, current)) return current;
      const existingEdge = current.find((edge) => sameConnection(edge, connection));
      if (existingEdge) return current;

      return [
        ...withoutConnectionConflicts(current, connection),
        {
          id: internalId("edge"),
          type: "dataFlow",
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
          markerEnd: { type: MarkerType.ArrowClosed },
          data: emptyEdgeData(),
        },
      ];
    });
  }

  function handleReconnect(oldEdge: FlowEdge, connection: Connection) {
    if (topologyLocked) return;
    setEdges((current) => {
      const existingEdge = current.find((edge) => edge.id === oldEdge.id);
      if (
        !existingEdge ||
        !sameSourceHandle(existingEdge, connection) ||
        sameConnection(existingEdge, connection) ||
        !validConnection(connection, nodes, current)
      ) {
        return current;
      }

      return [
        ...withoutConnectionConflicts(current, connection),
        {
          ...existingEdge,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
        },
      ];
    });
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (topologyLocked) return;
    const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const stepTemplateId = event.dataTransfer.getData(STEP_TEMPLATE_DRAG_TYPE);
    if (stepTemplateId) {
      const template = stepTemplates.find((item) => item.id === stepTemplateId);
      if (template) addStepTemplate(template, position);
      return;
    }
    const geometryId = event.dataTransfer.getData(GEOMETRY_DRAG_TYPE);
    if (geometryId) {
      const geometry = geometries.find((item) => item.id === geometryId);
      if (geometry) addFlowInput(position, geometry);
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (topologyLocked) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function updateFlowInput(node: FlowInputNode, patch: EditableFlowInputPatch) {
    if (topologyLocked) return;
    setNodes((current) =>
      current.map((item) =>
        item.id === node.id && isFlowInputNode(item)
          ? {
              ...item,
              data: {
                ...item.data,
                definition: { ...item.data.definition, ...patch },
              },
            }
          : item,
      ),
    );
  }

  function updateStepLabel(node: StepNode, stepLabel: string) {
    if (topologyLocked) return;
    setNodes((current) =>
      current.map((item) =>
        item.id === node.id && isStepNode(item)
          ? {
              ...item,
              data: {
                ...item.data,
                stepRef: { ...item.data.stepRef, stepLabel },
              },
            }
          : item,
      ),
    );
  }

  function setInputGeometry(node: FlowInputNode, geometryId: string) {
    const flowInputId = node.data.definition.flowInputId;
    setConfiguration((current) => {
      return {
        ...current,
        inputBindings: {
          ...current.inputBindings,
          [flowInputId]: { kind: "catalog", geometryId },
        },
      };
    });
    setPickerNodeId(null);
    setMessage(null);
  }

  function setStepParameterValues(node: StepNode, parameterValues: Record<string, unknown>) {
    setConfiguration((current) => ({
      ...current,
      stepConfigurations: {
        ...current.stepConfigurations,
        [node.data.stepRef.stepRefId]: { parameterValues },
      },
    }));
  }

  function openFlowInputPreview(node: FlowInputNode) {
    const geometry = geometryForFlowInput(
      configuration,
      node.data.definition.flowInputId,
      geometries,
    );
    if (!geometry) return;
    setPreview({
      previewId: `flow-input:${node.data.definition.flowInputId}`,
      sourceLabel: node.data.definition.name,
      slotLabel: "Input",
      sourceKind: "flowInput",
      request: {
        target: { type: "flowInput", flowInputId: node.data.definition.flowInputId },
        sourceLabel: node.data.definition.name,
        ...(savedTemplate
          ? { processFlowTemplateId: savedTemplate.id }
          : { flowTemplate: draftTemplate }),
        configuration,
      },
    });
  }

  function openStepPreview(node: StepNode) {
    setPreview({
      previewId: `step-output:${node.data.stepRef.stepRefId}`,
      sourceLabel: stepLabel(node),
      slotLabel: "Result",
      sourceKind: "stepOutput",
      request: {
        target: {
          type: "stepOutput",
          stepRefId: node.data.stepRef.stepRefId,
          outputPortId: "result_geometry",
        },
        sourceLabel: stepLabel(node),
        ...(savedTemplate
          ? { processFlowTemplateId: savedTemplate.id }
          : { flowTemplate: draftTemplate }),
        configuration,
      },
    });
  }

  function buildInstance(templateId: string): ProcessFlowInstance {
    return {
      schemaVersion: 2,
      id: instanceIdentity.id.trim(),
      name: instanceIdentity.name.trim(),
      processFlowTemplateId: templateId,
      inputBindings: configuration.inputBindings as Record<string, CatalogGeometryBinding>,
      stepConfigurations: configuration.stepConfigurations,
    };
  }

  async function saveTemplateOnly() {
    if (!canSaveTemplate) return;
    const validationError = validateTemplateSaveInformation(metadata, flowTemplates);
    if (validationError) {
      setSaveDialogError(validationError);
      return;
    }
    setBusyAction("template");
    setSaveDialogError(null);
    setMessage(null);
    try {
      const saved = await createProcessFlowTemplate<ProcessFlowTemplate>(draftTemplate);
      setSavedTemplate(saved);
      setFlowTemplates((current) => [...current, saved]);
      setSaveDialogMode(null);
      setMessage({ kind: "success", text: `Template ${saved.id} saved. Topology is now locked.` });
    } catch (error) {
      setSaveDialogError(
        error instanceof Error ? error.message : "Unable to save template.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function saveInstance() {
    if (!canSaveInstance) return;
    if (!savedTemplate) {
      const templateValidationError = validateTemplateSaveInformation(
        metadata,
        flowTemplates,
      );
      if (templateValidationError) {
        setSaveDialogError(templateValidationError);
        return;
      }
    }
    const instanceValidationError = validateInstanceSaveInformation(
      instanceIdentity,
      flowInstances,
    );
    if (instanceValidationError) {
      setSaveDialogError(instanceValidationError);
      return;
    }
    setBusyAction("instance");
    setSaveDialogError(null);
    setMessage(null);
    try {
      if (savedTemplate) {
        const instance = await createProcessFlowInstance<ProcessFlowInstance>(
          buildInstance(savedTemplate.id),
        );
        setFlowInstances((current) => [...current, instance]);
        setSaveDialogMode(null);
        setMessage({ kind: "success", text: `Instance ${instance.id} saved.` });
      } else {
        const result = await createProcessFlowTemplateInstance<
          ProcessFlowTemplate,
          ProcessFlowInstance
        >({
          processFlowTemplate: draftTemplate,
          processFlowInstance: buildInstance(draftTemplate.id),
        });
        setSavedTemplate(result.processFlowTemplate);
        setFlowTemplates((current) => [...current, result.processFlowTemplate]);
        setFlowInstances((current) => [...current, result.processFlowInstance]);
        setSaveDialogMode(null);
        setMessage({
          kind: "success",
          text: `Template ${result.processFlowTemplate.id} and instance ${result.processFlowInstance.id} saved.`,
        });
      }
    } catch (error) {
      setSaveDialogError(
        error instanceof Error ? error.message : "Unable to save instance.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  function handleFileExportJobCreated(job: FileExportJob) {
    setSeedFileExportJob(job);
    setFileExportJobsRefreshKey((current) => current + 1);
  }

  const statusText =
    analysis.error ??
    (!configurationComplete
      ? "Template topology can be saved; instance configuration is incomplete."
      : "Template and instance configuration are ready to save.");

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground lg:h-screen lg:min-h-[760px] lg:overflow-hidden">
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
              Create a process topology and its initial instance configuration.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/">
                <ArrowLeft />
                Home
              </Link>
            </Button>
            <select
              className={cn(selectClass, "w-[220px]")}
              value=""
              disabled={topologyLocked || busyAction !== null}
              aria-label="Start from template"
              onChange={(event) => loadTemplateAsCopy(event.target.value)}
            >
              <option value="">Start from template...</option>
              {flowTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} / {template.version}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!canSaveTemplate}
              onClick={() => openSaveDialog("template")}
            >
              <Save />
              Save Template
            </Button>
            <Button
              disabled={!canSaveInstance}
              onClick={() =>
                openSaveDialog(savedTemplate ? "instance" : "template-and-instance")
              }
            >
              <GitBranch />
              {savedTemplate ? "Save Instance" : "Save Template & Instance"}
            </Button>
          </div>
        </div>
      </header>

      <div
        className={cn(
          "flex min-h-9 items-center gap-2 border-b px-4 py-2 text-sm",
          message?.kind === "error"
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : message?.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "bg-muted/25 text-muted-foreground",
        )}
      >
        {message?.kind === "success" ? <Check className="h-4 w-4" /> : <CircleDot className="h-4 w-4" />}
        <span className="truncate">{message?.text ?? statusText}</span>
      </div>

      <section className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(540px,1fr)_320px] lg:overflow-hidden">
        <aside className="min-h-[240px] border-r bg-white lg:min-h-0">
          <PaletteHeader icon={<Boxes className="h-4 w-4" />} title="Geometry library" />
          <div className="h-[240px] overflow-y-auto p-3 lg:h-[calc(100%-49px)]">
            <CategoryLibraryBrowser
              items={geometries}
              path={geometryCategoryPath}
              search={geometrySearch}
              searchPlaceholder="Search geometry"
              emptyLabel="No geometry entities from API."
              noSearchResultsLabel="No geometry matched the search."
              noCategoryItemsLabel="No geometry in this category."
              getSearchText={(geometry) =>
                [geometry.name, geometry.id, geometry.category, geometry.entityType].join(" ")
              }
              itemKey={(geometry) => geometry.id}
              renderItem={(geometry, { showCategoryPath }) => (
                <GeometryPaletteItem
                  geometry={geometry}
                  showCategoryPath={showCategoryPath}
                  disabled={topologyLocked}
                />
              )}
              onPathChange={setGeometryCategoryPath}
              onSearchChange={setGeometrySearch}
            />
          </div>
        </aside>

        <ProcessFlowGraph
          mode={topologyLocked ? "view" : "edit"}
          nodes={displayNodes}
          edges={displayEdges}
          className="min-h-[560px] lg:min-h-0"
          fitView
          edgesReconnectable
          reconnectRadius={12}
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onReconnect={handleReconnect}
          isValidConnection={(connection) => validConnection(connection, nodes, edges)}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
            setEditingNodeId(node.id);
          }}
          onPaneClick={() => setSelectedNodeId(null)}
          emptyState={
            nodes.length === 0 ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-center text-sm text-muted-foreground">
                  <Workflow className="h-7 w-7" />
                  <span>Empty flow</span>
                </div>
              </div>
            ) : null
          }
        />

        <aside className="min-h-[280px] border-l bg-white lg:min-h-0">
          <PaletteHeader
            icon={<FileJson className="h-4 w-4" />}
            title="Process step templates"
          />
          <div className="h-[280px] overflow-y-auto p-3 lg:h-[calc(100%-49px)]">
            <CategoryLibraryBrowser
              items={stepTemplates}
              path={stepCategoryPath}
              search={stepSearch}
              searchPlaceholder="Search step templates"
              emptyLabel="No process step templates from API."
              noSearchResultsLabel="No process step templates matched the search."
              noCategoryItemsLabel="No process step templates in this category."
              getSearchText={(template) =>
                [template.name, template.id, template.category, template.program].join(" ")
              }
              itemKey={(template) => template.id}
              renderItem={(template, { showCategoryPath }) => (
                <StepTemplatePaletteItem
                  template={template}
                  showCategoryPath={showCategoryPath}
                  disabled={topologyLocked}
                  onAdd={() => addStepTemplate(template)}
                />
              )}
              onPathChange={setStepCategoryPath}
              onSearchChange={setStepSearch}
            />
          </div>
        </aside>
      </section>

      {saveDialogMode ? (
        <SaveInformationDialog
          mode={saveDialogMode}
          template={metadata}
          instance={instanceIdentity}
          error={saveDialogError}
          submitting={busyAction !== null}
          onTemplateChange={updateMetadata}
          onInstanceChange={updateInstanceIdentity}
          onClose={closeSaveDialog}
          onSubmit={
            saveDialogMode === "template" ? saveTemplateOnly : saveInstance
          }
        />
      ) : null}

      {editingNode ? (
        <NodeEditorDialog
          node={editingNode}
          topologyLocked={topologyLocked}
          configuration={configuration}
          geometries={geometries}
          edges={edges}
          onClose={() => setEditingNodeId(null)}
          onFlowInputChange={(patch) =>
            isFlowInputNode(editingNode) && updateFlowInput(editingNode, patch)
          }
          onStepLabelChange={(label) =>
            isStepNode(editingNode) && updateStepLabel(editingNode, label)
          }
          onStepValuesChange={(values) =>
            isStepNode(editingNode) && setStepParameterValues(editingNode, values)
          }
          onPickGeometry={() =>
            isFlowInputNode(editingNode) && setPickerNodeId(editingNode.id)
          }
          onPreviewFlowInput={() =>
            isFlowInputNode(editingNode) && openFlowInputPreview(editingNode)
          }
          stepPreviewAvailability={editingStepPreviewAvailability}
          onPreviewStep={() =>
            isStepNode(editingNode) && openStepPreview(editingNode)
          }
          onDelete={() => deleteNode(editingNode.id)}
        />
      ) : null}

      {pickerNode ? (
        <GeometryPickerDialog
          flowInput={pickerNode.data.definition}
          selectedBinding={configuration.inputBindings[pickerNode.data.definition.flowInputId]}
          geometries={geometries}
          onClose={() => setPickerNodeId(null)}
          onSelect={(geometryId) => setInputGeometry(pickerNode, geometryId)}
        />
      ) : null}

      {preview ? (
        <GeometryPreviewPanel
          preview={preview}
          onClose={() => setPreview(null)}
          onFileExportJobCreated={handleFileExportJobCreated}
        />
      ) : null}

      <FileExportJobsPanel
        refreshKey={fileExportJobsRefreshKey}
        seedJob={seedFileExportJob}
      />
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

function GeometryPaletteItem({
  geometry,
  showCategoryPath = false,
  disabled,
}: {
  geometry: GeometryEntity;
  showCategoryPath?: boolean;
  disabled: boolean;
}) {
  return (
    <div
      draggable={!disabled}
      aria-disabled={disabled}
      onDragStart={(event) => {
        if (disabled) return;
        event.dataTransfer.setData(GEOMETRY_DRAG_TYPE, geometry.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
      className={cn(
        "rounded-md border bg-white p-3 text-sm shadow-sm transition",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "cursor-grab hover:border-primary/60 hover:bg-muted/20 active:cursor-grabbing",
      )}
    >
      <div className="flex items-start gap-2">
        <Box className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="line-clamp-2 font-medium leading-snug">{geometry.name}</div>
          {showCategoryPath ? (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {formatCategoryPath(geometry.category)}
            </div>
          ) : null}
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {geometry.entityType} / {geometry.id}
          </div>
        </div>
      </div>
      {geometry.description ? (
        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
          {geometry.description}
        </p>
      ) : null}
    </div>
  );
}

function StepTemplatePaletteItem({
  template,
  showCategoryPath = false,
  disabled,
  onAdd,
}: {
  template: ProcessStepTemplate;
  showCategoryPath?: boolean;
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      draggable={!disabled}
      disabled={disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData(STEP_TEMPLATE_DRAG_TYPE, template.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onAdd}
      className="w-full rounded-md border bg-white p-3 text-left text-sm shadow-sm transition hover:border-primary/60 hover:bg-muted/20 disabled:cursor-not-allowed disabled:opacity-50"
      title={disabled ? "Topology is locked" : "Click to add, or drag to the whiteboard"}
    >
      <div className="font-medium leading-snug">{template.name}</div>
      {showCategoryPath ? (
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {formatCategoryPath(template.category)}
        </div>
      ) : null}
      <div className="mt-1 text-xs text-muted-foreground">
        {template.version} / {template.parameterDefinitions.length} parameters
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <Badge variant="outline">{template.inputPorts.length} geometry inputs</Badge>
      </div>
    </button>
  );
}

function NodeEditorDialog({
  node,
  topologyLocked,
  configuration,
  geometries,
  edges,
  onClose,
  onFlowInputChange,
  onStepLabelChange,
  onStepValuesChange,
  onPickGeometry,
  onPreviewFlowInput,
  stepPreviewAvailability,
  onPreviewStep,
  onDelete,
}: {
  node: FlowNode;
  topologyLocked: boolean;
  configuration: FlowConfiguration;
  geometries: GeometryEntity[];
  edges: FlowEdge[];
  onClose: () => void;
  onFlowInputChange: (patch: EditableFlowInputPatch) => void;
  onStepLabelChange: (label: string) => void;
  onStepValuesChange: (values: Record<string, unknown>) => void;
  onPickGeometry: () => void;
  onPreviewFlowInput: () => void;
  stepPreviewAvailability: PreviewAvailability | null;
  onPreviewStep: () => void;
  onDelete: () => void;
}) {
  React.useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  const title = isFlowInputNode(node)
    ? geometryInputDisplayName(node.data.definition.name)
    : stepLabel(node);
  const subtitle = isFlowInputNode(node)
    ? node.data.definition.flowInputId
    : node.data.stepTemplate.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <section className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(920px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport">
        <header className="flex items-start justify-between gap-3 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("truncate", isFlowInputNode(node) && "font-mono")}>
                {subtitle}
              </span>
              <Badge variant="outline">
                {isFlowInputNode(node) ? "geometry input" : "process step"}
              </Badge>
            </div>
          </div>
          <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isFlowInputNode(node) ? (
            <FlowInputInspector
              node={node}
              topologyLocked={topologyLocked}
              configuration={configuration}
              geometries={geometries}
              outgoingCount={edges.filter((edge) => edge.source === node.id).length}
              onChange={onFlowInputChange}
              onPick={onPickGeometry}
              onPreview={onPreviewFlowInput}
              onDelete={onDelete}
            />
          ) : (
            <StepInspector
              node={node}
              topologyLocked={topologyLocked}
              configuration={configuration}
              edges={edges}
              onLabelChange={onStepLabelChange}
              onValuesChange={onStepValuesChange}
              previewAvailability={
                stepPreviewAvailability ?? {
                  ok: false,
                  reason: "Preview is unavailable.",
                }
              }
              onPreview={onPreviewStep}
              onDelete={onDelete}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function FlowInputInspector({
  node,
  topologyLocked,
  configuration,
  geometries,
  outgoingCount,
  onChange,
  onPick,
  onPreview,
  onDelete,
}: {
  node: FlowInputNode;
  topologyLocked: boolean;
  configuration: FlowConfiguration;
  geometries: GeometryEntity[];
  outgoingCount: number;
  onChange: (patch: EditableFlowInputPatch) => void;
  onPick: () => void;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const definition = node.data.definition;
  const geometry = geometryForFlowInput(configuration, definition.flowInputId, geometries);
  const constraints = definition.geometryConstraints;

  return (
    <section className="p-4">
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{outgoingCount} connections</div>
        {!topologyLocked ? (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete geometry input"
            aria-label="Delete geometry input"
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>

      <FlowInputBindingControl
        geometry={geometry}
        canEdit
        onPick={onPick}
        onPreview={onPreview}
      />

      <FlowInputAdvancedDisclosure>
        {topologyLocked ? (
          <FlowInputAdvancedReadOnly definition={definition} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Name" required>
              <input
                className={inputClass}
                value={definition.name}
                onChange={(event) => onChange({ name: event.target.value })}
              />
            </FormField>
            <label className="flex items-end gap-2 pb-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={definition.required}
                onChange={(event) => onChange({ required: event.target.checked })}
              />
              Required
            </label>
            <div className="sm:col-span-2">
              <FormField label="Description">
                <textarea
                  className={textareaClass}
                  value={definition.description ?? ""}
                  onChange={(event) => onChange({ description: event.target.value })}
                />
              </FormField>
            </div>
            <FormField label="Allowed entity types">
              <input
                className={inputClass}
                value={(constraints?.entityTypes ?? []).join(", ")}
                onChange={(event) =>
                  onChange({
                    geometryConstraints: cleanConstraints({
                      ...constraints,
                      entityTypes: parseList(event.target.value),
                    }),
                  })
                }
              />
            </FormField>
            <FormField label="Allowed categories">
              <input
                className={inputClass}
                value={(constraints?.categories ?? []).join(", ")}
                onChange={(event) =>
                  onChange({
                    geometryConstraints: cleanConstraints({
                      ...constraints,
                      categories: parseList(event.target.value),
                    }),
                  })
                }
              />
            </FormField>
            <div className="sm:col-span-2">
              <div className="text-xs font-medium text-muted-foreground">Flow input ID</div>
              <div className="mt-1 font-mono text-[10px] text-foreground">
                {definition.flowInputId}
              </div>
            </div>
          </div>
        )}
      </FlowInputAdvancedDisclosure>
    </section>
  );
}

function StepInspector({
  node,
  topologyLocked,
  configuration,
  edges,
  onLabelChange,
  onValuesChange,
  previewAvailability,
  onPreview,
  onDelete,
}: {
  node: StepNode;
  topologyLocked: boolean;
  configuration: FlowConfiguration;
  edges: FlowEdge[];
  onLabelChange: (label: string) => void;
  onValuesChange: (values: Record<string, unknown>) => void;
  previewAvailability: PreviewAvailability;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const values =
    configuration.stepConfigurations[node.data.stepRef.stepRefId]?.parameterValues ?? {};
  return (
    <section className="p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">Process Step</div>
          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {node.data.stepRef.stepRefId}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            title={
              previewAvailability.ok
                ? "Preview step output"
                : previewAvailability.reason
            }
          >
            <Button
              variant="outline"
              size="sm"
              disabled={!previewAvailability.ok}
              onClick={onPreview}
            >
              <Eye />
              Preview
            </Button>
          </span>
          {!topologyLocked ? (
            <Button variant="ghost" size="icon" title="Delete process step" onClick={onDelete}>
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3">
        <FormField label="Step label">
          <input
            className={inputClass}
            value={node.data.stepRef.stepLabel ?? ""}
            disabled={topologyLocked}
            onChange={(event) => onLabelChange(event.target.value)}
          />
        </FormField>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-sm font-medium">{node.data.stepTemplate.name}</div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">
            {node.data.stepTemplate.id}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t pt-4">
        <div className="mb-3 text-sm font-semibold">Input Ports</div>
        <div className="divide-y rounded-md border">
          {node.data.stepTemplate.inputPorts.map((port) => {
            const edge = edges.find(
              (candidate) =>
                candidate.target === node.id && candidate.targetHandle === port.portId,
            );
            return (
              <div key={port.portId} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="truncate">{port.name}</span>
                <Badge variant={edge ? "signal" : "outline"}>
                  {edge ? "Mapped" : port.required ? "Required" : "Optional"}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-5 border-t pt-4">
        <div className="mb-3 text-sm font-semibold">Parameters</div>
        <ParameterValueEditor
          definitions={node.data.stepTemplate.parameterDefinitions}
          values={values}
          onChange={onValuesChange}
        />
      </div>
    </section>
  );
}

function GeometryPickerDialog({
  flowInput,
  selectedBinding,
  geometries,
  onClose,
  onSelect,
}: {
  flowInput: FlowInputDefinition;
  selectedBinding: FlowConfiguration["inputBindings"][string] | undefined;
  geometries: GeometryEntity[];
  onClose: () => void;
  onSelect: (geometryId: string) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [categoryPath, setCategoryPath] = React.useState<string[]>([]);
  const matchingGeometries = geometries.filter((geometry) =>
    geometryMatchesFlowInput(geometry, flowInput),
  );

  React.useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <section className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(820px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport">
        <header className="flex items-start justify-between gap-3 border-b bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Geometry Catalog</h2>
            <div className="mt-1 text-sm text-muted-foreground">{flowInput.name}</div>
          </div>
          <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <CategoryLibraryBrowser
            items={matchingGeometries}
            path={categoryPath}
            search={query}
            searchPlaceholder="Search geometry"
            emptyLabel="No matching geometry"
            noSearchResultsLabel="No geometry matched the search"
            noCategoryItemsLabel="No geometry in this category"
            getSearchText={(geometry) =>
              [geometry.name, geometry.id, geometry.category, geometry.entityType].join(" ")
            }
            itemKey={(geometry) => geometry.id}
            itemListClassName="grid gap-2 md:grid-cols-2"
            renderItem={(geometry, { showCategoryPath }) => (
              <button
                type="button"
                className={cn(
                  "rounded-md border bg-white p-3 text-left text-sm shadow-sm transition hover:border-primary hover:bg-muted/20",
                  selectedBinding?.kind === "catalog" &&
                    selectedBinding.geometryId === geometry.id &&
                    "border-primary ring-2 ring-primary/20",
                )}
                onClick={() => onSelect(geometry.id)}
              >
                <div className="font-medium">{geometry.name}</div>
                {showCategoryPath ? (
                  <div className="mt-1 truncate text-[11px] text-muted-foreground">
                    {formatCategoryPath(geometry.category)}
                  </div>
                ) : null}
                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {geometry.id}
                </div>
                <div className="mt-2 flex gap-1">
                  <Badge variant="outline">{geometry.entityType}</Badge>
                  <Badge variant="outline">{geometry.version}</Badge>
                </div>
              </button>
            )}
            onPathChange={setCategoryPath}
            onSearchChange={setQuery}
          />
        </div>
      </section>
    </div>
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
    <label className="block min-w-0">
      <div className="mb-2 text-xs font-medium">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </div>
      {children}
    </label>
  );
}

function buildTemplate(
  metadata: TemplateMetadata,
  nodes: FlowNode[],
  edges: FlowEdge[],
): ProcessFlowTemplate {
  return {
    schemaVersion: 2,
    ...metadata,
    flowInputs: nodes.filter(isFlowInputNode).map((node) => clone(node.data.definition)),
    stepRefs: nodes.filter(isStepNode).map((node) => clone(node.data.stepRef)),
    flowEdges: edges.flatMap((edge) => {
      const sourceNode = nodes.find((node) => node.id === edge.source);
      const targetNode = nodes.find((node): node is StepNode => node.id === edge.target && isStepNode(node));
      if (!sourceNode || !targetNode || !edge.targetHandle) return [];
      const source = isFlowInputNode(sourceNode)
        ? {
            kind: "flowInput" as const,
            flowInputId: sourceNode.data.definition.flowInputId,
          }
        : {
            kind: "stepOutput" as const,
            stepRefId: sourceNode.data.stepRef.stepRefId,
            outputPortId: edge.sourceHandle ?? "result_geometry",
          };
      return [
        {
          edgeId: edge.id,
          source,
          target: {
            stepRefId: targetNode.data.stepRef.stepRefId,
            inputPortId: edge.targetHandle,
          },
        } satisfies SavedFlowEdge,
      ];
    }),
  };
}

function graphFromTemplate(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const layout = computeTemplateLayout(template);
  const stepTemplatesById = new Map(stepTemplates.map((item) => [item.id, item]));
  const flowInputNodeById = new Map<string, FlowInputNode>();
  const stepNodeById = new Map<string, StepNode>();

  template.flowInputs.forEach((definition) => {
    const clonedDefinition = clone(definition);
    clonedDefinition.name = geometryInputDisplayName(clonedDefinition.name);
    flowInputNodeById.set(definition.flowInputId, {
      id: internalId("flow-input"),
      type: "flowInput",
      position: layout.flowInputPositions.get(definition.flowInputId) ?? { x: 40, y: 120 },
      data: { nodeKind: "flowInput", definition: clonedDefinition },
    });
  });
  template.stepRefs.forEach((stepRef) => {
    const stepTemplate = stepTemplatesById.get(stepRef.processStepTemplateId);
    if (!stepTemplate) return;
    stepNodeById.set(stepRef.stepRefId, {
      id: internalId("step"),
      type: "processStep",
      position: layout.stepPositions.get(stepRef.stepRefId) ?? { x: 360, y: 120 },
      data: {
        nodeKind: "processStep",
        stepRef: clone(stepRef),
        stepTemplate,
      },
    });
  });
  const nodes: FlowNode[] = [...flowInputNodeById.values(), ...stepNodeById.values()];
  const edges: FlowEdge[] = template.flowEdges.flatMap((edge) => {
    const sourceNode =
      edge.source.kind === "flowInput"
        ? flowInputNodeById.get(edge.source.flowInputId)
        : stepNodeById.get(edge.source.stepRefId);
    const targetNode = stepNodeById.get(edge.target.stepRefId);
    if (!sourceNode || !targetNode) return [];
    return [
      {
        id: edge.edgeId,
        type: "dataFlow",
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle:
          edge.source.kind === "flowInput" ? "out" : edge.source.outputPortId,
        targetHandle: edge.target.inputPortId,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: emptyEdgeData(),
      },
    ];
  });
  return { nodes, edges };
}

function analyzeTemplate(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
): TemplateAnalysis {
  const missingPortKeys = new Set<string>();
  if (template.flowInputs.length === 0) {
    return { error: "Add at least one geometry input.", missingPortKeys, hasCycle: false };
  }
  if (template.stepRefs.length === 0) {
    return { error: "Add at least one process step.", missingPortKeys, hasCycle: false };
  }
  const inputIdError = uniqueIdentifierError(
    template.flowInputs.map((input) => input.flowInputId),
    "Geometry input",
  );
  if (inputIdError) return { error: inputIdError, missingPortKeys, hasCycle: false };
  if (template.flowInputs.some((input) => !input.name.trim())) {
    return { error: "Every geometry input needs a name.", missingPortKeys, hasCycle: false };
  }
  const stepIdError = uniqueIdentifierError(
    template.stepRefs.map((step) => step.stepRefId),
    "Step reference",
  );
  if (stepIdError) return { error: stepIdError, missingPortKeys, hasCycle: false };

  const stepTemplateById = new Map(stepTemplates.map((item) => [item.id, item]));
  const incoming = new Set<string>();
  const outputSources = new Set<string>();
  for (const edge of template.flowEdges) {
    const targetKey = `${edge.target.stepRefId}:${edge.target.inputPortId}`;
    if (incoming.has(targetKey)) {
      return { error: `Input port ${targetKey} has multiple sources.`, missingPortKeys, hasCycle: false };
    }
    incoming.add(targetKey);
    const sourceKey =
      edge.source.kind === "flowInput"
        ? `flowInput:${edge.source.flowInputId}:out`
        : `stepOutput:${edge.source.stepRefId}:${edge.source.outputPortId}`;
    if (outputSources.has(sourceKey)) {
      return { error: `Output port ${sourceKey} has multiple consumers.`, missingPortKeys, hasCycle: false };
    }
    outputSources.add(sourceKey);
  }
  for (const stepRef of template.stepRefs) {
    const stepTemplate = stepTemplateById.get(stepRef.processStepTemplateId);
    if (!stepTemplate) {
      return {
        error: `Process step template ${stepRef.processStepTemplateId} was not found.`,
        missingPortKeys,
        hasCycle: false,
      };
    }
    for (const port of stepTemplate.inputPorts) {
      const key = `${stepRef.stepRefId}:${port.portId}`;
      if (port.required && !incoming.has(key)) missingPortKeys.add(key);
    }
  }
  if (missingPortKeys.size > 0) {
    return {
      error: `Missing source for ${Array.from(missingPortKeys)[0]}.`,
      missingPortKeys,
      hasCycle: false,
    };
  }
  const unusedFlowInput = template.flowInputs.find(
    (input) =>
      !template.flowEdges.some(
        (edge) => edge.source.kind === "flowInput" && edge.source.flowInputId === input.flowInputId,
      ),
  );
  if (unusedFlowInput) {
    return {
      error: `Geometry input ${unusedFlowInput.flowInputId} is not connected.`,
      missingPortKeys,
      hasCycle: false,
    };
  }
  const hasCycle = templateHasCycle(template);
  return {
    error: hasCycle ? "Process flow contains a cycle." : null,
    missingPortKeys,
    hasCycle,
  };
}

function validConnection(
  connection: Connection | FlowEdge,
  nodes: FlowNode[],
  edges: FlowEdge[],
) {
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode || !isStepNode(targetNode)) return false;
  if (sourceNode.id === targetNode.id || !connection.targetHandle) return false;
  if (
    !targetNode.data.stepTemplate.inputPorts.some(
      (port) => port.portId === connection.targetHandle,
    )
  ) {
    return false;
  }
  const remainingEdges = withoutConnectionConflicts(edges, connection);
  if (isStepNode(sourceNode) && pathExists(targetNode.id, sourceNode.id, remainingEdges)) {
    return false;
  }
  return true;
}

function withoutConnectionConflicts(
  edges: FlowEdge[],
  connection: Connection | FlowEdge,
) {
  return edges.filter(
    (edge) =>
      !sameSourceHandle(edge, connection) && !sameTargetHandle(edge, connection),
  );
}

function sameConnection(left: Connection | FlowEdge, right: Connection | FlowEdge) {
  return sameSourceHandle(left, right) && sameTargetHandle(left, right);
}

function sameSourceHandle(left: Connection | FlowEdge, right: Connection | FlowEdge) {
  return (
    left.source === right.source &&
    (left.sourceHandle ?? "result_geometry") ===
      (right.sourceHandle ?? "result_geometry")
  );
}

function sameTargetHandle(left: Connection | FlowEdge, right: Connection | FlowEdge) {
  return (
    left.target === right.target && left.targetHandle === right.targetHandle
  );
}

function previewAvailabilityFromReadiness(
  readiness: ConfigurationReadiness,
): PreviewAvailability {
  return readiness.status === "ready"
    ? { ok: true }
    : { ok: false, reason: readiness.reason };
}

function templateHasCycle(template: ProcessFlowTemplate) {
  const adjacency = new Map<string, string[]>();
  template.flowEdges.forEach((edge) => {
    if (edge.source.kind !== "stepOutput") return;
    adjacency.set(edge.source.stepRefId, [
      ...(adjacency.get(edge.source.stepRefId) ?? []),
      edge.target.stepRefId,
    ]);
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(stepRefId: string): boolean {
    if (visiting.has(stepRefId)) return true;
    if (visited.has(stepRefId)) return false;
    visiting.add(stepRefId);
    if ((adjacency.get(stepRefId) ?? []).some(visit)) return true;
    visiting.delete(stepRefId);
    visited.add(stepRefId);
    return false;
  }
  return template.stepRefs.some((ref) => visit(ref.stepRefId));
}

function pathExists(sourceId: string, targetId: string, edges: FlowEdge[]) {
  const adjacency = new Map<string, string[]>();
  edges.forEach((edge) => {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  });
  const visited = new Set<string>();
  const pending = [sourceId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function emptyEdgeData(): ProcessFlowGraphEdgeData {
  return {
    sourceKind: "flowInput",
    targetStepRefId: "",
    targetInputPortId: "",
    slotLabel: "Input",
    sourceLabel: "Source",
  };
}

function getEdgeSourceKind(edge: FlowEdge, nodes: FlowNode[]) {
  const source = nodes.find((node) => node.id === edge.source);
  return source && isStepNode(source) ? "stepOutput" : "flowInput";
}

function newMetadata(): TemplateMetadata {
  return {
    id: "",
    name: "",
    version: "V2.0.0",
    description: "",
    owner: "",
  };
}

function emptyConfiguration(): FlowConfiguration {
  return { inputBindings: {}, stepConfigurations: {}, embeddedGeometries: {} };
}

function isFlowInputNode(node: FlowNode): node is FlowInputNode {
  return node.type === "flowInput" && node.data.nodeKind === "flowInput";
}

function isStepNode(node: FlowNode): node is StepNode {
  return node.type === "processStep" && node.data.nodeKind === "processStep";
}

function stepLabel(node: StepNode) {
  return stepLabelFromRef(node.data.stepRef, node.data.stepTemplate);
}

function stepLabelFromRef(ref: StepRef, template: ProcessStepTemplate) {
  return normalizeStepLabel(ref.stepLabel, template.name);
}

function nodeSourceLabel(node: FlowNode) {
  return isFlowInputNode(node) ? node.data.definition.name : stepLabel(node);
}

function parseList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanConstraints(
  constraints: FlowInputDefinition["geometryConstraints"],
): FlowInputDefinition["geometryConstraints"] {
  if (!constraints) return undefined;
  const result = {
    entityTypes: constraints.entityTypes?.length ? constraints.entityTypes : undefined,
    categories: constraints.categories?.length ? constraints.categories : undefined,
    // Hidden in the current UI, but preserved when the visible constraints change.
    structureFormats: constraints.structureFormats?.length
      ? constraints.structureFormats
      : undefined,
  };
  return Object.values(result).some(Boolean) ? result : undefined;
}

function uniqueIdentifierError(ids: string[], label: string) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id.trim()) return `${label} id is required.`;
    if (!validIdentifier(id)) return `${label} id ${id} contains unsupported characters.`;
    if (seen.has(id)) return `${label} id ${id} is duplicated.`;
    seen.add(id);
  }
  return null;
}

function validIdentifier(value: string) {
  return /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value);
}

function validateTemplateSaveInformation(
  metadata: TemplateMetadata,
  templates: ProcessFlowTemplate[],
) {
  const requiredFields: Array<[string, string]> = [
    ["Template name", metadata.name],
    ["Template id", metadata.id],
    ["Version", metadata.version],
    ["Owner", metadata.owner],
  ];
  const missingField = requiredFields.find(([, value]) => !value.trim());
  if (missingField) return `${missingField[0]} is required.`;
  if (!validIdentifier(metadata.id)) {
    return "Template id contains unsupported characters.";
  }
  if (templates.some((template) => template.id === metadata.id)) {
    return "Template id already exists.";
  }
  return null;
}

function validateInstanceSaveInformation(
  identity: InstanceSaveInformation,
  instances: ProcessFlowInstance[],
) {
  if (!identity.name.trim()) return "Instance name is required.";
  if (!identity.id.trim()) return "Instance id is required.";
  if (instances.some((instance) => instance.id === identity.id.trim())) {
    return "Instance id already exists.";
  }
  return null;
}

function slugId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function nextId(base: string, used: Set<string>) {
  const normalized = validIdentifier(base) ? base : "item";
  if (!used.has(normalized)) return normalized;
  let index = 2;
  while (used.has(`${normalized}_${index}`)) index += 1;
  return `${normalized}_${index}`;
}

function internalId(prefix: string) {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}

function defaultDropPosition(nodes: FlowNode[]) {
  const offset = nodes.length * 28;
  return { x: 80 + (offset % 420), y: 100 + (offset % 280) };
}
