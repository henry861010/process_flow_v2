import type { DashboardSnapshot } from "./dashboard-state";

export const ACTIVE_POLL_MS = 2_000;
export const IDLE_POLL_MS = 5_000;
export const STALE_MS = 10_000;

export type DashboardState = {
  snapshot: DashboardSnapshot | null;
  refreshing: boolean;
  stale: boolean;
  error: string | null;
  advanceSeconds: number;
};

export const initialDashboardState: DashboardState = {
  snapshot: null,
  refreshing: false,
  stale: false,
  error: null,
  advanceSeconds: 0,
};

/** Owns one request at a time; the UI's one-second clock never uses wall time. */
export class DashboardPoller {
  private state: DashboardState = { ...initialDashboardState };
  private receivedAt = 0;
  private visible = false;
  private disposed = false;
  private refreshOnSettled = false;
  private request: AbortController | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private clockTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly load: (signal: AbortSignal) => Promise<DashboardSnapshot>,
    private readonly onChange: (state: DashboardState) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.clearTimers();
    if (visible) {
      this.publish();
      this.clockTimer = setInterval(() => this.publish(), 1_000);
      if (this.request) this.refreshOnSettled = true;
      else void this.refresh();
    } else {
      this.refreshOnSettled = false;
      this.request?.abort();
    }
  }

  async refresh() {
    if (this.disposed || !this.visible || this.request) return;
    clearTimeout(this.pollTimer);
    const controller = new AbortController();
    this.request = controller;
    this.state = { ...this.state, refreshing: true };
    this.publish();
    let timedOut = false;
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new Error("Request aborted"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STALE_MS);
    try {
      const snapshot = await Promise.race([this.load(controller.signal), aborted]);
      if (this.disposed || !this.visible || controller.signal.aborted) return;
      this.receivedAt = this.now();
      this.state = { snapshot, refreshing: true, stale: false, error: null, advanceSeconds: 0 };
    } catch {
      if (this.disposed || !this.visible || (controller.signal.aborted && !timedOut)) return;
      this.publish();
      this.state = {
        ...this.state,
        stale: true,
        error: timedOut
          ? "Request timed out. Retrying automatically."
          : "Unable to refresh jobs. Retrying automatically.",
      };
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", rejectAbort);
      this.request = null;
      if (!this.disposed) {
        this.state = { ...this.state, refreshing: false };
        this.publish();
        if (this.visible) {
          if (this.refreshOnSettled) {
            this.refreshOnSettled = false;
            void this.refresh();
          } else {
            const active = this.state.snapshot &&
              this.state.snapshot.runningCount + this.state.snapshot.queuedCount > 0;
            this.pollTimer = setTimeout(() => void this.refresh(),
              this.state.stale || !active ? IDLE_POLL_MS : ACTIVE_POLL_MS);
          }
        }
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.request?.abort();
  }

  private clearTimers() {
    clearTimeout(this.pollTimer);
    clearInterval(this.clockTimer);
  }

  private publish() {
    if (this.disposed) return;
    if (this.state.snapshot && !this.state.stale) {
      const age = Math.max(0, this.now() - this.receivedAt);
      this.state = {
        ...this.state,
        advanceSeconds: Math.min(age, STALE_MS) / 1_000,
        stale: age >= STALE_MS,
      };
    }
    this.onChange({ ...this.state });
  }
}
