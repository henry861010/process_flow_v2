import { apiFetch } from '@/lib/process-flow-api';
import type { DataFieldDefinition, DataFieldSpec, DataValues, FlowDraft, ProcessFlow, ProcessStepTemplate } from './types';

export type FieldUsage = {
  kind: 'flow' | 'draft'; id: string; name: string; revision: number;
  stepRefId: string; stepLabel: string; recipeId: string; recipeName: string;
  value: string | number | boolean; issue: string | null;
};
export type FieldReview = {
  templateId: string; templateName: string; field: DataFieldDefinition;
  dataFieldsRevision: number; reviewToken: string; usages: FieldUsage[];
  flowCount: number; draftCount: number; valueCount: number; issueCount: number;
};
export type DataSaveIdentity = { actor: string; draftName: string };
export function dataValueIssue(field: DataFieldDefinition, value: unknown): string | null {
  if (value === undefined || value === '') return null;
  if (field.valueType === 'string' && typeof value !== 'string') return 'Expected text';
  if (field.valueType === 'boolean' && typeof value !== 'boolean') return 'Expected true or false';
  if (field.valueType === 'integer' || field.valueType === 'float') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'Expected a finite number';
    if (field.valueType === 'integer' && !Number.isInteger(value)) return 'Expected an integer';
    if (field.min != null && value < field.min) return `Minimum is ${field.min}`;
    if (field.max != null && value > field.max) return `Maximum is ${field.max}`;
  }
  return null;
}
export function fieldInputValue(field: DataFieldDefinition, raw: string): string | number {
  if ((field.valueType === 'float' || field.valueType === 'integer') && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
  return raw;
}
const fieldPath = (templateId: string, fieldId?: string) => `/process-step-templates/${encodeURIComponent(templateId)}/data-fields${fieldId ? `/${encodeURIComponent(fieldId)}` : ''}`;
export const loadFieldTemplate = (id: string) => apiFetch<ProcessStepTemplate>(`/api/process-step-templates/${encodeURIComponent(id)}`);
export const listFieldReviews = () => apiFetch<FieldReview[]>('/api/data-field-reviews');
export const getFieldReview = (templateId: string, fieldId: string) => apiFetch<FieldReview>(`/api${fieldPath(templateId, fieldId)}/review`);
export function writeDataField(templateId: string, spec: DataFieldSpec, revision: number, actor: string, fieldId?: string) {
  return apiFetch<ProcessStepTemplate>(`/api${fieldPath(templateId, fieldId)}`, {
    method: fieldId ? 'PUT' : 'POST', body: JSON.stringify({ ...spec, revision, actor }),
  });
}
export function reviewDataField(review: FieldReview, actor: string, action: 'approve' | 'remove') {
  return apiFetch<ProcessStepTemplate>(`/api${fieldPath(review.templateId, review.field.id)}/${action}`, {
    method: 'POST', body: JSON.stringify({ actor, reviewToken: review.reviewToken }),
  });
}
export function saveRecipeData(kind: 'flow' | 'draft', document: { id: string; revision: number }, stepId: string, recipeId: string, dataFieldsRevision: number, dataValues: DataValues) {
  const collection = kind === 'flow' ? 'process-flows' : 'process-flow-drafts';
  return apiFetch<ProcessFlow | FlowDraft>(`/api/${collection}/${encodeURIComponent(document.id)}/steps/${encodeURIComponent(stepId)}/recipes/${encodeURIComponent(recipeId)}/data-values`, {
    method: 'PUT', body: JSON.stringify({ revision: document.revision, dataFieldsRevision, dataValues }),
  });
}
export function fieldUsageUrl(usage: FieldUsage) {
  return `/flow-editor?${new URLSearchParams({ [usage.kind === 'flow' ? 'flowId' : 'draftId']: usage.id, stepRefId: usage.stepRefId, recipeId: usage.recipeId })}`;
}
