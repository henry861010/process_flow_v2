"use client";

import * as React from "react";
import { ArrowLeft, ChevronRight, Eye, FlaskConical, Pencil, Plus, Trash2, X } from "lucide-react";
import { AddRecipeDataFieldDialog } from "@/components/data-fields/add-recipe-data-field-dialog";
import { RecipeDataFields, RecipeDataSummary, useRecipeFieldTemplate } from "@/components/data-fields/recipe-data-fields";
import { StepTemplateDetails } from "@/components/process-flow-fields/step-template-details";
import { ParameterRows } from "@/components/process-flow-parameters/parameter-value-editor";
import { ValueFieldList } from "@/components/process-flow-parameters/value-field-layout";
import { RecipeParameterSummary } from "@/components/process-flow-parameters/recipe-parameter-summary";
import { EditorDialog, useEditorDialogFocus } from "@/components/process-flow-save/editor-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dataValueIssue } from "@/lib/process-flow/data-fields";
import { draftFingerprint } from "@/lib/process-flow/editor-drafts";
import { createRecipe, removeRecipe } from "@/lib/process-flow/recipes";
import type { ProcessStepTemplate, RecipeCandidate, RecipeDataEdit, StepConfiguration, StepRef } from "@/lib/process-flow/types";
import { normalizeStepLabel } from "@/lib/process-flow/utils";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const inputClass = `${fieldClass} py-2`;
const emptyConfiguration: StepConfiguration = { recipeCandidates: [], selectedRecipeId: null };
const slideDurationMs = 200;

export type PreviewAvailability = { ok: true } | { ok: false; reason: string };

type RecipeForm = { page: "recipe"; draft: RecipeCandidate; creating: boolean };
type EditorPage = { page: "overview" } | { page: "candidates" } | RecipeForm;
type FocusTarget = "initial" | "edit" | "add" | { recipeId: string };
type Navigation = {
  current: EditorPage;
  visit: number;
  focus: FocusTarget;
  slide?: { previous: EditorPage; back: boolean };
};

type StepEditorDialogProps = {
  stepRef: StepRef;
  template: ProcessStepTemplate;
  topologyLocked: boolean;
  configuration?: StepConfiguration;
  onClose: () => void;
  onStepLabelChange: (label: string) => void;
  onStepConfigurationChange: (value: StepConfiguration, dataEdit?: RecipeDataEdit) => void;
  stepPreviewAvailability: PreviewAvailability;
  onPreviewStep: () => void;
  onDelete: () => void;
  canSaveDraft?: boolean;
  hasUnsavedRecipeChanges?: boolean;
  recipeDataEdits?: RecipeDataEdit[];
  onTemplateUpdated?: (template: ProcessStepTemplate) => void;
  initialRecipeId?: string;
};

function markOutgoingPage(element: HTMLDivElement | null) {
  element?.setAttribute("inert", "");
}

