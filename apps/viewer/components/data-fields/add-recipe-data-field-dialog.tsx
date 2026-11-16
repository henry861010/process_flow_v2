"use client";

import * as React from "react";
import { EditorDialog } from "@/components/process-flow-save/editor-dialog";
import { Button } from "@/components/ui/button";
import { loadFieldTemplate, writeDataField } from "@/lib/process-flow/data-fields";
import { ApiRequestError } from "@/lib/process-flow-api";
import type { DataFieldSpec, ProcessStepTemplate } from "@/lib/process-flow/types";
import { DataFieldForm } from "./data-field-form";

export function AddRecipeDataFieldDialog({ templateId, returnFocus, onClose, onAdded }: {
  templateId: string;
  returnFocus: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onAdded: (template: ProcessStepTemplate) => void;
}) {
  const [fields, setFields] = React.useState<{ template: ProcessStepTemplate } | { error: string }>();
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const template = fields && "template" in fields ? fields.template : undefined;

  React.useEffect(() => {
    let active = true;
    void loadFieldTemplate(templateId).then(
      (template) => { if (active) setFields({ template }); },
      (error: unknown) => {
        if (active) setFields({ error: error instanceof Error ? error.message : "Unable to load shared fields." });
      },
    );
    return () => { active = false; };
  }, [templateId, loadAttempt]);

  function reloadFields() {
    setFields(undefined);
    setLoadAttempt((attempt) => attempt + 1);
  }

  function close() {
    if (!savingRef.current) onClose();
  }

  async function submit(spec: DataFieldSpec, actor: string) {
    if (!template || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const next = await writeDataField(templateId, spec, template.dataFieldsRevision ?? 1, actor);
      onAdded(next);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        reloadFields();
        if (error.message === "Fields changed. Refresh before saving.") {
          throw new Error("The shared fields changed. Review your entry and save again after the fields reload.");
        }
      }
      throw error;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <EditorDialog title="Add data field" description="Propose a shared field for recipes using this step template."
      className="max-w-lg" busy={saving} onClose={close} returnFocus={returnFocus}>
      <div className="min-h-0 space-y-4 overflow-y-auto p-5">
        {!fields && <p role="status" className="text-sm text-muted-foreground">Loading shared fields…</p>}
        {fields && "error" in fields && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="min-w-0 break-words text-sm text-destructive">{fields.error}</p>
            <Button type="button" size="sm" variant="outline" onClick={reloadFields}>Retry loading fields</Button>
          </div>
        )}
        <DataFieldForm busy={saving} submitDisabled={!template} names={template?.dataFieldDefinitions?.map((field) => field.name)}
          className="rounded-none border-0 bg-transparent p-0" onCancel={close} onSubmit={submit} />
      </div>
    </EditorDialog>
  );
}
