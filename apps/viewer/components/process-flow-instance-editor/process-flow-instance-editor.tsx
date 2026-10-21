"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MarkerType, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import { CategoryLibraryBrowser } from "@/components/category-library/category-library-browser";
import { GeometryGeneratorDialogLauncher } from "@/components/geometry-generator/geometry-generator-registry";
import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import { canEditGeneratorBinding, generatorsForFlowInput } from "@/components/geometry-generator/geometry-generator-placements";
import { useGeneratorBindingGeometries } from "@/components/geometry-generator/use-generator-binding-geometries";
import { FileExportJobsPanel } from "@/components/geometry-preview/file-export-jobs-panel";
import type { FileExportJob } from "@/components/geometry-preview/file-export-client";
import { GeometryPreviewPanel, type GeometryPreviewContext } from "@/components/geometry-preview/geometry-preview-panel";
import { GeometryCardDetails, geometrySearchText } from "@/components/process-flow-fields/geometry-card-details";
import { FlowGdsFileProvider } from "@/components/process-flow-fields/flow-gds-file-context";
import { ProcessFlowGraph, type ProcessFlowGraphEdgeData, type ProcessFlowGraphNodeData } from "@/components/process-flow-graph/process-flow-graph";
import { EditorDialog } from "@/components/process-flow-save/editor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCategoryPath } from "@/lib/category-library";
import { getFlowInputReadiness, getStepExecutionReadiness, getStepConfigurationReadiness, geometryForFlowInput, geometryMatchesFlowInput } from "@/lib/process-flow/configuration";
import { geometryInputDisplayName, geometryInputNodePresentation, geometryInputStatusLabel, stepReadinessStatusLabel } from "@/lib/process-flow/readiness-presentation";
import { analyzeFlowDependencies } from "@/lib/process-flow/dependencies";
import { computeTemplateLayout } from "@/lib/process-flow/template-layout";
import { buildProcessFlowInstanceCreate, configurationFromInstance, instanceFlowConfiguration, missingActiveRecipeSteps, instancesForTemplate, newInstanceIdentity, validateInstanceIdentity } from "@/lib/process-flow/instance-editor";
import type { FlowConfiguration, FlowInputDefinition, GeometryEntity, GeneratorGeometryBinding, CatalogGeometryBinding, ProcessFlowInstance, ProcessFlowTemplate, ProcessStepTemplate, StepRef } from "@/lib/process-flow/types";
import { normalizeStepLabel } from "@/lib/process-flow/utils";
import { isTemplateEnabled } from "@/lib/process-flow/template-availability";
import { flowConfigurationIssues } from "@/lib/process-flow/template-editor-save";
import { addInstanceRecipe, setInstanceActiveRecipe, updateInstanceInputBindings, createProcessFlowInstance, getGeometryGeneratorVersion, loadBootstrap, ApiRequestError } from "@/lib/process-flow-api";
import { cn } from "@/lib/utils";
import { InstanceRecipeDialog } from "./instance-recipe-dialog";

const inputClass = "mt-1 h-9 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
type FlowInputNodeData = ProcessFlowGraphNodeData & { nodeKind: "flowInput"; definition: FlowInputDefinition };
type StepNodeData = ProcessFlowGraphNodeData & { nodeKind: "processStep"; stepRef: StepRef; stepTemplate: ProcessStepTemplate };
type FlowInputNode = Node<FlowInputNodeData, "flowInput">;
type StepNode = Node<StepNodeData, "processStep">;
type FlowNode = FlowInputNode | StepNode;
type FlowEdge = Edge<ProcessFlowGraphEdgeData, "dataFlow">;
type PersistedBinding = CatalogGeometryBinding | GeneratorGeometryBinding;

export function ProcessFlowInstanceEditor() {
  return <React.Suspense fallback={<p className="p-5">Loading instance…</p>}><ReactFlowProvider><FlowGdsFileProvider><ProcessFlowInstanceEditorInner /></FlowGdsFileProvider></ReactFlowProvider></React.Suspense>;
}

