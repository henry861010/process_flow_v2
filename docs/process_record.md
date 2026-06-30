# Process Record

## Geometry Preview Flow

This record describes the active geometry preview path from the viewer to FastAPI, Python kernel execution, Python CadQuery/OCP CAD export, and STEP AP242 export.

## Request Path

1. The viewer calls `POST /api/geometry-preview` through `apps/viewer/components/geometry-preview/geometry-preview-client.ts`.
2. The request includes the preview target, draft flow template, draft flow instance, optional repository snapshots, and optional `sourceLabel`.
3. FastAPI validates the target and builds repositories for the Python kernel.
4. `GeometryKernel.execute_preview()` runs only the upstream closure needed for the requested edge or step output.
5. FastAPI receives a `geometryStructure` plus preview context such as `sourceKind` and `outputStepRefId`.
6. FastAPI builds a download-ready `geometryEntityJson`.
7. FastAPI calls the isolated Python CAD worker to export the `geometryStructure` as GLB through CadQuery/OCP.
8. FastAPI base64-encodes the generated GLB and returns `{ geometryEntityJson, glbBase64 }`.
9. The preview panel can call `POST /api/geometry-preview/step` with the same `geometryEntityJson.structure` to generate STEP AP242 without re-running the kernel.
10. The preview panel can call `POST /api/geometry-preview/cdb-jobs` with the same `geometryEntityJson.structure` to start a server-side CDB export job without re-running the kernel.
11. The flow editor export requests drawer polls `GET /api/export-jobs?clientId=...` and displays only jobs owned by the browser-generated client id.

## Child Process Export

GLB and STEP export both use:

```text
python -m process_flow_cad.worker <format> <input-json> <output-file>
```

FastAPI creates a temporary working directory, writes `geometry-structure.json`, starts the worker with the current Python executable, waits for completion, reads the output file, and removes the temporary directory.

Worker responsibilities:

1. Read the input geometry structure.
2. Normalize the structure with the Python geometry kernel schema helpers.
3. Convert Box, Cylinder, Cone, and Polygon primitives into CadQuery/OCP solids.
4. For `glb`, export solid bodies only.
5. For `step`, export STEP AP242 with feature bodies.
6. Write the generated binary to the requested output path.

## Why The Worker Exists

CadQuery/OCP loads a native CAD kernel. Running export in a short-lived worker process isolates CAD memory lifecycle and hard timeouts from FastAPI.

FastAPI is responsible for request validation, Python kernel execution, response assembly, timeout handling, and error reporting. The worker is responsible only for CAD conversion.

## Timeout And Failure Behavior

`GEOMETRY_PREVIEW_EXPORT_TIMEOUT_SECONDS` controls the Python CAD worker timeout and defaults to `30`.

If the worker times out, exits non-zero, or fails to produce output, FastAPI returns an API error with the worker's stderr/stdout summary. Temporary files are scoped to the request and removed after the worker exits.

## Files

| File | Responsibility |
| --- | --- |
| `apps/api/src/process_flow_api/main.py` | FastAPI routes, request validation, kernel calls, response assembly. |
| `apps/api/src/process_flow_api/exporter.py` | Python CAD worker orchestration for GLB and STEP export. |
| `apps/api/src/process_flow_api/cdb_jobs.py` | In-memory CDB export job queue, polling state, cancellation, and cleanup. |
| `apps/api/src/process_flow_api/cdb_exporter.py` | Python mesher worker subprocess orchestration for CDB jobs. |
| `packages/cad-py/src/process_flow_cad/worker.py` | Isolated Python worker entry point. |
| `packages/cad-py/src/process_flow_cad/exporter.py` | CadQuery/OCP geometry conversion and GLB/STEP export implementation. |
| `packages/mesher-py/src/process_flow_mesher/worker.py` | Isolated Python worker entry point for text CDB export. |
| `packages/mesher-py/src/process_flow_mesher/builder.py` | Geometry structure to `Dragger` and `MeshResult` conversion. |
| `packages/mesher-py/src/mesher/dragger.py` | 2.5D mesh extrusion engine and `Dragger.write(path)` text CDB export entry point. |
| `packages/mesher-py/src/mesher/cdb_writer.py` | Text CDB serialization for mesher-owned mesh arrays. |
| `apps/viewer/components/geometry-preview/geometry-preview-client.ts` | Browser API client helpers for preview and STEP export. |
| `apps/viewer/components/geometry-preview/geometry-preview-panel.tsx` | Preview overlay UI and download actions. |
| `apps/viewer/components/geometry-preview/cdb-export-dialog.tsx` | CDB export modal for element size and absolute output path. |
| `apps/viewer/components/geometry-preview/cdb-export-client.ts` | Browser client id and CDB job create/list/cancel helpers. |
| `apps/viewer/components/geometry-preview/cdb-export-jobs-panel.tsx` | Editor-level export request drawer, polling, cancellation, and hover detail. |
