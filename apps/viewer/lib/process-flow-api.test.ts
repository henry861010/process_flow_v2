import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, commitFlowDraft, createProcessFlow, updateProcessFlow, deleteProcessFlow,
  createGeometry, deleteGeometry, getFlowDraft, listFlowDrafts, saveFlowDraft, deleteFlowDraft,
  exportProcessStepTemplates, importProcessStepTemplates } from "./process-flow-api";
import type { FlowDraftCreate, ProcessFlowCreate } from "./process-flow/types";
afterEach(() => vi.unstubAllGlobals());

describe("step template JSON transfer", () => {
  it("uploads the JSON file directly and returns the merged list and counts", async () => {
    const file = new File(['[{"id":"step"}]'], "templates.json", { type: "text/plain" });
    const result = { processStepTemplates: [{ id: "step", description: "Updated" }], createdCount: 1, updatedCount: 2 };
    const fetch = vi.fn().mockResolvedValue(Response.json(result));
    vi.stubGlobal("fetch", fetch);
    await expect(importProcessStepTemplates(file)).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/process-step-templates/import"),
      expect.objectContaining({ method: "POST", body: file }));
    expect(fetch.mock.calls[0][1].headers.get("Content-Type")).toBe("application/json");
  });

  it("downloads a JSON blob with a timestamp filename and releases the object URL", async () => {
    const click = vi.fn(), remove = vi.fn(), appendChild = vi.fn();
    const link = { href: "", download: "", click, remove };
    const blob = new Blob(['[{"id":"disabled-step","status":"disabled"}]'], { type: "application/json" });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:step-templates");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.stubGlobal("document", { createElement: vi.fn().mockReturnValue(link), body: { appendChild } });
    const fetch = vi.fn().mockResolvedValue(new Response(blob));
    vi.stubGlobal("fetch", fetch);
    try {
      await exportProcessStepTemplates();
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/process-step-templates/export"));
      expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      expect(link.href).toBe("blob:step-templates");
      expect(link.download).toMatch(/^process-step-templates-\d{8}T\d{6}Z\.json$/);
      expect(appendChild).toHaveBeenCalledWith(link);
      expect(click).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:step-templates");
    } finally {
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it.each([400, 409, 413, 415])("retains actionable import errors (%s)", async (status) => {
    const message = "Cannot change step structure: referenced by template draft example";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message }, { status })));
    await expect(importProcessStepTemplates(new File(["[]"], "templates.json")))
      .rejects.toMatchObject({ status, message });
  });

  it("does not create a download when export fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Export unavailable" }, { status: 500 })));
    await expect(exportProcessStepTemplates()).rejects.toMatchObject({ status: 500, message: "Export unavailable" });
  });
});

describe("manual geometry creation requests", () => {
  const request = {
    name: "Custom die", entityType: "die", owner: "engineering", dim: "", structureFormat: "standard",
    structure: { schemaVersion: "1.0.0", unitSystem: "um", root: {} },
  };

  it("posts a structure and metadata without a caller-generated ID", async () => {
    const saved = { ...request, id: "geom_custom_die_123" };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(createGeometry(request)).resolves.toEqual(saved);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/geometries"), expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(request);
  });

  it("keeps the structure validation path from the API for inline display", async () => {
    const message = "structure.root.bodies[0].geometry.thk: must be positive";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message }), { status: 400 })));
    await expect(createGeometry(request)).rejects.toMatchObject({ status: 400, message });
  });
});


describe("unified flow transport", () => {
  const flow: ProcessFlowCreate = { schemaVersion: 3, name: "Flow", version: "v1", owner: "RD", description: "",
    definition: { flowInputs: [], stepRefs: [], flowEdges: [] }, configuration: { inputBindings: {}, stepConfigurations: {} } };
  it("uses one CRUD resource and carries revision for update and delete", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ...flow, id: "f", revision: 1 })); vi.stubGlobal("fetch", fetch);
    await createProcessFlow(flow); await updateProcessFlow("f", { ...flow, revision: 4 }); await deleteProcessFlow({ id: "f", revision: 4 });
    expect(fetch.mock.calls.map((call) => [call[0], call[1].method])).toEqual([
      [expect.stringContaining("/api/process-flows"), "POST"], [expect.stringContaining("/api/process-flows/f"), "PUT"], [expect.stringContaining("/api/process-flows/f?revision=4"), "DELETE"]]);
    expect(JSON.parse(fetch.mock.calls[1][1].body).revision).toBe(4);
  });
  it("commits the current content and target revision in a single request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: "f" })); vi.stubGlobal("fetch", fetch);
    await commitFlowDraft({ id: "draft", revision: 2 }, flow, { flowId: "f", revision: 8 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ revision: 2, flow, target: { flowId: "f", revision: 8 } });
  });
  it("propagates conflicts without retries or fallback writes", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ detail: "Revision conflict" }, { status: 409 })); vi.stubGlobal("fetch", fetch);
    await expect(commitFlowDraft({ id: "draft", revision: 1 }, flow)).rejects.toMatchObject({ status: 409, message: "Revision conflict" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("lists drafts across all flows and preserves target and UI state on save", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal("fetch", fetch);
    const body: FlowDraftCreate = { schemaVersion: 2, user: "RD", name: "draft", target: { flowId: "f", revision: 3 },
      state: { metadata: flow, configuration: flow.configuration, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, editingRecipeIds: { a: "r2" } } };
    await listFlowDrafts({ user: "RD" }); await getFlowDraft("draft"); await saveFlowDraft(body, { id: "draft", revision: 2 }); await deleteFlowDraft({ id: "draft", revision: 3 });
    expect(fetch.mock.calls[0][0]).toContain("/api/process-flow-drafts?user=RD");
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ ...body, revision: 2 });
    expect(fetch.mock.calls[3][0]).toContain("?revision=3");
  });
});