export function StepEditorDialog({
  stepRef, template, topologyLocked, configuration = emptyConfiguration, onClose, onStepLabelChange,
  onStepConfigurationChange, stepPreviewAvailability, onPreviewStep, onDelete, canSaveDraft, hasUnsavedRecipeChanges,
  recipeDataEdits, onTemplateUpdated, initialRecipeId,
}: StepEditorDialogProps) {
  const initialRecipe = configuration.recipeCandidates.find((recipe) => recipe.recipeId === initialRecipeId);
  const [navigation, setNavigation] = React.useState<Navigation>(() => ({
    current: initialRecipe ? { page: "recipe", draft: structuredClone(initialRecipe), creating: false } : { page: "overview" },
    visit: 0,
    focus: "initial",
  }));
  const { current, focus, slide, visit } = navigation;
  const showRecipeNotice = hasUnsavedRecipeChanges && current.page !== "recipe";
  const [deleteRecipeId, setDeleteRecipeId] = React.useState<string | null>(null);
  const [fieldDialog, setFieldDialog] = React.useState<"closed" | "open" | "added">("closed");
  const recipeToDelete = configuration.recipeCandidates.find((recipe) => recipe.recipeId === deleteRecipeId);
  const panel = React.useRef<HTMLElement>(null);
  const activePage = React.useRef<HTMLDivElement>(null);
  const addFieldButton = React.useRef<HTMLButtonElement>(null);

  useEditorDialogFocus(panel, escape, false);
  const fieldLoad = useRecipeFieldTemplate(template, current.page === "recipe" ? visit : null, onTemplateUpdated);
  const fields = fieldLoad.template.dataFieldDefinitions ?? [];
  const fieldsRevision = fieldLoad.template.dataFieldsRevision ?? 1;

  React.useEffect(() => {
    panel.current?.toggleAttribute("inert", fieldDialog === "open");
  }, [fieldDialog]);

  React.useEffect(() => {
    if (!initialRecipe) return;
    // A link can resolve after the step dialog mounts. Only follow it before interactive navigation.
    setNavigation((state) => state.visit === 0 && state.current.page === "overview"
      ? { current: { page: "recipe", draft: structuredClone(initialRecipe), creating: false }, visit: 1, focus: "initial" }
      : state);
  }, [initialRecipe]);

  React.useEffect(() => {
    if (!slide) return;
    // Navigation is already committed. This only removes the departing visual panel.
    const timer = window.setTimeout(() => {
      setNavigation((state) => state.visit === visit ? { ...state, slide: undefined } : state);
    }, slideDurationMs + 30);
    return () => window.clearTimeout(timer);
  }, [slide, visit]);

  React.useEffect(() => {
    if (visit === 0) return;
    const page = activePage.current;
    const scrollArea = page?.querySelector<HTMLElement>("[data-recipe-scroll]");
    if (!page || !scrollArea) return;
    const requested = typeof focus === "string"
      ? page.querySelector<HTMLElement>(`[data-recipe-focus="${focus}"]`)
      : Array.from(page.querySelectorAll<HTMLElement>("[data-recipe-id]")).find((element) => element.dataset.recipeId === focus.recipeId);
    const target = requested ?? page.querySelector<HTMLElement>('[data-recipe-focus="initial"]');
    if (!target) return;
    target.focus({ preventScroll: true });
    const bounds = scrollArea.getBoundingClientRect();
    const control = target.getBoundingClientRect();
    if (control.bottom > bounds.bottom) scrollArea.scrollTop += control.bottom - bounds.bottom + 8;
  }, [focus, visit]);

  function navigate(next: EditorPage, back = false, target: FocusTarget = "initial") {
    setFieldDialog("closed");
    setNavigation((state) => ({ current: next, focus: target, visit: state.visit + 1, slide: { previous: state.current, back } }));
  }

  function returnToCandidates(form: RecipeForm, saved = false) {
    navigate({ page: "candidates" }, true, form.creating && !saved ? "add" : { recipeId: form.draft.recipeId });
  }

  function escape() {
    if (current.page === "recipe") returnToCandidates(current);
    else if (current.page === "candidates") navigate({ page: "overview" }, true, "edit");
    else onClose();
  }

  function startAddRecipe() {
    let nextNumber = configuration.recipeCandidates.length + 1;
    while (configuration.recipeCandidates.some((recipe) => recipe.name === `Recipe ${nextNumber}`)) nextNumber += 1;
    navigate({ page: "recipe", draft: createRecipe(template.parameterDefinitions, `Recipe ${nextNumber}`), creating: true });
  }

  function updateDraft(formVisit: number, update: Partial<RecipeCandidate>) {
    setNavigation((state) => state.visit === formVisit && state.current.page === "recipe"
      ? { ...state, current: { ...state.current, draft: { ...state.current.draft, ...update } } }
      : state);
  }

  function applyRecipeChanges(form: RecipeForm, dataEdit?: RecipeDataEdit) {
    const recipe = { ...form.draft, name: form.draft.name.trim() };
    const candidates = configuration.recipeCandidates;
    onStepConfigurationChange({
      ...configuration,
      recipeCandidates: candidates.some((candidate) => candidate.recipeId === recipe.recipeId)
        ? candidates.map((candidate) => candidate.recipeId === recipe.recipeId ? recipe : candidate)
        : [...candidates, recipe],
      selectedRecipeId: form.creating && candidates.length === 0 ? recipe.recipeId : configuration.selectedRecipeId,
    }, dataEdit);
    returnToCandidates(form, true);
  }

  function renderPage(view: EditorPage, pageVisit: number, leaving = false) {
    const motion = slide?.back
      ? { enter: "motion-safe:slide-in-from-left", exit: "motion-safe:slide-out-to-right" }
      : { enter: "motion-safe:slide-in-from-right", exit: "motion-safe:slide-out-to-left" };
    const recipe = view.page === "recipe" ? view.draft : null;
    const previous = configuration.recipeCandidates.find((item) => item.recipeId === recipe?.recipeId);
    const values = recipe?.dataValues ?? {};
    const dataChanged = draftFingerprint(values) !== draftFingerprint(previous?.dataValues ?? {});
    const pending = recipeDataEdits?.find((edit) => edit.stepRefId === stepRef.stepRefId && edit.recipeId === recipe?.recipeId);
    const needsFieldReview = pending !== undefined && pending.dataFieldsRevision !== fieldsRevision;
    const dataEdit = recipe && (dataChanged || needsFieldReview)
      ? { stepRefId: stepRef.stepRefId, recipeId: recipe.recipeId, dataFieldsRevision: fieldsRevision }
      : undefined;
    const removed = fieldLoad.confirmed ? Object.keys(values).filter((id) => !fields.some((field) => field.id === id)) : [];
    const invalid = fields.some((field) => field.status === "formal" && dataValueIssue(field, values[field.id]));
    const cannotApply = !recipe?.name.trim() || invalid || removed.length > 0 ||
      Boolean((dataChanged || pending) && (fieldLoad.loading || fieldLoad.error));

    return (
      <div key={pageVisit} ref={leaving ? markOutgoingPage : activePage} aria-hidden={leaving || undefined}
        className={cn("flex min-h-0 w-full min-w-0 flex-col",
          leaving && "pointer-events-none absolute inset-0 motion-reduce:hidden",
          slide && (leaving ? "motion-safe:animate-out" : "motion-safe:animate-in"),
          slide && "motion-safe:fill-mode-both motion-safe:ease-in-out", slide && (leaving ? motion.exit : motion.enter))}
        style={slide ? { animationDuration: `${slideDurationMs}ms` } : undefined}>
        <div data-recipe-scroll className="min-h-0 flex-1 overflow-y-auto p-4">
          {view.page === "overview" ? (
            <StepOverview {...{ stepRef, template, topologyLocked, configuration, onStepLabelChange,
              onStepConfigurationChange, stepPreviewAvailability, onPreviewStep, onDelete }}
              onEdit={() => navigate({ page: "candidates" })} />
          ) : view.page === "candidates" ? (
            <RecipeCandidates configuration={configuration} template={template}
              onBack={() => navigate({ page: "overview" }, true, "edit")} onAdd={startAddRecipe}
              onEdit={(recipe) => navigate({ page: "recipe", draft: structuredClone(recipe), creating: false })}
              onDelete={setDeleteRecipeId} onAddField={() => setFieldDialog("open")}
              addFieldButton={leaving ? undefined : addFieldButton} fieldAdded={!leaving && fieldDialog === "added"} />
          ) : (
            <div className="space-y-4 [&_[data-parameter-description]]:hidden">
              <div className="space-y-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => returnToCandidates(view)}>
                  <ArrowLeft aria-hidden="true" />Back to candidates
                </Button>
                <h3 className="break-words text-base font-semibold">
                  {view.creating ? "Add recipe" : `Edit ${previous?.name ?? view.draft.name}`}
                </h3>
              </div>
              <FormField label="Recipe name" required>
                <input className={inputClass} data-autofocus data-recipe-focus="initial" value={view.draft.name}
                  onChange={(event) => updateDraft(pageVisit, { name: event.target.value })} />
              </FormField>
              {(template.parameterDefinitions.length > 0 || fields.length > 0 || removed.length > 0) && (
                <ValueFieldList>
                  <ParameterRows definitions={template.parameterDefinitions} values={view.draft.parameterValues}
                    onChange={(parameterValues) => updateDraft(pageVisit, { parameterValues })} />
                  <RecipeDataFields fields={fields} values={values} removed={removed} onChange={(id, value) => {
                    const dataValues = { ...values };
                    if (value === "") delete dataValues[id];
                    else dataValues[id] = value;
                    updateDraft(pageVisit, { dataValues });
                  }} />
                </ValueFieldList>
              )}
              {!leaving && fieldLoad.loading && !fieldLoad.confirmed && <p role="status" className="text-sm">Loading fields…</p>}
              {!leaving && fieldLoad.error && <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                <p role="alert">{fieldLoad.error}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => void fieldLoad.refresh()}>Retry loading fields</Button>
              </div>}
              {!leaving && fieldLoad.confirmed && (needsFieldReview || (dataChanged && fieldLoad.changed)) && (
                <p role="status" className="text-sm">Field specifications changed. Review your values before saving.</p>
              )}
            </div>
          )}
        </div>
        {view.page === "recipe" ? (
          <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t bg-white px-4 py-3">
            <p className="min-w-0 basis-full self-center text-xs text-muted-foreground sm:flex-1 sm:basis-auto">
              Apply changes, then choose Save flow…{canSaveDraft ? " or Save Draft" : ""} to write them to the database.
            </p>
            <Button type="button" variant="outline" onClick={() => returnToCandidates(view)}>Cancel</Button>
            <Button type="button" disabled={cannotApply} onClick={() => applyRecipeChanges(view, dataEdit)}>Apply changes</Button>
          </footer>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-foreground/40" onClick={onClose} />
        <section ref={panel} role="dialog" aria-modal="true" aria-label="Edit flow node" tabIndex={-1}
          className="relative z-10 flex h-[min(720px,calc(100dvh-32px))] w-full max-w-[920px] flex-col overflow-hidden rounded-md border bg-background shadow-viewport">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b bg-white px-5 py-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{normalizeStepLabel(stepRef.stepLabel, template.name)}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="truncate">{template.name}</span>
                <Badge variant="outline">process step</Badge>
              </div>
              <p role="status" className={cn("text-sm font-medium text-amber-800", showRecipeNotice ? "mt-2" : "sr-only")}>
                {showRecipeNotice ? "Unsaved recipe changes" : null}
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" title="Close" aria-label="Close step editor" onClick={onClose}>
              <X aria-hidden="true" />
            </Button>
          </header>
          <div className="relative flex min-h-0 flex-1 overflow-clip">
            {slide ? renderPage(slide.previous, visit - 1, true) : null}
            {renderPage(current, visit)}
          </div>
        </section>
      </div>
      {fieldDialog === "open" && (
        <AddRecipeDataFieldDialog templateId={template.id} returnFocus={addFieldButton}
          onClose={() => setFieldDialog("closed")} onAdded={(next) => {
            onTemplateUpdated?.(next);
            setFieldDialog("added");
          }} />
      )}
      {recipeToDelete ? (
        <EditorDialog title="Delete recipe?" onClose={() => setDeleteRecipeId(null)} footer={<>
          <Button type="button" variant="outline" onClick={() => setDeleteRecipeId(null)}>Cancel</Button>
          <Button type="button" variant="destructive" onClick={() => {
            onStepConfigurationChange(removeRecipe(configuration, recipeToDelete.recipeId));
            setDeleteRecipeId(null);
          }}>Delete recipe</Button>
        </>}>
          <p className="p-5 text-sm">Delete <strong>{recipeToDelete.name}</strong>? This removes its parameter values from this flow.</p>
        </EditorDialog>
      ) : null}
    </>
  );
}

function StepOverview({ stepRef, template, topologyLocked, configuration, onStepLabelChange, onStepConfigurationChange,
  stepPreviewAvailability, onPreviewStep, onDelete, onEdit,
}: Omit<StepEditorDialogProps, "onClose" | "configuration" | "recipeDataEdits" | "onTemplateUpdated" | "initialRecipeId"> & {
  configuration: StepConfiguration;
  onEdit: () => void;
}) {
  const applied = configuration.recipeCandidates.find((recipe) => recipe.recipeId === configuration.selectedRecipeId);
  const hasCandidates = configuration.recipeCandidates.length > 0;
  return (
    <div className="space-y-6">
      <section aria-label="Step details" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Step details</h3>
          <div className="flex items-center gap-1">
            <span title={stepPreviewAvailability.ok ? "Preview step output" : stepPreviewAvailability.reason}>
              <Button type="button" variant="outline" size="sm" disabled={!stepPreviewAvailability.ok} onClick={onPreviewStep}>
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
            <input className={inputClass} value={stepRef.stepLabel ?? ""} disabled={topologyLocked} onChange={(event) => onStepLabelChange(event.target.value)} />
          </FormField>
          <StepTemplateDetails template={template} />
        </div>
      </section>
      <section aria-label="Active recipe" className="space-y-4 border-t pt-5">
        <h3 className="text-sm font-semibold">Active recipe</h3>
        <FormField label="Apply recipe">
          <select className={fieldClass} value={applied?.recipeId ?? ""} disabled={!hasCandidates}
            onChange={(event) => onStepConfigurationChange({ ...configuration, selectedRecipeId: event.target.value })}>
            {!applied ? <option value="" disabled>{hasCandidates ? "Choose a recipe" : "No recipes"}</option> : null}
            {configuration.recipeCandidates.map((recipe) => (
              <option key={recipe.recipeId} value={recipe.recipeId}>{recipe.name}</option>
            ))}
          </select>
        </FormField>
        {applied ? (
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="text-sm font-medium">{applied.name}</div>
            <div className="mt-1 break-all font-mono text-[11px] text-muted-foreground">{applied.recipeId}</div>
            <RecipeParameterSummary definitions={template.parameterDefinitions} recipe={applied} />
            <RecipeDataSummary template={template} recipe={applied} />
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" role="status">
            {hasCandidates ? "Choose a recipe to apply to this step." : "Add a recipe to configure this step."}
          </p>
        )}
      </section>
      <div className="flex justify-end border-t pt-4">
        <Button type="button" size="sm" data-recipe-focus="edit" onClick={onEdit}><Pencil aria-hidden="true" />Edit recipe</Button>
      </div>
    </div>
  );
}

function RecipeCandidates({ configuration, template, onBack, onAdd, onEdit, onDelete, onAddField, addFieldButton, fieldAdded }: {
  configuration: StepConfiguration;
  template: ProcessStepTemplate;
  onBack: () => void;
  onAdd: () => void;
  onEdit: (recipe: RecipeCandidate) => void;
  onDelete: (recipeId: string) => void;
  onAddField: () => void;
  addFieldButton?: React.RefObject<HTMLButtonElement>;
  fieldAdded: boolean;
}) {
  const parameterNames = template.parameterDefinitions.map((definition) => definition.name).join(", ") || "No parameters";
  return (
    <section aria-label="Candidate recipes" className="space-y-4">
      <div className="space-y-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}><ArrowLeft aria-hidden="true" />Back to step</Button>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 tabIndex={-1} data-recipe-focus="initial" className="text-base font-semibold outline-none">Candidate recipes</h3>
          <Button ref={addFieldButton} type="button" variant="outline" size="sm" aria-haspopup="dialog" onClick={onAddField}
            className="ml-auto border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 hover:text-rose-900 focus-visible:ring-rose-600">
            <FlaskConical aria-hidden="true" />Add data field
          </Button>
        </div>
        <p role="status" className={cn("text-sm text-primary", !fieldAdded && "sr-only")}>
          {fieldAdded ? "Data field added. Open a recipe to enter a value." : null}
        </p>
      </div>
      {configuration.recipeCandidates.length ? (
        <ul className="space-y-2">
          {configuration.recipeCandidates.map((recipe) => {
            const active = recipe.recipeId === configuration.selectedRecipeId;
            return (
              <li key={recipe.recipeId} className={cn("flex min-w-0 items-stretch rounded-md border bg-white shadow-sm", active && "border-primary ring-1 ring-primary/20")}>
                <button type="button" data-recipe-id={recipe.recipeId} aria-label={`Open recipe ${recipe.name}${active ? " (active)" : ""}`}
                  onClick={() => onEdit(recipe)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-l-md p-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 break-words text-sm font-medium">{recipe.name}</span>
                      {active ? <Badge variant="outline">Active</Badge> : null}
                    </span>
                    <span className="mt-0.5 block break-all font-mono text-[11px] text-muted-foreground">{recipe.recipeId}</span>
                    <span className="mt-2 block break-words text-xs text-muted-foreground">{parameterNames}</span>
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                </button>
                <div className="flex shrink-0 items-center px-2">
                  <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive"
                    aria-label={`Delete recipe ${recipe.name}`} title={`Delete ${recipe.name}`} onClick={() => onDelete(recipe.recipeId)}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-muted-foreground">No recipes yet.</p>}
      <div className="flex justify-end">
        <Button type="button" size="sm" data-recipe-focus="add" onClick={onAdd}><Plus aria-hidden="true" />Add recipe</Button>
      </div>
    </section>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <div className="mb-2 text-xs font-medium">
        {label}{required ? <span className="ml-1 text-destructive">*</span> : null}
      </div>
      {children}
    </label>
  );
}
