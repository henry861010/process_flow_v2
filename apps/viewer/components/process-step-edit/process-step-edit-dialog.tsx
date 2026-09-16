"use client";

import * as React from "react";
import { Loader2, Pencil, Save, X } from "lucide-react";

import { ParameterValueEditor } from "@/components/process-flow-parameters/parameter-value-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createDefaultParameterValue } from "@/lib/process-flow/parameter-values";
import {
  clearProcessStepParameterDefault,
  hasParameterDefault,
  setProcessStepParameterDefault,
} from "@/lib/process-flow/process-step-update";
import type { ParameterDefinition, ProcessStepTemplate } from "@/lib/process-flow/types";
import { updateProcessStepTemplate } from "@/lib/process-flow-api";
import { clone } from "@/lib/process-flow/utils";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
const textareaClass =
  "min-h-[88px] w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:resize-none disabled:bg-muted disabled:text-muted-foreground";

export function ProcessStepEditDialog({
  template,
  onClose,
  onSaved,
}: {
  template: ProcessStepTemplate;
  onClose: () => void;
  onSaved: (template: ProcessStepTemplate) => void;
}) {
  const [draft, setDraft] = React.useState<ProcessStepTemplate>(() => clone(template));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const savingRef = React.useRef(saving);

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

  const canSave = Boolean(
    !saving && draft.owner.trim() && draft.category.trim() && draft.program.trim(),
  );

  function patchMetadata(patch: Partial<Pick<ProcessStepTemplate, "owner" | "category" | "program">>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  function toggleDefault(definition: ParameterDefinition, enabled: boolean) {
    setDraft((current) =>
      enabled
        ? setProcessStepParameterDefault(
            current,
            definition.id,
            createDefaultParameterValue(definition),
          )
        : clearProcessStepParameterDefault(current, definition.id),
    );
    setError(null);
  }

  function updateDefault(parameterId: string, values: Record<string, unknown>) {
    setDraft((current) =>
      setProcessStepParameterDefault(current, parameterId, values[parameterId]),
    );
    setError(null);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateProcessStepTemplate<ProcessStepTemplate>(draft.id, draft);
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update process step.");
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
        className="relative z-10 flex max-h-[calc(100vh-24px)] w-[min(880px,calc(100vw-24px))] flex-col overflow-hidden rounded-md border bg-background shadow-viewport sm:max-h-[calc(100vh-40px)]"
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
            aria-label="Close process step editor"
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
                Locked fields are shown for reference and cannot be changed.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MetadataInput label="ID" value={draft.id} disabled locked mono />
              <MetadataInput
                label="Schema version"
                value={String(draft.schemaVersion)}
                disabled
                locked
              />
              <MetadataInput label="Version" value={draft.version} disabled locked />
              <MetadataInput label="Name" value={draft.name} disabled locked />
              <MetadataInput
                autoFocus
                label="Owner"
                value={draft.owner}
                disabled={saving}
                onChange={(owner) => patchMetadata({ owner })}
              />
              <MetadataInput
                label="Category"
                value={draft.category}
                disabled={saving}
                onChange={(category) => patchMetadata({ category })}
              />
              <div className="sm:col-span-2">
                <MetadataInput
                  label="Program"
                  value={draft.program}
                  disabled={saving}
                  mono
                  onChange={(program) => patchMetadata({ program })}
                />
              </div>
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                <span className="flex items-center justify-between gap-2">
                  Description
                  <LockedLabel />
                </span>
                <textarea
                  className={textareaClass}
                  disabled
                  value={draft.description}
                  readOnly
                />
              </label>
            </div>
          </section>

          <section className="space-y-3 border-t pt-5">
            <div>
              <h3 className="text-sm font-semibold">Ports</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Input and output port definitions are locked.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <PortList title="Input ports" ports={draft.inputPorts} kind="input" />
              <PortList title="Output ports" ports={draft.outputPorts} kind="output" />
            </div>
          </section>

          <section className="space-y-3 border-t pt-5">
            <div>
              <h3 className="text-sm font-semibold">Parameter definitions and defaults</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Definitions are locked. Default values apply only when future process flows are
                created.
              </p>
            </div>
            {draft.parameterDefinitions.length > 0 ? (
              <div className="space-y-3">
                {draft.parameterDefinitions.map((definition) => {
                  const enabled = hasParameterDefault(definition);
                  return (
                    <section key={definition.id} className="overflow-hidden rounded-md border bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{definition.name}</div>
                          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {definition.id}
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-medium">
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={saving}
                            onChange={(event) => toggleDefault(definition, event.target.checked)}
                          />
                          Use default value
                        </label>
                      </div>
                      <ParameterDefinitionDetails definition={definition} />
                      <ParameterValueEditor
                        definitions={[definition]}
                        values={enabled ? { [definition.id]: definition.defaultValue } : {}}
                        disabled={saving || !enabled}
                        onChange={(values) => updateDefault(definition.id, values)}
                      />
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                This process step has no parameters.
              </div>
            )}
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
  locked = false,
  autoFocus,
  mono = false,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  locked?: boolean;
  autoFocus?: boolean;
  mono?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span className="flex items-center justify-between gap-2">
        {label}
        {locked ? <LockedLabel /> : null}
      </span>
      <input
        autoFocus={autoFocus}
        className={`${inputClass} ${mono ? "font-mono text-xs" : ""}`}
        disabled={disabled}
        readOnly={locked}
        required={!locked}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
      />
    </label>
  );
}

function LockedLabel() {
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      Locked
    </span>
  );
}

type PortDefinition =
  | ProcessStepTemplate["inputPorts"][number]
  | ProcessStepTemplate["outputPorts"][number];

function PortList({
  title,
  ports,
  kind,
}: {
  title: string;
  ports: PortDefinition[];
  kind: "input" | "output";
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{title}</span>
        <Badge variant="outline">{ports.length}</Badge>
      </div>
      {ports.length > 0 ? (
        <div className="space-y-3">
          {ports.map((port) => (
            <div key={port.portId} className="space-y-3 rounded-md border bg-white p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <ReadOnlyField label="Port ID" value={port.portId} mono />
                <ReadOnlyField label="Name" value={port.name} />
                <ReadOnlyField label="Data type" value={port.dataType} />
                {kind === "input" && "role" in port ? (
                  <ReadOnlyField label="Role" value={port.role} />
                ) : null}
              </div>
              {kind === "input" && "required" in port ? (
                <ReadOnlyBoolean label="Required" value={port.required} />
              ) : null}
              <ReadOnlyTextArea label="Description" value={port.description ?? ""} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No {title.toLowerCase()}.
        </div>
      )}
    </div>
  );
}

function ParameterDefinitionDetails({ definition }: { definition: ParameterDefinition }) {
  return (
    <div className="space-y-3 border-b bg-muted/10 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReadOnlyField label="Value type" value={definition.valueType} />
        <ReadOnlyField label="Control type" value={definition.controlType ?? "—"} />
        <ReadOnlyField label="Selection mode" value={definition.selectionMode ?? "—"} />
        <ReadOnlyField label="Unit" value={definition.unit ?? "—"} />
      </div>
      <ReadOnlyBoolean label="Required" value={definition.required ?? false} />
      <ReadOnlyTextArea label="Description" value={definition.description ?? ""} />
      <div className="grid gap-3 lg:grid-cols-2">
        <ReadOnlyJson label="Validation" value={definition.validation} />
        <ReadOnlyJson label="Options" value={definition.optionSource} />
        <ReadOnlyJson label="Repeat definition" value={definition.repeatDefinition} />
      </div>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      <span>{label}</span>
      <input
        className={`${inputClass} ${mono ? "font-mono text-xs" : ""}`}
        disabled
        readOnly
        value={value}
      />
    </label>
  );
}

function ReadOnlyTextArea({ label, value }: { label: string; value: string }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium">
      <span>{label}</span>
      <textarea className={textareaClass} disabled readOnly value={value || "—"} />
    </label>
  );
}

function ReadOnlyBoolean({ label, value }: { label: string; value: boolean }) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium">
      <input checked={value} disabled readOnly type="checkbox" />
      {label}
    </label>
  );
}

function ReadOnlyJson({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <div className="grid gap-1.5 text-xs font-medium">
      <span>{label}</span>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted px-3 py-2 font-mono text-[11px] font-normal text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
