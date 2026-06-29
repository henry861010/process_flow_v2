# Process Record

## Geometry Preview Flow

This record describes the active geometry preview path from the viewer to FastAPI, Python kernel execution, JavaScript CAD export, and STEP AP242 export.

## Request Path

1. The viewer calls `POST /api/geometry-preview` through `apps/viewer/components/geometry-preview/geometry-preview-client.ts`.
2. The request includes the preview target, draft flow template, draft flow instance, optional repository snapshots, and optional `sourceLabel`.
3. FastAPI validates the target and builds repositories for the Python kernel.
4. `GeometryKernel.execute_preview()` runs only the upstream closure needed for the requested edge or step output.
5. FastAPI receives a `geometryStructure` plus preview context such as `sourceKind` and `outputStepRefId`.
6. FastAPI builds a download-ready `geometryEntityJson`.
7. FastAPI calls the isolated Node worker to export the `geometryStructure` as GLB through `src/exporters/cad.js`.
8. FastAPI base64-encodes the generated GLB and returns `{ geometryEntityJson, glbBase64 }`.
9. The preview panel can call `POST /api/geometry-preview/step` with the same `geometryEntityJson.structure` to generate STEP AP242 without re-running the kernel.

## Child Process Export

GLB and STEP export both use:

```text
node apps/viewer/scripts/geometry-export-worker.mjs <format> <input-json> <output-file> <cad-exporter-js>
```

FastAPI creates a temporary working directory, writes `geometry-structure.json`, starts the worker, waits for completion, reads the output file, and removes the temporary directory.

Worker responsibilities:

1. Read the input geometry structure.
2. Import `src/exporters/cad.js`.
3. For `glb`, call `convertCad(geometryStructure, { formats: ["glb"] })`.
4. For `step`, export STEP AP242 with feature bodies.
5. Write the generated binary to the requested output path.

## Why The Worker Exists

OpenCascade.js loads a WebAssembly CAD kernel. Running export in a short-lived worker process isolates the WASM memory lifecycle from FastAPI and from the Next.js viewer process.

FastAPI is responsible for request validation, Python kernel execution, response assembly, timeout handling, and error reporting. The worker is responsible only for CAD conversion.

## Timeout And Failure Behavior

`GEOMETRY_PREVIEW_EXPORT_TIMEOUT_SECONDS` controls the worker timeout and defaults to `30`.

If the worker times out, exits non-zero, or fails to produce output, FastAPI returns an API error with the worker's stderr/stdout summary. Temporary files are scoped to the request and removed after the worker exits.

## Files

| File | Responsibility |
| --- | --- |
| `apps/api/src/process_flow_api/main.py` | FastAPI routes, request validation, kernel calls, response assembly. |
| `apps/api/src/process_flow_api/exporter.py` | Node worker orchestration for GLB and STEP export. |
| `apps/viewer/components/geometry-preview/geometry-preview-client.ts` | Browser API client helpers for preview and STEP export. |
| `apps/viewer/components/geometry-preview/geometry-preview-panel.tsx` | Preview overlay UI and download actions. |
| `apps/viewer/scripts/geometry-export-worker.mjs` | Isolated OpenCascade GLB/STEP worker. |
| `src/exporters/cad.js` | JavaScript CAD conversion implementation. |
