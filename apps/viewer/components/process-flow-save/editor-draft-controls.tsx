"use client";

import * as React from "react";
import { FileClock, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteEditorDraft, getEditorDraft, listEditorDrafts, saveEditorDraft,
  type EditorDraftKind,
} from "@/lib/process-flow-api";
import type { EditorDraft, EditorDraftSummary, InstanceEditorDraftState, TemplateEditorDraftState } from "@/lib/process-flow/types";
import { assertDraftVersion, draftFingerprint } from "@/lib/process-flow/editor-drafts";

type State = InstanceEditorDraftState | TemplateEditorDraftState;
const inputClass = "h-9 w-full rounded-md border border-input bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function useEditorDrafts({ kind, templateId, state, enabled, saveDisabled, busy: parentBusy, onLoad }: {
  kind: EditorDraftKind; templateId?: string; state: State; enabled: boolean;
  saveDisabled?: boolean; busy?: boolean; onLoad: (draft: EditorDraft) => State;
}) {
  const fingerprint = draftFingerprint(state);
  const [baseline, setBaseline] = React.useState(fingerprint);
  const initialized = React.useRef(false);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const [active, setActive] = React.useState<EditorDraft | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [user, setUser] = React.useState("");
  const [name, setName] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [userFilter, setUserFilter] = React.useState("");
  const [rows, setRows] = React.useState<EditorDraftSummary[]>([]);
  const [working, setWorking] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const dirty = enabled && initialized.current && baseline !== fingerprint;
  const busy = working || Boolean(parentBusy);
  const requestVersion = React.useRef(0);
  const saveTrigger = React.useRef<HTMLButtonElement>(null);
  const pickerTrigger = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (enabled && !initialized.current) {
      initialized.current = true;
      setBaseline(draftFingerprint(stateRef.current));
    }
  }, [enabled]);

  React.useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  React.useEffect(() => {
    if (!pickerOpen) return;
    let current = true;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    listEditorDrafts(kind, { templateId }).then((items) => {
      if (current && version === requestVersion.current) setRows(items);
    }).catch((cause) => { if (current && version === requestVersion.current) setError(errorMessage(cause)); })
      .finally(() => { if (current && version === requestVersion.current) setLoading(false); });
    return () => { current = false; };
  }, [pickerOpen, kind, templateId]);

  async function refresh() {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const items = await listEditorDrafts(kind, { templateId, user: userFilter.trim(), search: search.trim() });
      if (version === requestVersion.current) setRows(items);
    } catch (cause) { if (version === requestVersion.current) setError(errorMessage(cause)); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }

  async function save(asNew = false) {
    if (busy) return;
    if (!user.trim() || !name.trim()) { setError("User and draft name are required."); return; }
    const captured = structuredClone(stateRef.current);
    setWorking(true);
    setError(null);
    try {
      const identity = { schemaVersion: 1 as const, user: user.trim(), name: name.trim() };
      if (kind === "template" && !("nodes" in captured)) throw new Error("Template snapshot is missing its graph.");
      const body = kind === "instance"
        ? { ...identity, state: captured, processFlowTemplateId: templateId! }
        : { ...identity, state: captured as TemplateEditorDraftState };
      const saved = await saveEditorDraft(kind, body, !asNew && active ? active : undefined);
      setActive(saved);
      setBaseline(draftFingerprint(captured));
      setSaveOpen(false);
      setNotice(`Draft "${saved.name}" saved at ${new Date(saved.updatedAt).toLocaleString()}.`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setWorking(false); }
  }

  async function load(row: EditorDraftSummary) {
    if (busy) return;
    setWorking(true);
    setError(null);
    try {
      const draft = await getEditorDraft(kind, row.id, templateId);
      assertDraftVersion(draft);
      if (draftFingerprint(stateRef.current) !== baseline && !window.confirm("Discard changes since the last saved draft?")) return;
      const restored = onLoad(draft);
      setActive(draft);
      setUser(draft.user);
      setName(draft.name);
      setBaseline(draftFingerprint(restored));
      setPickerOpen(false);
      setNotice(`Draft "${draft.name}" loaded.`);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setWorking(false); }
  }

  async function remove(row: EditorDraftSummary) {
    if (busy || !window.confirm(`Delete draft "${row.name}"?`)) return;
    setWorking(true);
    setError(null);
    try {
      await deleteEditorDraft(kind, row, templateId);
      setRows((items) => items.filter((item) => item.id !== row.id));
      if (active?.id === row.id) {
        setActive(null);
        setBaseline("");
        setNotice("Draft deleted. Editor contents remain available to save as a new draft.");
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setWorking(false); }
  }

  function detach() { setActive(null); setName(""); setNotice(null); }
  function markClean(captured: State = stateRef.current) { setBaseline(draftFingerprint(captured)); }
  function confirmReplace() { return !dirty || window.confirm("Discard changes since the last save?"); }

  const controls = <>
    <Button ref={saveTrigger} type="button" variant="outline" size="sm" disabled={!enabled || busy || saveDisabled}
      onClick={() => { setError(null); setSaveOpen(true); }}><Save />Save Draft</Button>
    <Button ref={pickerTrigger} type="button" variant="outline" size="sm" disabled={!enabled || busy}
      onClick={() => { setSearch(""); setUserFilter(""); setPickerOpen(true); }}><FileClock />From Draft</Button>
    {saveOpen ? <DraftModal title={active ? "Update draft" : "Save draft"} busy={busy} returnFocus={saveTrigger} onClose={() => setSaveOpen(false)}>
      <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="text-sm text-muted-foreground">Save your current progress. Draft information is separate from the final record.</p>
        <label className="block space-y-1 text-sm">User<input autoFocus required className={inputClass} value={user} disabled={busy} onChange={(event) => setUser(event.target.value)} /></label>
        <label className="block space-y-1 text-sm">Draft name<input required className={inputClass} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setSaveOpen(false)}>Cancel</Button>
          {active ? <Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>Save as New Draft</Button> : null}
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Draft"}</Button>
        </div>
      </form>
    </DraftModal> : null}
    {pickerOpen ? <DraftModal title="From Draft" busy={busy} returnFocus={pickerTrigger} onClose={() => setPickerOpen(false)}>
      <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void refresh(); }}>
        <label className="min-w-0 flex-1 space-y-1 text-sm">Search<input autoFocus className={inputClass} placeholder="Name or user" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="w-40 space-y-1 text-sm">User<input className={inputClass} placeholder="All users" value={userFilter} onChange={(event) => setUserFilter(event.target.value)} /></label>
        <Button type="submit" variant="outline" disabled={loading || busy}>Search</Button>
      </form>
      {error ? <p role="alert" className="mb-3 text-sm text-destructive">{error}</p> : null}
      {loading ? <p role="status" className="text-sm">Loading drafts…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No drafts found.</p> :
        <ul className="space-y-2">{rows.map((row) => <li key={row.id} className="flex items-center gap-3 rounded-md border p-3">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{row.name}</p><p className="break-words text-xs text-muted-foreground">{row.user} · {new Date(row.updatedAt).toLocaleString()}</p></div>
          <Button type="button" size="sm" disabled={busy} onClick={() => void load(row)}>Load</Button>
          <Button type="button" size="icon" variant="ghost" aria-label={`Delete draft ${row.name}`} disabled={busy} onClick={() => void remove(row)}><Trash2 /></Button>
        </li>)}</ul>}
    </DraftModal> : null}
  </>;
  const status = dirty && active ? `Draft "${active.name}" has unsaved changes.` : notice;
  return { active, dirty, controls, notice: status, busy, detach, markClean, confirmReplace };
}

function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : "Unable to access drafts."; }

function DraftModal({ title, busy, onClose, children, returnFocus }: { title: string; busy: boolean; onClose: () => void; children: React.ReactNode; returnFocus: React.RefObject<HTMLButtonElement> }) {
  const titleId = React.useId();
  const panel = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const previous = returnFocus.current ?? document.activeElement as HTMLElement | null;
    (panel.current?.querySelector<HTMLElement>("input") ?? panel.current?.querySelector<HTMLElement>("button"))?.focus();
    return () => previous?.focus();
  }, [returnFocus]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
    onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId}
      className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border bg-white p-5 shadow-xl"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
        if (event.key !== "Tab") return;
        const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']") ?? []);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <header className="mb-4 flex items-center justify-between"><h2 id={titleId} className="text-lg font-semibold">{title}</h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Close draft dialog" disabled={busy} onClick={onClose}><X /></Button></header>
      {children}
    </div>
  </div>;
}
