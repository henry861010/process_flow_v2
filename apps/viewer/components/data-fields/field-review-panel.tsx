'use client';
import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EditorDialog } from '@/components/process-flow-save/editor-dialog';
import { fieldUsageUrl, getFieldReview, listFieldReviews, reviewDataField, writeDataField, type FieldReview } from '@/lib/process-flow/data-fields';
import type { ProcessStepTemplate } from '@/lib/process-flow/types';
import { DataFieldForm, dataInputClass } from './data-field-form';

export function FieldReviewPanel({ onTemplateUpdated }: { onTemplateUpdated: (template: ProcessStepTemplate) => void }) {
  const [rows, setRows] = React.useState<FieldReview[]>([]);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('proposed');
  const [step, setStep] = React.useState('');
  const [selected, setSelected] = React.useState<FieldReview | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [issuesOnly, setIssuesOnly] = React.useState(false);
  const [actor, setActor] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const requestVersion = React.useRef(0);
  const detailVersion = React.useRef(0);
  const actionRef = React.useRef(false);
  const refresh = React.useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    try { const next = await listFieldReviews(); if (version === requestVersion.current) { setRows(next); setError(null); } }
    catch (cause) { if (version === requestVersion.current) setError(cause instanceof Error ? cause.message : 'Unable to load field reviews.'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }, []);
  React.useEffect(() => {
    void refresh(); const focus = () => { if (!actionRef.current) void refresh(); };
    const cancelPending = () => { requestVersion.current++; detailVersion.current++; };
    window.addEventListener('focus', focus);
    try { setActor(localStorage.getItem('data-field-actor') ?? ''); } catch { /* optional */ }
    return () => { cancelPending(); window.removeEventListener('focus', focus); };
  }, [refresh]);
  async function open(row: FieldReview) {
    const version = ++detailVersion.current;
    setSelected(row); setEditing(false); setIssuesOnly(false); setDetailError(null); setBusy(true);
    try { const next = await getFieldReview(row.templateId, row.field.id); if (version === detailVersion.current) setSelected(next); }
    catch (cause) { if (version === detailVersion.current) setDetailError(cause instanceof Error ? cause.message : 'Unable to refresh review.'); }
    finally { if (version === detailVersion.current) setBusy(false); }
  }
  async function act(action: 'approve' | 'remove') {
    if (!selected || actionRef.current || !actor.trim()) return;
    if (action === 'remove' && !window.confirm(`Remove "${selected.field.name}"? This permanently removes the field and ${selected.valueCount} values across ${selected.flowCount} flows and ${selected.draftCount} drafts. There is no undo.`)) return;
    actionRef.current = true; setBusy(true); setDetailError(null);
    try {
      const template = await reviewDataField(selected, actor.trim(), action);
      onTemplateUpdated(template); setSelected(null);
      setNotice(action === 'remove' ? 'Field and all corresponding values removed.' : 'Field approved as formal.');
      await refresh();
    } catch (cause) { setDetailError(cause instanceof Error ? cause.message : 'Unable to update field. Refresh the review and retry.'); }
    finally { actionRef.current = false; setBusy(false); }
  }
  const filtered = rows.filter((row) => (!status || row.field.status === status) && (!step || row.templateId === step) &&
    `${row.field.name} ${row.field.reason} ${row.templateName}`.toLowerCase().includes(search.trim().toLowerCase()));
  const steps = [...new Map(rows.map((row) => [row.templateId, row.templateName])).entries()];
  return <section className="space-y-4 pt-3" aria-label="Field review">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Field review</h2><p className="text-sm text-muted-foreground">Review shared collection fields and every supplied value before approval.</p></div><Button variant="outline" disabled={loading || busy} onClick={() => void refresh()}>Refresh</Button></div>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm">Search fields or reasons<input className={dataInputClass} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      <label className="text-sm">Process step<select className={dataInputClass} value={step} onChange={(e) => setStep(e.target.value)}><option value="">All process steps</option>{steps.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="text-sm">Status<select className={dataInputClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="proposed">Proposed</option><option value="formal">Formal</option><option value="">All</option></select></label>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm text-primary">{notice}</p>}
    {loading && <p role="status" className="text-sm">Loading field reviews…</p>}
    <div className="overflow-x-auto rounded-md border bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Shared collection fields and usage counts</caption>
        <thead className="border-b bg-muted/40"><tr>
          {['Field', 'Process step', 'Type', 'Flows / drafts', 'Values', 'Issues', 'Actions'].map((title) =>
            <th key={title} className={`px-4 py-3${title === 'Actions' ? ' text-right' : ''}`}>{title}</th>)}
        </tr></thead>
        <tbody>
          {filtered.map((row) => <tr key={`${row.templateId}:${row.field.id}`} className="border-b last:border-0">
            <td className="px-4 py-3"><span className="font-medium">{row.field.name}</span>
              <div className="mt-1"><Badge variant="outline">{row.field.status === 'proposed' ? 'Proposed' : 'Formal'}</Badge></div>
            </td>
            <td className="px-4 py-3">{row.templateName}</td>
            <td className="px-4 py-3">{row.field.valueType}</td>
            <td className="px-4 py-3 tabular-nums">{row.flowCount} / {row.draftCount}</td>
            <td className="px-4 py-3 tabular-nums">{row.valueCount}</td>
            <td className="px-4 py-3 tabular-nums">{row.issueCount}</td>
            <td className="px-4 py-3 text-right align-top">
              <Button type="button" size="sm" variant="outline" disabled={busy}
                aria-label={`${row.field.status === 'proposed' ? 'Edit' : 'View'} ${row.field.name}`}
                onClick={() => void open(row)}>{row.field.status === 'proposed' ? 'Edit' : 'View'}</Button>
            </td>
          </tr>)}
          {!loading && !filtered.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No matching fields.</td></tr>}
        </tbody>
      </table>
    </div>
    {selected && <EditorDialog title={`${selected.field.status === 'proposed' ? 'Edit' : 'View'} ${selected.field.name}`} className="max-w-5xl" busy={busy} onClose={() => { if (!busy) { detailVersion.current++; setSelected(null); } }} footer={<>
      <Button variant="outline" disabled={busy} onClick={() => void open(selected)}>Refresh review</Button>
      {selected.field.status === 'proposed' && <><Button variant="destructive" disabled={busy || editing || !actor.trim()} onClick={() => void act('remove')}>Delete field</Button><Button disabled={busy || editing || Boolean(detailError) || selected.issueCount > 0 || !actor.trim()} onClick={() => void act('approve')}>Approve as formal</Button></>}
    </>}>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">{selected.field.status}</Badge><span className="text-sm">{selected.templateName}</span>{selected.field.status === 'proposed' && <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>Edit specification</Button>}</div>
        <p className="text-sm"><strong>Reason:</strong> {selected.field.reason}</p>
        <p className="text-sm text-muted-foreground">{selected.field.valueType} · Unit: {selected.field.unit || 'None'} · Range: {selected.field.min ?? '—'} to {selected.field.max ?? '—'}</p>
        <p className="text-xs text-muted-foreground">Proposed by {selected.field.createdBy} · {new Date(selected.field.createdAt).toLocaleString()}{selected.field.approvedBy ? ` · Approved by ${selected.field.approvedBy}` : ''}</p>
        {editing && <DataFieldForm key={selected.dataFieldsRevision} initial={{ name: selected.field.name, valueType: selected.field.valueType, reason: selected.field.reason, unit: selected.field.unit, min: selected.field.min, max: selected.field.max }} busy={busy} onCancel={() => setEditing(false)} onSubmit={async (spec, name) => {
          actionRef.current = true; setBusy(true);
          try { const template = await writeDataField(selected.templateId, spec, selected.dataFieldsRevision, name, selected.field.id); onTemplateUpdated(template); setEditing(false); await open(selected); await refresh(); }
          finally { actionRef.current = false; setBusy(false); }
        }} />}
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm">{selected.valueCount} values · {selected.flowCount} flows · {selected.draftCount} drafts · {selected.issueCount} issues</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} />Only values with issues</label></div>
        <div className="overflow-x-auto rounded-md border"><table className="w-full text-left text-sm"><thead className="border-b bg-muted/40"><tr>{['Source', 'Step / recipe', 'Original value', 'Validation'].map((title) => <th key={title} className="px-3 py-2">{title}</th>)}</tr></thead><tbody>{selected.usages.filter((u) => !issuesOnly || u.issue).map((u) => <tr key={`${u.kind}:${u.id}:${u.stepRefId}:${u.recipeId}`} className="border-b last:border-0"><td className="px-3 py-2"><Link className="text-primary underline" href={fieldUsageUrl(u)}>{u.name}</Link><p className="text-xs text-muted-foreground">{u.kind}</p></td><td className="px-3 py-2">{u.stepLabel}<p className="text-xs">{u.recipeName}</p></td><td className="max-w-72 break-words px-3 py-2 font-mono">{String(u.value)}</td><td className={`px-3 py-2 ${u.issue ? 'text-amber-800' : 'text-muted-foreground'}`}>{u.issue ?? 'Valid'}</td></tr>)}</tbody></table></div>
        {selected.issueCount > 0 && <p className="text-sm text-amber-800">Correct every invalid value before approval. Proposed values remain saved while you review.</p>}
        {selected.field.status === 'proposed' && <div>
          <label className="block text-sm">Reviewer name<input required className={dataInputClass} value={actor} onChange={(e) => setActor(e.target.value)} /></label>
          {!actor.trim() && <p className="mt-1 text-xs text-muted-foreground">Enter your name to enable approval or deletion.</p>}
        </div>}
        {detailError && <p role="alert" className="text-sm text-destructive">{detailError}</p>}
      </div>
    </EditorDialog>}
  </section>;
}
