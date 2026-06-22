import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_EXPORT_CONCURRENCY = 1;
const DEFAULT_EXPORT_TIMEOUT_MS = 30_000;
const MAX_WORKER_LOG_BYTES = 16_000;

let activeGeometryExports = 0;
const highPriorityGeometryExports = [];
const lowPriorityGeometryExports = [];

export class GeometryExportAbortError extends Error {
  constructor(message = "Geometry export was cancelled.") {
    super(message);
    this.name = "AbortError";
  }
}

export function isGeometryExportAbortError(error) {
  return error?.name === "AbortError";
}

export function enqueueGeometryExport({
  geometryStructure,
  format,
  priority = "low",
  signal = null,
}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GeometryExportAbortError());
      return;
    }

    const job = {
      geometryStructure,
      format: normalizeExportFormat(format),
      priority: priority === "high" ? "high" : "low",
      signal,
      resolve,
      reject,
      state: "queued",
      settled: false,
      cancelled: false,
      child: null,
      abortListener: null,
    };

    if (signal) {
      job.abortListener = () => abortGeometryExportJob(job);
      signal.addEventListener("abort", job.abortListener, { once: true });
    }

    queueForPriority(job.priority).push(job);
    drainGeometryExportQueue();
  });
}

function drainGeometryExportQueue() {
  const concurrency = exportConcurrency();

  while (
    activeGeometryExports < concurrency &&
    (highPriorityGeometryExports.length > 0 ||
      lowPriorityGeometryExports.length > 0)
  ) {
    const job =
      highPriorityGeometryExports.shift() ?? lowPriorityGeometryExports.shift();
    if (!job || job.settled) continue;

    activeGeometryExports += 1;
    job.state = "running";

    runGeometryExportJob(job)
      .then((bytes) => settleGeometryExportJob(job, null, bytes))
      .catch((error) => settleGeometryExportJob(job, error))
      .finally(() => {
        activeGeometryExports -= 1;
        job.state = "done";
        cleanupGeometryExportJob(job);
        drainGeometryExportQueue();
      });
  }
}

async function runGeometryExportJob(job) {
  throwIfCancelled(job);

  const workDir = await mkdtemp(join(tmpdir(), "process-flow-preview-"));
  const inputPath = join(workDir, "geometry-structure.json");
  const outputPath = join(workDir, `preview.${job.format}`);

  try {
    throwIfCancelled(job);
    await writeFile(inputPath, JSON.stringify(job.geometryStructure), "utf8");
    throwIfCancelled(job);
    await runGeometryExportWorker({ job, inputPath, outputPath });
    throwIfCancelled(job);
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runGeometryExportWorker({ job, inputPath, outputPath }) {
  const workerPath = join(process.cwd(), "scripts/geometry-export-worker.mjs");
  const exporterPath = join(process.cwd(), "../../src/exporters/cad.js");
  const timeoutMs = exportTimeoutMs();

  return new Promise((resolve, reject) => {
    throwIfCancelled(job);

    const child = spawn(
      process.execPath,
      [workerPath, job.format, inputPath, outputPath, exporterPath],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    job.child = child;

    let stderr = "";
    let stdout = "";
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.stdout.on("data", (chunk) => {
      stdout = appendLimited(stdout, chunk);
    });

    child.on("error", (error) => {
      settle(() => {
        reject(
          new Error(`Unable to start geometry ${job.format} export worker: ${error.message}`),
        );
      });
    });

    child.on("exit", (code, signal) => {
      settle(() => {
        if (job.cancelled) {
          reject(new GeometryExportAbortError());
          return;
        }
        if (timedOut) {
          reject(
            new Error(
              `Geometry ${job.format} export timed out after ${timeoutMs}ms.`,
            ),
          );
          return;
        }
        if (code === 0) {
          resolve();
          return;
        }
        reject(workerFailureError({ format: job.format, code, signal, stderr, stdout }));
      });
    });

    function settle(callback) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (job.child === child) {
        job.child = null;
      }
      callback();
    }
  });
}

function abortGeometryExportJob(job) {
  job.cancelled = true;

  if (job.state === "queued") {
    removeQueuedJob(job);
    settleGeometryExportJob(job, new GeometryExportAbortError());
    cleanupGeometryExportJob(job);
    return;
  }

  if (job.child) {
    job.child.kill("SIGKILL");
  }
}

function settleGeometryExportJob(job, error, bytes) {
  if (job.settled) return;
  job.settled = true;
  if (error) {
    job.reject(error);
    return;
  }
  job.resolve(bytes);
}

function cleanupGeometryExportJob(job) {
  if (job.signal && job.abortListener) {
    job.signal.removeEventListener("abort", job.abortListener);
    job.abortListener = null;
  }
}

function removeQueuedJob(job) {
  const queue = queueForPriority(job.priority);
  const index = queue.indexOf(job);
  if (index >= 0) {
    queue.splice(index, 1);
  }
}

function throwIfCancelled(job) {
  if (job.cancelled || job.signal?.aborted) {
    job.cancelled = true;
    throw new GeometryExportAbortError();
  }
}

function queueForPriority(priority) {
  return priority === "high"
    ? highPriorityGeometryExports
    : lowPriorityGeometryExports;
}

function normalizeExportFormat(format) {
  const normalized = String(format ?? "").trim().toLowerCase();
  if (normalized === "glb" || normalized === "step") {
    return normalized;
  }
  throw new Error(`Unsupported geometry export format: ${format}`);
}

function exportConcurrency() {
  const value = Number(process.env.GEOMETRY_PREVIEW_EXPORT_CONCURRENCY ?? "");
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_EXPORT_CONCURRENCY;
}

function exportTimeoutMs() {
  const value = Number.parseInt(
    process.env.GEOMETRY_PREVIEW_EXPORT_TIMEOUT_MS ?? "",
    10,
  );
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_EXPORT_TIMEOUT_MS;
}

function appendLimited(current, chunk) {
  const next = `${current}${chunk.toString()}`;
  return next.length > MAX_WORKER_LOG_BYTES
    ? next.slice(next.length - MAX_WORKER_LOG_BYTES)
    : next;
}

function workerFailureError({ format, code, signal, stderr, stdout }) {
  const reason = signal ? `signal ${signal}` : `exit code ${code}`;
  const details = (stderr || stdout).trim();
  if (!details) {
    return new Error(`Geometry ${format} export failed with ${reason}.`);
  }
  return new Error(`Geometry ${format} export failed with ${reason}: ${details}`);
}