function ProcessFlowInstanceEditorInner() {
  const router = useRouter();
  const search = useSearchParams().toString();
  const [hydrated, setHydrated] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<ProcessFlowTemplate | null>(null);
  const [instance, setInstance] = React.useState<ProcessFlowInstance | null>(null);
  const [instances, setInstances] = React.useState<ProcessFlowInstance[]>([]);
  const [stepTemplates, setStepTemplates] = React.useState<ProcessStepTemplate[]>([]);
  const [geometries, setGeometries] = React.useState<GeometryEntity[]>([]);
  const [generatorDefinitions, setGeneratorDefinitions] = React.useState<GeometryGeneratorDefinition[]>([]);
  const [identity, setIdentity] = React.useState(newInstanceIdentity);
  const [sourceId, setSourceId] = React.useState("");
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [editingStepId, setEditingStepId] = React.useState<string | null>(null);
  const returnStepFocus = React.useRef<string | null>(null);
  const [pickerFlowInputId, setPickerFlowInputId] = React.useState<string | null>(null);
  const [pendingBinding, setPendingBinding] = React.useState<PersistedBinding | null>(null);
  const [generatorEditor, setGeneratorEditor] = React.useState<{ flowInputId: string; definition: GeometryGeneratorDefinition; initialParameters?: Record<string, unknown> } | null>(null);
  const [preview, setPreview] = React.useState<GeometryPreviewContext | null>(null);
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [showIssues, setShowIssues] = React.useState(false);
  const [fileExportJobsRefreshKey, setFileExportJobsRefreshKey] = React.useState(0);
  const [seedFileExportJob, setSeedFileExportJob] = React.useState<FileExportJob | null>(null);

  React.useEffect(() => {
    if (editingStepId || !returnStepFocus.current) return;
    const stepRefId = returnStepFocus.current;
    returnStepFocus.current = null;
    // Restore after dialog cleanup and graph updates have both completed.
    let restoreFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      restoreFrame = requestAnimationFrame(() => {
        const node = document.querySelector(`[data-id="${CSS.escape(stepNodeId(stepRefId))}"]`);
        node?.querySelector<HTMLButtonElement>('button[title="Edit step"]')?.focus();
      });
    });
    return () => { cancelAnimationFrame(frame); if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame); };
  }, [editingStepId]);

  React.useEffect(() => {
    let active = true;
    setHydrated(false); setMessage(null); setInstance(null);
    const params = new URLSearchParams(search);
    void loadBootstrap().then((bootstrap) => {
      if (!active) return;
      setStepTemplates(bootstrap.processStepTemplates); setGeometries(bootstrap.geometries);
      setGeneratorDefinitions(bootstrap.geometryGenerators); setInstances(bootstrap.processFlowInstances);
      const id = params.get("instanceId");
      const saved = id ? bootstrap.processFlowInstances.find((item) => item.id === id) : null;
      if (id && !saved) throw new Error(`Instance not found: ${id}`);
      const templateId = saved?.processFlowTemplateId ?? params.get("templateId");
      const template = bootstrap.processFlowTemplates.find((item) => item.id === templateId);
      if (!template) throw new Error("Choose a process flow template from Home.");
      if (saved && params.get("templateId") && params.get("templateId") !== saved.processFlowTemplateId) throw new Error("Instance does not belong to the requested template.");
      setSelectedTemplate(template); setInstance(saved ?? null);
    }).catch((error) => { if (active) { setSelectedTemplate(null); setMessage(error instanceof Error ? error.message : "Unable to load instance."); } })
      .finally(() => { if (active) setHydrated(true); });
    return () => { active = false; };
  }, [search]);

  const configuration = React.useMemo(() => instance ? instanceFlowConfiguration(instance) : emptyConfiguration(), [instance]);
  const generated = useGeneratorBindingGeometries(configuration);
  const resolvedGeometries = [...geometries, ...generated.geometries];
  const sources = selectedTemplate ? instancesForTemplate(instances, selectedTemplate.id) : [];
  const issues = selectedTemplate && instance ? [
    ...missingActiveRecipeSteps(instance, selectedTemplate, stepTemplates).map((id) => `${id}: choose an active recipe.`),
    ...flowConfigurationIssues(selectedTemplate, stepTemplates, configuration, resolvedGeometries),
  ] : [];

  async function mutate(action: () => Promise<ProcessFlowInstance>) {
    if (busyRef.current) throw new Error("An update is already in progress.");
    busyRef.current = true; setBusy(true); setMessage(null);
    try { const saved = await action(); setInstance(saved); setPreview(null); return saved; }
    catch (error) {
      const detail = error instanceof Error ? error.message : "Unable to update instance.";
      setMessage(instance !== null && error instanceof ApiRequestError && error.status === 409
        ? `${detail} Return Home and reopen this instance to continue with the latest saved version.`
        : detail);
      throw error;
    }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || !isTemplateEnabled(selectedTemplate) || busyRef.current) return;
    const error = validateInstanceIdentity(identity);
    if (error) { setMessage(error); const field = ["name", "version", "owner"].find((key) => !identity[key as keyof typeof identity].trim()); if (field) (event.currentTarget.elements.namedItem(field) as HTMLElement)?.focus(); return; }
    const source = sources.find((item) => item.id === sourceId);
    try {
      const saved = await mutate(() => createProcessFlowInstance(buildProcessFlowInstanceCreate(selectedTemplate.id, identity, source ? instanceFlowConfiguration(source) : undefined)));
      router.replace(`/flow-instance-editor?instanceId=${encodeURIComponent(saved.id)}`);
    } catch { /* Keep entered metadata. */ }
  }
  function closeStepRecipes() {
    returnStepFocus.current = editingStepId;
    setEditingStepId(null);
  }
  function pickInput(id: string) {
    if (!instance || busyRef.current) return;
    setPendingBinding(structuredClone(instance.inputBindings[id] ?? null)); setPickerFlowInputId(id); setMessage(null);
  }
  async function applyBinding() {
    if (!instance || !pickerFlowInputId) return;
    const bindings = structuredClone(instance.inputBindings);
    if (pendingBinding) bindings[pickerFlowInputId] = pendingBinding; else delete bindings[pickerFlowInputId];
    try { await mutate(() => updateInstanceInputBindings(instance, bindings)); setPickerFlowInputId(null); } catch { /* Keep pending selection. */ }
  }
  async function editCurrentGenerator() {
    if (!pickerFlowInputId || pendingBinding?.kind !== "generator") return;
    try {
      const definition = await getGeometryGeneratorVersion(pendingBinding.generatorId, pendingBinding.generatorVersion);
      setGeneratorEditor({ flowInputId: pickerFlowInputId, definition, initialParameters: structuredClone(pendingBinding.parameters) }); setPickerFlowInputId(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Generator unavailable."); }
  }
  function openInputPreview(input: FlowInputDefinition) {
    if (!selectedTemplate || !instance) return;
    setPreview({ previewId: `input:${input.flowInputId}:${instance.revision}`, sourceLabel: input.name, slotLabel: "Input", sourceKind: "flowInput", request: {
      target: { type: "flowInput", flowInputId: input.flowInputId }, processFlowTemplateId: selectedTemplate.id,
      sourceLabel: input.name, configuration, analyticsContext: { flowTemplateId: selectedTemplate.id, flowInstanceId: instance.id },
    } });
  }
  function openStepPreview(node: StepNode) {
    if (!selectedTemplate || !instance) return;
    const missing = missingActiveRecipeSteps(instance, selectedTemplate, stepTemplates, node.data.stepRef.stepRefId);
    if (missing.length) { setMessage(`Choose active recipes for: ${missing.join(", ")}`); return; }
    setPreview({ previewId: `step:${node.data.stepRef.stepRefId}:${instance.revision}`, sourceLabel: stepLabel(node.data.stepRef, node.data.stepTemplate), slotLabel: "Result", sourceKind: "stepOutput", request: {
      target: { type: "stepOutput", stepRefId: node.data.stepRef.stepRefId, outputPortId: "result_geometry" },
      processFlowTemplateId: selectedTemplate.id, configuration,
      analyticsContext: { flowTemplateId: selectedTemplate.id, flowInstanceId: instance.id },
    } });
  }
  const graph = selectedTemplate && instance ? graphForInstance(selectedTemplate, stepTemplates, configuration, resolvedGeometries, selectedNodeId, false,
    (id) => { if (!busyRef.current) setEditingStepId(id.replace(/^step:/, "")); }, pickInput, openStepPreview, instance) : { nodes: [], edges: [] };
  const editingRef = selectedTemplate?.stepRefs.find((ref) => ref.stepRefId === editingStepId);
  const editingTemplate = stepTemplates.find((step) => step.id === editingRef?.processStepTemplateId);
  const pickerInput = selectedTemplate?.flowInputs.find((input) => input.flowInputId === pickerFlowInputId);
  return <main className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <header className="flex shrink-0 flex-wrap items-center gap-4 border-b bg-white px-4 py-4 shadow-sm sm:px-5">
      <nav aria-label="Editor navigation" className="shrink-0">
        <Button asChild className={cn("h-11 px-5 font-semibold", busy && "opacity-50")}>
          <Link href="/" aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} onClick={(event) => { if (busy) event.preventDefault(); }}>
            <ArrowLeft aria-hidden="true" />Return Home
          </Link>
        </Button>
      </nav>
      <div aria-hidden="true" className="hidden h-10 w-px bg-border sm:block" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-xs font-medium text-muted-foreground">Flow Instance Editor</p>
        <h1 className="truncate font-semibold">{instance ? instance.name : "Create Instance"}</h1>
        <p className="truncate text-xs text-muted-foreground">{selectedTemplate?.name} · {selectedTemplate?.version}{instance ? ` · Revision ${instance.revision} · ${instance.owner}` : ""}</p>
      </div>
    </header>
    {message ? <div role="alert" className="shrink-0 border-b bg-destructive/5 px-5 py-3 text-sm text-destructive">{message}</div> : null}
    {!hydrated ? <p className="p-5">Loading…</p> : !instance ? <div className="min-h-0 flex-1 overflow-y-auto p-5"><form onSubmit={(event) => void create(event)} className="mx-auto max-w-xl space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="font-semibold">Create a flow tracking instance</h2><p className="text-sm text-muted-foreground">Geometry and station recipes can be added after creation.</p>
      {(["name", "version", "owner", "description"] as const).map((field) => <label key={field} className="block text-sm font-medium capitalize">{field}{field !== "description" ? " *" : ""}<input name={field} required={field !== "description"} value={identity[field]} disabled={busy} onChange={(event) => setIdentity({ ...identity, [field]: event.target.value })} className={inputClass} /></label>)}
      <label className="block text-sm font-medium">Initial configuration<select value={sourceId} disabled={busy} onChange={(event) => setSourceId(event.target.value)} className={inputClass}><option value="">Empty instance · no recipes or geometry</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name} · {source.version}</option>)}</select></label>
      {sourceId ? <p className="text-xs text-muted-foreground">Copies the source active recipes and geometry. New recipes receive new IDs.</p> : null}
      {selectedTemplate && !isTemplateEnabled(selectedTemplate) ? <p className="text-sm text-destructive">This template is disabled. Enable it before creating an instance.</p> : null}
      <Button type="submit" disabled={busy || !selectedTemplate || !isTemplateEnabled(selectedTemplate)}>{busy ? "Creating…" : "Create Instance"}</Button>
    </form></div> : <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-5 py-2 text-xs"><span role="status">{busy ? "Applying changes…" : `Instance stored · Revision ${instance.revision}`}</span><button type="button" className="rounded text-amber-800 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={showIssues} onClick={() => setShowIssues(!showIssues)}>{issues.length ? `${issues.length} configuration issues` : "Ready to execute"}</button></div>
      {showIssues && issues.length ? <ul className="max-h-32 shrink-0 list-disc overflow-y-auto border-b bg-amber-50 px-10 py-3 text-sm text-amber-900">{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul> : null}
      <ProcessFlowGraph mode="view" nodes={graph.nodes} edges={graph.edges} className="min-h-0 flex-1" fitView edgesReconnectable={false} elementsSelectable minZoom={0.28} maxZoom={1.45} showMiniMap
        defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }} onNodeClick={(_, node) => { if (busyRef.current) return; setSelectedNodeId(node.id); if (isFlowInputNode(node)) pickInput(node.data.definition.flowInputId); }}
        onNodeDoubleClick={(_, node) => { if (!busyRef.current && isStepNode(node)) setEditingStepId(node.data.stepRef.stepRefId); }} onPaneClick={() => setSelectedNodeId(null)} />
    </>}
    {instance && selectedTemplate && editingRef && editingTemplate ? <InstanceRecipeDialog key={editingRef.stepRefId} label={stepLabel(editingRef, editingTemplate)} station={instance.stepConfigurations[editingRef.stepRefId]} template={editingTemplate}
      defaults={configurationFromInstance(selectedTemplate, stepTemplates).stepConfigurations[editingRef.stepRefId]?.parameterValues ?? {}} busy={busy} error={message}
      onClose={closeStepRecipes} onActivate={(id) => mutate(() => setInstanceActiveRecipe(instance, editingRef.stepRefId, id))}
      onAdd={async (recipe) => { const saved = await mutate(() => addInstanceRecipe(instance, editingRef.stepRefId, recipe)); return saved.stepConfigurations[editingRef.stepRefId].recipes.at(-1)!; }} /> : null}
    {pickerInput && instance ? <GeometryPickerDialog flowInput={pickerInput} pendingBinding={pendingBinding} busy={busy} error={message} geometries={geometries} generatorDefinitions={generatorDefinitions}
      onClose={() => setPickerFlowInputId(null)} onSelect={(id) => setPendingBinding({ kind: "catalog", geometryId: id })} onClear={() => setPendingBinding(null)} onApply={() => void applyBinding()}
      onPreview={() => { setPickerFlowInputId(null); openInputPreview(pickerInput); }} canPreview={Boolean(geometryForFlowInput(configuration, pickerInput.flowInputId, resolvedGeometries))}
      onSelectGenerator={(definition) => { setGeneratorEditor({ flowInputId: pickerInput.flowInputId, definition }); setPickerFlowInputId(null); }} onEditCurrentGenerator={() => void editCurrentGenerator()} /> : null}
    {generatorEditor ? <GeometryGeneratorDialogLauncher definition={generatorEditor.definition} initialParameters={generatorEditor.initialParameters}
      onClose={() => { setPickerFlowInputId(generatorEditor.flowInputId); setGeneratorEditor(null); }}
      onDefine={(result) => { setPendingBinding(result.binding); setPickerFlowInputId(generatorEditor.flowInputId); setGeneratorEditor(null); }} /> : null}
    {preview ? <GeometryPreviewPanel preview={preview} onClose={() => setPreview(null)} onFileExportJobCreated={(job) => { setSeedFileExportJob(job); setFileExportJobsRefreshKey((key) => key + 1); }} /> : null}
    <FileExportJobsPanel refreshKey={fileExportJobsRefreshKey} seedJob={seedFileExportJob} />
  </main>;
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
  instance?: ProcessFlowInstance,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const layout = computeTemplateLayout(template, stepTemplates);
  const dependencies = analyzeFlowDependencies(template, stepTemplates, configuration);
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
    const readiness = getStepConfigurationReadiness(
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
        status: instance && !instance.stepConfigurations[stepRef.stepRefId]?.activeRecipeId && dependencies.stepRefIds.has(stepRef.stepRefId) ? "incomplete" : readiness.status,
        statusLabel: instance && !instance.stepConfigurations[stepRef.stepRefId]?.activeRecipeId && dependencies.stepRefIds.has(stepRef.stepRefId) ? "No active recipe" : stepReadinessStatusLabel(readiness, stepRef.stepRefId),
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
    const previewReady = sourceStep && sourceReadiness?.status === "ready" && (!instance || missingActiveRecipeSteps(instance, template, stepTemplates, sourceStep.data.stepRef.stepRefId).length === 0);
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
          status: dependencies.edgeIds.has(savedEdge.edgeId) ? sourceReadiness?.status ?? "error" : "neutral",
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
    ).status === "ready" && (!instance || missingActiveRecipeSteps(instance, template, stepTemplates, node.data.stepRef.stepRefId).length === 0);
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


