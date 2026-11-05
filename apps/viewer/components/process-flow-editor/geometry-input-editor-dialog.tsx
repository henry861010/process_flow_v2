"use client";

import * as React from "react";
import { ArrowLeft, Eye, Trash2, X } from "lucide-react";
import type { GeometryGeneratorDefinition } from "@/components/geometry-generator/geometry-generator-contracts";
import { GeometryGeneratorEditorContent,
  geometryGeneratorDefineResult, useGeometryGeneratorPreview } from "@/components/geometry-generator/geometry-generator-editor";
import { toGeneratorEditorValues } from "@/components/geometry-generator/geometry-generator-parameters";
import { FlowInputAdvancedDisclosure } from "@/components/process-flow-fields/flow-input-controls";
import { GeometryCardDetails } from "@/components/process-flow-fields/geometry-card-details";
import { useEditorDialogFocus } from "@/components/process-flow-save/editor-dialog";
import { Button } from "@/components/ui/button";
import { getGeometryGeneratorVersion } from "@/lib/process-flow-api";
import type { FlowInputDefinition, GeneratorGeometryBinding, GeometryBinding, GeometryEntity } from "@/lib/process-flow/types";
import { GeometrySourcePicker } from "./geometry-source-picker";

const inputClass = "h-9 w-full min-w-0 rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20";

export type GeometryInputEdit = { definition: FlowInputDefinition; binding: GeometryBinding };

