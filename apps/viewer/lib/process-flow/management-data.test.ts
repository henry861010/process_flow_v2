import { afterEach, expect, it, vi } from "vitest";
import { deleteManagementResource, loadManagementData, removeManagementResource } from "./management-data";
import type { FlowDraftSummary, ProcessFlow } from "./types";
afterEach(() => vi.unstubAllGlobals());
it("loads all drafts without per-source queries", async () => {
  const bootstrap = { processFlows: [], processStepTemplates: [], geometries: [], geometryGenerators: [] };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(bootstrap)).mockResolvedValueOnce(Response.json([])); vi.stubGlobal("fetch", fetch);
  expect(await loadManagementData()).toEqual({ ...bootstrap, flowDrafts: [] }); expect(fetch).toHaveBeenCalledTimes(2);
});
it("sends revision on deletion and preserves derived records", async () => {
  const flow = { id: "flow", revision: 3 } as ProcessFlow;
  const child = { id: "child", revision: 1, origin: { flowId: "flow", revision: 1 } } as ProcessFlow;
  const draft = { id: "draft", revision: 2, target: { flowId: "flow", revision: 1 } } as FlowDraftSummary;
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", fetch);
  const target = { collection: "processFlows" as const, resource: flow };
  await deleteManagementResource(target);
  expect(fetch.mock.calls[0][0]).toContain("/api/process-flows/flow?revision=3");
  const result = removeManagementResource({ processFlows: [flow, child], flowDrafts: [draft], geometries: [], geometryGenerators: [], processStepTemplates: [] }, target);
  expect(result.processFlows).toEqual([child]); expect(result.flowDrafts).toEqual([draft]);
});
