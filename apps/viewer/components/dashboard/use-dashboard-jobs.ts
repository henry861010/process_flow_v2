"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/process-flow-api";
import { DashboardPoller, initialDashboardState } from "./dashboard-poller";
import type { DashboardSnapshot } from "./dashboard-state";

export function useDashboardJobs() {
  const [state, setState] = useState(initialDashboardState);
  const poller = useRef<DashboardPoller | null>(null);

  useEffect(() => {
    const current = new DashboardPoller(
      (signal) => apiFetch<DashboardSnapshot>("/api/dashboard/jobs", { signal, cache: "no-store" }),
      setState,
    );
    poller.current = current;
    const onVisibility = () => current.setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      current.dispose();
      poller.current = null;
    };
  }, []);

  const refresh = useCallback(() => { void poller.current?.refresh(); }, []);
  return { ...state, refresh };
}
