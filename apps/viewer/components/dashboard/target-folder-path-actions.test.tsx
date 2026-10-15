import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TargetFolderPath } from "./target-folder-path";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return { ...actual, useState: vi.fn(actual.useState), useEffect: vi.fn(actual.useEffect) };
});

function copyAction() {
  const setFeedback = vi.fn();
  vi.mocked(React.useState).mockReturnValueOnce(["idle", setFeedback]);
  vi.mocked(React.useEffect).mockImplementationOnce(() => {});
  const path = `/exports/中文 folder/${"long directory/".repeat(30)}`;
  const view = TargetFolderPath({ jobId: "job-123", path });
  function findCopy(element: React.ReactElement): (() => Promise<void>) | undefined {
    if (element.props["aria-label"] === "Copy target folder for job job-123") return element.props.onClick;
    for (const child of React.Children.toArray(element.props.children)) {
      if (React.isValidElement(child)) {
        const action = findCopy(child);
        if (action) return action;
      }
    }
  }
  const action = findCopy(view);
  if (!action) throw new Error("Missing copy control");
  return { action, path, setFeedback };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("target folder clipboard actions", () => {
  it("copies the original full path and confirms success after the write completes", async () => {
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { action, path, setFeedback } = copyAction();
    const pending = action();
    expect(writeText).toHaveBeenCalledWith(path);
    expect(setFeedback).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(setFeedback).toHaveBeenCalledWith("copied");
  });

  it.each(["missing", "denied"])("reports manual-copy feedback when clipboard is %s", async (mode) => {
    vi.stubGlobal("navigator", mode === "missing" ? {} : {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Permission denied")) },
    });
    const { action, setFeedback } = copyAction();
    await action();
    expect(setFeedback).toHaveBeenCalledWith("error");
    expect(setFeedback).not.toHaveBeenCalledWith("copied");
  });
});
