"use client";

import * as React from "react";
import type { FileExportJob } from "./file-export-client";
import { FileExportJobsPanel } from "./file-export-jobs-panel";

const FileExportJobsContext = React.createContext<((job: FileExportJob) => void) | null>(null);

export function FileExportJobsProvider({ children }: { children: React.ReactNode }) {
  const [notification, setNotification] = React.useState<{
    refreshKey: number;
    seedJob: FileExportJob | null;
  }>({ refreshKey: 0, seedJob: null });
  const registerJob = React.useCallback((job: FileExportJob) => {
    setNotification((current) => ({ refreshKey: current.refreshKey + 1, seedJob: job }));
  }, []);

  return (
    <FileExportJobsContext.Provider value={registerJob}>
      {children}
      <FileExportJobsPanel {...notification} />
    </FileExportJobsContext.Provider>
  );
}

export function useFileExportJobs() {
  const registerJob = React.useContext(FileExportJobsContext);
  if (!registerJob) throw new Error("useFileExportJobs requires FileExportJobsProvider.");
  return { registerJob };
}
