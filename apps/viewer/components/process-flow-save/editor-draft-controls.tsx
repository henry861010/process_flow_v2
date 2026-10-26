"use client";

import * as React from "react";
import { ChevronDown, FileClock, Loader2, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorDialog } from "./editor-dialog";
import { cn } from "@/lib/utils";
import {
  deleteFlowDraft, getFlowDraft, listFlowDrafts, saveFlowDraft,
} from "@/lib/process-flow-api";
import type { FlowDraft, FlowDraftSummary, FlowOrigin, FlowDraftState } from "@/lib/process-flow/types";
import { assertDraftVersion, draftFingerprint } from "@/lib/process-flow/editor-drafts";

type State = FlowDraftState;
type Confirmation = { title: string; description: string; action: string; resolve: (accepted: boolean) => void };
const inputClass = "h-9 w-full rounded-md border border-input bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

export function useEditorDrafts({ target, origin, state, enabled, saveDisabled, busy: parentBusy, modern = false, onLoad, onSaved }: {
  target?: FlowOrigin; origin?: FlowOrigin; state: State; enabled: boolean;
  saveDisabled?: boolean; busy?: boolean; modern?: boolean; onLoad: (draft: FlowDraft) => State;
  onSaved?: (draft: FlowDraft) => void;
}) {
  const fingerprint = draftFingerprint(state);
  const [baseline, setBaseline] = React.useState(fingerprint);
  const initialized = React.useRef(false);
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const [active, setActive] = React.useState<FlowDraft | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [selectedDraftId, setSelectedDraftId] = React.useState<string | null>(null);
  const [user, setUser] = React.useState("");
  const [name, setName] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [userFilter, setUserFilter] = React.useState("");
  const [rows, setRows] = React.useState<FlowDraftSummary[]>([]);
  const [operation, setOperation] = React.useState<"save" | "load" | "delete" | null>(null);
  const operationRef = React.useRef(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  const [confirmation, setConfirmation] = React.useState<Confirmation | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menu = React.useRef<HTMLDivElement>(null);
  const saveTrigger = React.useRef<HTMLButtonElement>(null);
  const saveReturnFocus = React.useRef<HTMLElement | null>(null);
  const dirty = enabled && initialized.current && baseline !== fingerprint;
  const busy = operation !== null || Boolean(parentBusy);
  const requestVersion = React.useRef(0);
  const invalidateRequests = React.useCallback(() => { requestVersion.current++; }, []);

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
    if (!menuOpen) return;
    const buttons = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? []);
    buttons()[0]?.focus();
    const close = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node)) setMenuOpen(false); };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMenuOpen(false); menu.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = buttons();
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
      if (event.key === "Tab") setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    menu.current?.addEventListener("keydown", keys);
    const element = menu.current;
    return () => { document.removeEventListener("mousedown", close); element?.removeEventListener("keydown", keys); };
  }, [menuOpen]);

  React.useEffect(() => {
    if (!pickerOpen) return;
    let current = true;
    const version = ++requestVersion.current;
    setLoading(true); setError(null); setRows([]); setSelectedDraftId(null);
    setSearch(""); setUserFilter("");
    listFlowDrafts().then((items) => {
      if (current && version === requestVersion.current) setRows(items);
    }).catch((cause) => { if (current && version === requestVersion.current) setError(errorMessage(cause)); })
      .finally(() => { if (current && version === requestVersion.current) setLoading(false); });
    return () => { current = false; invalidateRequests(); };
  }, [pickerOpen, invalidateRequests]);

  async function refresh() {
    const version = ++requestVersion.current;
    setLoading(true); setError(null);
    try {
      const items = await listFlowDrafts({ user: userFilter.trim(), search: search.trim() });
      if (version === requestVersion.current) { setRows(items); setSelectedDraftId(null); }
    } catch (cause) { if (version === requestVersion.current) setError(errorMessage(cause)); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }

  function ask(title: string, description: string, action: string) {
    return new Promise<boolean>((resolve) => setConfirmation({ title, description, action, resolve }));
  }
  function answer(accepted: boolean) { confirmation?.resolve(accepted); setConfirmation(null); }
  async function confirmReplaceAsync(destination: string) {
    if (draftFingerprint(stateRef.current) === baseline) return true;
    return ask("Discard unsaved changes?", `Your changes have not been saved. ${destination}`, "Discard changes");
  }

  async function save(identityOverride?: { user: string; name: string }) {
    if (!enabled || target || saveDisabled || busy || operationRef.current) return;
    const identityValues = identityOverride ?? { user, name };
    if (!identityValues.user.trim() || !identityValues.name.trim()) { setError("User and draft name are required."); return; }
    const captured = structuredClone(stateRef.current);
    operationRef.current = true; setOperation("save"); setError(null);
    try {
      const body = { schemaVersion: 2 as const, user: identityValues.user.trim(), name: identityValues.name.trim(),
        state: captured, ...(origin ? { origin } : {}) };
      const saved = await saveFlowDraft(body, active ?? undefined);
      setActive(saved); setUser(saved.user); setName(saved.name);
      setBaseline(draftFingerprint(captured)); setLastSavedAt(saved.updatedAt);
      setSaveOpen(false);
      setNotice(`Draft "${saved.name}" saved at ${new Date(saved.updatedAt).toLocaleString()}.`);
      onSaved?.(saved);
    } catch (cause) { setError(errorMessage(cause)); }
    finally {
      operationRef.current = false; setOperation(null);
      if (modern && !saveOpen) requestAnimationFrame(() => {
        if (document.activeElement === document.body) saveTrigger.current?.focus();
      });
    }
  }

  async function load(row: Pick<FlowDraftSummary, "id">) {
    if (busy || operationRef.current) return false;
    operationRef.current = true; setOperation("load"); setError(null);
    try {
      const draft = await getFlowDraft(row.id);
      assertDraftVersion(draft);
      const accepted = modern
        ? await confirmReplaceAsync(`Resume draft "${draft.name}"?`)
        : draftFingerprint(stateRef.current) === baseline || window.confirm("Discard changes since the last saved draft?");
      if (!accepted) return false;
      const restored = onLoad(draft);
      setActive(draft); setUser(draft.user); setName(draft.name);
      setBaseline(draftFingerprint(restored)); setLastSavedAt(draft.updatedAt);
      setPickerOpen(false); setNotice(`Draft "${draft.name}" loaded.`);
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
    finally { operationRef.current = false; setOperation(null); }
  }

  async function remove(row: FlowDraftSummary) {
    if (busy || operationRef.current) return;
    operationRef.current = true; setOperation("delete");
    try {
      const accepted = modern
        ? await ask(`Delete draft "${row.name}"?`, "This deletes the saved draft. Your current editor contents will remain available.", "Delete draft")
        : window.confirm(`Delete draft "${row.name}"?`);
      if (!accepted) return;
      setError(null);
      await deleteFlowDraft(row);
      setRows((items) => items.filter((item) => item.id !== row.id));
      if (selectedDraftId === row.id) setSelectedDraftId(null);
      if (active?.id === row.id) {
        setActive(null); setBaseline(""); setLastSavedAt(null);
        setNotice("Draft deleted. Editor contents remain available to save as a draft.");
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { operationRef.current = false; setOperation(null); }
  }

  function detach() { setActive(null); setName(""); setNotice(null); setLastSavedAt(null); setError(null); }
  const markClean = React.useCallback((captured: State = stateRef.current) => {
    setBaseline(draftFingerprint(captured));
  }, []);
  function confirmReplace() { return !dirty || window.confirm("Discard changes since the last save?"); }
  function openSave() {
    if (target) return;
    saveReturnFocus.current = menuOpen
      ? menu.current?.querySelector<HTMLButtonElement>("[aria-haspopup]") ?? saveTrigger.current
      : saveTrigger.current;
    setMenuOpen(false); setError(null);
    setUser(active?.user ?? user); setName(active?.name ?? name);
    setSaveOpen(true);
  }

  const saveControl = modern ? <div ref={menu} className="relative flex shrink-0">
    <Button ref={saveTrigger} type="button" variant="outline" className={active ? "rounded-r-none" : undefined}
      disabled={!enabled || Boolean(target) || busy || saveDisabled} onClick={() => active ? void save(active) : openSave()}>
      {operation === "save" ? <Loader2 className="animate-spin" /> : <Save className="hidden sm:block" />} {operation === "save" ? "Saving…" : "Save Draft"}
    </Button>
    {active ? <Button type="button" variant="outline" size="icon" className="-ml-px rounded-l-none" aria-haspopup="menu" aria-expanded={menuOpen}
      title="Draft options" aria-label="Draft options" disabled={!enabled || Boolean(target) || busy || saveDisabled} onClick={() => setMenuOpen(!menuOpen)}><ChevronDown /></Button> : null}
    {menuOpen ? <div role="menu" aria-label="Draft options" className="absolute right-0 top-full z-30 mt-2 w-56 rounded-md border bg-white p-1 shadow-lg">
      <button role="menuitem" className="w-full rounded px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted focus:outline-none" onClick={() => openSave()}>Edit draft details…</button>
    </div> : null}
  </div> : <Button ref={saveTrigger} type="button" variant="outline" size="sm" disabled={!enabled || Boolean(target) || busy || saveDisabled} onClick={() => openSave()}><Save />Save Draft</Button>;

  const selectedDraft = rows.find((row) => row.id === selectedDraftId) ?? null;
  const sortedRows = [...rows].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const pickerContent = <>
    <form className="flex shrink-0 flex-wrap items-end gap-2 border-b px-5 py-4" onSubmit={(event) => { event.preventDefault(); void refresh(); }}>
      <label className="min-w-[140px] flex-1 space-y-1 text-xs font-medium">Search<input data-autofocus className={inputClass} placeholder="Name or user" value={search} disabled={busy} onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="w-36 space-y-1 text-xs font-medium">User<input className={inputClass} placeholder="All users" value={userFilter} disabled={busy} onChange={(event) => setUserFilter(event.target.value)} /></label>
      <Button type="submit" variant="outline" disabled={loading || busy}>Search</Button>
    </form>
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
      {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {loading ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">Loading drafts…</p> : sortedRows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No drafts found.</p> :
        <ul className="space-y-2">{sortedRows.map((row) => <li key={row.id} className={cn("flex items-center gap-2 rounded-md border p-1", modern && selectedDraftId === row.id ? "border-primary bg-primary/5" : "border-border")}>
          <button type="button" disabled={busy} aria-pressed={modern ? selectedDraftId === row.id : undefined}
            className="min-w-0 flex-1 rounded p-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            onClick={() => modern ? setSelectedDraftId(row.id) : void load(row)}>
            <span className="block break-words text-sm font-medium">{row.name}</span>
            <span className="mt-1 block break-words text-xs text-muted-foreground">{row.user} · {new Date(row.updatedAt).toLocaleString()}</span>
          </button>
          {!modern ? <Button type="button" size="sm" disabled={busy} onClick={() => void load(row)}>Load</Button> : null}
          <Button type="button" size="icon" variant="ghost" title={`Delete draft ${row.name}`} aria-label={`Delete draft ${row.name}`} disabled={busy} onClick={() => void remove(row)}><Trash2 /></Button>
        </li>)}</ul>}
    </div>
  </>;

  const dialogContent = <>
    {saveOpen && !target ? <EditorDialog returnFocus={saveReturnFocus} title={active ? modern ? "Edit draft details" : "Update draft" : "Save draft"} busy={busy} onClose={() => setSaveOpen(false)}>
      <form className="min-h-0 overflow-y-auto" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">Preserve your complete editing progress, including geometry bindings, parameters and graph layout.</p>
          <label className="block space-y-1 text-sm">Draft name<input data-autofocus required className={inputClass} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block space-y-1 text-sm">User<input required className={inputClass} value={user} disabled={busy} onChange={(event) => setUser(event.target.value)} /></label>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setSaveOpen(false)}>Cancel</Button>
          <Button type="submit" disabled={busy}>{operation === "save" ? "Saving…" : "Save Draft"}</Button>
        </footer>
      </form>
    </EditorDialog> : null}
    {!modern && pickerOpen ? <EditorDialog title="From Draft" busy={busy} onClose={() => setPickerOpen(false)}>{pickerContent}</EditorDialog> : null}
    {confirmation ? <EditorDialog title={confirmation.title} description={confirmation.description} className="max-w-md" onClose={() => answer(false)}
      footer={<><Button data-autofocus type="button" variant="outline" onClick={() => answer(false)}>{confirmation.action === "Discard changes" ? "Keep editing" : "Cancel"}</Button>
        <Button type="button" variant="destructive" onClick={() => answer(true)}>{confirmation.action}</Button></>}><div /></EditorDialog> : null}
  </>;

  // Legacy callers keep the same two controls and embedded dialogs.
  const controls = <>{saveControl}<Button type="button" variant="outline" size="sm" disabled={!enabled || busy} onClick={() => setPickerOpen(true)}><FileClock />From Draft</Button>{dialogContent}</>;
  const status = dirty && active ? `Draft "${active.name}" has unsaved changes.` : notice;
  return {
    active, dirty, controls, saveControl, dialogs: dialogContent, notice: status, error, busy,
    saving: operation === "save", loading, lastSavedAt, detach, markClean, confirmReplace, confirmReplaceAsync,
    pickerContent, selectedDraft, setPickerOpen, load,
  };
}

function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : "Unable to access drafts."; }
