import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiRequestError,
  deleteProcessFlowInstance,
  deleteProcessFlowTemplate,
} from "./process-flow-api";

afterEach(() => vi.unstubAllGlobals());

describe("resource deletion requests", () => {
  it.each([
    [deleteProcessFlowTemplate, "process-flow-templates"],
    [deleteProcessFlowInstance, "process-flow-instances"],
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Resource is referenced by a new instance" }), { status }),
    ));
    const result = deleteProcessFlowTemplate("flow");
    await expect(result).rejects.toBeInstanceOf(ApiRequestError);
    await expect(result).rejects.toMatchObject({ status, message: "Resource is referenced by a new instance" });
  });
});
