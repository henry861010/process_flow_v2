"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { EditorDialog } from "@/components/process-flow-save/editor-dialog";
import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import type { InstanceStepConfiguration, ProcessStepTemplate } from "@/lib/process-flow/types";

const inputClass = "mt-1 h-9 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
export type NewRecipe = { name: string; description: string; parameterValues: Record<string, unknown>; activate: boolean };

export function recipeDraftFromSource(station: InstanceStepConfiguration, defaults: Record<string, unknown>, sourceId: string): NewRecipe {
  const source = station.recipes.find((recipe) => recipe.id === sourceId);
  return {
    name: source ? `${source.name} copy` : `Recipe ${station.recipes.length + 1}`,
    description: source?.description ?? "",
    parameterValues: structuredClone(source ? source.parameterValues : defaults),
    activate: false,
  };
}

type PendingAction = { type: "close" } | { type: "source"; id: string };

export function NewInstanceRecipeDialog({ station, template, defaults, busy, error, onAdd, onClose, returnFocus }: {
  station: InstanceStepConfiguration; template: ProcessStepTemplate; defaults: Record<string, unknown>;
  busy: boolean; error: string | null; onAdd: (recipe: NewRecipe) => Promise<void>;
  onClose: () => void; returnFocus: React.RefObject<HTMLElement>;
}) {
  const [sourceId, setSourceId] = React.useState("");
  const [draft, setDraft] = React.useState(() => recipeDraftFromSource(station, defaults, ""));
  const [dirty, setDirty] = React.useState(false);
  const [pending, setPending] = React.useState<PendingAction | null>(null);
  const nameInput = React.useRef<HTMLInputElement>(null);
  const errorPanel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (busy) return;
    if (error) errorPanel.current?.focus();
    else nameInput.current?.focus();
  }, [busy, error]);
  React.useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  function change(next: NewRecipe) { setDraft(next); setDirty(true); }
  function apply(action: PendingAction) {
    if (action.type === "close") onClose();
    else { setSourceId(action.id); setDraft(recipeDraftFromSource(station, defaults, action.id)); setDirty(false); }
  }
  function request(action: PendingAction) { if (dirty) setPending(action); else apply(action); }
  async function create() {
    if (busy || !draft.name.trim()) return;
    try { await onAdd({ ...draft, name: draft.name.trim() }); }
    catch { /* Keep all pending values; the parent exposes the request error. */ }
  }
  return <>
    <EditorDialog title="Add recipe" description="Saved recipes are fixed. Create a new recipe to change parameters."
      busy={busy || Boolean(pending)} onClose={() => request({ type: "close" })} returnFocus={returnFocus} className="max-w-4xl"
      footer={<><Button variant="outline" disabled={busy || Boolean(pending)} onClick={() => request({ type: "close" })}>Cancel</Button>
        <Button disabled={busy || Boolean(pending) || !draft.name.trim()} onClick={() => void create()}>{busy ? "Creating…" : "Create recipe"}</Button></>}>
      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        {error ? <div ref={errorPanel} tabIndex={-1} role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive outline-none">
          {error}
        </div> : null}
        <label className="block text-sm font-medium">Start from<select value={sourceId} disabled={busy} className={inputClass}
          onChange={(event) => request({ type: "source", id: event.target.value })}>
          <option value="">Template defaults</option>
          {station.recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name} · {recipe.id}</option>)}
        </select></label>
        <label className="block text-sm font-medium">Recipe name<input ref={nameInput} data-autofocus required value={draft.name} disabled={busy}
          onChange={(event) => change({ ...draft, name: event.target.value })} className={inputClass} /></label>
        <label className="block text-sm font-medium">Description<textarea value={draft.description} disabled={busy}
          onChange={(event) => change({ ...draft, description: event.target.value })} className={`${inputClass} min-h-20 py-2`} /></label>
        {station.recipes.length > 0 ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.activate} disabled={busy}
          onChange={(event) => change({ ...draft, activate: event.target.checked })} />Set as active when created</label>
          : <p className="text-sm text-muted-foreground">The first recipe becomes active automatically.</p>}
        <p className="text-xs text-muted-foreground">Incomplete parameters can be created. Once created, this recipe cannot be edited.</p>
        <ParameterValueEditor definitions={template.parameterDefinitions} values={draft.parameterValues} disabled={busy}
          onChange={(parameterValues) => change({ ...draft, parameterValues })} />
      </div>
    </EditorDialog>
    {pending ? <EditorDialog title="Discard recipe changes?" description={pending.type === "source" ? "Switching the source replaces your unsubmitted recipe values." : "This recipe has not been created. Its unsubmitted values will be discarded."}
      onClose={() => setPending(null)} footer={<><Button variant="outline" onClick={() => setPending(null)}>Keep editing</Button>
        <Button onClick={() => { const action = pending; setPending(null); apply(action); }}>Discard changes</Button></>}><div /></EditorDialog> : null}
  </>;
}
