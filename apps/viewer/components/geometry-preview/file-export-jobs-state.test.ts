import { describe, expect, it } from "vitest";
import type { FileExportJob, FileExportStatus } from "./file-export-client";
import { isActiveStatus, mergeJob, retainFileExportJobs } from "./file-export-jobs-state";

function job(index: number, status: FileExportStatus = "queued"): FileExportJob {
  return {
    jobId: `job-${index}`, clientId: "browser-a", kind: "json", status,
    sourceLabel: null, outputPath: `/exports/${index}.json`, geometryOutputPath: null,
    meshControlOutputPath: null, logPath: `/logs/${index}.log`, meshControl: null,
    createdAt: new Date(Date.UTC(2026, 9, 26, 0, 0, index)).toISOString(),
    startedAt: null, finishedAt: null, durationSeconds: null, runElapsedSeconds: null,
    queuePosition: null, progress: null, nodeCount: null, elementCount: null,
    componentCount: null, message: null, warning: null,
  };
}

describe("export jobs retention", () => {
  it("keeps all active jobs even when newer terminal requests exceed the history limit", () => {
    const active = Array.from({ length: 25 }, (_, index) => job(index,
      (["queued", "running", "canceling"] as const)[index % 3]));
    const finished = Array.from({ length: 25 }, (_, index) => job(index + 25,
      (["success", "failed", "canceled"] as const)[index % 3]));
    const input = [...active, ...finished];
    const result = retainFileExportJobs(input);

    expect(result).toHaveLength(45);
    expect(result.filter((item) => isActiveStatus(item.status))).toEqual([...active].reverse());
    expect(result.filter((item) => !isActiveStatus(item.status))).toEqual(finished.slice(5).reverse());
    expect(result.map((item) => item.createdAt)).toEqual(result.map((item) => item.createdAt).sort().reverse());
    expect(input).toEqual([...active, ...finished]);
  });

  it("merges updated jobs by ID without moving an older request above newer requests", () => {
    const previous = [job(2), job(1), job(0)];
    const updated = { ...job(0, "canceling"), message: "Cancel requested." };
    const result = mergeJob(previous, updated);
    expect(result).toEqual([job(2), job(1), updated]);
    expect(previous[2].status).toBe("queued");
  });

  it("retains a newly finished request and evicts only the oldest terminal history", () => {
    const finished = Array.from({ length: 20 }, (_, index) => job(index, "success"));
    const active = Array.from({ length: 25 }, (_, index) => job(index + 20));
    const result = mergeJob([...finished, ...active], job(44, "failed"));
    expect(result).toHaveLength(44);
    expect(result[0]).toEqual(job(44, "failed"));
    expect(result.some((item) => item.jobId === "job-0")).toBe(false);
    expect(result.filter((item) => isActiveStatus(item.status))).toHaveLength(24);
  });

  it("deduplicates snapshots before counting terminal history", () => {
    const newest = job(21, "success");
    const result = retainFileExportJobs([
      newest, newest, ...Array.from({ length: 21 }, (_, index) => job(index, "failed")),
    ]);
    expect(result).toHaveLength(20);
    expect(new Set(result.map((item) => item.jobId)).size).toBe(20);
    expect(result.at(-1)?.jobId).toBe("job-2");
  });
});
