import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type BootstrapPayload } from "@/lib/process-flow-api";
import type { EditorDraftSummary } from "./types";
import { deleteManagementResource, loadManagementData, managementDataFromBootstrap, removeManagementResource } from "./management-data";

afterEach(() => vi.unstubAllGlobals());

const bootstrap: BootstrapPayload = {
  processFlowTemplates: ["a", "b"].map((id) => ({ id, name: id })) as BootstrapPayload["processFlowTemplates"],
  processFlowInstances: [], processStepTemplates: [], geometries: [], geometryGenerators: [],
};
function draft(id: string, updatedAt: string, processFlowTemplateId?: string): EditorDraftSummary {
  return { schemaVersion: 1, id, name: id, user: "engineer", revision: 3, createdAt: updatedAt, updatedAt, processFlowTemplateId };
}

describe("management draft loading", () => {
  it("collects summaries for every template without user filters and sorts both lists newest first", async () => {
    const older = "2026-10-12T00:00:00Z", newer = "2026-10-13T00:00:00Z";
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === "/api/bootstrap") return Response.json(bootstrap);
      expect(url.searchParams.has("user")).toBe(false);
      if (url.pathname === "/api/process-flow-template-drafts") {
        return Response.json([draft("t-old", older), draft("t-new", newer)]);
      }
      expect(url.pathname).toBe("/api/process-flow-instance-drafts");
      const templateId = url.searchParams.get("processFlowTemplateId");
      expect(["a", "b"]).toContain(templateId);
      return Response.json([draft(`i-${templateId}`, templateId === "a" ? older : newer, templateId!)]);
    });
    vi.stubGlobal("fetch", fetch);
    const data = await loadManagementData();
    expect(data.processFlowTemplateDrafts.map((item) => item.id)).toEqual(["t-new", "t-old"]);
    expect(data.processFlowInstanceDrafts.map((item) => item.id)).toEqual(["i-b", "i-a"]);
    expect(data.processFlowTemplates).toEqual(bootstrap.processFlowTemplates);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("still lists template drafts when no formal templates exist", async () => {
    const saved = draft("unfinished-template", "2026-10-13T00:00:00Z");
    const fetch = vi.fn(async (input: string) => Response.json(input.endsWith("/bootstrap")
      ? { ...bootstrap, processFlowTemplates: [] } : [saved]));
    vi.stubGlobal("fetch", fetch);
    const data = await loadManagementData();
    expect(data.processFlowTemplateDrafts).toEqual([saved]);
    expect(data.processFlowInstanceDrafts).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("fails the refresh instead of returning a partial snapshot if a scoped list fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (input.endsWith("/bootstrap")) return Response.json(bootstrap);
      if (input.includes("processFlowTemplateId=b")) return Response.json({ message: "List unavailable" }, { status: 500 });
      return Response.json([]);
    }));
    await expect(loadManagementData()).rejects.toMatchObject({ status: 500, message: "List unavailable" });
  });
});

describe("management draft deletion", () => {
  it.each(["processFlowTemplateDrafts", "processFlowInstanceDrafts"] as const)("sends the current revision and scoped template ID for %s", async (collection) => {
    const saved = draft("draft/id with space", "2026-10-13T00:00:00Z", "template/id");
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(deleteManagementResource({ collection, resource: saved })).resolves.toBeUndefined();
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe(`/api/process-flow-${collection === "processFlowTemplateDrafts" ? "template" : "instance"}-drafts/draft%2Fid%20with%20space`);
    expect(url.searchParams.get("revision")).toBe("3");
    expect(url.searchParams.get("processFlowTemplateId")).toBe(collection === "processFlowInstanceDrafts" ? "template/id" : null);
    expect(fetch.mock.calls[0][1].method).toBe("DELETE");
  });

  it.each([404, 409, 500])("preserves server errors for status %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "Draft changed" }, { status })));
    const deletion = deleteManagementResource({ collection: "processFlowTemplateDrafts", resource: draft("id", "2026-10-13T00:00:00Z") });
    await expect(deletion).rejects.toBeInstanceOf(ApiRequestError);
    await expect(deletion).rejects.toMatchObject({ status, message: "Draft changed" });
  });

  it("does not send an unscoped instance delete when the template ID is missing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(deleteManagementResource({ collection: "processFlowInstanceDrafts", resource: draft("id", "2026-10-13T00:00:00Z") })).rejects.toThrow("missing its template ID");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("removes only the selected draft and preserves formal resources and other drafts", () => {
    const selected = draft("selected", "2026-10-13T00:00:00Z", "a");
    const other = draft("other", selected.updatedAt, "b");
    const data = { ...managementDataFromBootstrap(bootstrap), processFlowTemplateDrafts: [other], processFlowInstanceDrafts: [selected, other] };
    const updated = removeManagementResource(data, { collection: "processFlowInstanceDrafts", resource: selected });
    expect(updated.processFlowInstanceDrafts).toEqual([other]);
    expect(updated.processFlowTemplateDrafts).toBe(data.processFlowTemplateDrafts);
    expect(updated.processFlowTemplates).toBe(data.processFlowTemplates);
    expect(updated.geometries).toBe(data.geometries);
    expect(data.processFlowInstanceDrafts).toHaveLength(2);
  });

  it("cleans only the deleted template's instance drafts and resets both lists from reset responses", () => {
    const a = draft("a-draft", "2026-10-13T00:00:00Z", "a");
    const b = draft("b-draft", a.updatedAt, "b");
    const data = { ...managementDataFromBootstrap(bootstrap), processFlowTemplateDrafts: [a], processFlowInstanceDrafts: [a, b] };
    const updated = removeManagementResource(data, { collection: "processFlowTemplates", resource: { id: "a", name: "a" } });
    expect(updated.processFlowTemplates.map((template) => template.id)).toEqual(["b"]);
    expect(updated.processFlowInstanceDrafts).toEqual([b]);
    expect(updated.processFlowTemplateDrafts).toEqual([a]);
    expect(managementDataFromBootstrap(bootstrap)).toEqual({ ...bootstrap, processFlowTemplateDrafts: [], processFlowInstanceDrafts: [] });
  });
});
