import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  commitProcessFlowWorkspace,
  createProcessFlowInstance,
  createProcessFlowTemplate,
  createProcessFlowTemplateInstance,
  deleteGeometry,
  deleteProcessFlowInstance,
  deleteProcessFlowTemplate,
  createGeometry,
} from "./process-flow-api";

afterEach(() => vi.unstubAllGlobals());

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

  it("commits a workspace without instanceId", async () => {
    const request = {
      revision: 1, instanceName: "Instance", instanceVersion: "V0", instanceOwner: "test", instanceDescription: "",
    };
    const saved = {
      workspace: { id: "workspace", committedInstanceId: "7e2adea78dd7496db50910936f6ccc4b" },
      processFlowInstance: { ...instance, id: "7e2adea78dd7496db50910936f6ccc4b", processFlowTemplateId: "template" },
    };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(saved), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(commitProcessFlowWorkspace("workspace", request)).resolves.toEqual(saved);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toEqual(request);
    expect(body).not.toHaveProperty("instanceId");
  });
});
