import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("file export client identity", () => {
  it("keeps exporting possible with a stable in-memory ID when localStorage is blocked", async () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("blocked"); } });
    const { getFileExportClientId } = await import("./file-export-client");
    const id = getFileExportClientId();
    expect(id).toMatch(/^client-/);
    expect(getFileExportClientId()).toBe(id);
  });

  it("retains an existing ID even if storage is full", async () => {
    vi.stubGlobal("window", { localStorage: {
      getItem: () => "existing-client",
      setItem() { throw new Error("quota"); },
    } });
    const { getFileExportClientId } = await import("./file-export-client");
    expect(getFileExportClientId()).toBe("existing-client");
  });

  it("preserves the legacy client identity and its migration", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => key === "process-flow:cdb-export-client-id" ? "legacy-client" : null,
      setItem,
    } });
    const { getFileExportClientId } = await import("./file-export-client");
    expect(getFileExportClientId()).toBe("legacy-client");
    expect(setItem).toHaveBeenCalledWith("process-flow:export-client-id", "legacy-client");
  });
});