export function GeometryInputEditorDialog({ flowInput, initialBinding, geometries, generatorDefinitions,
  outgoingCount, onApply, onPreview, onDelete, onClose }: {
  flowInput: FlowInputDefinition;
  initialBinding?: GeometryBinding;
  geometries: GeometryEntity[];
  generatorDefinitions: GeometryGeneratorDefinition[];
  outgoingCount: number;
  onApply: (edit: GeometryInputEdit) => void;
  onPreview: (edit: GeometryInputEdit) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [draftInput, setDraftInput] = React.useState(() => structuredClone(flowInput));
  const [binding, setBinding] = React.useState(() => initialBinding && structuredClone(initialBinding));
  const [definition, setDefinition] = React.useState<GeometryGeneratorDefinition | null>(null);
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const [choosing, setChoosing] = React.useState(!initialBinding);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const requests = React.useRef(0);
  const pendingRequest = React.useRef(false);
  const invalidateRequests = React.useCallback(() => { requests.current++; pendingRequest.current = false; }, []);
  const generator = useGeometryGeneratorPreview(definition, values);
  const result = definition ? geometryGeneratorDefineResult(definition, generator.latestPreview) : null;
  const catalogGeometry = binding?.kind === "catalog" ? geometries.find((item) => item.id === binding.geometryId) : null;

  function installGenerator(next: GeometryGeneratorDefinition, source: GeneratorGeometryBinding) {
    setDefinition(next);
    setBinding(structuredClone(source));
    setValues(toGeneratorEditorValues(next.parameterDefinitions, structuredClone({ ...next.defaultParameters, ...source.parameters })));
    setChoosing(false);
    setLoadError(null);
  }

  async function loadSavedGenerator(source: GeneratorGeometryBinding) {
    if (pendingRequest.current) return;
    pendingRequest.current = true;
    const request = ++requests.current;
    setLoadingId(source.generatorId);
    setLoadError(null);
    try {
      const saved = await getGeometryGeneratorVersion(source.generatorId, source.generatorVersion);
      if (requests.current === request) installGenerator(saved, source);
    } catch (error) {
      if (requests.current === request) setLoadError(error instanceof Error ? error.message : "Generator version unavailable.");
    } finally {
      if (requests.current === request) { pendingRequest.current = false; setLoadingId(null); }
    }
  }

  React.useEffect(() => {
    if (initialBinding?.kind === "generator") void loadSavedGenerator(initialBinding);
    return invalidateRequests;
    // The parent keys each editing session by node ID; props are its immutable baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() { invalidateRequests(); onClose(); }
  const panel = React.useRef<HTMLElement>(null);
  const body = React.useRef<HTMLDivElement>(null);
  useEditorDialogFocus(panel, close, false);
  React.useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    panel.current?.querySelector<HTMLElement>(choosing ? "[data-source-heading]" : "[data-autofocus]")?.focus();
  }, [choosing]);
  React.useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  function changeSource() {
    invalidateRequests();
    setLoadingId(null);
    setLoadError(null);
    setChoosing(true);
  }

  function backToGeometry() {
    invalidateRequests();
    setLoadingId(null);
    setLoadError(null);
    setChoosing(false);
    if (binding?.kind === "generator" && !definition) void loadSavedGenerator(binding);
  }

  function selectGenerator(selected: GeometryGeneratorDefinition) {
    if (pendingRequest.current) return;
    if (binding?.kind === "generator" && binding.generatorId === selected.id) {
      if (definition) setChoosing(false);
      else void loadSavedGenerator(binding);
    } else if (initialBinding?.kind === "generator" && initialBinding.generatorId === selected.id) {
      void loadSavedGenerator(initialBinding);
    } else {
      requests.current++;
      installGenerator(selected, { kind: "generator", generatorId: selected.id, generatorVersion: selected.version,
        parameters: structuredClone(selected.defaultParameters) });
    }
  }

  const originalValues = definition && initialBinding?.kind === "generator"
    && initialBinding.generatorId === definition.id && initialBinding.generatorVersion === definition.version
    ? toGeneratorEditorValues(definition.parameterDefinitions, { ...definition.defaultParameters, ...initialBinding.parameters }) : null;
  const parametersChanged = definition !== null && !sameValue(originalValues, values);
  const pendingBinding = binding?.kind === "generator" && parametersChanged ? result?.binding : binding;
  const changed = !sameValue(flowInput, draftInput) || !sameValue(initialBinding, pendingBinding);
  const canApply = !choosing && loadingId === null && !loadError && pendingBinding !== undefined && changed
    && (binding?.kind === "generator" ? generator.canDefine : Boolean(catalogGeometry));
  const sourceLabel = binding?.kind === "generator" ? definition?.label
    ?? generatorDefinitions.find((item) => item.id === binding.generatorId)?.label ?? binding.generatorId
    : catalogGeometry?.name ?? (binding ? "Geometry unavailable" : "No geometry selected");

  function editInput(patch: Partial<FlowInputDefinition>) { setDraftInput((current) => ({ ...current, ...patch })); }

  const advancedSettings = (
    <FlowInputAdvancedDisclosure>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="min-w-0 space-y-2 text-sm"><span>Name</span>
          <input className={inputClass} value={draftInput.name} onChange={(event) => editInput({ name: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draftInput.required}
          onChange={(event) => editInput({ required: event.target.checked })} />Required</label>
        <label className="min-w-0 space-y-2 text-sm sm:col-span-2"><span>Description</span>
          <textarea className={`${inputClass} h-auto min-h-[72px]`} value={draftInput.description ?? ""}
            onChange={(event) => editInput({ description: event.target.value })} /></label>
        {(["entityTypes", "categories"] as const).map((key) => (
          <label key={key} className="min-w-0 space-y-2 text-sm"><span>{key === "entityTypes" ? "Allowed entity types" : "Allowed categories"}</span>
            <input className={inputClass} value={(draftInput.geometryConstraints?.[key] ?? []).join(", ")}
              onChange={(event) => editInput({ geometryConstraints: updatedConstraints(draftInput.geometryConstraints, key, event.target.value) })} /></label>
        ))}
        <div className="text-xs text-muted-foreground"><span>Connections</span><p className="mt-1 text-foreground">{outgoingCount}</p></div>
        <div className="min-w-0 text-xs text-muted-foreground"><span>Flow input ID</span><p className="mt-1 break-all font-mono text-foreground">{draftInput.flowInputId}</p></div>
        <div className="border-t pt-3 sm:col-span-2">
          <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { requests.current++; onDelete(); }}>
            <Trash2 />Delete geometry input
          </Button>
        </div>
      </div>
    </FlowInputAdvancedDisclosure>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-3 sm:p-5"
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={panel} role="dialog" aria-modal="true" aria-label="Edit geometry input" tabIndex={-1}
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-[1240px] flex-col overflow-hidden rounded-lg border bg-background shadow-viewport outline-none sm:max-h-[calc(100dvh-40px)]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b bg-white px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 data-autofocus tabIndex={-1} className="break-words text-lg font-semibold outline-none">{draftInput.name || "Geometry input"}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="break-words">{sourceLabel}</span>
              {!choosing ? <Button type="button" size="sm" variant="outline" onClick={changeSource}>Change source</Button> : null}
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close geometry editor" title="Close" onClick={close}><X /></Button>
        </header>

        <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
          {choosing ? <>
            {binding ? <Button type="button" variant="ghost" size="sm" className="mb-3" onClick={backToGeometry}>
              <ArrowLeft />Back to geometry
            </Button> : null}
            <GeometrySourcePicker flowInput={draftInput} binding={binding} geometries={geometries}
              generatorDefinitions={generatorDefinitions} loadingGeneratorId={loadingId} error={loadError}
              onSelectGenerator={selectGenerator} onSelect={(geometryId) => {
                if (pendingRequest.current) return;
                requests.current++;
                setBinding({ kind: "catalog", geometryId }); setDefinition(null); setLoadError(null); setChoosing(false);
              }} />
          </> : <>
            {loadingId !== null ? <p role="status" className="py-6 text-sm text-muted-foreground">Loading generator…</p> : null}
            {loadError ? <div role="alert" className="space-y-3 rounded-md border border-destructive/30 p-4 text-sm text-destructive">
              <p>{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => {
                if (binding?.kind === "generator") void loadSavedGenerator(binding);
              }}>Retry</Button>
            </div> : null}
            {definition && binding?.kind === "generator" ? (
              <GeometryGeneratorEditorContent definition={definition} values={values} generator={generator} onChange={setValues}>
                {advancedSettings}
              </GeometryGeneratorEditorContent>
            ) : null}
            {binding?.kind === "catalog" ? (
              catalogGeometry ? <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border bg-white p-4">
                <div className="min-w-0"><GeometryCardDetails geometry={catalogGeometry} /></div>
                <Button type="button" variant="outline" onClick={() => onPreview({ definition: structuredClone(draftInput), binding: structuredClone(binding) })}>
                  <Eye />Preview geometry
                </Button>
              </div> : <p role="alert" className="text-sm text-destructive">This catalog geometry is unavailable. Choose another source.</p>
            ) : null}
          </>}

          {!(definition && binding?.kind === "generator" && !choosing) ? advancedSettings : null}
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-white px-4 py-3 sm:px-5">
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="button" disabled={!canApply} onClick={() => {
            if (canApply && pendingBinding) onApply({ definition: structuredClone(draftInput), binding: structuredClone(pendingBinding) });
          }}>Apply changes</Button>
        </footer>
      </section>
    </div>
  );
}

function sameValue(left: unknown, right: unknown) {
  const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  return stable(left) === stable(right);
}

function updatedConstraints(constraints: FlowInputDefinition["geometryConstraints"], key: "entityTypes" | "categories", text: string) {
  const values = text.split(",").map((value) => value.trim()).filter(Boolean);
  const result = { ...constraints, [key]: values.length ? values : undefined };
  return Object.values(result).some((value) => value?.length) ? result : undefined;
}
