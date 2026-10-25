"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EditorDialog } from "./editor-dialog";
import type { EditorMetadata } from "@/lib/process-flow/types";
export type SaveInformationMode = "save" | "save-as";
export type FlowSaveInformation = EditorMetadata;

export function SaveInformationDialog({ mode, hasTarget, onModeChange, metadata, onChange,
  blockingIssues, configurationIssues, error, conflict, submitting, onReload, onClose, onSubmit }: {
  mode: SaveInformationMode; hasTarget: boolean; onModeChange: (mode: SaveInformationMode) => void;
  metadata: EditorMetadata; onChange: (patch: Partial<EditorMetadata>) => void;
  blockingIssues: string[]; configurationIssues: string[]; error: string | null; conflict: boolean;
  submitting: boolean; onReload: () => void; onClose: () => void; onSubmit: () => void;
}) {
  const invalid = !metadata.name.trim() || !metadata.version.trim() || !metadata.owner.trim();
  return <EditorDialog title="Save flow" description="Save the topology, geometry bindings and every recipe candidate."
    busy={submitting} onClose={onClose} footer={<>
      {conflict && hasTarget ? <Button variant="outline" onClick={onReload} disabled={submitting}>Reload saved flow</Button> : null}
      <Button variant="outline" disabled={submitting} onClick={onClose}>Cancel</Button>
      <Button disabled={submitting || invalid || blockingIssues.length > 0} onClick={onSubmit}>
        {submitting ? "Saving…" : mode === "save-as" ? "Save as new flow" : hasTarget ? "Update flow" : "Create flow"}
      </Button></>}>
    <div className="space-y-4 overflow-y-auto p-5">
      {hasTarget ? <fieldset className="flex gap-5"><legend className="mb-2 text-sm font-medium">Save destination</legend>
        {(["save", "save-as"] as const).map((value) => <label key={value} className="flex items-center gap-2 text-sm">
          <input type="radio" name="save-mode" value={value} checked={mode === value} disabled={submitting} onChange={() => onModeChange(value)} />
          {value === "save" ? "Update current flow" : "Save as new flow"}</label>)}
      </fieldset> : null}
      {(["name", "version", "owner", "description"] as const).map((key) => <label key={key} className="block text-sm font-medium">
        <span className="capitalize">{key}</span>{key !== "description" ? " *" : ""}
        {key === "description" ? <textarea className="mt-1 min-h-20 w-full rounded-md border bg-white p-2" value={metadata[key]} disabled={submitting} onChange={(e) => onChange({ [key]: e.target.value })} /> :
          <input className="mt-1 h-9 w-full rounded-md border bg-white px-3" value={metadata[key]} disabled={submitting} onChange={(e) => onChange({ [key]: e.target.value })} />}
      </label>)}
      {blockingIssues.length ? <ul role="alert" className="list-disc pl-5 text-sm text-destructive">{blockingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul> : null}
      {configurationIssues.length ? <p className="text-sm text-muted-foreground">This flow can be saved. {configurationIssues.length} configuration items still need attention before execution.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}{conflict ? " Your edits are preserved. Reload the saved flow or save these edits as a new flow with a different name or version." : ""}</p> : null}
    </div>
  </EditorDialog>;
}
