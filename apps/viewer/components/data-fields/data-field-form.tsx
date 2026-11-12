'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { DataFieldSpec } from '@/lib/process-flow/types';

export const dataInputClass = 'h-9 w-full rounded-md border border-input bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
export function DataFieldForm({ initial, busy, onSubmit, onCancel, names = [] }: {
  initial?: DataFieldSpec; busy: boolean; onSubmit: (spec: DataFieldSpec, actor: string) => Promise<void>;
  onCancel: () => void; names?: string[];
}) {
  const [spec, setSpec] = React.useState<DataFieldSpec>(initial ?? { name: '', valueType: 'string', reason: '', unit: '' });
  const [actor, setActor] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { try { setActor(localStorage.getItem('data-field-actor') ?? ''); } catch { /* storage optional */ } }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null);
    if (!spec.name.trim() || !spec.reason.trim()) { setError('Name and reason are required.'); return; }
    if (spec.min != null && spec.max != null && spec.min > spec.max) { setError('Minimum must not exceed maximum.'); return; }
    try {
      try { localStorage.setItem('data-field-actor', actor.trim()); } catch { /* storage optional */ }
      await onSubmit({ ...spec, name: spec.name.trim(), reason: spec.reason.trim() }, actor.trim() || 'unknown');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save field. Refresh fields and retry.'); }
  }
  const matches = spec.name.trim() ? names.filter((name) => name.toLowerCase().includes(spec.name.trim().toLowerCase())) : [];
  return <form onSubmit={(event) => void submit(event)} className="space-y-3 rounded-md border bg-muted/20 p-4" aria-label={initial ? 'Edit proposed field' : 'Add data field'}>
    <label className="block text-sm">Field name<input autoFocus required className={dataInputClass} value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} /></label>
    {matches.length > 0 && <p className="text-xs text-amber-800">Existing fields: {matches.join(', ')}. Cancel to use an existing field.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">Data type<select className={dataInputClass} value={spec.valueType} onChange={(e) => setSpec({ ...spec, valueType: e.target.value as DataFieldSpec['valueType'], min: undefined, max: undefined })}>
        <option value="string">Text</option><option value="integer">Integer</option><option value="float">Decimal</option><option value="boolean">Boolean</option>
      </select></label>
      <label className="block text-sm">Unit (optional)<input className={dataInputClass} value={spec.unit ?? ''} onChange={(e) => setSpec({ ...spec, unit: e.target.value })} /></label>
    </div>
    {(spec.valueType === 'integer' || spec.valueType === 'float') && <div className="grid grid-cols-2 gap-3">{(['min', 'max'] as const).map((key) => <label key={key} className="text-sm">{key === 'min' ? 'Minimum' : 'Maximum'} (optional)<input type="number" step="any" className={dataInputClass} value={spec[key] ?? ''} onChange={(e) => setSpec({ ...spec, [key]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>)}</div>}
    <label className="block text-sm">Why is this field needed?<textarea required className={`${dataInputClass} h-20 py-2`} value={spec.reason} onChange={(e) => setSpec({ ...spec, reason: e.target.value })} /></label>
    <label className="block text-sm">Your name (optional)<input className={dataInputClass} value={actor} onChange={(e) => setActor(e.target.value)} /></label>
    <p className="text-xs text-muted-foreground">This shared field is saved immediately, independently of recipe edits. Adding your name helps others follow up.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save field'}</Button></div>
  </form>;
}
