import { describe, expect, it } from "vitest";
import { formatElapsed, jobElapsed, progressPercent, type DashboardJob } from "./dashboard-state";

const progress: NonNullable<DashboardJob["progress"]> = {
  stage: "building_3d_mesh", current: 3, total: 12, unit: "layers",
  message: "Built layer 3 of 12.",
  stageStartedAt: "2026-10-07T00:00:00Z", updatedAt: "2026-10-07T00:00:01Z",
};

describe("dashboard presentation", () => {
  it("only shows percentages for reliable stage counts", () => {
    expect(progressPercent(progress)).toBe(25);
    expect(progressPercent({ ...progress, current: 0 })).toBe(0);
    expect(progressPercent({ ...progress, current: 12 })).toBe(100);
    for (const invalid of [null, { ...progress, current: null }, { ...progress, total: 0 },
      { ...progress, current: 13 }, { ...progress, current: -1 }, { ...progress, total: Infinity }]) {
      expect(progressPercent(invalid)).toBeNull();
    }
  });

  it("formats short and long durations without dropping elapsed seconds", () => {
    expect(formatElapsed(null)).toBe("—");
    expect(formatElapsed(NaN)).toBe("—");
    expect(formatElapsed(-1)).toBe("0s");
    expect(formatElapsed(65.9)).toBe("1m 05s");
    expect(formatElapsed(3602)).toBe("1h 00m 02s");
    expect(formatElapsed(90061)).toBe("25h 01m 01s");
  });

  it("uses server elapsed values rather than browser date differences", () => {
    const job: DashboardJob = {
      jobId: "id", kind: "cdb", status: "running", createdAt: "2000-01-01T00:00:00Z",
      startedAt: "2000-01-01T00:00:00Z", queuePosition: null,
      runElapsedSeconds: 60, queueElapsedSeconds: null, progress,
    };
    expect(jobElapsed(job, 2)).toBe("1m 02s");
    expect(jobElapsed({ ...job, status: "canceling" }, 2)).toBe("1m 02s");
    expect(jobElapsed({ ...job, status: "queued", queueElapsedSeconds: 5 }, 2)).toBe("7s");
    expect(jobElapsed({ ...job, runElapsedSeconds: null }, 2)).toBe("—");
  });
});
