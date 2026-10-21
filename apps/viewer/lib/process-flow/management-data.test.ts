import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type BootstrapPayload } from "@/lib/process-flow-api";
import type { EditorDraftSummary } from "./types";
import { deleteManagementResource, loadManagementData, managementDataFromBootstrap, removeManagementResource } from "./management-data";

afterEach(() => vi.unstubAllGlobals());
const bootstrap: BootstrapPayload = {
  processFlowTemplates: ["a", "b"].map((id) => ({ id, name: id })) as BootstrapPayload["processFlowTemplates"],
  processFlowInstances: [], processStepTemplates: [], geometries: [], geometryGenerators: [],
};
function draft(id: string, updatedAt: string): EditorDraftSummary {
  return { schemaVersion: 1, id, name: id, user: "engineer", revision: 3, createdAt: updatedAt, updatedAt };
}

describe("management template drafts", () => {
  it("loads only template drafts, sorted newest first", async () => {
    const fetch = vi.fn(async (input: string) => {
      if (input.endsWith("/bootstrap")) return Response.json(bootstrap);
      expect(new URL(input).pathname).toBe("/api/process-flow-template-drafts");
      return Response.json([draft("old", "2026-10-12T00:00:00Z"), draft("new", "2026-10-13T00:00:00Z")]);
    });
    vi.stubGlobal("fetch", fetch);
    const data = await loadManagementData();
    expect(data.processFlowTemplateDrafts.map((item) => item.id)).toEqual(["new", "old"]);
    expect(data).not.toHaveProperty("processFlowInstanceDrafts");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("still loads drafts without formal templates", async () => {
    const saved = draft("unfinished", "2026-10-13T00:00:00Z");
    vi.stubGlobal("fetch", vi.fn(async (input: string) => Response.json(input.endsWith("/bootstrap") ? { ...bootstrap, processFlowTemplates: [] } : [saved])));
    expect((await loadManagementData()).processFlowTemplateDrafts).toEqual([saved]);
  });
  it("does not return partial data on failed listing", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => input.endsWith("/bootstrap") ? Response.json(bootstrap) : Response.json({ message: "List unavailable" }, { status: 500 })));
    await expect(loadManagementData()).rejects.toMatchObject({ status: 500, message: "List unavailable" });
  });
  it("sends the current revision when deleting a template draft", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await deleteManagementResource({ collection: "processFlowTemplateDrafts", resource: draft("id/with space", "2026-10-13T00:00:00Z") });
    expect(fetch.mock.calls[0][0]).toContain("process-flow-template-drafts/id%2Fwith%20space?revision=3");
  });
  it.each([404, 409, 500])("preserves server errors (%s)", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Draft changed" }, { status })));
    const deletion = deleteManagementResource({ collection: "processFlowTemplateDrafts", resource: draft("id", "2026-10-13T00:00:00Z") });
    await expect(deletion).rejects.toBeInstanceOf(ApiRequestError);
    await expect(deletion).rejects.toMatchObject({ status, message: "Draft changed" });
  });
  it("removes only the selected resource and resets the template draft list", () => {
    const selected = draft("selected", "2026-10-13T00:00:00Z"), other = draft("other", selected.updatedAt);
    const data = { ...managementDataFromBootstrap(bootstrap), processFlowTemplateDrafts: [selected, other] };
    const updated = removeManagementResource(data, { collection: "processFlowTemplateDrafts", resource: selected });
    expect(updated.processFlowTemplateDrafts).toEqual([other]);
    expect(data.processFlowTemplateDrafts).toHaveLength(2);
    expect(updated.processFlowTemplates).toBe(data.processFlowTemplates);
    expect(managementDataFromBootstrap(bootstrap)).toEqual({ ...bootstrap, processFlowTemplateDrafts: [] });
  });
});
