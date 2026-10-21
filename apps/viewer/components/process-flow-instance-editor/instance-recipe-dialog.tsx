"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EditorDialog } from "@/components/process-flow-save/editor-dialog";
import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import { isParameterValueComplete } from "@/lib/process-flow/configuration";
import type { InstanceStepConfiguration, ProcessStepTemplate, StepRecipe } from "@/lib/process-flow/types";
import { NewInstanceRecipeDialog, type NewRecipe } from "./new-instance-recipe-dialog";

function RecipeParameters({ recipe, template }: { recipe: StepRecipe; template: ProcessStepTemplate }) {
  const complete = template.parameterDefinitions.every((definition) => isParameterValueComplete(definition, recipe.parameterValues[definition.id]));
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center gap-2"><h4 className="min-w-0 max-w-full break-words font-semibold">{recipe.name}</h4><Badge variant="outline">{complete ? "Parameters complete" : "Incomplete"}</Badge></div>
    <p className="break-all font-mono text-xs text-muted-foreground">{recipe.id}</p>
    {recipe.description ? <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{recipe.description}</p> : null}
    <p className="text-xs text-muted-foreground">Created {new Date(recipe.createdAt).toLocaleString()} · Read only</p>
    <ParameterValueEditor definitions={template.parameterDefinitions} values={recipe.parameterValues} disabled compact onChange={() => {}} />
  </div>;
}

export function InstanceRecipeDialog({ label, station, template, defaults, busy, error, onAdd, onActivate, onClose }: {
  label: string; station: InstanceStepConfiguration; template: ProcessStepTemplate;
  defaults: Record<string, unknown>; busy: boolean; error: string | null;
  onAdd: (recipe: NewRecipe) => Promise<StepRecipe>;
  onActivate: (id: string) => Promise<unknown>; onClose: () => void;
}) {
  const [selectedId, setSelectedId] = React.useState(station.activeRecipeId ?? "");
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const addButton = React.useRef<HTMLButtonElement>(null);
  const selectedButton = React.useRef<HTMLButtonElement>(null);
  const errorPanel = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();
  const active = station.recipes.find((recipe) => recipe.id === station.activeRecipeId);
  const selected = station.recipes.find((recipe) => recipe.id === selectedId);
  React.useEffect(() => {
    if (!busy && !adding && error) errorPanel.current?.focus();
  }, [busy, adding, error]);
  React.useEffect(() => {
    if (selectedId && !station.recipes.some((recipe) => recipe.id === selectedId)) {
      setSelectedId(station.activeRecipeId ?? "");
      setExpandedId(null);
    }
  }, [station, selectedId]);
  async function activate() {
    if (!selected || busy) return;
    try {
      await onActivate(selected.id);
      // The submit control becomes disabled once its candidate is active.
      requestAnimationFrame(() => selectedButton.current?.focus());
    } catch { /* Keep the candidate selected; the parent exposes the request error. */ }
  }

  return <>
    <EditorDialog title={label} description={template.description || undefined} busy={busy || adding} onClose={onClose}
      className="max-w-4xl [&>header_h2]:break-words [&>header_p]:max-h-28 [&>header_p]:overflow-y-auto [&>header_p]:whitespace-pre-wrap [&>header_p]:break-words"
      footer={<>
        <Button ref={addButton} variant="outline" disabled={busy || adding} onClick={() => setAdding(true)}>Add recipe</Button>
        <Button disabled={busy || adding || !selected || selected.id === station.activeRecipeId}
          onClick={() => void activate()}>{busy ? "Applying…" : "Set active"}</Button>
      </>}>
      <div className="min-h-0 space-y-6 overflow-y-auto p-5">
        {!adding && error ? <div ref={errorPanel} tabIndex={-1} role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive outline-none">
          {error}
        </div> : null}
        <section aria-label="Active recipe" className="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4" aria-hidden="true" />Active recipe</h3>
          {active ? <RecipeParameters recipe={active} template={template} /> : <p className="text-sm text-muted-foreground">No active recipe yet. Add the first recipe to activate it automatically.</p>}
        </section>
        <section aria-label="Station recipes" className="min-w-0 space-y-3">
          <h3 className="font-semibold">Recipes <span className="text-sm font-normal text-muted-foreground">({station.recipes.length})</span></h3>
          {station.recipes.length === 0 ? <p className="text-sm text-muted-foreground">No recipes yet.</p> : null}
          {station.recipes.map((recipe, index) => {
            const isActive = recipe.id === station.activeRecipeId;
            const isSelected = recipe.id === selectedId;
            const expanded = recipe.id === expandedId;
            const detailsId = `${listId}-${index}`;
            return <div key={recipe.id} className="min-w-0">
              <button ref={isSelected ? selectedButton : undefined} type="button" disabled={busy || adding} aria-pressed={isSelected} aria-expanded={expanded} aria-controls={detailsId}
                onClick={() => { setSelectedId(recipe.id); setExpandedId(expanded ? null : recipe.id); }}
                className={`flex w-full items-center gap-3 rounded-md border p-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${isActive ? "border-primary bg-primary/10" : "border-border bg-white"}`}>
                <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${isSelected ? "border-foreground" : "border-muted-foreground"}`}>
                  {isSelected ? <span className="h-2 w-2 rounded-full bg-foreground" /> : null}
                </span>
                <span className="min-w-0 flex-1"><span className="block break-words font-medium">{recipe.name}</span><span className="mt-1 block break-all font-mono text-xs text-muted-foreground">{recipe.id}</span></span>
                {isActive ? <Badge variant="signal" className="shrink-0">Active</Badge> : null}
                {expanded ? <ChevronUp aria-hidden="true" className="h-4 w-4 shrink-0" /> : <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </button>
              <div id={detailsId} hidden={!expanded} role="region" aria-label={`${recipe.name} recipe details`} className="ml-3 mt-2 min-w-0 rounded-md border bg-muted/20 p-4 sm:ml-7">
                {expanded ? <RecipeParameters recipe={recipe} template={template} /> : null}
              </div>
            </div>;
          })}
        </section>
      </div>
    </EditorDialog>
    {adding ? <NewInstanceRecipeDialog station={station} template={template} defaults={defaults} busy={busy} error={error}
      returnFocus={addButton} onClose={() => setAdding(false)} onAdd={async (draft) => {
        const recipe = await onAdd(draft);
        setSelectedId(recipe.id); setExpandedId(recipe.id); setAdding(false);
      }} /> : null}
  </>;
}
