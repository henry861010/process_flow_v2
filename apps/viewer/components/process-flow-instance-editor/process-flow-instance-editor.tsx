"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MarkerType, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import {
  ArrowLeft,
  CircleDot,
  Eye,
  GitBranch,
  Layers3,
  Save,
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
import {
  GeometryCardDetails,
  geometrySearchText,
} from "@/components/process-flow-fields/geometry-card-details";
import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import {
  SaveInformationDialog,
  type InstanceSaveInformation,
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
} from "@/lib/process-flow/configuration";
import {
  geometryInputDisplayName,
  geometryInputNodePresentation,
  geometryInputStatusLabel,
  stepReadinessStatusLabel,
} from "@/lib/process-flow/readiness-presentation";
import { computeTemplateLayout } from "@/lib/process-flow/template-layout";
import {
  buildProcessFlowInstanceCreate,
  configurationFromInstance,
  instanceEditorEntry,
  instancesForTemplate,
  newInstanceIdentity,
  validateInstanceIdentity,
} from "@/lib/process-flow/instance-editor";
import type {
  FlowConfiguration,
  FlowInputDefinition,
  GeometryEntity,
  ProcessFlowInstance,
  ProcessFlowTemplate,
  ProcessStepTemplate,
  StepRef,
} from "@/lib/process-flow/types";
import { normalizeStepLabel } from "@/lib/process-flow/utils";
import { createProcessFlowInstance, loadBootstrap } from "@/lib/process-flow-api";
import { cn } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const selectClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

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

export function ProcessFlowInstanceEditor() {
  return (
    <ReactFlowProvider>
      <ProcessFlowInstanceEditorInner />
    </ReactFlowProvider>
  );
}

