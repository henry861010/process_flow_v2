'use client';
import * as React from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DataValues, ProcessStepTemplate, RecipeCandidate } from '@/lib/process-flow/types';
import { dataValueIssue, fieldInputValue, loadFieldTemplate, writeDataField, type DataSaveIdentity } from '@/lib/process-flow/data-fields';
import { DataFieldForm, dataInputClass } from './data-field-form';

export type RecipeDataTools = {
  draftIdentityRequired: boolean;
  save: (stepId: string, recipe: RecipeCandidate, values: DataValues, fieldsRevision: number, identity: DataSaveIdentity) => Promise<void>;
  updateTemplate: (template: ProcessStepTemplate) => void;
};
export function RecipeDataFields({ template, recipe, stepId, tools, onSaved, onBusyChange }: {
  template: ProcessStepTemplate; recipe: RecipeCandidate; stepId: string; tools?: RecipeDataTools;
  onSaved: (values: DataValues) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [current, setCurrent] = React.useState(template);
  const [values, setValues] = React.useState<DataValues>(() => ({ ...recipe.dataValues }));
  const [inputText, setInputText] = React.useState<Record<string, string>>({});
  const [adding, setAdding] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [identity, setIdentity] = React.useState({ actor: '', draftName: 'Collected process data' });
  const version = React.useRef(0);
  const toolsRef = React.useRef(tools); toolsRef.current = tools;
  const busyRef = React.useRef(false);
  React.useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const refresh = React.useCallback(async () => {
    if (busyRef.current) return;
    const request = ++version.current;
    setLoading(true);
    try {
      const next = await loadFieldTemplate(template.id);
      if (request !== version.current) return;
      setCurrent(next); toolsRef.current?.updateTemplate(next); setError(null);
    } catch (cause) { if (request === version.current) setError(cause instanceof Error ? cause.message : 'Unable to load fields. Retry refresh.'); }
    finally { if (request === version.current) setLoading(false); }
  }, [template.id]);
  React.useEffect(() => {
    void refresh();
    const focus = () => { void refresh(); };
    const cancelPending = () => { version.current++; };
    window.addEventListener('focus', focus);
    try { setIdentity((v) => ({ ...v, actor: localStorage.getItem('data-field-actor') ?? '' })); } catch { /* optional */ }
    return () => { cancelPending(); window.removeEventListener('focus', focus); };
  }, [refresh]);
  const fields = current.dataFieldDefinitions ?? [];
  const unknown = Object.keys(values).filter((id) => !fields.some((field) => field.id === id));
  const invalid = fields.some((field) => field.status === 'formal' && dataValueIssue(field, values[field.id]));
  function change(id: string, value: string | number | boolean) {
    setValues((old) => { const next = { ...old }; if (value === '') delete next[id]; else next[id] = value; return next; });
    setNotice(null);
  }
  async function save() {
    if (!tools || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await tools.save(stepId, recipe, values, current.dataFieldsRevision ?? 1, identity);
      onSaved(values); setNotice('Saved to database. Closing this recipe does not undo saved data.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save data. Retry.'); }
    finally { busyRef.current = false; setBusy(false); }
  }
  return <section aria-label="Recipe data fields" className="space-y-4 border-t pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Data fields</h3><div className="flex gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw aria-hidden="true" />Refresh fields</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy || loading || adding} onClick={() => setAdding(true)}><Plus aria-hidden="true" />Add data field</Button>
    </div></div>
    <p className="text-xs text-muted-foreground">Shared with every recipe using this process step. Proposed specifications may change or be removed. These fields only collect data.</p>
    {loading && <p role="status" className="text-sm">Loading fields…</p>}
    {adding && <DataFieldForm busy={busy} names={fields.map((field) => field.name)} onCancel={() => setAdding(false)} onSubmit={async (spec, actor) => {
      busyRef.current = true; setBusy(true);
      try {
        const next = await writeDataField(template.id, spec, current.dataFieldsRevision ?? 1, actor);
        setCurrent(next); tools?.updateTemplate(next); setAdding(false); setNotice('Shared proposed field saved to database. You can now enter a value.');
      } finally { busyRef.current = false; setBusy(false); }
    }} />}
    {!loading && !fields.length && <p className="text-sm text-muted-foreground">No data fields yet. Add a field to record additional recipe details.</p>}
    {fields.map((field) => {
      const value = values[field.id]; const issue = dataValueIssue(field, value);
      const id = `data-value-${field.id}`;
      return <div key={field.id} className="space-y-1">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">{field.name}<Badge variant="outline">{field.status === 'proposed' ? 'Proposed' : 'Formal'}</Badge></label>
        <div className="flex items-center gap-2">{field.valueType === 'boolean' ? <select id={id} className={dataInputClass} value={value === undefined ? '' : String(value)} disabled={busy} aria-describedby={issue ? `${id}-issue` : undefined} onChange={(e) => change(field.id, e.target.value === '' ? '' : e.target.value === 'true')}>
          <option value="">Not set</option><option value="true">True</option><option value="false">False</option>
          {value !== undefined && typeof value !== 'boolean' && <option value={String(value)}>{String(value)} (invalid)</option>}
        </select> : <input id={id} className={dataInputClass} value={inputText[field.id] ?? (value === undefined ? '' : String(value))} inputMode={field.valueType === 'string' ? 'text' : 'decimal'} disabled={busy} aria-describedby={issue ? `${id}-issue` : undefined} onChange={(e) => { setInputText((old) => ({ ...old, [field.id]: e.target.value })); change(field.id, fieldInputValue(field, e.target.value)); }} />}
        {field.unit && <span className="text-sm">{field.unit}</span>}</div>
        {(field.min != null || field.max != null) && <p className="text-xs text-muted-foreground">Range: {field.min ?? '−∞'} – {field.max ?? '∞'}</p>}
        {issue && <p id={`${id}-issue`} className={`text-xs ${field.status === 'formal' ? 'text-destructive' : 'text-amber-800'}`}>{issue}. {field.status === 'proposed' ? 'Original value can still be saved for review.' : 'Correct this value before saving.'}</p>}
      </div>;
    })}
    {unknown.map((id) => <div key={id} role="alert" className="text-sm text-destructive">A field was removed. Unsaved value: {String(values[id])}. <Button type="button" variant="outline" size="sm" onClick={() => change(id, '')}>Discard removed field value</Button></div>)}
    {tools?.draftIdentityRequired && <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
      <p className="text-xs text-muted-foreground sm:col-span-2">This new flow will first be saved as a draft, including the current recipe.</p>
      <label className="text-sm">Your name<input className={dataInputClass} value={identity.actor} onChange={(e) => setIdentity({ ...identity, actor: e.target.value })} /></label>
      <label className="text-sm">Draft name<input className={dataInputClass} value={identity.draftName} onChange={(e) => setIdentity({ ...identity, draftName: e.target.value })} /></label>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    <div className="flex justify-end"><Button type="button" disabled={!tools || busy || loading || invalid || unknown.length > 0 || (tools.draftIdentityRequired && (!identity.actor.trim() || !identity.draftName.trim()))} onClick={() => void save()}>{busy ? 'Saving…' : tools?.draftIdentityRequired ? 'Save draft and data' : 'Save data'}</Button></div>
  </section>;
}

export function RecipeDataSummary({ template, recipe }: { template: ProcessStepTemplate; recipe: RecipeCandidate }) {
  const fields = (template.dataFieldDefinitions ?? []).filter((field) => Object.hasOwn(recipe.dataValues ?? {}, field.id));
  if (!fields.length) return null;
  return <dl aria-label="Collected recipe data" className="mt-3 space-y-2 border-t pt-3 text-sm">{fields.map((field) => <div key={field.id}>
    <dt className="flex items-center gap-2 text-muted-foreground">{field.name}{field.status === 'proposed' && <Badge variant="outline">Proposed</Badge>}</dt>
    <dd className="break-words">{String(recipe.dataValues?.[field.id])}{field.unit ? ` ${field.unit}` : ''}</dd>
  </div>)}</dl>;
}
