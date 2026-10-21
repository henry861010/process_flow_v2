"use client";

import * as React from "react";
import { EditorDialog } from "@/components/process-flow-save/editor-dialog";
import { Button } from "@/components/ui/button";
import { createProcessFlowInstance } from "@/lib/process-flow-api";
import { buildProcessFlowInstanceCreate, configurationFromInstance, newInstanceIdentity } from "@/lib/process-flow/instance-editor";
import { isTemplateEnabled } from "@/lib/process-flow/template-availability";
import type { ProcessFlowInstance, ProcessFlowTemplate, ProcessStepTemplate } from "@/lib/process-flow/types";

const inputClass = "mt-2 min-h-10 w-full min-w-0 rounded-md border border-input bg-white px-3 py-2 text-sm leading-5 outline-none focus:ring-2 focus:ring-ring disabled:bg-muted";

export function CreateInstanceDialog({ templates, stepTemplates, returnFocus, onClose, onCreated }: {
  templates: ProcessFlowTemplate[];
  stepTemplates: ProcessStepTemplate[];
  returnFocus: React.RefObject<HTMLElement>;
  onClose: () => void;
  onCreated: (instance: ProcessFlowInstance, editAfterCreate: boolean) => void;
}) {
  const formId = React.useId();
  const [templateId, setTemplateId] = React.useState("");
  const [identity, setIdentity] = React.useState(newInstanceIdentity);
  const [attempted, setAttempted] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<"create" | "edit" | null>(null);
  const busy = pendingAction !== null;
  const inFlight = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const errorRef = React.useRef<HTMLParagraphElement>(null);
  const enabled = templates.filter(isTemplateEnabled);
  const selected = enabled.find((template) => template.id === templateId);

  React.useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);
  React.useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    setAttempted(true);
    const missing = Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[required]"))
      .find((field) => !field.value.trim());
    if (missing) { missing.focus(); return; }
    if (!selected) { setError("Choose an available template."); return; }
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const editAfterCreate = submitter?.value === "edit";
    inFlight.current = true;
    setPendingAction(editAfterCreate ? "edit" : "create");
    setError(null);
    try {
      const configuration = configurationFromInstance(selected, stepTemplates);
      const instance = await createProcessFlowInstance(buildProcessFlowInstanceCreate(selected.id, identity, configuration));
      onCreated(instance, editAfterCreate);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create instance.");
      inFlight.current = false;
      setPendingAction(null);
    }
  }

  return <EditorDialog title="Create Instance" description="Choose a template and enter the instance information."
    busy={busy} onClose={onClose} returnFocus={returnFocus} className="[&_footer_button]:min-h-10"
    footer={<><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" form={formId} name="action" value="create" disabled={busy || !enabled.length}>
        {pendingAction === "create" ? "Creating…" : "Create"}</Button>
      <Button type="submit" form={formId} name="action" value="edit" variant="outline" disabled={busy || !enabled.length}>
        {pendingAction === "edit" ? "Creating…" : "Create & Edit"}</Button></>}>
    <form id={formId} noValidate onSubmit={(event) => void submit(event)} className="min-h-0 space-y-5 overflow-y-auto p-5">
      {error ? <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-md bg-destructive/5 p-3 text-sm text-destructive [overflow-wrap:anywhere]">{error}</p> : null}
      <div>
        <label htmlFor={`${formId}-template`} className="text-sm font-medium">Template *</label>
        <select id={`${formId}-template`} name="templateId" required data-autofocus value={templateId}
          aria-invalid={attempted && !selected} aria-describedby={attempted && !selected ? `${formId}-template-error` : undefined}
          disabled={busy} onChange={(event) => setTemplateId(event.target.value)} className={inputClass}>
          <option value="">Choose a template</option>
          {enabled.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.version}</option>)}
        </select>
        {attempted && !selected ? <p id={`${formId}-template-error`} className="mt-1 text-xs text-destructive">Template is required.</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {([ ["name", "Name"], ["version", "Version"], ["owner", "Owner"] ] as const).map(([field, label]) => {
          const invalid = attempted && !identity[field].trim();
          return <div key={field} className={field === "name" ? "sm:col-span-2" : "min-w-0"}>
            <label htmlFor={`${formId}-${field}`} className="text-sm font-medium">{label} *</label>
            <input id={`${formId}-${field}`} name={field} required value={identity[field]} disabled={busy}
              aria-invalid={invalid} aria-describedby={invalid ? `${formId}-${field}-error` : undefined}
              onChange={(event) => setIdentity((current) => ({ ...current, [field]: event.target.value }))} className={inputClass} />
            {invalid ? <p id={`${formId}-${field}-error`} className="mt-1 text-xs text-destructive">{label} is required.</p> : null}
          </div>;
        })}
      </div>
      <div>
        <label htmlFor={`${formId}-description`} className="text-sm font-medium">Description</label>
        <textarea id={`${formId}-description`} name="description" rows={3} value={identity.description} disabled={busy}
          onChange={(event) => setIdentity((current) => ({ ...current, description: event.target.value }))} className={`${inputClass} resize-y`} />
      </div>
      <p className="text-sm leading-6 text-muted-foreground">Each station starts with an active recipe using template defaults. Geometry can be configured in the editor.</p>
    </form>
  </EditorDialog>;
}
