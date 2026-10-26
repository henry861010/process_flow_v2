import type { FileExportJob, FileExportStatus } from "./file-export-client";

export function isActiveStatus(status: FileExportStatus) {
  return status === "queued" || status === "running" || status === "canceling";
}

/** Keep every active job and the latest 20 terminal jobs, newest first. */
export function retainFileExportJobs(jobs: FileExportJob[]): FileExportJob[] {
  const seen = new Set<string>();
  const unique = jobs.filter((job) => {
    if (seen.has(job.jobId)) return false;
    seen.add(job.jobId);
    return true;
  });
  unique.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  let terminalCount = 0;
  return unique.filter((job) => isActiveStatus(job.status) || ++terminalCount <= 20);
}

export function mergeJob(jobs: FileExportJob[], job: FileExportJob) {
  return retainFileExportJobs([job, ...jobs]);
}
