// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { RecipeDataFields, RecipeDataSummary } from './recipe-data-fields';
import { FieldReviewPanel } from './field-review-panel';
import * as api from '@/lib/process-flow/data-fields';
import type { DataFieldDefinition, ProcessStepTemplate, RecipeCandidate } from '@/lib/process-flow/types';
vi.mock('@/lib/process-flow/data-fields', async (original) => ({ ...await original<typeof api>(), loadFieldTemplate: vi.fn(), listFieldReviews: vi.fn(), getFieldReview: vi.fn(), writeDataField: vi.fn(), reviewDataField: vi.fn() }));
const field: DataFieldDefinition = { id: 'power', name: 'Plasma power', valueType: 'float', min: 0, max: 500, reason: 'Machine setup', unit: 'W', status: 'proposed', createdBy: 'Engineer', updatedBy: 'Engineer', createdAt: '2026-11-13T00:00:00Z', updatedAt: '2026-11-13T00:00:00Z' };
const template = { id: 'step', name: 'Etch', dataFieldsRevision: 2, dataFieldDefinitions: [field] } as ProcessStepTemplate;
const recipe: RecipeCandidate = { recipeId: 'r', name: 'Recipe', description: '', parameterValues: {} };
let root: Root; let host: HTMLDivElement;
function button(text: string) { const result = [...host.querySelectorAll('button')].find((el) => el.textContent === text); if (!result) throw new Error(`Missing button ${text}`); return result; }
async function click(element: HTMLElement) { await act(async () => { element.click(); }); }
async function input(element: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function render(element: React.ReactNode) { await act(async () => { root.render(element); }); }
beforeEach(() => {
  vi.clearAllMocks(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear();
  vi.mocked(api.loadFieldTemplate).mockResolvedValue(template); vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
describe('recipe data collection', () => {
  it('retains invalid proposed input on failure and retries without changing parameters', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValue(undefined); const onSaved = vi.fn();
    await render(<RecipeDataFields template={template} recipe={recipe} stepId="s" tools={{ draftIdentityRequired: false, save, updateTemplate: vi.fn() }} onSaved={onSaved} />);
    await input(host.querySelector('#data-value-power')!, 'approximately 150');
    expect(host.textContent).toContain('Original value can still be saved'); expect(button('Save data').disabled).toBe(false);
    await click(button('Save data')); expect(host.textContent).toContain('Network unavailable');
    expect((host.querySelector('#data-value-power') as HTMLInputElement).value).toBe('approximately 150'); expect(onSaved).not.toHaveBeenCalled();
    await click(button('Save data')); expect(save).toHaveBeenLastCalledWith('s', recipe, { power: 'approximately 150' }, 2, expect.any(Object));
    expect(onSaved).toHaveBeenCalledWith({ power: 'approximately 150' }); expect(host.textContent).toContain('Saved to database');
  });
  it('refreshes formal rules and blocks saving invalid values', async () => {
    const save = vi.fn();
    await render(<RecipeDataFields template={template} recipe={{ ...recipe, dataValues: { power: 'bad' } }} stepId="s" tools={{ draftIdentityRequired: false, save, updateTemplate: vi.fn() }} onSaved={vi.fn()} />);
    vi.mocked(api.loadFieldTemplate).mockResolvedValue({ ...template, dataFieldsRevision: 3, dataFieldDefinitions: [{ ...field, status: 'formal' }] });
    await click(button('Refresh fields')); expect(button('Save data').disabled).toBe(true);
    await input(host.querySelector('#data-value-power')!, '0'); expect(button('Save data').disabled).toBe(false);
    await click(button('Save data')); expect(save).toHaveBeenCalledWith('s', expect.anything(), { power: 0 }, 3, expect.anything());
  });
  it('keeps false visible and requires identity for the first draft save', async () => {
    const boolTemplate = { ...template, dataFieldDefinitions: [{ ...field, valueType: 'boolean' as const, min: undefined, max: undefined }] };
    await render(<RecipeDataSummary template={boolTemplate} recipe={{ ...recipe, dataValues: { power: false } }} />); expect(host.textContent).toContain('false');
    await render(<RecipeDataFields template={template} recipe={recipe} stepId="s" tools={{ draftIdentityRequired: true, save: vi.fn(), updateTemplate: vi.fn() }} onSaved={vi.fn()} />);
    expect(button('Save draft and data').disabled).toBe(true); expect(host.textContent).toContain('first be saved as a draft');
  });
});
describe('field review', () => {
  it('lists candidate and draft issues, and confirms removal using the reviewed snapshot', async () => {
    const review: api.FieldReview = { templateId: 'step', templateName: 'Etch', field, dataFieldsRevision: 2, reviewToken: 'snapshot', flowCount: 1, draftCount: 1, valueCount: 2, issueCount: 1,
      usages: [
        { kind: 'flow', id: 'flow', name: 'Production', revision: 2, stepRefId: 's', stepLabel: 'Etch', recipeId: 'alternative', recipeName: 'Alternative', value: 150, issue: null },
        { kind: 'draft', id: 'draft', name: 'Experiment', revision: 1, stepRefId: 's', stepLabel: 'Etch', recipeId: 'r', recipeName: 'Recipe', value: 'TBD', issue: 'Expected a finite number' },
      ] };
    vi.mocked(api.listFieldReviews).mockResolvedValue([review]); vi.mocked(api.getFieldReview).mockResolvedValue(review);
    vi.mocked(api.reviewDataField).mockResolvedValue({ ...template, dataFieldsRevision: 3, dataFieldDefinitions: [] });
    const updated = vi.fn(); await render(<FieldReviewPanel onTemplateUpdated={updated} />); await click(button('Edit'));
    expect(host.textContent).toContain('Alternative'); expect(host.textContent).toContain('Experiment');
    expect(host.querySelector('a[href*="draftId=draft"]')?.getAttribute('href')).toContain('recipeId=r');
    const actor = [...host.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Reviewer name'))!.querySelector('input')!;
    await input(actor, 'Reviewer'); expect(button('Approve as formal').disabled).toBe(true); await click(button('Delete field'));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 values across 1 flows and 1 drafts'));
    expect(api.reviewDataField).toHaveBeenCalledWith(review, 'Reviewer', 'remove'); expect(updated).toHaveBeenCalled(); expect(host.textContent).toContain('Field and all corresponding values removed');
  });
});