function GeometryPickerDialog({ flowInput, pendingBinding, geometries, generatorDefinitions, busy, error, canPreview,
  onClose, onSelect, onClear, onApply, onPreview, onSelectGenerator, onEditCurrentGenerator }: {
  flowInput: FlowInputDefinition; pendingBinding: PersistedBinding | null; geometries: GeometryEntity[];
  generatorDefinitions: GeometryGeneratorDefinition[]; busy: boolean; error: string | null; canPreview: boolean;
  onClose: () => void; onSelect: (id: string) => void; onClear: () => void; onApply: () => void; onPreview: () => void;
  onSelectGenerator: (definition: GeometryGeneratorDefinition) => void; onEditCurrentGenerator: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [path, setPath] = React.useState<string[]>([]);
  const matching = geometries.filter((geometry) => geometryMatchesFlowInput(geometry, flowInput));
  const generators = generatorsForFlowInput(generatorDefinitions, flowInput);
  return <EditorDialog title={`Geometry · ${flowInput.name}`} description="Choose a shared geometry source, then apply it to this instance." busy={busy} onClose={onClose} className="max-w-3xl"
    footer={<><Button variant="outline" disabled={busy || !canPreview} onClick={onPreview}>Preview current input</Button><Button variant="outline" disabled={busy} onClick={onClear}>Clear selection</Button><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={onApply}>{busy ? "Applying…" : "Apply geometry"}</Button></>}>
    <div className="min-h-0 space-y-4 overflow-y-auto p-5">
      {error ? <div role="alert" className="text-sm text-destructive">{error}</div> : null}
      <p className="break-words text-sm">Selected: {pendingBinding?.kind === "catalog" ? geometries.find((geometry) => geometry.id === pendingBinding.geometryId)?.name ?? pendingBinding.geometryId : pendingBinding?.kind === "generator" ? `${pendingBinding.generatorId} · v${pendingBinding.generatorVersion}` : "No geometry"}</p>
      {pendingBinding?.kind === "generator" && canEditGeneratorBinding(generatorDefinitions, pendingBinding) ? <Button variant="outline" disabled={busy} onClick={onEditCurrentGenerator}>Edit selected generator parameters</Button> : null}
      {generators.length ? <div className="flex flex-wrap gap-2">{generators.map((definition) => <Button key={`${definition.id}@${definition.version}`} variant="outline" disabled={busy} onClick={() => onSelectGenerator(definition)}>{definition.label} · v{definition.version}</Button>)}</div> : null}
      <CategoryLibraryBrowser items={matching} path={path} search={query} searchPlaceholder="Search geometry" emptyLabel="No matching geometry" noSearchResultsLabel="No geometry matched the search" noCategoryItemsLabel="No geometry in this category"
        getSearchText={geometrySearchText} itemKey={(geometry) => geometry.id} itemListClassName="grid gap-2" onPathChange={setPath} onSearchChange={setQuery}
        renderItem={(geometry, { showCategoryPath }) => <button type="button" disabled={busy} aria-pressed={pendingBinding?.kind === "catalog" && pendingBinding.geometryId === geometry.id}
          className={cn("rounded-md border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", pendingBinding?.kind === "catalog" && pendingBinding.geometryId === geometry.id && "border-primary bg-primary/5")} onClick={() => onSelect(geometry.id)}>
          <GeometryCardDetails geometry={geometry} categoryPath={showCategoryPath ? formatCategoryPath(geometry.category) : null} /></button>} />
    </div>
  </EditorDialog>;
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
