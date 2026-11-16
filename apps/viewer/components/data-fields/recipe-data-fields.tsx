'use client';

import * as React from 'react';
import { ValueFieldRow, valueFieldInputClass, valueFieldSelectClass, valueFieldUnitClass } from '@/components/process-flow-parameters/value-field-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DataFieldDefinition, DataValues, ProcessStepTemplate, RecipeCandidate } from '@/lib/process-flow/types';
import { dataValueIssue, fieldInputValue, loadFieldTemplate } from '@/lib/process-flow/data-fields';

const proposedLabel = 'In proposed';

type FieldLoad = {
  visit: number;
  template?: ProcessStepTemplate;
  loading: boolean;
  error?: string;
  changed?: boolean;
};

export function useRecipeFieldTemplate(
  template: ProcessStepTemplate,
  visit: number | null,
  onTemplateUpdated?: (template: ProcessStepTemplate) => void,
) {
  const [state, setState] = React.useState<FieldLoad>();
  const sequence = React.useRef(0);
  const onUpdated = React.useRef(onTemplateUpdated);
  onUpdated.current = onTemplateUpdated;
  const invalidate = React.useCallback(() => { sequence.current++; }, []);

  const refresh = React.useCallback(async () => {
    if (visit === null) return;
    const request = ++sequence.current;
    setState((previous) => ({
      visit, template: previous?.visit === visit ? previous.template : undefined,
      changed: previous?.visit === visit && previous.changed,
      loading: true,
    }));
    try {
      const next = await loadFieldTemplate(template.id);
      if (request !== sequence.current) return;
      setState((previous) => {
        const earlier = previous?.visit === visit ? previous : undefined;
        const revisionChanged = earlier?.template &&
          (earlier.template.dataFieldsRevision ?? 1) !== (next.dataFieldsRevision ?? 1);
        return { visit, template: next, loading: false, changed: earlier?.changed || Boolean(revisionChanged) };
      });
      onUpdated.current?.(next);
    } catch (cause) {
      if (request !== sequence.current) return;
      const error = cause instanceof Error ? cause.message : 'Unable to load fields.';
      setState((previous) => ({ ...previous, visit, loading: false, error }));
    }
  }, [template.id, visit]);

  React.useEffect(() => {
    if (visit === null) return;
    const onFocus = () => { void refresh(); };
    void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      invalidate();
      window.removeEventListener('focus', onFocus);
    };
  }, [invalidate, refresh, visit]);

  const load = state?.visit === visit ? state : undefined;
  return {
    template: load?.template ?? template,
    confirmed: Boolean(load?.template),
    changed: load?.changed,
    loading: load?.loading ?? true,
    error: load?.error,
    refresh,
  };
}

export function RecipeDataFields({ fields, values, removed, onChange }: {
  fields: DataFieldDefinition[];
  values: DataValues;
  removed: string[];
  onChange: (id: string, value: DataValues[string]) => void;
}) {
  return <>
    {fields.map((field) => <RecipeDataInput key={field.id} field={field} value={values[field.id]}
      onChange={(value) => onChange(field.id, value)} />)}
    {removed.map((id) => <div key={id} className="flex flex-wrap items-center gap-2 p-4 text-sm text-destructive">
      <span role="alert">A field was removed. Entered value: {String(values[id])}.</span>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(id, '')}>Discard removed field value</Button>
    </div>)}
  </>;
}

function RecipeDataInput({ field, value, onChange }: {
  field: DataFieldDefinition;
  value: DataValues[string] | undefined;
  onChange: (value: DataValues[string]) => void;
}) {
  const [inputText, setInputText] = React.useState<string>();
  const id = `data-value-${field.id}`;
  const issue = dataValueIssue(field, value);
  const proposed = field.status === 'proposed';
  const hasRange = field.min != null || field.max != null;
  const description = [proposed && `${id}-status`, field.unit && `${id}-unit`, hasRange && `${id}-range`, issue && `${id}-issue`]
    .filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(issue && !proposed);
  const inputProps = { id, 'aria-invalid': invalid, 'aria-describedby': description };

  return <ValueFieldRow invalid={invalid} label={<>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <label htmlFor={id} className="min-w-0 break-words text-sm font-medium">{field.name}</label>
      {proposed && <Badge id={`${id}-status`} variant="outline" className="whitespace-nowrap py-0">{proposedLabel}</Badge>}
    </div>
    {hasRange && <p id={`${id}-range`} className="mt-1 font-mono text-[11px] text-muted-foreground">
      Range: {field.min ?? '−∞'} – {field.max ?? '∞'}
    </p>}
  </>}>
    <div className="flex items-center gap-2">
      {field.valueType === 'boolean' ? (
        <select {...inputProps} className={valueFieldSelectClass}
          value={value === undefined ? '' : typeof value === 'boolean' ? String(value) : 'invalid'}
          onChange={(event) => {
            if (event.target.value === 'invalid') return;
            setInputText(undefined);
            onChange(event.target.value === '' ? '' : event.target.value === 'true');
          }}>
          <option value="">Not set</option>
          <option value="true">True</option>
          <option value="false">False</option>
          {value !== undefined && typeof value !== 'boolean' && <option value="invalid">{String(value)} (invalid)</option>}
        </select>
      ) : (
        <input {...inputProps} className={valueFieldInputClass} value={inputText ?? (value === undefined ? '' : String(value))}
          inputMode={field.valueType === 'string' ? 'text' : 'decimal'}
          onChange={(event) => {
            setInputText(event.target.value);
            onChange(fieldInputValue(field, event.target.value));
          }} />
      )}
      {field.unit && <span id={`${id}-unit`} className={valueFieldUnitClass}>{field.unit}</span>}
    </div>
    {issue && <p id={`${id}-issue`} className={`mt-2 text-xs ${proposed ? 'text-amber-800' : 'text-destructive'}`}>
      {issue}. {proposed ? 'Original value can still be saved for review.' : 'Correct this value before saving.'}
    </p>}
  </ValueFieldRow>;
}

export function RecipeDataSummary({ template, recipe }: { template: ProcessStepTemplate; recipe: RecipeCandidate }) {
  const values = recipe.dataValues ?? {};
  const fields = (template.dataFieldDefinitions ?? [])
    .map((field) => ({ field, value: Object.hasOwn(values, field.id) ? values[field.id] : undefined }))
    .filter(({ field, value }) => field.status === 'proposed' || value !== undefined);
  if (!fields.length) return null;

  return (
    <dl aria-label="Collected recipe data" className="mt-3 space-y-2 border-t pt-3 text-sm">
      {fields.map(({ field, value }) => (
        <div key={field.id}>
          <dt className="flex flex-wrap items-center gap-2 text-muted-foreground">
            <span className="min-w-0 break-words">{field.name}</span>
            {field.status === 'proposed' && <Badge variant="outline" className="whitespace-nowrap">Proposed</Badge>}
          </dt>
          <dd className="break-words">
            {value === undefined ? 'Not set' : `${value}${field.unit ? ` ${field.unit}` : ''}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}