function ProcessFlowInstanceEditorInner() {
  const router = useRouter();
  const [hydrated, setHydrated] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<ProcessFlowTemplate | null>(null);
  const [stepTemplates, setStepTemplates] = React.useState<ProcessStepTemplate[]>([]);
  const [geometries, setGeometries] = React.useState<GeometryEntity[]>([]);
  const [instances, setInstances] = React.useState<ProcessFlowInstance[]>([]);
  const [selectedSourceId, setSelectedSourceId] = React.useState("");
  const [instanceIdentity, setInstanceIdentity] = React.useState<InstanceSaveInformation>(
    newInstanceIdentity(),
  );
  const [configuration, setConfiguration] = React.useState<FlowConfiguration>(emptyConfiguration());
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = React.useState<string | null>(null);
  const [pickerFlowInputId, setPickerFlowInputId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<GeometryPreviewContext | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [saveDialogError, setSaveDialogError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const [fileExportJobsRefreshKey, setFileExportJobsRefreshKey] = React.useState(0);
  const [seedFileExportJob, setSeedFileExportJob] = React.useState<FileExportJob | null>(null);

  React.useEffect(() => {
    let active = true;
    const { templateId, workspaceUnsupported } = instanceEditorEntry(window.location.search);

    loadBootstrap()
      .then((bootstrap) => {
        if (!active) return;
        setStepTemplates(bootstrap.processStepTemplates);
        setGeometries(bootstrap.geometries);
        setInstances(bootstrap.processFlowInstances);

        if (workspaceUnsupported) {
          setMessage({
            kind: "error",
            text: "Workspace links are no longer supported. Choose a template from Home.",
          });
          return;
        }
        if (!templateId) {
          setMessage({
            kind: "error",
            text: "No process flow template was selected. Choose a template from Home.",
          });
          return;
        }
        const template = bootstrap.processFlowTemplates.find((item) => item.id === templateId);
        if (!template) {
          setMessage({
            kind: "error",
            text: `Process flow template not found: ${templateId}`,
          });
          return;
        }
        setSelectedTemplate(template);
        setConfiguration(configurationFromInstance(template, bootstrap.processStepTemplates));
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

  React.useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const sourceInstances = React.useMemo(
    () =>
      selectedTemplate ? instancesForTemplate(instances, selectedTemplate.id) : [],
    [instances, selectedTemplate],
  );

  const graph = selectedTemplate
    ? graphForInstance(
        selectedTemplate,
        stepTemplates,
        configuration,
        geometries,
        selectedNodeId,
        false,
        (nodeId) => {
          setSelectedNodeId(nodeId);
          setEditingNodeId(nodeId);
        },
        setPickerFlowInputId,
        openStepPreview,
      )
    : { nodes: [] as FlowNode[], edges: [] as FlowEdge[] };
  const editingNode = graph.nodes.find((node) => node.id === editingNodeId) ?? null;
  const pickerInput = selectedTemplate?.flowInputs.find(
    (input) => input.flowInputId === pickerFlowInputId,
  ) ?? null;
  const configurationComplete = Boolean(
    selectedTemplate &&
      isConfigurationComplete(selectedTemplate, stepTemplates, configuration, geometries),
  );
  const canSave = hydrated && Boolean(selectedTemplate) && configurationComplete && !saving;

  function navigateHome() {
    if (dirty && !window.confirm("Discard this unsaved instance?")) return;
    router.push("/");
  }

  function selectSource(instanceId: string) {
    if (instanceId === selectedSourceId) return;
    if (dirty && !window.confirm("Discard the current unsaved instance values?")) return;
    const source = sourceInstances.find((instance) => instance.id === instanceId);
    if (!selectedTemplate) return;
    setConfiguration(configurationFromInstance(selectedTemplate, stepTemplates, source));
    setSelectedSourceId(source?.id ?? "");
    setInstanceIdentity(newInstanceIdentity());
    setSelectedNodeId(null);
    setEditingNodeId(null);
    setPickerFlowInputId(null);
    setDirty(Boolean(source));
    setSaveDialogError(null);
    setMessage(null);
  }

  function updateInputBinding(flowInputId: string, geometryId: string) {
    setConfiguration((current) => ({
      ...current,
      inputBindings: {
        ...current.inputBindings,
        [flowInputId]: { kind: "catalog", geometryId },
      },
    }));
    setPickerFlowInputId(null);
    setDirty(true);
    setMessage(null);
  }

  function updateStepValues(stepRefId: string, parameterValues: Record<string, unknown>) {
    setConfiguration((current) => ({
      ...current,
      stepConfigurations: {
        ...current.stepConfigurations,
        [stepRefId]: { parameterValues },
      },
    }));
    setDirty(true);
    setMessage(null);
  }

  function updateInstanceIdentity(patch: Partial<InstanceSaveInformation>) {
    setInstanceIdentity((current) => ({ ...current, ...patch }));
    setSaveDialogError(null);
  }

  async function saveInstance() {
    if (!canSave || !selectedTemplate) return;
    const validationError = validateInstanceIdentity(instanceIdentity, instances);
    if (validationError) {
      setSaveDialogError(validationError);
      return;
    }
    setSaving(true);
    setSaveDialogError(null);
    try {
      await createProcessFlowInstance(
        buildProcessFlowInstanceCreate(selectedTemplate.id, instanceIdentity, configuration),
      );
      setDirty(false);
      setSaveDialogOpen(false);
      router.push("/");
    } catch (error) {
      setSaveDialogError(error instanceof Error ? error.message : "Unable to save instance.");
    } finally {
      setSaving(false);
    }
  }

  function openInputPreview(flowInput: FlowInputDefinition) {
    if (!selectedTemplate) return;
    const geometry = geometryForFlowInput(configuration, flowInput.flowInputId, geometries);
    if (!geometry) return;
    setPreview({
      previewId: `flow-input:${flowInput.flowInputId}`,
      sourceLabel: flowInput.name,
      slotLabel: "Input",
      sourceKind: "flowInput",
      request: {
        target: { type: "flowInput", flowInputId: flowInput.flowInputId },
        sourceLabel: flowInput.name,
        processFlowTemplateId: selectedTemplate.id,
        configuration,
      },
    });
  }

  function openStepPreview(step: StepNode) {
    if (!selectedTemplate) return;
    setPreview({
      previewId: `step-output:${step.data.stepRef.stepRefId}`,
      sourceLabel: stepLabel(step.data.stepRef, step.data.stepTemplate),
      slotLabel: "Result",
      sourceKind: "stepOutput",
      request: {
        target: {
          type: "stepOutput",
          stepRefId: step.data.stepRef.stepRefId,
          outputPortId: "result_geometry",
        },
        sourceLabel: stepLabel(step.data.stepRef, step.data.stepTemplate),
        processFlowTemplateId: selectedTemplate.id,
        configuration,
      },
    });
  }

  function handleFileExportJobCreated(job: FileExportJob) {
    setSeedFileExportJob(job);
    setFileExportJobsRefreshKey((current) => current + 1);
  }

  const statusText = !hydrated
    ? "Loading process flow template..."
    : !selectedTemplate
      ? "Choose a process flow template from Home."
      : !configurationComplete
        ? "Complete the required geometry bindings and process values before saving."
        : selectedSourceId
          ? "Instance values loaded. Save with a new immutable identity."
          : dirty
            ? "Instance has unsaved changes."
            : "Start from blank or load values from an existing instance.";

  return (
    <main className="flex h-screen min-h-[720px] flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b bg-white px-5 py-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold tracking-normal">Process Flow Instance Editor</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a new immutable instance from a process flow template.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={navigateHome}>
              <ArrowLeft />Home
            </Button>
            <Button
              type="button"
              disabled={!canSave}
              onClick={() => {
                setSaveDialogError(null);
                setSaveDialogOpen(true);
              }}
            >
              <Save />Save
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <FormField label="Process flow template">
            <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border bg-muted/20 px-3 text-sm">
              <Workflow className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate font-medium">
                {selectedTemplate ? `${selectedTemplate.name} / ${selectedTemplate.version}` : "No template selected"}
              </span>
            </div>
          </FormField>
          <FormField label="From instance">
            <select
              className={selectClass}
              value={selectedSourceId}
              disabled={!selectedTemplate || saving}
              onChange={(event) => selectSource(event.target.value)}
            >
              <option value="">Start from blank</option>
              {sourceInstances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} / {instance.version}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </header>

      <div
        className={cn(
          "flex min-h-9 items-center gap-2 border-b px-4 py-2 text-sm",
          message?.kind === "error"
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "bg-muted/25 text-muted-foreground",
        )}
      >
        <CircleDot className="h-4 w-4 shrink-0" />
        <span className="truncate">{message?.text ?? statusText}</span>
      </div>

      <ProcessFlowGraph
        mode="view"
        nodes={graph.nodes}
        edges={graph.edges}
        className="min-h-0 flex-1"
        fitView
        edgesReconnectable={false}
        elementsSelectable
        panOnScroll
        minZoom={0.28}
        maxZoom={1.45}
        showMiniMap={graph.nodes.length > 0}
        defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
        onNodeClick={(_, node) => {
          setSelectedNodeId(node.id);
          setEditingNodeId(node.id);
        }}
        onPaneClick={() => setSelectedNodeId(null)}
        emptyState={
          !selectedTemplate ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-md rounded-md border border-dashed bg-white/90 px-5 py-4 text-center shadow-sm">
                <Layers3 className="mx-auto h-6 w-6 text-primary" />
                <h2 className="mt-3 text-sm font-semibold">No template selected</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Return Home and choose a process flow template to begin.
                </p>
              </div>
            </div>
          ) : null
        }
      />

      {saveDialogOpen ? (
        <SaveInformationDialog
          mode="instance"
          instance={instanceIdentity}
          error={saveDialogError}
          submitting={saving}
          onInstanceChange={updateInstanceIdentity}
          onClose={() => {
            if (!saving) setSaveDialogOpen(false);
          }}
          onSubmit={saveInstance}
        />
      ) : null}

      {editingNode ? (
        <InstanceNodeEditorDialog
          node={editingNode}
          configuration={configuration}
          geometries={geometries}
          disabled={false}
          onClose={() => setEditingNodeId(null)}
          onPick={() => isFlowInputNode(editingNode) && setPickerFlowInputId(editingNode.data.definition.flowInputId)}
          onPreview={() => isFlowInputNode(editingNode) && openInputPreview(editingNode.data.definition)}
          onStepChange={(values) => isStepNode(editingNode) && updateStepValues(editingNode.data.stepRef.stepRefId, values)}
        />
      ) : null}

      {pickerInput ? (
        <GeometryPickerDialog
          flowInput={pickerInput}
          selectedGeometry={geometryForFlowInput(configuration, pickerInput.flowInputId, geometries)}
          geometries={geometries}
          onClose={() => setPickerFlowInputId(null)}
          onSelect={(geometryId) => updateInputBinding(pickerInput.flowInputId, geometryId)}
        />
      ) : null}

      {preview ? (
        <GeometryPreviewPanel
          preview={preview}
          onClose={() => setPreview(null)}
          onFileExportJobCreated={handleFileExportJobCreated}
        />
      ) : null}

      <FileExportJobsPanel refreshKey={fileExportJobsRefreshKey} seedJob={seedFileExportJob} />
    </main>
  );
}

function graphForInstance(
  template: ProcessFlowTemplate,
  stepTemplates: ProcessStepTemplate[],
  configuration: FlowConfiguration,
  geometries: GeometryEntity[],
  selectedNodeId: string | null,
  committed: boolean,
  onSelectStep: (nodeId: string) => void,
  onPickInput: (flowInputId: string) => void,
  onPreviewStep: (node: StepNode) => void,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const layout = computeTemplateLayout(template);
  const stepTemplateById = new Map(stepTemplates.map((item) => [item.id, item]));
  const flowInputNodes = new Map<string, FlowInputNode>();
  const stepNodes = new Map<string, StepNode>();

  template.flowInputs.forEach((definition) => {
    const displayDefinition = {
      ...definition,
      name: geometryInputDisplayName(definition.name),
    };
    const geometry = geometryForFlowInput(configuration, definition.flowInputId, geometries);
    const readiness = getFlowInputReadiness(
      template,
      stepTemplates,
      configuration,
      geometries,
      definition.flowInputId,
    );
    const binding = configuration.inputBindings[definition.flowInputId];
    const presentation = geometryInputNodePresentation(
      displayDefinition.name,
      geometry?.name,
      readiness,
    );
    const nodeId = flowInputNodeId(definition.flowInputId);
    flowInputNodes.set(definition.flowInputId, {
      id: nodeId,
      type: "flowInput",
      position: layout.flowInputPositions.get(definition.flowInputId) ?? { x: 40, y: 100 },
      draggable: false,
      selected: nodeId === selectedNodeId,
      data: {
        nodeKind: "flowInput",
        definition: displayDefinition,
        graphMode: "view",
        ...presentation,
        icon: geometry?.icon,
        iconScale: geometry?.iconScale,
        pickId: definition.flowInputId,
        status: readiness.status,
        statusLabel: geometryInputStatusLabel(readiness, binding?.kind),
        onPick: committed ? undefined : onPickInput,
      },
    });
  });

  template.stepRefs.forEach((stepRef) => {
    const stepTemplate = stepTemplateById.get(stepRef.processStepTemplateId);
    if (!stepTemplate) return;
    const readiness = getStepExecutionReadiness(
      stepRef.stepRefId,
      template,
      stepTemplates,
      configuration,
      geometries,
    );
    const nodeId = stepNodeId(stepRef.stepRefId);
    const node: StepNode = {
      id: nodeId,
      type: "processStep",
      position: layout.stepPositions.get(stepRef.stepRefId) ?? { x: 360, y: 100 },
      draggable: false,
      selected: nodeId === selectedNodeId,
      data: {
        nodeKind: "processStep",
        stepRef,
        stepTemplate,
        graphMode: "view",
        displayLabel: stepLabel(stepRef, stepTemplate),
        displaySublabel: stepTemplate.name,
        editId: nodeId,
        stepRefId: stepRef.stepRefId,
        template: stepTemplate,
        geometryInputPorts: stepTemplate.inputPorts.map((port) => ({
          id: port.portId,
          name: port.name,
        })),
        outputPortId: "result_geometry",
        status: readiness.status,
        statusLabel: stepReadinessStatusLabel(readiness, stepRef.stepRefId),
        onEdit: onSelectStep,
      },
    };
    stepNodes.set(stepRef.stepRefId, node);
  });

  const nodes: FlowNode[] = [...flowInputNodes.values(), ...stepNodes.values()];
  const edges: FlowEdge[] = template.flowEdges.flatMap((savedEdge) => {
    const sourceNode =
      savedEdge.source.kind === "flowInput"
        ? flowInputNodes.get(savedEdge.source.flowInputId)
        : stepNodes.get(savedEdge.source.stepRefId);
    const targetNode = stepNodes.get(savedEdge.target.stepRefId);
    if (!sourceNode || !targetNode) return [];
    const sourceStep = isStepNode(sourceNode) ? sourceNode : null;
    const targetPort = targetNode.data.stepTemplate.inputPorts.find(
      (port) => port.portId === savedEdge.target.inputPortId,
    );
    const sourceReadiness = sourceStep
      ? getStepExecutionReadiness(
          sourceStep.data.stepRef.stepRefId,
          template,
          stepTemplates,
          configuration,
          geometries,
        )
      : isFlowInputNode(sourceNode)
        ? getFlowInputReadiness(
            template,
            stepTemplates,
            configuration,
            geometries,
            sourceNode.data.definition.flowInputId,
          )
        : null;
    const previewReady = sourceStep && sourceReadiness?.status === "ready";
    return [
      {
        id: savedEdge.edgeId,
        type: "dataFlow",
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle:
          savedEdge.source.kind === "flowInput" ? "out" : savedEdge.source.outputPortId,
        targetHandle: savedEdge.target.inputPortId,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: {
          sourceKind: savedEdge.source.kind,
          targetStepRefId: savedEdge.target.stepRefId,
          targetInputPortId: savedEdge.target.inputPortId,
          slotLabel: targetPort?.name ?? savedEdge.target.inputPortId,
          sourceLabel: isFlowInputNode(sourceNode)
            ? sourceNode.data.definition.name
            : stepLabel(sourceNode.data.stepRef, sourceNode.data.stepTemplate),
          graphMode: "view",
          status: sourceReadiness?.status ?? "error",
          geometryViewVisible: Boolean(sourceStep),
          geometryViewDisabled: !previewReady,
          geometryViewTitle: previewReady
            ? "Preview geometry at this edge"
            : "Complete upstream configuration to preview",
          onGeometryView: sourceStep ? () => onPreviewStep(sourceStep) : undefined,
        },
      },
    ];
  });

  stepNodes.forEach((node) => {
    const terminal = !template.flowEdges.some(
      (edge) =>
        edge.source.kind === "stepOutput" &&
        edge.source.stepRefId === node.data.stepRef.stepRefId,
    );
    const previewReady = getStepExecutionReadiness(
      node.data.stepRef.stepRefId,
      template,
      stepTemplates,
      configuration,
      geometries,
    ).status === "ready";
    node.data = {
      ...node.data,
      terminalGeometryViewVisible: terminal,
      terminalGeometryViewDisabled: !previewReady,
      terminalGeometryViewTitle: previewReady
        ? "Preview final geometry"
        : "Complete upstream configuration to preview",
      onTerminalGeometryView: () => onPreviewStep(node),
    };
  });

  return { nodes, edges };
}

function InstanceNodeEditorDialog({
  node,
  configuration,
  geometries,
  disabled,
  onClose,
  onPick,
  onPreview,
  onStepChange,
}: {
  node: FlowNode;
  configuration: FlowConfiguration;
  geometries: GeometryEntity[];
  disabled: boolean;
  onClose: () => void;
  onPick: () => void;
  onPreview: () => void;
  onStepChange: (values: Record<string, unknown>) => void;
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
    : stepLabel(node.data.stepRef, node.data.stepTemplate);
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
              <span className="truncate">{subtitle}</span>
              <Badge variant="outline">
                {isFlowInputNode(node) ? "geometry input" : "process step"}
              </Badge>
              {disabled ? <Badge variant="signal">committed</Badge> : null}
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
              configuration={configuration}
              geometries={geometries}
              disabled={disabled}
              onPick={onPick}
              onPreview={onPreview}
            />
          ) : (
            <StepInspector
              node={node}
              configuration={configuration}
              disabled={disabled}
              onChange={onStepChange}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function FlowInputInspector({
  node,
  configuration,
  geometries,
  disabled,
  onPick,
  onPreview,
}: {
  node: FlowInputNode;
  configuration: FlowConfiguration;
  geometries: GeometryEntity[];
  disabled: boolean;
  onPick: () => void;
  onPreview: () => void;
}) {
  const definition = node.data.definition;
  const geometry = geometryForFlowInput(configuration, definition.flowInputId, geometries);
  return (
    <section className="p-4">
      <div className="mb-2 flex min-h-8 items-center justify-end">
        <Badge variant={geometry ? "signal" : "outline"}>
          {geometry ? "Bound" : node.data.statusLabel ?? "Optional"}
        </Badge>
      </div>
      <FlowInputBindingControl
        geometry={geometry}
        canEdit={!disabled}
        onPick={onPick}
        onPreview={onPreview}
      />
      <FlowInputAdvancedDisclosure>
        <FlowInputAdvancedReadOnly definition={definition} />
      </FlowInputAdvancedDisclosure>
    </section>
  );
}

function StepInspector({
  node,
  configuration,
  disabled,
  onChange,
}: {
  node: StepNode;
  configuration: FlowConfiguration;
  disabled: boolean;
  onChange: (values: Record<string, unknown>) => void;
}) {
  const values =
    configuration.stepConfigurations[node.data.stepRef.stepRefId]?.parameterValues ?? {};
  return (
    <section className="p-4">
      <div className="mb-4">
        <div className="text-sm font-semibold">
          {stepLabel(node.data.stepRef, node.data.stepTemplate)}
        </div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          {node.data.stepRef.stepRefId} / {node.data.stepTemplate.id}
        </div>
      </div>
      <ParameterValueEditor
        definitions={node.data.stepTemplate.parameterDefinitions}
        values={values}
        disabled={disabled}
        onChange={onChange}
      />
    </section>
  );
}

function GeometryPickerDialog({
  flowInput,
  selectedGeometry,
  geometries,
  onClose,
  onSelect,
}: {
  flowInput: FlowInputDefinition;
  selectedGeometry: ReturnType<typeof geometryForFlowInput>;
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
            getSearchText={geometrySearchText}
            itemKey={(geometry) => geometry.id}
            itemListClassName="grid gap-2"
            renderItem={(geometry, { showCategoryPath }) => (
              <button
                type="button"
                className={cn(
                  "rounded-md border bg-white p-3 text-left text-sm shadow-sm transition hover:border-primary hover:bg-muted/20",
                  selectedGeometry?.id === geometry.id &&
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

function stepLabel(stepRef: StepRef, template: ProcessStepTemplate) {
  return normalizeStepLabel(stepRef.stepLabel, template.name);
}

function isFlowInputNode(node: FlowNode): node is FlowInputNode {
  return node.type === "flowInput" && node.data.nodeKind === "flowInput";
}

function isStepNode(node: FlowNode): node is StepNode {
  return node.type === "processStep" && node.data.nodeKind === "processStep";
}

function flowInputNodeId(flowInputId: string) {
  return `flow-input:${flowInputId}`;
}

function stepNodeId(stepRefId: string) {
  return `step:${stepRefId}`;
}

function emptyConfiguration(): FlowConfiguration {
  return { inputBindings: {}, stepConfigurations: {}, embeddedGeometries: {} };
}
