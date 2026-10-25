import type { FlowDraftSummary, ProcessFlow } from "./types";
import { deleteFlowDraft, deleteGeometry, deleteProcessFlow, listFlowDrafts, loadBootstrap, type BootstrapPayload } from "@/lib/process-flow-api";
export type ManagementData = BootstrapPayload & { flowDrafts: FlowDraftSummary[] };
export type ManagementDeletion =
  | { collection: "processFlows"; resource: ProcessFlow }
  | { collection: "geometries"; resource: { id: string; name: string } }
  | { collection: "flowDrafts"; resource: FlowDraftSummary };
export function managementDataFromBootstrap(payload: BootstrapPayload): ManagementData { return { ...payload, flowDrafts: [] }; }
export async function loadManagementData(): Promise<ManagementData> {
  const [payload, flowDrafts] = await Promise.all([loadBootstrap(), listFlowDrafts()]);
  return { ...payload, flowDrafts };
}
export async function deleteManagementResource(target: ManagementDeletion) {
  switch (target.collection) {
    case "processFlows": return deleteProcessFlow(target.resource);
    case "geometries": return deleteGeometry(target.resource.id);
    case "flowDrafts": return deleteFlowDraft(target.resource);
  }
}
export function removeManagementResource(data: ManagementData, target: ManagementDeletion): ManagementData {
  return { ...data, [target.collection]: data[target.collection].filter((item) => item.id !== target.resource.id) };
}
