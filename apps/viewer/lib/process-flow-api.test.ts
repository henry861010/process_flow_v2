import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  commitInstanceEditorDraft,
  commitTemplateEditorDraft,
  commitTemplateInstanceEditorDraft,
  createProcessFlowInstance,
  createProcessFlowTemplate,
  createProcessFlowTemplateInstance,
  deleteGeometry,
  deleteProcessFlowInstance,
  deleteProcessFlowTemplate,
  createGeometry,
  getEditorDraft,
  listEditorDrafts,
  saveEditorDraft,
  deleteEditorDraft,
} from "./process-flow-api";

afterEach(() => vi.unstubAllGlobals());

describe("editor draft requests", () => {
  it("scopes instance listing and recovery to the selected template", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetch);
    await listEditorDrafts("instance", { templateId: "template/id", user: "engineer", search: "progress" });
    await getEditorDraft("instance", "draft/id", "template/id");
    expect(fetch.mock.calls[0][0]).toContain("processFlowTemplateId=template%2Fid");
    expect(fetch.mock.calls[0][0]).toContain("user=engineer&search=progress");
    expect(fetch.mock.calls[1][0]).toContain("draft%2Fid?processFlowTemplateId=template%2Fid");
  });
  it("updates the original revision or creates a separate draft, and checks revision on delete", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const body = { schemaVersion: 1 as const, user: "user", name: "draft", processFlowTemplateId: "template", state: {
      metadata: { name: "", version: "", owner: "", description: "" },
      configuration: { inputBindings: {}, stepConfigurations: {}, embeddedGeometries: {} },
    } };
    await saveEditorDraft("instance", body, { id: "original", revision: 3 });
    await saveEditorDraft("instance", body);
    expect(fetch.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(fetch.mock.calls[0][1].body).revision).toBe(3);
    expect(fetch.mock.calls[1][1].method).toBe("POST");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty("revision");
    await deleteEditorDraft("instance", { id: "original", revision: 4 } as never, "template");
    expect(fetch.mock.calls[2][0]).toContain("processFlowTemplateId=template&revision=4");
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

describe("resource deletion requests", () => {
  it.each([
    [deleteProcessFlowTemplate, "process-flow-templates"],
    [deleteProcessFlowInstance, "process-flow-instances"],
    [deleteGeometry, "geometries"],
  ] as const)("handles empty 204 responses and encodes ids (%s)", async (remove, collection) => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(remove("id/with space")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/api/${collection}/id%2Fwith%20space`),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it.each([404, 409, 500])("preserves server error messages and status %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ message: "Resource is referenced by a new instance" }), { status }),
    ));
    for (const remove of [deleteProcessFlowTemplate, deleteProcessFlowInstance, deleteGeometry]) {
      const result = remove("resource");
      await expect(result).rejects.toBeInstanceOf(ApiRequestError);
      await expect(result).rejects.toMatchObject({ status, message: "Resource is referenced by a new instance" });
    }
  });
});


describe("server-generated flow IDs", () => {
  const template = {
    schemaVersion: 2 as const, status: "enabled" as const,
    name: "Template", version: "V0", owner: "test", description: "",
    flowInputs: [], stepRefs: [], flowEdges: [],
  };
  const instance = {
    schemaVersion: 2 as const, name: "Instance", version: "V0", owner: "test", description: "",
    inputBindings: {}, stepConfigurations: {}, embeddedGeometries: {},
  };

  it("sends create metadata and returns the assigned template ID", async () => {
    const saved = { ...template, id: "ecfcf14f6268494aaf405806789a87e1" };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(createProcessFlowTemplate(template)).resolves.toEqual(saved);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual(template);
    expect(body).not.toHaveProperty("id");
  });

  it("keeps the selected template reference while accepting the assigned instance ID", async () => {
    const request = { ...instance, processFlowTemplateId: "existing-template" };
    const saved = { ...request, id: "7e2adea78dd7496db50910936f6ccc4b" };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(createProcessFlowInstance(request)).resolves.toEqual(saved);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual(request);
    expect(body).not.toHaveProperty("id");
  });

  it("creates template and instance without caller-owned identity or relationship", async () => {
    const request = { processFlowTemplate: template, processFlowInstance: instance };
    const saved = {
      processFlowTemplate: { ...template, id: "ecfcf14f6268494aaf405806789a87e1" },
      processFlowInstance: { ...instance, id: "7e2adea78dd7496db50910936f6ccc4b", processFlowTemplateId: "ecfcf14f6268494aaf405806789a87e1" },
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(createProcessFlowTemplateInstance(request)).resolves.toEqual(saved);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual(request);
    expect(body.processFlowTemplate).not.toHaveProperty("id");
    expect(body.processFlowInstance).not.toHaveProperty("id");
    expect(body.processFlowInstance).not.toHaveProperty("processFlowTemplateId");
  });

  it("commits an instance draft using current values and its revision", async () => {
    const request = { ...instance, processFlowTemplateId: "template" };
    const saved = { ...request, id: "assigned" };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(commitInstanceEditorDraft({ id: "draft", revision: 2 }, request)).resolves.toEqual(saved);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ revision: 2, processFlowInstance: request });
  });

  it("commits a template with its instance in one revision-checked request", async () => {
    const request = { processFlowTemplate: template, processFlowInstance: instance };
    const saved = {
      processFlowTemplate: { ...template, id: "assigned-template" },
      processFlowInstance: { ...instance, id: "assigned-instance", processFlowTemplateId: "assigned-template" },
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(commitTemplateInstanceEditorDraft({ id: "draft/id", revision: 4 }, request)).resolves.toEqual(saved);
    expect(fetch.mock.calls[0][0]).toContain("/api/process-flow-template-drafts/draft%2Fid/commit");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ revision: 4, ...request });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the template-only draft request and response compatible", async () => {
    const saved = { ...template, id: "assigned-template" };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(commitTemplateEditorDraft({ id: "draft", revision: 2 }, template)).resolves.toEqual(saved);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ revision: 2, processFlowTemplate: template });
  });

  it("preserves a combined draft conflict for display without falling back to separate creates", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Draft changed" }), { status: 409 }));
    vi.stubGlobal("fetch", fetch);
    await expect(commitTemplateInstanceEditorDraft({ id: "draft", revision: 2 }, {
      processFlowTemplate: template, processFlowInstance: instance,
    })).rejects.toMatchObject({ status: 409, message: "Draft changed" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
