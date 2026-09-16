"use client";

import * as React from "react";
import { Loader2, Pencil, RotateCcw, Save, X } from "lucide-react";

import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  clearFlowParameterDefault,
  hasFlowParameterDefault,
  initialFlowParameterDefault,
  resetFlowStepDefaults,
  scalarParameterDefinitions,
  setFlowParameterDefault,
} from "@/lib/process-flow/process-flow-template-update";
import type {
  ParameterDefinition,
  ProcessFlowTemplate,
  ProcessStepTemplate,
} from "@/lib/process-flow/types";
import { clone } from "@/lib/process-flow/utils";
import { updateProcessFlowTemplate } from "@/lib/process-flow-api";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[88px] w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";

export function ProcessFlowTemplateEditDialog({
  template,
  stepTemplates,
  onClose,
  onSaved,
}: {
  template: ProcessFlowTemplate;
  stepTemplates: ProcessStepTemplate[];
  onClose: () => void;
  onSaved: (template: ProcessFlowTemplate) => void;
}) {
  const [draft, setDraft] = React.useState<ProcessFlowTemplate>(() => clone(template));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const savingRef = React.useRef(saving);
  const stepTemplatesById = React.useMemo(
    () => new Map(stepTemplates.map((stepTemplate) => [stepTemplate.id, stepTemplate])),
    [stepTemplates],
  );

  React.useEffect(() => {
    onCloseRef.current = onClose;
    savingRef.current = saving;
  }, [onClose, saving]);

  React.useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !savingRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("keydown", close);
      previousFocus.current?.focus();
    };
  }, []);

  const canSave = Boolean(!saving && draft.name.trim() && draft.owner?.trim());

  function patchMetadata(
    patch: Partial<Pick<ProcessFlowTemplate, "name" | "owner" | "description">>,
  ) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  function toggleDefault(
    stepRefId: string,
    definition: ParameterDefinition,
    enabled: boolean,
  ) {
    setDraft((current) =>
      enabled
        ? setFlowParameterDefault(
            current,
            stepRefId,
            definition.id,
            initialFlowParameterDefault(definition),
          )
        : clearFlowParameterDefault(current, stepRefId, definition.id),
    );
    setError(null);
  }

  function updateDefault(
    stepRefId: string,
    parameterId: string,
    values: Record<string, unknown>,
  ) {
    setDraft((current) =>
      setFlowParameterDefault(current, stepRefId, parameterId, values[parameterId]),
    );
    setError(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateProcessFlowTemplate<ProcessFlowTemplate>(draft.id, draft);
      onSaved(saved);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to update process flow template.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-5">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-foreground/45"
        onClick={saving ? undefined : onClose}
      />
      <form
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100vh-24px)] w-[min(920px,calc(100vw-24px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport sm:max-h-[calc(100vh-40px)]"
        role="dialog"
        onSubmit={(event) => void save(event)}
      >
        <header className="flex items-start justify-between gap-4 border-b bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              <h2 id={titleId} className="truncate text-lg font-semibold">
                Edit {draft.name}
              </h2>
            </div>
            <div
              id={descriptionId}
              className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
            >
              <span className="font-mono">{draft.id}</span>
              <Badge variant="outline">{draft.version}</Badge>
            </div>
          </div>
          <Button
            aria-label="Close process flow template editor"
            disabled={saving}
            size="icon"
            title="Close"
            type="button"
            variant="ghost"
            onClick={onClose}
          >
            <X />
          </Button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Metadata</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Identity, version, flow inputs, steps, and topology remain locked.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MetadataInput
                autoFocus
                disabled={saving}
                label="Name"
                value={draft.name}
                onChange={(name) => patchMetadata({ name })}
              />
              <MetadataInput
                disabled={saving}
                label="Owner"
                value={draft.owner ?? ""}
                onChange={(owner) => patchMetadata({ owner })}
              />
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                <span>Description</span>
                <textarea
                  className={textareaClass}
                  disabled={saving}
                  value={draft.description ?? ""}
                  onChange={(event) => patchMetadata({ description: event.target.value })}
                />
              </label>
            </div>
          </section>

          <section className="space-y-3 border-t pt-5">
            <div>
              <h3 className="text-sm font-semibold">Flow parameter defaults</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Only affects future instances created from blank. Existing instances and instances
                copied from another instance are unchanged.
              </p>
            </div>
            <div className="space-y-4">
              {draft.stepRefs.map((stepRef, index) => {
                const stepTemplate = stepTemplatesById.get(stepRef.processStepTemplateId);
                if (!stepTemplate) {
                  return (
                    <section
                      key={stepRef.stepRefId}
                      className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-4"
                    >
                      <div className="text-sm font-medium">
                        {stepRef.stepLabel || stepRef.processStepTemplateId}
                      </div>
                      <p className="mt-1 text-xs text-destructive">
                        Process step definition is unavailable: {stepRef.processStepTemplateId}
                      </p>
                    </section>
                  );
                }
                const definitions = scalarParameterDefinitions(stepTemplate);
                return (
                  <section
                    key={stepRef.stepRefId}
                    className="overflow-hidden rounded-md border bg-white"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">
                          {index + 1}. {stepRef.stepLabel?.trim() || stepTemplate.name}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                          <span>{stepRef.stepRefId}</span>
                          <span>{stepTemplate.id}</span>
                        </div>
                      </div>
                      <Button
                        disabled={saving}
                        size="sm"
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setDraft((current) =>
                            resetFlowStepDefaults(current, stepRef.stepRefId, stepTemplate),
                          );
                          setError(null);
                        }}
                      >
                        <RotateCcw />
                        Reset to process-step defaults
                      </Button>
                    </div>
                    {definitions.length > 0 ? (
                      <div className="divide-y">
                        {definitions.map((definition) => {
                          const enabled = hasFlowParameterDefault(stepRef, definition.id);
                          return (
                            <div key={definition.id} className="space-y-3 px-4 py-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium">{definition.name}</div>
                                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                                    {definition.id}
                                  </div>
                                </div>
                                <label className="flex items-center gap-2 text-xs font-medium">
                                  <input
                                    checked={enabled}
                                    disabled={saving}
                                    type="checkbox"
                                    onChange={(event) =>
                                      toggleDefault(
                                        stepRef.stepRefId,
                                        definition,
                                        event.target.checked,
                                      )
                                    }
                                  />
                                  Use flow default
                                </label>
                              </div>
                              <ParameterValueEditor
                                definitions={[definition]}
                                disabled={saving || !enabled}
                                values={
                                  enabled
                                    ? {
                                        [definition.id]:
                                          stepRef.parameterDefaults?.[definition.id],
                                      }
                                    : {}
                                }
                                onChange={(values) =>
                                  updateDefault(stepRef.stepRefId, definition.id, values)
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                        This step has no scalar parameters available as flow defaults.
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </section>

          {error ? (
            <p
              aria-live="polite"
              className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t bg-white px-5 py-3">
          <Button disabled={saving} type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSave} type="submit">
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function MetadataInput({
  label,
  value,
  disabled,
  autoFocus,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <input
        autoFocus={autoFocus}
        className={inputClass}
        disabled={disabled}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
