import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPoller, type DashboardState } from "./dashboard-poller";
import type { DashboardSnapshot } from "./dashboard-state";

const idle: DashboardSnapshot = {
  generatedAt: "2026-10-07T00:00:00Z", maxConcurrentJobs: 3, runningCount: 0, queuedCount: 0, jobs: [],
};
const active: DashboardSnapshot = { ...idle, runningCount: 1 };

describe("dashboard polling lifecycle", () => {
  let poller: DashboardPoller;
  let state: DashboardState;
  let load: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<DashboardSnapshot>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    load = vi.fn<(signal: AbortSignal) => Promise<DashboardSnapshot>>().mockResolvedValue(active);
    poller = new DashboardPoller(load, (next) => { state = next; }, () => Date.now());
  });

  afterEach(async () => {
    poller.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("loads immediately and switches between active and idle intervals", async () => {
    poller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    expect(state.snapshot).toEqual(active);
    load.mockResolvedValue(idle);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("keeps one request in flight and supports manual refresh", async () => {
    let resolve!: (value: DashboardSnapshot) => void;
    load.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    poller.setVisible(true);
    void poller.refresh();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(load).toHaveBeenCalledTimes(1);
    resolve(active);
    await vi.advanceTimersByTimeAsync(0);
    await poller.refresh();
    expect(load).toHaveBeenCalledTimes(2);
    expect(state.refreshing).toBe(false);
  });

  it("retains the snapshot and freezes elapsed time after a failure, then recovers", async () => {
    poller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    load.mockRejectedValueOnce(new Error("private backend error"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(state.snapshot).toEqual(active);
    expect(state.stale).toBe(true);
    expect(state.error).not.toContain("private");
    const frozen = state.advanceSeconds;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(state.advanceSeconds).toBe(frozen);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.stale).toBe(false);
    expect(state.error).toBeNull();
    expect(state.advanceSeconds).toBe(0);
  });

  it("marks old data stale and aborts a request after ten seconds", async () => {
    poller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    let signal: AbortSignal | undefined;
    load.mockImplementationOnce((nextSignal) => {
      signal = nextSignal;
      return new Promise(() => {});
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.stale).toBe(true);
    expect(state.advanceSeconds).toBe(10);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(signal?.aborted).toBe(true);
    expect(state.error).toContain("timed out");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.snapshot).toEqual(active);
    expect(state.stale).toBe(false);
  });

  it("pauses while hidden and immediately reloads on returning", async () => {
    poller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    poller.setVisible(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    poller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(state.stale).toBe(false);
  });

  it("aborts hidden requests and ignores late responses", async () => {
    let resolve!: (value: DashboardSnapshot) => void;
    let signal!: AbortSignal;
    load.mockImplementationOnce((nextSignal) => {
      signal = nextSignal;
      return new Promise((done) => { resolve = done; });
    });
    poller.setVisible(true);
    poller.setVisible(false);
    expect(signal.aborted).toBe(true);
    // Returning before the canceled promise settles still starts exactly one fresh request.
    poller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    resolve(idle);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(state.snapshot).toEqual(active);
  });

  it("handles initial connection failures without displaying an empty snapshot", async () => {
    load.mockRejectedValueOnce(new Error("offline"));
    poller.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(state.snapshot).toBeNull();
    expect(state.stale).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.snapshot).toEqual(active);
  });
});
