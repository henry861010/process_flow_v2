import type { EditorDraftSummary } from "./types";
import {
  deleteEditorDraft,
  deleteGeometry,
  deleteProcessFlowInstance,
  deleteProcessFlowTemplate,
  listEditorDrafts,
  loadBootstrap,
  type BootstrapPayload,
} from "@/lib/process-flow-api";

export type ManagementData = BootstrapPayload & {
  processFlowTemplateDrafts: EditorDraftSummary[];
};

export type ManagementDeletion =
  | { collection: "processFlowTemplates" | "processFlowInstances" | "geometries"; resource: { id: string; name: string } }
  | { collection: "processFlowTemplateDrafts"; resource: EditorDraftSummary };

export function managementDataFromBootstrap(payload: BootstrapPayload): ManagementData {
  return { ...payload, processFlowTemplateDrafts: [] };
}

function newestFirst(drafts: EditorDraftSummary[]) {
  return drafts.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

export async function loadManagementData(): Promise<ManagementData> {
  const [payload, templateDrafts] = await Promise.all([
    loadBootstrap(),
    listEditorDrafts("template", {}),
  ]);
  return {
    ...payload,
    processFlowTemplateDrafts: newestFirst(templateDrafts),
  };
}

export async function deleteManagementResource(target: ManagementDeletion): Promise<void> {
  const { resource } = target;
  switch (target.collection) {
    case "processFlowTemplates": return deleteProcessFlowTemplate(resource.id);
    case "processFlowInstances": return deleteProcessFlowInstance(resource.id);
    case "geometries": return deleteGeometry(resource.id);
    case "processFlowTemplateDrafts": return deleteEditorDraft("template", target.resource);

  }
}

export function removeManagementResource(data: ManagementData, target: ManagementDeletion): ManagementData {
  const updated = {
    ...data,
    [target.collection]: data[target.collection].filter((item) => item.id !== target.resource.id),
  };
  return updated;
}
