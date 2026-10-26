"use client";

import * as React from "react";
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
  Box,
  Boxes,
  Eye,
  FileJson,
  LayoutGrid,
  Pencil,
  Plus,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import { CategoryLibraryBrowser } from "@/components/category-library/category-library-browser";
import { GeometryGeneratorDialogLauncher } from "@/components/geometry-generator/geometry-generator-registry";
import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import {
  canEditGeneratorBinding,
  generatorsForFlowInput,
  generatorsForPlacement,
} from "@/components/geometry-generator/geometry-generator-placements";
import { useGeneratorBindingGeometries } from "@/components/geometry-generator/use-generator-binding-geometries";
import { useFileExportJobs } from "@/components/geometry-preview/file-export-jobs-provider";
import {
  GeometryPreviewPanel,
  type GeometryPreviewContext,
} from "@/components/geometry-preview/geometry-preview-panel";
import {
  FlowInputAdvancedDisclosure,
  FlowInputAdvancedReadOnly,
  FlowInputBindingControl,
} from "@/components/process-flow-fields/flow-input-controls";
import {
  GeometryCardDetails,
  geometrySearchText,
} from "@/components/process-flow-fields/geometry-card-details";
import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import { PlacementPreview } from "@/components/process-flow-fields/placement-preview";
import { normalizePlacements } from "@/components/process-flow-fields/placement-list-control";
import { FlowGdsFileProvider, useFlowGdsFile } from "@/components/process-flow-fields/flow-gds-file-context";
import { StepTemplateDetails } from "@/components/process-flow-fields/step-template-details";
import { StepTemplateHoverPreview, StepTemplatePreviewProvider } from "@/components/process-flow-fields/step-template-hover-preview";
import {
  SaveInformationDialog,
  type FlowSaveInformation,
} from "@/components/process-flow-save/save-information-dialog";
import {
  ProcessFlowGraph,
  type ProcessFlowGraphEdgeData,
  type ProcessFlowGraphNodeData,
} from "@/components/process-flow-graph/process-flow-graph";
import { EditorDialog, useEditorDialogFocus } from "@/components/process-flow-save/editor-dialog";
import { useEditorDrafts } from "@/components/process-flow-save/editor-draft-controls";
import { EditorShellHeader, EditorStatusBar } from "@/components/process-flow-save/editor-shell-header";
import { FlowSourceDialog } from "@/components/process-flow-save/flow-source-dialog";
import { validateFlowDraftState } from "@/lib/process-flow/editor-drafts";
import { commitFlowDraft, getProcessFlow, ApiRequestError } from "@/lib/process-flow-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCategoryPath } from "@/lib/category-library";
import {
  createEmptyFlowConfiguration,
  getFlowInputReadiness,
  getStepExecutionReadiness,
  getStepConfigurationReadiness,
  geometryCategoryConstraints,
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
import { analyzeFlowDependencies } from "@/lib/process-flow/dependencies";
import { computeTemplateLayout } from "@/lib/process-flow/template-layout";
import { createStepConfiguration, createRecipe, removeRecipe } from "@/lib/process-flow/recipes";
import { summarizePlacementValidation } from "@/lib/process-flow/placement-validation";


import { flowConfigurationIssues, flowAuthoringIssues } from "@/lib/process-flow/flow-editor-save";
import type {
  FlowConfiguration,
  FlowDraftState,
  FlowInputDefinition,
  GeometryEntity,
  GeometryBinding,
  ProcessFlow, FlowDefinition, FlowOrigin, StepConfiguration, RecipeCandidate,
  ProcessStepTemplate,
  SavedFlowEdge,
  StepRef,
} from "@/lib/process-flow/types";
import { clone, normalizeStepLabel } from "@/lib/process-flow/utils";
import { disabledStepsForNewFlow, isTemplateEnabled } from "@/lib/process-flow/template-availability";
import { createProcessFlow, updateProcessFlow, getGeometryGeneratorVersion, loadBootstrap } from "@/lib/process-flow-api";
import { cn } from "@/lib/utils";

const STEP_TEMPLATE_DRAG_TYPE = "application/process-step-template-v2";
const GEOMETRY_DRAG_TYPE = "application/process-flow-geometry-v2";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[72px] w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted";

type FlowMetadata = FlowSaveInformation;
type FlowSaveMode = "save";

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

type FlowAnalysis = {
  error: string | null;
  missingPortKeys: Set<string>;
  hasCycle: boolean;
};

type PreviewAvailability =
  | { ok: true }
  | { ok: false; reason: string };

export function ProcessFlowEditor() {
  return (
    <ReactFlowProvider>
      <FlowGdsFileProvider>
        <ProcessFlowEditorInner />
      </FlowGdsFileProvider>
    </ReactFlowProvider>
  );
}

function ProcessFlowEditorInner() {
  const flowGds = useFlowGdsFile();
  const router = useRouter();
  const reactFlow = useReactFlow<FlowNode, FlowEdge>();
  const [hydrated, setHydrated] = React.useState(false);
  const [stepTemplates, setStepTemplates] = React.useState<ProcessStepTemplate[]>([]);
  const [flows, setFlows] = React.useState<ProcessFlow[]>([]);
  const [geometries, setGeometries] = React.useState<GeometryEntity[]>([]);
  const [generatorDefinitions, setGeneratorDefinitions] = React.useState<GeometryGeneratorDefinition[]>([]);
  const templateLibraryGenerators = generatorsForPlacement(generatorDefinitions, "templateGeometryLibrary");
  const [generatorEditor, setGeneratorEditor] = React.useState<{
    targetNodeId: string | null;
    definition: GeometryGeneratorDefinition;
    initialParameters?: Record<string, unknown>;
  } | null>(null);
  const [metadata, setMetadata] = React.useState<FlowMetadata>(newMetadata());
  const [target, setTarget] = React.useState<FlowOrigin | undefined>();
  const [origin, setOrigin] = React.useState<FlowOrigin | undefined>();
  const [editingRecipeIds, setEditingRecipeIds] = React.useState<Record<string, string>>({});
  const [conflict, setConflict] = React.useState(false);
  const [configuration, setConfiguration] = React.useState<FlowConfiguration>(emptyConfiguration());
  const [nodes, setNodes] = React.useState<FlowNode[]>([]);
  const [edges, setEdges] = React.useState<FlowEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = React.useState<string | null>(null);
  const [pickerNodeId, setPickerNodeId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<GeometryPreviewContext | null>(null);
  const [savedFlow, setSavedFlow] = React.useState<ProcessFlow | null>(null);
  const [busyAction, setBusyAction] = React.useState<FlowSaveMode | null>(null);
  const savingRef = React.useRef(false);
  const [saveDialogMode, setSaveDialogMode] = React.useState<
    FlowSaveMode | null
  >(null);
  const [legacyCopyNotice, setLegacyCopyNotice] = React.useState(false);
  const [unavailableDraft, setUnavailableDraft] = React.useState(false);
  const [sourceOpen, setSourceOpen] = React.useState(false);
  const [requirementsOpen, setRequirementsOpen] = React.useState(false);
  const [saveDialogError, setSaveDialogError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [geometryCategoryPath, setGeometryCategoryPath] = React.useState<string[]>([]);
  const [geometrySearch, setGeometrySearch] = React.useState("");
  const [stepCategoryPath, setStepCategoryPath] = React.useState<string[]>([]);
  const [stepSearch, setStepSearch] = React.useState("");
  const { registerJob } = useFileExportJobs();

  React.useEffect(() => {
    let active = true;
    loadBootstrap()
      .then((payload) => {
        if (!active) return;
        setStepTemplates(payload.processStepTemplates);
        setFlows(payload.processFlows);
        setGeometries(payload.geometries);
        setGeneratorDefinitions(payload.geometryGenerators);
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

  const [draftViewport, setDraftViewport] = React.useState({ x: 0, y: 0, zoom: 1 });
  const [graphInteractionKey, setGraphInteractionKey] = React.useState(0);
  const cleanLoadedFlow = React.useRef(false);
  const editorDraftState = React.useMemo<FlowDraftState>(() => ({
    metadata, configuration, editingRecipeIds,
    nodes: nodes.map((node) => isFlowInputNode(node)
      ? { id: node.id, kind: "flowInput", position: node.position, definition: node.data.definition }
      : { id: node.id, kind: "processStep", position: node.position, stepRef: node.data.stepRef }),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null })),
    viewport: draftViewport,
  }), [metadata, configuration, editingRecipeIds, nodes, edges, draftViewport]);
  React.useEffect(() => { setMessage(null); }, [editorDraftState]);
  const drafts = useEditorDrafts({
    state: editorDraftState, target, origin, enabled: hydrated, modern: true,
    saveDisabled: Boolean(target), busy: busyAction !== null,
    onSaved(draft) {
      window.history.replaceState(null, "", `/flow-editor?draftId=${encodeURIComponent(draft.id)}`);
    },
    onLoad(draft) {
      if (!("nodes" in draft.state)) throw new Error("This is not a flow draft.");
      const state = structuredClone(draft.state);
      validateFlowDraftState(state, stepTemplates);
      state.edges = state.edges.map((edge) => ({ ...edge, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null }));
      const restoredNodes = state.nodes.map<FlowNode>((node) => node.kind === "flowInput"
        ? { id: node.id, type: "flowInput", position: node.position, data: { nodeKind: "flowInput", definition: node.definition } }
        : { id: node.id, type: "processStep", position: node.position,
            data: { nodeKind: "processStep", stepRef: node.stepRef,
              stepTemplate: stepTemplates.find((step) => step.id === node.stepRef.processStepTemplateId)! } });
      const restoredEdges = state.edges.map<FlowEdge>((edge) => ({ ...edge, type: "dataFlow",
        markerEnd: { type: MarkerType.ArrowClosed }, data: emptyEdgeData() }));
      flowGds?.clearFile();
      setMetadata(state.metadata);
      setTarget(undefined); setOrigin(draft.origin); setEditingRecipeIds(state.editingRecipeIds ?? {});
      setSaveDialogMode(null); setSaveDialogError(null);
      setRequirementsOpen(false); setLegacyCopyNotice(false);
      setConfiguration(state.configuration);
      setNodes(restoredNodes);
      setGraphInteractionKey((current) => current + 1);
      setEdges(restoredEdges);
      setDraftViewport(state.viewport);
      setSavedFlow(null);
      setSelectedNodeId(null); setEditingNodeId(null); setPickerNodeId(null);
      setGeneratorEditor(null); setPreview(null); setMessage(null);
      requestAnimationFrame(() => { void reactFlow.setViewport(state.viewport); });
      window.history.replaceState(null, "", `/flow-editor?draftId=${encodeURIComponent(draft.id)}`);
      return state;
    },
  });
  const markDraftClean = drafts.markClean;
  React.useEffect(() => {
    if (!cleanLoadedFlow.current) return;
    cleanLoadedFlow.current = false;
    const loadedState = editorDraftState;
    requestAnimationFrame(() => {
      void reactFlow.fitView({ padding: 0.18, duration: 0 }).then(() => {
        markDraftClean({ ...loadedState, viewport: reactFlow.getViewport() });
      });
    });
  }, [editorDraftState, markDraftClean, reactFlow]);
  const topologyLocked = false;
  const editingLocked = topologyLocked || busyAction !== null;
  const generated = useGeneratorBindingGeometries(configuration);
  const resolvedGeometries = [...geometries, ...generated.geometries];
  const draftDefinition = React.useMemo(
    () => buildDefinition(nodes, edges),
    [edges, nodes],
  );
  const analysis = React.useMemo(
    () => analyzeDefinition(draftDefinition, stepTemplates),
    [draftDefinition, stepTemplates],
  );
  const previousRefs = new Set((savedFlow?.definition.stepRefs ?? []).map((ref) => `${ref.stepRefId}:${ref.processStepTemplateId}`));
  const disabledSteps = disabledStepsForNewFlow({ ...draftDefinition, stepRefs: draftDefinition.stepRefs.filter((ref) => !target || !previousRefs.has(`${ref.stepRefId}:${ref.processStepTemplateId}`)) }, stepTemplates);
  const authoringIssues = flowAuthoringIssues(draftDefinition, stepTemplates, configuration);
  const availabilityError = !topologyLocked && disabledSteps.length > 0
    ? `Cannot save a new flow with disabled steps: ${disabledSteps.map((step) => step.name).join(", ")}. Remove or replace them.`
    : null;
  const canSaveFlow =
    hydrated && !topologyLocked && !busyAction && !drafts.busy && !analysis.error && !availabilityError && authoringIssues.length === 0;
  const configurationComplete = isConfigurationComplete(draftDefinition, stepTemplates, configuration, resolvedGeometries);
  const executionIssues = !analysis.error && !configurationComplete
    ? flowConfigurationIssues(draftDefinition, stepTemplates, configuration, resolvedGeometries)
    : [];
  const editingNode = nodes.find((node) => node.id === editingNodeId) ?? null;
  const editingStepPreviewAvailability =
    editingNode && isStepNode(editingNode)
      ? previewAvailabilityFromReadiness(
          getStepExecutionReadiness(
            editingNode.data.stepRef.stepRefId,
            draftDefinition,
            stepTemplates,
            configuration,
            resolvedGeometries,
          ),
        )
      : null;
  const pickerNode = nodes.find((node): node is FlowInputNode => node.id === pickerNodeId && isFlowInputNode(node)) ?? null;

  const dependencies = analyzeFlowDependencies(draftDefinition, stepTemplates, configuration);

  const displayNodes: FlowNode[] = nodes.map((node) => {
        if (isFlowInputNode(node)) {
          const geometry = geometryForFlowInput(
            configuration,
            node.data.definition.flowInputId,
            resolvedGeometries,
          );
          const connected = edges.some((edge) => edge.source === node.id);
          const readiness = getFlowInputReadiness(
            draftDefinition,
            stepTemplates,
            configuration,
            resolvedGeometries,
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

        const readiness = getStepConfigurationReadiness(
          node.data.stepRef.stepRefId,
          draftDefinition,
          stepTemplates,
          configuration,
          resolvedGeometries,
        );
        const previewAvailability = previewAvailabilityFromReadiness(
          getStepExecutionReadiness(node.data.stepRef.stepRefId, draftDefinition, stepTemplates, configuration, resolvedGeometries),
        );
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
              if (savingRef.current) return;
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
          ? getStepConfigurationReadiness(
              sourceStep.data.stepRef.stepRefId,
              draftDefinition,
              stepTemplates,
              configuration,
              resolvedGeometries,
            )
          : sourceNode && isFlowInputNode(sourceNode)
            ? getFlowInputReadiness(
                draftDefinition,
                stepTemplates,
                configuration,
                resolvedGeometries,
                sourceNode.data.definition.flowInputId,
              )
            : null;
        const previewAvailability = sourceStep && sourceReadiness
          ? previewAvailabilityFromReadiness(
              getStepExecutionReadiness(
                sourceStep.data.stepRef.stepRefId,
                draftDefinition,
                stepTemplates,
                configuration,
                resolvedGeometries,
              ),
            )
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
            status: dependencies.edgeIds.has(edge.id) ? sourceReadiness?.status ?? "error" : "neutral",
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

  function updateMetadata(patch: Partial<FlowMetadata>) {
    if (topologyLocked || savingRef.current) return;
    setMetadata((current) => ({ ...current, ...patch }));
    setSaveDialogError(null);
    setMessage(null);
  }

  function openSaveDialog() {
    if (savingRef.current) return;
    setEditingNodeId(null); setPickerNodeId(null); setGeneratorEditor(null); setPreview(null);
    setSaveDialogError(null);
    setMessage(null);
    setSaveDialogMode("save");
  }

  function closeSaveDialog() {
    if (busyAction) return;
    setSaveDialogMode(null);
    setSaveDialogError(null);
  }

  function applyFlow(flow: ProcessFlow, oldCopyLink = false) {
    const missing = flow.definition.stepRefs.filter((ref) => !stepTemplates.some((step) => step.id === ref.processStepTemplateId));
    if (missing.length) throw new Error(`Missing step templates: ${missing.map((ref) => ref.processStepTemplateId).join(", ")}`);
    const graph = graphFromDefinition(flow.definition, stepTemplates);
    cleanLoadedFlow.current = true;
    flowGds?.clearFile(); drafts.detach();
    setMetadata({ name: flow.name, version: flow.version, owner: flow.owner, description: flow.description });
    setConfiguration(structuredClone(flow.configuration)); setEditingRecipeIds({});
    setTarget({ flowId: flow.id, revision: flow.revision });
    setOrigin(flow.origin);
    setSavedFlow(flow);
    setNodes(graph.nodes); setEdges(graph.edges); setGraphInteractionKey((key) => key + 1);
    setSelectedNodeId(null); setEditingNodeId(null); setPickerNodeId(null); setGeneratorEditor(null); setPreview(null);
    setSaveDialogMode(null); setSaveDialogError(null); setConflict(false); setMessage(null);
    setLegacyCopyNotice(oldCopyLink);
    window.history.replaceState(null, "", `/flow-editor?flowId=${encodeURIComponent(flow.id)}`);
  }
  async function loadFlowSource(flowId: string, oldCopyLink = false) {
    if (savingRef.current || drafts.busy) return false;
    const flow = await getProcessFlow(flowId);
    if (!await drafts.confirmReplaceAsync(`Open flow "${flow.name}"?`)) return false;
    applyFlow(flow, oldCopyLink);
    return true;
  }
  const entryLoaded = React.useRef(false);
  // Entry URLs load once after bootstrap, using the current source/draft handlers.
  const entryActions = React.useRef({ loadFlowSource, loadDraft: drafts.load });
  entryActions.current = { loadFlowSource, loadDraft: drafts.load };
  React.useEffect(() => {
    if (!hydrated || !stepTemplates.length || entryLoaded.current) return;
    entryLoaded.current = true;
    const params = new URLSearchParams(window.location.search);
    const flowId = params.get("flowId"); const draftId = params.get("draftId");
    if (flowId) void entryActions.current.loadFlowSource(flowId, params.get("copy") === "1").catch((error) => setMessage({ kind: "error", text: String(error) }));
    else if (draftId) void entryActions.current.loadDraft({ id: draftId }).then((loaded) => {
      if (!loaded) setUnavailableDraft(true);
    });
  }, [hydrated, stepTemplates]);

  async function navigateHome() {
    if (savingRef.current || drafts.busy) return;
    if (!await drafts.confirmReplaceAsync("Return Home?")) return;
    drafts.markClean();
    router.push("/");
  }

  function arrangeFlow() {
    if (nodes.length === 0 || savingRef.current) return;
    const layout = computeTemplateLayout(draftDefinition, stepTemplates);
    setNodes((current) =>
      current.map((node) => {
        const position = isFlowInputNode(node)
          ? layout.flowInputPositions.get(node.data.definition.flowInputId)
          : layout.stepPositions.get(node.data.stepRef.stepRefId);
        return position ? { ...node, position } : node;
      }),
    );
    requestAnimationFrame(() =>
      reactFlow.fitView({ padding: 0.18, duration: 250 }),
    );
  }

  function addFlowInput(
    position: { x: number; y: number },
    source: {
      geometry: { id: string; category?: string | null; entityType?: string };
      binding: GeometryBinding;
      suggestedName?: string;
    },
  ) {
    if (topologyLocked || savingRef.current) return;
    const geometryConstraints = geometryCategoryConstraints(source.geometry);
    if (!geometryConstraints) {
      setMessage({
        kind: "error",
        text: `Geometry ${source.geometry.id} needs a category before it can define a flow input.`,
      });
      return;
    }
    setMessage(null);
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
          name: source.suggestedName ?? "Geometry input",
          description: "",
          dataType: "geometry",
          required: true,
          geometryConstraints,
        },
      },
    };
    setNodes((current) => [...current, node]);
    setSelectedNodeId(node.id);
    setConfiguration((current) => {
      return {
        ...current,
        inputBindings: {
          ...current.inputBindings,
          [flowInputId]: source.binding,
        },
      };
    });
    setGeometrySearch("");
    setGeometryCategoryPath([]);
  }

  function addStepTemplate(
    template: ProcessStepTemplate,
    position = defaultDropPosition(nodes),
  ) {
    if (topologyLocked || savingRef.current || !isTemplateEnabled(template)) return;
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
        [stepRefId]: createStepConfiguration(template.parameterDefinitions),
      },
    }));
    setSelectedNodeId(node.id);
    setStepSearch("");
    setStepCategoryPath([]);
  }

  function deleteNode(nodeId: string) {
    if (topologyLocked || savingRef.current) return;
    const node = nodes.find((item) => item.id === nodeId);
    setNodes((current) => current.filter((item) => item.id !== nodeId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    );
    setSelectedNodeId((current) => (current === nodeId ? null : current));
    setEditingNodeId((current) => (current === nodeId ? null : current));
    if (!node) return;
    if (isStepNode(node)) setEditingRecipeIds((current) => {
      const next = { ...current }; delete next[node.data.stepRef.stepRefId]; return next;
    });
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
    if (topologyLocked || savingRef.current) return;
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
  }

  function handleNodesChange(changes: NodeChange<FlowNode>[]) {
    if (savingRef.current) return;
    const accepted = topologyLocked
      ? changes.filter((change) => change.type === "select")
      : changes;
    const removed = new Set(accepted.filter((change) => change.type === "remove").map((change) => change.id));
    if (removed.size) {
      setEditingRecipeIds((current) => {
        const next = { ...current };
        for (const node of nodes.filter((node) => removed.has(node.id))) {
          if (isStepNode(node)) delete next[node.data.stepRef.stepRefId];
        }
        return next;
      });
      setConfiguration((current) => {
        const next = structuredClone(current);
        for (const node of nodes.filter((node) => removed.has(node.id))) {
          if (isFlowInputNode(node)) delete next.inputBindings[node.data.definition.flowInputId];
          else delete next.stepConfigurations[node.data.stepRef.stepRefId];
        }
        return next;
      });
      setEdges((current) => current.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)));
      if (editingNodeId && removed.has(editingNodeId)) setEditingNodeId(null);
    }
    setNodes((current) => applyNodeChanges(accepted, current));
  }

  function handleEdgesChange(changes: EdgeChange<FlowEdge>[]) {
    if (topologyLocked || savingRef.current) return;
    setEdges((current) => applyEdgeChanges(changes, current));
  }

  function handleConnect(connection: Connection) {
    if (topologyLocked || savingRef.current) return;
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
    if (topologyLocked || savingRef.current) return;
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
    if (topologyLocked || savingRef.current) return;
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
      if (geometry) addFlowInput(position, {
        geometry,
        binding: { kind: "catalog", geometryId: geometry.id },
      });
    }
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (topologyLocked || savingRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function updateFlowInput(node: FlowInputNode, patch: EditableFlowInputPatch) {
    if (topologyLocked || savingRef.current) return;
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
    if (topologyLocked || savingRef.current) return;
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
    if (savingRef.current) return;
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

  function setInputGenerator(node: FlowInputNode, binding: GeometryBinding) {
    if (savingRef.current) return;
    setConfiguration((current) => ({
      ...current,
      inputBindings: {
        ...current.inputBindings,
        [node.data.definition.flowInputId]: binding,
      },
    }));
    setGeneratorEditor(null);
    setMessage(null);
  }

  async function editCurrentGenerator(node: FlowInputNode) {
    if (savingRef.current) return;
    const binding = configuration.inputBindings[node.data.definition.flowInputId];
    if (binding?.kind !== "generator") return;
    try {
      const definition = await getGeometryGeneratorVersion(
        binding.generatorId, binding.generatorVersion,
      );
      if (savingRef.current) return;
      setPickerNodeId(null);
      setGeneratorEditor({ targetNodeId: node.id, definition, initialParameters: binding.parameters });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Generator version unavailable." });
    }
  }

  function changeStepConfiguration(stepRefId: string, value: StepConfiguration) {
    if (savingRef.current) return;
    setConfiguration((current) => ({ ...current, stepConfigurations: { ...current.stepConfigurations, [stepRefId]: value } }));
  }

  function openFlowInputPreview(node: FlowInputNode) {
    const geometry = geometryForFlowInput(
      configuration,
      node.data.definition.flowInputId,
      resolvedGeometries,
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
        flow: { definition: draftDefinition, configuration },
        analyticsContext: { sourceKind: "inline_draft", ...(target ? { flowId: target.flowId, flowRevision: target.revision } : {}) },
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
        flow: { definition: draftDefinition, configuration },
        analyticsContext: { sourceKind: "inline_draft", ...(target ? { flowId: target.flowId, flowRevision: target.revision } : {}) },
      },
    });
  }

  async function saveFlow() {
    if (!saveDialogMode || savingRef.current || !canSaveFlow) return;
    const validationError = validateFlowSaveInformation(metadata);
    if (validationError) { setSaveDialogError(validationError); return; }
    const captured = structuredClone(editorDraftState);
    const request = { schemaVersion: 3 as const, ...metadata, definition: draftDefinition,
      configuration: captured.configuration, ...(origin ? { origin } : {}) };
    savingRef.current = true; setBusyAction(saveDialogMode); setSaveDialogError(null); setConflict(false);
    try {
      const saved = target
        ? await updateProcessFlow(target.flowId, { ...request, revision: target.revision })
        : drafts.active ? await commitFlowDraft(drafts.active, request)
          : await createProcessFlow(request);
      drafts.detach(); drafts.markClean(captured);
      setSavedFlow(saved); setTarget({ flowId: saved.id, revision: saved.revision }); setOrigin(saved.origin);
      setLegacyCopyNotice(false);
      setFlows((current) => [...current.filter((flow) => flow.id !== saved.id), saved]);
      setSaveDialogMode(null); setMessage({ kind: "success", text: `Saved ${saved.name} · revision ${saved.revision}` });
      window.history.replaceState(null, "", `/flow-editor?flowId=${encodeURIComponent(saved.id)}`);
    } catch (error) {
      setConflict(Boolean(target) && error instanceof ApiRequestError && error.status === 409);
      setSaveDialogError(error instanceof Error ? error.message : "Unable to save flow.");
    } finally { savingRef.current = false; setBusyAction(null); }
  }

  const blockingIssues = [analysis.error, availabilityError, ...authoringIssues].filter((issue): issue is string => Boolean(issue));
  const configurationIssues = !analysis.error && !configurationComplete
    ? (executionIssues.length ? executionIssues : ["Check the flow configuration for invalid input or step settings."])
    : [];
  const flowIssues = [...blockingIssues, ...configurationIssues];
  const progressStatus = busyAction || drafts.saving ? "Saving…"
    : drafts.dirty ? "Unsaved changes"
    : drafts.lastSavedAt ? `Draft saved · ${new Date(drafts.lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : target ? `Saved flow · revision ${target.revision}`
    : "Not saved";
  const flowName = drafts.active?.name || metadata.name.trim() || "Untitled flow";

  if (unavailableDraft) return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
      <section className="w-full max-w-md rounded-md border bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Draft unavailable</h1>
        <p role="alert" className="mt-2 text-sm text-muted-foreground">This draft could not be opened. It may have been deleted.</p>
        <Button type="button" className="mt-5" onClick={() => router.push("/")}>Home</Button>
      </section>
    </main>
  );

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground lg:h-screen lg:min-h-[760px] lg:overflow-hidden">
      <EditorShellHeader editor="flow" subtitle={flowName}
        busy={busyAction !== null || drafts.busy}
        sourceDisabled={!hydrated || topologyLocked || drafts.busy}
        saveDisabled={!canSaveFlow}
        draftControl={target ? null : drafts.saveControl}
        onHome={() => void navigateHome()}
        onStartFrom={() => setSourceOpen(true)}
        onSave={openSaveDialog} />
      <EditorStatusBar progress={progressStatus}
        saving={Boolean(busyAction || drafts.saving)}
        saved={!drafts.dirty && Boolean(drafts.lastSavedAt || target)}
        issueCount={flowIssues.length}
        issueKind={blockingIssues.length ? "Flow" : "Configuration"}
        expanded={requirementsOpen}
        onToggle={() => setRequirementsOpen(!requirementsOpen)} />
      {legacyCopyNotice ? <div role="status" className="shrink-0 border-b bg-amber-50 px-5 py-2 text-sm text-amber-900">Copy flow is no longer available. You are editing the original flow.</div> : null}
      {message || (drafts.error && !sourceOpen) ? <div role={message?.kind === "success" ? "status" : "alert"}
        className={cn("shrink-0 border-b px-5 py-2 text-sm", message?.kind === "success" ? "bg-emerald-50 text-emerald-800" : "bg-destructive/5 text-destructive")}>
        {message?.text ?? drafts.error}
      </div> : null}
      {requirementsOpen && flowIssues.length > 0 ? <div id="flow-save-requirements" className="shrink-0 border-b bg-amber-50 px-5 py-3 text-sm text-amber-900">
        <ul className="max-h-24 list-disc space-y-1 overflow-y-auto pl-5">{flowIssues.map((issue, index) => <li key={`${index}:${issue}`}>{issue}</li>)}</ul>
      </div> : null}

      <section className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(540px,1fr)_320px] lg:overflow-hidden">
        <aside className="flex min-h-[240px] flex-col border-r bg-white lg:min-h-0">
          <PaletteHeader icon={<Boxes className="h-4 w-4" />} title="Geometry library" />
          {templateLibraryGenerators.length > 0 ? (
            <div className="space-y-2 border-b p-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Generators</div>
              {templateLibraryGenerators.map((definition) => (
                <Button
                  key={`${definition.id}@${definition.version}`}
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={editingLocked}
                  onClick={() => setGeneratorEditor({ targetNodeId: null, definition })}
                >
                  {definition.label}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="h-[240px] min-h-0 overflow-y-auto p-3 lg:h-auto lg:flex-1">
            <CategoryLibraryBrowser
              items={geometries}
              path={geometryCategoryPath}
              search={geometrySearch}
              searchPlaceholder="Search geometry"
              emptyLabel="No geometry entities from API."
              noSearchResultsLabel="No geometry matched the search."
              noCategoryItemsLabel="No geometry in this category."
              getSearchText={geometrySearchText}
              itemKey={(geometry) => geometry.id}
              renderItem={(geometry, { showCategoryPath }) => (
                <GeometryPaletteItem
                  geometry={geometry}
                  showCategoryPath={showCategoryPath}
                  disabled={editingLocked}
                />
              )}
              onPathChange={setGeometryCategoryPath}
              onSearchChange={setGeometrySearch}
            />
          </div>
        </aside>

        <ProcessFlowGraph
          mode={editingLocked ? "view" : "edit"}
          interactionKey={`${graphInteractionKey}:${drafts.saving}`}
          nodes={displayNodes}
          edges={displayEdges}
          className="min-h-[560px] lg:min-h-0"
          fitView
          edgesReconnectable
          reconnectRadius={12}
          topRightOverlay={
            <Button
              type="button"
              variant="outline"
              className="bg-white shadow-sm"
              disabled={nodes.length === 0 || busyAction !== null}
              onClick={arrangeFlow}
            >
              <LayoutGrid />
              Arrange
            </Button>
          }
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onReconnect={handleReconnect}
          isValidConnection={(connection) => validConnection(connection, nodes, edges)}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onNodeClick={(_, node) => {
            if (savingRef.current) return;
            setSelectedNodeId(node.id);
            if (isFlowInputNode(node)) setEditingNodeId(node.id);
          }}
          onNodeDoubleClick={(_, node) => {
            if (savingRef.current || !isStepNode(node)) return;
            setSelectedNodeId(node.id);
            setEditingNodeId(node.id);
          }}
          onMoveEnd={(_, viewport) => { if (!savingRef.current) setDraftViewport(viewport); }}
          onPaneClick={() => { if (!savingRef.current) setSelectedNodeId(null); }}
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
            <StepTemplatePreviewProvider>
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
                    disabled={editingLocked || !isTemplateEnabled(template)}
                    onAdd={() => addStepTemplate(template)}
                  />
                )}
                onPathChange={setStepCategoryPath}
                onSearchChange={setStepSearch}
              />
            </StepTemplatePreviewProvider>
          </div>
        </aside>
      </section>

      {sourceOpen ? <FlowSourceDialog flows={flows} drafts={drafts}
        onUseFlow={loadFlowSource} onClose={() => setSourceOpen(false)} /> : null}
      {drafts.dialogs}
      {saveDialogMode ? (
        <SaveInformationDialog
          blockingIssues={blockingIssues}
          configurationIssues={configurationIssues}
          metadata={metadata}
          hasTarget={Boolean(target)}
          conflict={conflict}
          onReload={() => { if (target) void loadFlowSource(target.flowId).catch((error) => setSaveDialogError(String(error))); }}
          error={saveDialogError}
          submitting={busyAction !== null}
          onChange={updateMetadata}
          onClose={closeSaveDialog}
          onSubmit={saveFlow}
        />
      ) : null}

      {editingNode ? (
        <NodeEditorDialog
          key={editingNode.id}
          node={editingNode}
          topologyLocked={topologyLocked}
          configuration={configuration}
          geometries={resolvedGeometries}
          generatorError={isFlowInputNode(editingNode) ? generated.errors[editingNode.data.definition.flowInputId] : undefined}
          edges={edges}
          onClose={() => setEditingNodeId(null)}
          onFlowInputChange={(patch) =>
            isFlowInputNode(editingNode) && updateFlowInput(editingNode, patch)
          }
          onStepLabelChange={(label) =>
            isStepNode(editingNode) && updateStepLabel(editingNode, label)
          }
          onStepConfigurationChange={(value) => { if (isStepNode(editingNode)) changeStepConfiguration(editingNode.data.stepRef.stepRefId, value); }}
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
          generatorDefinitions={generatorDefinitions}
          onClose={() => setPickerNodeId(null)}
          onSelect={(geometryId) => setInputGeometry(pickerNode, geometryId)}
          onSelectGenerator={(definition) => {
            setPickerNodeId(null);
            setGeneratorEditor({ targetNodeId: pickerNode.id, definition });
          }}
          onEditCurrentGenerator={() => void editCurrentGenerator(pickerNode)}
        />
      ) : null}

      {generatorEditor ? (
        <GeometryGeneratorDialogLauncher
          definition={generatorEditor.definition}
          initialParameters={generatorEditor.initialParameters}
          onClose={() => setGeneratorEditor(null)}
          onDefine={(result) => {
            if (generatorEditor.targetNodeId === null) {
              addFlowInput(defaultDropPosition(nodes), {
                geometry: {
                  id: `generator:${result.binding.generatorId}`,
                  category: result.geometry.category ?? "",
                },
                binding: result.binding,
                suggestedName: result.suggestedFlowInputName,
              });
            } else {
              const node = nodes.find((item): item is FlowInputNode =>
                item.id === generatorEditor.targetNodeId && isFlowInputNode(item),
              );
              if (node) setInputGenerator(node, result.binding);
            }
            setGeneratorEditor(null);
          }}
        />
      ) : null}

      {preview ? (
        <GeometryPreviewPanel
          preview={preview}
          onClose={() => setPreview(null)}
          onFileExportJobCreated={registerJob}
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
        <GeometryCardDetails
          geometry={geometry}
          categoryPath={showCategoryPath ? formatCategoryPath(geometry.category) : null}
        />
      </div>
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
    <StepTemplateHoverPreview template={template} disabled={disabled}>
      {({ triggerProps, closePreview }) => (
        <button
          type="button"
          {...triggerProps}
          draggable={!disabled}
          disabled={disabled}
          onDragStart={(event) => {
            closePreview();
            if (disabled) return;
            event.dataTransfer.setData(STEP_TEMPLATE_DRAG_TYPE, template.id);
            event.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => {
            closePreview();
            if (!disabled) onAdd();
          }}
          className="w-full rounded-md border bg-white p-3 text-left text-sm shadow-sm transition hover:border-primary/60 hover:bg-muted/20 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
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
            {!isTemplateEnabled(template) ? <Badge variant="outline">Disabled</Badge> : null}
          </div>
        </button>
      )}
    </StepTemplateHoverPreview>
  );
}

function NodeEditorDialog({
  node,
  topologyLocked,
  configuration,
  geometries,
  generatorError,
  edges,
  onClose,
  onFlowInputChange,
  onStepLabelChange,
  onStepConfigurationChange,
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
  generatorError?: string;
  edges: FlowEdge[];
  onClose: () => void;
  onFlowInputChange: (patch: EditableFlowInputPatch) => void;
  onStepLabelChange: (label: string) => void;
  onStepConfigurationChange: (value: StepConfiguration) => void;
  onPickGeometry: () => void;
  onPreviewFlowInput: () => void;
  stepPreviewAvailability: PreviewAvailability | null;
  onPreviewStep: () => void;
  onDelete: () => void;
}) {
  const panel = React.useRef<HTMLElement>(null);
  useEditorDialogFocus(panel, onClose, false);

  const title = isFlowInputNode(node)
    ? geometryInputDisplayName(node.data.definition.name)
    : stepLabel(node);
  const subtitle = isFlowInputNode(node)
    ? node.data.definition.flowInputId
    : node.data.stepTemplate.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <section ref={panel} role="dialog" aria-modal="true" aria-label="Edit flow node" tabIndex={-1} className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(920px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport">
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
              generatorError={generatorError}
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
              onLabelChange={onStepLabelChange}
              onConfigurationChange={onStepConfigurationChange}
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
  generatorError,
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
  generatorError?: string;
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
        hasBinding={Boolean(configuration.inputBindings[definition.flowInputId])}
        canEdit
        onPick={onPick}
        onPreview={onPreview}
      />
      {generatorError ? <p className="mt-2 text-sm text-destructive">{generatorError}</p> : null}

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

export function StepInspector({
  node,
  topologyLocked,
  configuration,
  onLabelChange,
  onConfigurationChange,
  previewAvailability,
  onPreview,
  onDelete,
}: {
  node: StepNode;
  topologyLocked: boolean;
  configuration: FlowConfiguration;
  onLabelChange: (label: string) => void;
  onConfigurationChange: (value: StepConfiguration) => void;
  previewAvailability: PreviewAvailability;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const config = configuration.stepConfigurations[node.data.stepRef.stepRefId] ?? { recipeCandidates: [], selectedRecipeId: null };
  const [recipeDraft, setRecipeDraft] = React.useState<RecipeCandidate | null>(null);
  const [creatingRecipe, setCreatingRecipe] = React.useState(false);
  const [deleteRecipeId, setDeleteRecipeId] = React.useState<string | null>(null);
  const applied = config.recipeCandidates.find((recipe) => recipe.recipeId === config.selectedRecipeId);
  const recipeToDelete = config.recipeCandidates.find((recipe) => recipe.recipeId === deleteRecipeId);

  function openRecipe(recipe: RecipeCandidate) {
    setRecipeDraft(structuredClone(recipe));
    setCreatingRecipe(false);
  }

  function startAddRecipe() {
    let nextNumber = config.recipeCandidates.length + 1;
    while (config.recipeCandidates.some((recipe) => recipe.name === `Recipe ${nextNumber}`)) nextNumber += 1;
    setRecipeDraft(createRecipe(node.data.stepTemplate.parameterDefinitions, `Recipe ${nextNumber}`));
    setCreatingRecipe(true);
  }

  function saveRecipeDraft() {
    if (!recipeDraft?.name.trim()) return;
    const saved = { ...recipeDraft, name: recipeDraft.name.trim() };
    onConfigurationChange({
      ...config,
      recipeCandidates: creatingRecipe
        ? [...config.recipeCandidates, saved]
        : config.recipeCandidates.map((recipe) => recipe.recipeId === saved.recipeId ? saved : recipe),
      selectedRecipeId: creatingRecipe && config.recipeCandidates.length === 0
        ? saved.recipeId
        : config.selectedRecipeId,
    });
    setRecipeDraft(null);
  }

  return (
    <section className="space-y-6 p-4">
      <section aria-label="Step details" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Step details</h3>
          <div className="flex items-center gap-1">
            <span title={previewAvailability.ok ? "Preview step output" : previewAvailability.reason}>
              <Button type="button" variant="outline" size="sm" disabled={!previewAvailability.ok} onClick={onPreview}>
                <Eye aria-hidden="true" />Preview
              </Button>
            </span>
            {!topologyLocked ? (
              <Button type="button" variant="ghost" size="icon" title="Delete process step" aria-label="Delete process step" onClick={onDelete}>
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="grid gap-3">
          <FormField label="Step label">
            <input className={inputClass} value={node.data.stepRef.stepLabel ?? ""} disabled={topologyLocked} onChange={(event) => onLabelChange(event.target.value)} />
          </FormField>
          <StepTemplateDetails template={node.data.stepTemplate} />
        </div>
      </section>

      <section aria-label="Active recipe" className="space-y-4 border-t pt-5">
        <h3 className="text-sm font-semibold">Active recipe</h3>
        <FormField label="Apply recipe">
          <select
            className={selectClass}
            value={applied?.recipeId ?? ""}
            disabled={config.recipeCandidates.length === 0}
            onChange={(event) => onConfigurationChange({ ...config, selectedRecipeId: event.target.value })}
          >
            {!applied ? <option value="" disabled>{config.recipeCandidates.length ? "Choose a recipe" : "No recipes"}</option> : null}
            {config.recipeCandidates.map((recipe) => (
              <option key={recipe.recipeId} value={recipe.recipeId}>{recipe.name}</option>
            ))}
          </select>
        </FormField>
        {applied ? (
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-sm font-medium">{applied.name}</div>
            <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{applied.recipeId}</div>
            <RecipeParameterSummary definitions={node.data.stepTemplate.parameterDefinitions} recipe={applied} />
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" role="status">
            {config.recipeCandidates.length ? "Choose a recipe to apply to this step." : "Add a recipe to configure this step."}
          </p>
        )}
      </section>

      <section aria-label="Candidate recipes" className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold">Candidate recipes</h3>
        {config.recipeCandidates.length ? (
          <div className="space-y-2">
            {config.recipeCandidates.map((recipe) => (
              <div key={recipe.recipeId} className={cn("flex min-w-0 items-stretch rounded-md border bg-white shadow-sm", recipe.recipeId === config.selectedRecipeId && "border-primary ring-1 ring-primary/20")}>
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-l-md p-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`Open recipe ${recipe.name}`}
                  onClick={() => openRecipe(recipe)}
                >
                  <div className="text-sm font-medium">{recipe.name}</div>
                  <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{recipe.recipeId}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {node.data.stepTemplate.parameterDefinitions.map((definition) => definition.name).join(", ") || "No parameters"}
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1 px-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Edit recipe ${recipe.name}`}
                    title={`Edit ${recipe.name}`}
                    onClick={() => openRecipe(recipe)}
                  ><Pencil aria-hidden="true" />Edit</Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete recipe ${recipe.name}`}
                    title={`Delete ${recipe.name}`}
                    onClick={() => setDeleteRecipeId(recipe.recipeId)}
                  ><Trash2 aria-hidden="true" /></Button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">No recipes yet.</p>}
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={startAddRecipe}><Plus aria-hidden="true" />Add recipe</Button>
        </div>
      </section>

      {recipeDraft ? (
        <EditorDialog
          title={creatingRecipe ? "Add recipe" : `Edit ${recipeDraft.name}`}
          onClose={() => setRecipeDraft(null)}
          className="max-w-3xl"
          footer={<>
            <Button type="button" variant="outline" onClick={() => setRecipeDraft(null)}>Cancel</Button>
            <Button type="button" disabled={!recipeDraft.name.trim()} onClick={saveRecipeDraft}>Save recipe</Button>
          </>}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 [&_[data-parameter-description]]:hidden">
            <FormField label="Recipe name" required>
              <input className={inputClass} data-autofocus value={recipeDraft.name} onChange={(event) => setRecipeDraft({ ...recipeDraft, name: event.target.value })} />
            </FormField>
            <ParameterValueEditor
              definitions={node.data.stepTemplate.parameterDefinitions}
              values={recipeDraft.parameterValues}
              onChange={(parameterValues) => setRecipeDraft((current) => current ? { ...current, parameterValues } : current)}
            />
          </div>
        </EditorDialog>
      ) : null}

      {recipeToDelete ? (
        <EditorDialog
          title="Delete recipe?"
          onClose={() => setDeleteRecipeId(null)}
          footer={<>
            <Button type="button" variant="outline" onClick={() => setDeleteRecipeId(null)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => { onConfigurationChange(removeRecipe(config, recipeToDelete.recipeId)); setDeleteRecipeId(null); }}>Delete recipe</Button>
          </>}
        >
          <p className="p-5 text-sm">Delete <strong>{recipeToDelete.name}</strong>? This removes its parameter values from this flow.</p>
        </EditorDialog>
      ) : null}
    </section>
  );
}

function RecipeParameterSummary({ definitions, recipe }: { definitions: ProcessStepTemplate["parameterDefinitions"]; recipe: RecipeCandidate }) {
  if (!definitions.length) return <p className="mt-3 text-sm text-muted-foreground">No parameters</p>;
  return (
    <dl className="mt-4 divide-y border-t">
      {definitions.map((definition) => {
        const value = recipe.parameterValues[definition.id];
        const isPlacement = definition.valueType === "placements" || definition.controlType === "placementList";
        return (
          <div key={definition.id} className="min-w-0 py-3 first:pt-4 last:pb-0">
            <dt className="text-xs font-medium">{definition.name}{definition.unit ? ` / ${definition.unit}` : ""}</dt>
            {isPlacement ? (
              <dd className="mt-2"><AppliedPlacementGraph key={`${recipe.recipeId}:${definition.id}`} value={value} unit={definition.unit} /></dd>
            ) : (
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{formatRecipeValue(value)}</dd>
            )}
          </div>
        );
      })}
    </dl>
  );
}

function AppliedPlacementGraph({ value, unit }: { value: unknown; unit?: string | null }) {
  const placements = React.useMemo(() => normalizePlacements(value), [value]);
  const validation = React.useMemo(() => summarizePlacementValidation(placements), [placements]);
  return <PlacementPreview placements={placements} validation={validation} unit={unit} selectedIndex={null} resetKey={0} onSelect={() => {}} readOnly />;
}

function formatRecipeValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not set";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  return JSON.stringify(value, null, 2) ?? "Not set";
}

function GeometryPickerDialog({
  flowInput,
  selectedBinding,
  geometries,
  generatorDefinitions,
  onClose,
  onSelect,
  onSelectGenerator,
  onEditCurrentGenerator,
}: {
  flowInput: FlowInputDefinition;
  selectedBinding: FlowConfiguration["inputBindings"][string] | undefined;
  geometries: GeometryEntity[];
  generatorDefinitions: GeometryGeneratorDefinition[];
  onClose: () => void;
  onSelect: (geometryId: string) => void;
  onSelectGenerator: (definition: GeometryGeneratorDefinition) => void;
  onEditCurrentGenerator: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [categoryPath, setCategoryPath] = React.useState<string[]>([]);
  const matchingGeometries = geometries.filter((geometry) =>
    geometryMatchesFlowInput(geometry, flowInput),
  );
  const matchingGenerators = generatorsForFlowInput(generatorDefinitions, flowInput);
  const canEditCurrentGenerator = canEditGeneratorBinding(generatorDefinitions, selectedBinding);

  const panel = React.useRef<HTMLElement>(null);
  useEditorDialogFocus(panel, onClose, false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
      <section ref={panel} role="dialog" aria-modal="true" aria-label="Choose geometry source" tabIndex={-1} className="relative z-10 flex max-h-[calc(100vh-32px)] w-[min(820px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport">
        <header className="flex items-start justify-between gap-3 border-b bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">Choose geometry source</h2>
            <div className="mt-1 text-sm text-muted-foreground">{flowInput.name}</div>
          </div>
          <Button variant="ghost" size="icon" title="Close" onClick={onClose}>
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {canEditCurrentGenerator || matchingGenerators.length > 0 ? (
            <div className="mb-4 space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Generators</div>
              {canEditCurrentGenerator && selectedBinding?.kind === "generator" ? (
                <Button type="button" variant="outline" className="w-full justify-start" onClick={onEditCurrentGenerator}>
                  Edit current {selectedBinding.generatorId}@{selectedBinding.generatorVersion} recipe
                </Button>
              ) : null}
              {matchingGenerators.map((definition) => (
                <Button key={`${definition.id}@${definition.version}`} type="button" variant="outline" className="w-full justify-start" onClick={() => onSelectGenerator(definition)}>
                  {definition.label} · v{definition.version}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Geometry catalog</div>
          <CategoryLibraryBrowser
            items={matchingGeometries}
            path={categoryPath}
            search={query}
            searchPlaceholder="Search geometry"
            emptyLabel="No matching geometry"
            noSearchResultsLabel="No geometry matched the search"
            noCategoryItemsLabel="No geometry in this category"
            getSearchText={geometrySearchText}
            itemKey={(geometry) => geometry.id}
            itemListClassName="grid gap-2"
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
                <GeometryCardDetails
                  geometry={geometry}
                  categoryPath={
                    showCategoryPath ? formatCategoryPath(geometry.category) : null
                  }
                />
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

function buildDefinition(nodes: FlowNode[], edges: FlowEdge[]): FlowDefinition {
  return {
    flowInputs: nodes.filter(isFlowInputNode).map((node) => structuredClone(node.data.definition)),
    stepRefs: nodes.filter(isStepNode).map((node) => structuredClone(node.data.stepRef)),
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

function graphFromDefinition(
  template: FlowDefinition,
  stepTemplates: ProcessStepTemplate[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const layout = computeTemplateLayout(template, stepTemplates);
  const stepTemplatesById = new Map(stepTemplates.map((item) => [item.id, item]));
  const flowInputNodeById = new Map<string, FlowInputNode>();
  const stepNodeById = new Map<string, StepNode>();

  template.flowInputs.forEach((definition) => {
    const clonedDefinition = clone(definition);
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

function analyzeDefinition(
  template: FlowDefinition,
  stepTemplates: ProcessStepTemplate[],
): FlowAnalysis {
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

function templateHasCycle(template: FlowDefinition) {
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

function newMetadata(): FlowMetadata {
  return {
    name: "",
    version: "V0.0.0",
    description: "",
    owner: "",
  };
}

function emptyConfiguration(): FlowConfiguration {
  return { inputBindings: {}, stepConfigurations: {} };
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

function validateFlowSaveInformation(
  metadata: FlowMetadata,
) {
  const requiredFields: Array<[string, string]> = [
    ["Flow name", metadata.name],
    ["Version", metadata.version],
    ["Owner", metadata.owner],
  ];
  const missingField = requiredFields.find(([, value]) => !value.trim());
  if (missingField) return `${missingField[0]} is required.`;
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
