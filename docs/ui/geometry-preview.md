# Geometry Preview UI Design

## Location

Geometry Preview is an overlay used inside the process flow editors. It is not a standalone route.

| File | Responsibility |
| --- | --- |
| `apps/viewer/components/geometry-preview/geometry-preview-panel.tsx` | Overlay shell, loading/error/ready state, export actions. |
| `apps/viewer/components/geometry-preview/cdb-export-dialog.tsx` | Modal form for JSON, STEP, and CDB export output paths. |
| `apps/viewer/components/geometry-preview/cdb-export-jobs-panel.tsx` | Editor-level export request drawer, job polling, cancellation, and hover details. |
| `apps/viewer/components/geometry-preview/cdb-export-client.ts` | Browser client id, export job creation, list, and cancel helpers. |
| `apps/viewer/components/geometry-preview/geometry-preview-client.ts` | Client helpers for FastAPI preview calls. |
| `apps/api/src/process_flow_api/main.py` | Preview request validation, Python kernel execution, response assembly. |
| `apps/api/src/process_flow_api/exporter.py` | GLB and STEP export through the Python CadQuery/OCP worker. |

The preview UI stays separate from the flow graph component. The graph owns topology and field editing. The preview overlay owns rendering and snapshot export actions. The flow editors own the persistent export request drawer so request state survives closing the preview overlay.

## Goal

Geometry Preview lets an engineer inspect a geometry state while editing a draft process flow:

- The geometry entering a target field from an initial geometry reference.
- The output geometry produced by an upstream process step.
- The terminal output geometry of a step.

Opening a preview never changes the draft and never saves data.

## Entry Points

Every geometry flow edge can expose a preview button.

| Source | Preview result |
| --- | --- |
| `geometryRef` | The selected `GeometryEntity` after passing through the preview execution path. |
| `stepOutput` | The source process step's output geometry. |

Step output preview can also be requested directly with `target.type: "stepOutput"` and a `stepRefId`.

## Enabled State

Preview button enabled state checks only the dependencies needed to produce that preview.

For `geometryRef` edge preview:

- The target field must contain a non-empty `GeometryEntity.id`.
- The id must exist in the current geometry repository or request snapshot.
- Downstream fields after the preview target do not block the preview.

For `stepOutput` preview:

- The source step and all upstream dependencies must be complete.
- Downstream steps after the source output do not block the preview.

Disabled preview buttons remain visible and use a concise tooltip such as `Select initial geometry first` or `Complete upstream fields first`.

## Overlay Behavior

The preview opens as a full-page overlay above the graph:

- It does not navigate away from the editor.
- The graph remains visible through a dim background.
- The graph is not interactive while preview is open.
- Closing the preview does not modify the draft instance.

Close actions:

- Close icon button.
- Escape key.
- Dim background click.

## Panel Structure

| Area | Content |
| --- | --- |
| Header | Title, source/target context, status badge, close button. |
| Main viewport | Generated GLB in the shared CAD viewer scene. |
| Side controls | Section, camera, grid, and axes controls reused from CAD viewer behavior. |
| Footer actions | `Export JSON`, `Export STEP AP242`, `Export CDB`. |

The panel should feel like an engineering inspection tool: dense, legible, and restrained.

## Loading State

When the user starts a preview:

- The overlay opens immediately.
- The panel shows a loading state while FastAPI runs preview execution and GLB export.
- Download buttons are disabled.
- The user may close the panel while the request is in flight.
- A completed request must not update a closed panel.

Loading text:

```text
Generating geometry preview...
```

## Error State

If validation, kernel execution, or CAD export fails:

- The panel remains open.
- The error message is shown inside the panel.
- Download buttons stay disabled.
- The graph draft is unchanged.

The displayed message should use the concise API error message.

## Ready State

After success:

- The generated GLB loads into the shared CAD viewer scene.
- The generated geometry JSON stays in memory for export.
- JSON, STEP, and CDB actions use the exact same preview snapshot.
- The graph draft remains unchanged.

Viewer controls should include:

- Orbit, pan, and zoom.
- Camera fit.
- Grid toggle.
- Axes toggle.
- Section plane controls.

## Exports

| Button | Output |
| --- | --- |
| `Export JSON` | Import-ready `GeometryEntity` JSON with `id: null`, written to an absolute `.json` path. |
| `Export STEP AP242` | STEP AP242 generated from the preview snapshot, written to an absolute `.step` path. |
| `Export CDB` | Server-side text CDB export job written to an absolute `.cdb` path. |

JSON, STEP AP242, and CDB are server-side export jobs. They do not create
database records, but they do appear in the editor export requests drawer.

Clicking any export action opens the export dialog, starts a server-side job,
and writes directly to the requested absolute path.

Export job creation calls:

```http
POST /api/geometry-preview/export-jobs
```

with:

```json
{
  "clientId": "browser-generated-client-token",
  "kind": "json | step | cdb",
  "geometryStructure": {},
  "geometryEntityJson": {},
  "elementSize": 500,
  "outputPath": "/absolute/path/model.step",
  "sourceLabel": "Panel -> main_geometry"
}
```

The request uses `geometryEntityJson` or `geometryEntityJson.structure` from the
ready preview response. It does not re-read the current graph draft and does not
re-run the kernel.

## Export Dialog

Export footer actions are enabled only when the preview is ready.

Clicking an action opens a modal above the preview overlay. The modal is rendered through a portal on `document.body` so it stays above the editor export drawer.

Dialog content:

| Area | Content |
| --- | --- |
| Header | Format icon, `Export JSON` / `Export STEP` / `Export CDB`, source label, close icon. |
| Body | `Output path` input. CDB also shows `Element size`. |
| Error | Inline destructive message when validation or job creation fails. |
| Footer | `Cancel` and `Export` actions. |

Client-side validation:

- CDB `elementSize` must be a finite number greater than `0`.
- `outputPath` must be non-empty.
- `outputPath` must be an absolute path beginning with `/`.
- `outputPath` must end with the selected format's suffix: `.json`, `.step`, or `.cdb`, case-insensitive.

The server repeats path validation. Uppercase suffixes are accepted and normalized
to lowercase. The parent folder must already exist. Existing files are
overwritten by the server-side job.

Submit behavior:

- The dialog sends `POST /api/geometry-preview/export-jobs` with the ready preview snapshot.
- The request includes a browser-generated `clientId`.
- The `Export` button shows a spinner while the create-job request is in flight.
- If job creation succeeds, the dialog closes and the editor export requests drawer opens.
- If job creation fails, the dialog stays open and shows the API error message.

## Export Requests Drawer

The export requests drawer is mounted at the flow editor level, not inside the preview overlay. It is visible in both `/flow-instance-editor` and `/flow-template-editor`.

Collapsed state:

- Fixed to the right edge at vertical center.
- Size is `40px` wide by `64px` high.
- Shape is a left-rounded tab with a border, white background, and viewport shadow.
- Content is icon-only: left chevron above export icon.
- Accessible label and title are `Open export requests`.
- If at least one job is `queued`, `running`, or `canceling`, a small primary dot appears on the tab.

Expanded state:

- Fixed to the right edge at vertical center.
- Width is `min(420px, calc(100vw - 16px))`.
- Maximum height is `min(78vh, 640px)`.
- The drawer opens from right to left and uses a left-rounded border.
- The drawer z-index is above the preview overlay. The export dialog uses a higher z-index.

Drawer structure:

| Area | Content |
| --- | --- |
| Header | Export icon, `Export requests`, active/recent count, `Running` or `Idle` badge, collapse button. |
| Body | Error banner, empty state, and job rows. |
| Footer | `Showing the latest 20 requests for this browser.` |

The drawer always has a collapsed affordance, even when there are no jobs. Empty state text is:

```text
No export requests
Exports created from preview will appear here.
```

Job ownership:

- The browser creates and stores a stable `clientId`.
- Job list requests always include `clientId`.
- The backend returns only jobs owned by that `clientId`.
- The drawer shows the latest 20 jobs for the browser.
- A newly created job is seeded into the drawer immediately and causes the drawer to expand.

Polling:

- Poll every `1800ms` when any visible job is `queued`, `running`, or `canceling`.
- Poll every `5000ms` when all visible jobs are terminal.
- Polling errors appear as a destructive banner in the drawer body.

Job row content:

- Status icon.
- Format icon.
- Source label, or `{FORMAT} export` fallback.
- Status badge.
- Output path in monospace.
- Success summary. CDB shows element count, node count, component count, and duration; JSON and STEP show format and duration.
- Non-success message, clamped to two lines.
- Warning message, clamped to two lines.
- Cancel icon button for `queued` and `running` jobs.

Hover detail:

- Desktop hover or pointer movement over a job row shows a read-only detail popover to the left of the drawer.
- The popover width is `min(520px, calc(100vw - 464px))`.
- The popover maximum height is `min(70vh, 420px)` and scrolls vertically.
- The popover shows full source label, kind, status, output path, duration, created time, started time, finished time, job id, full message, and full warning.
- CDB job details also show element size and mesh summary.
- The row also has a native `title` with the same essential content so long messages remain accessible when the popover is unavailable.

## API Contract

Preview request:

```json
{
  "target": {
    "type": "edge",
    "previewEdgeId": "edge_initial_panel_to_pnp"
  },
  "sourceLabel": "Panel -> PnP",
  "flowTemplate": {},
  "draftInstance": {},
  "geometries": [],
  "processStepTemplates": []
}
```

Terminal output preview request:

```json
{
  "target": {
    "type": "stepOutput",
    "stepRefId": "pnp_hbm"
  },
  "flowTemplate": {},
  "draftInstance": {}
}
```

`geometries` and `processStepTemplates` are optional snapshots. When omitted, FastAPI resolves them from SQLite.

Preview response:

```json
{
  "geometryEntityJson": {
    "id": null,
    "category": "preview.generated",
    "entityType": "preview",
    "name": "Preview - Panel -> PnP output",
    "structureFormat": "standard",
    "structure": {}
  },
  "glbBase64": "..."
}
```

Export job request:

```json
{
  "clientId": "browser-generated-client-token",
  "kind": "step",
  "geometryStructure": {},
  "geometryEntityJson": {},
  "elementSize": null,
  "outputPath": "/absolute/path/model.step",
  "sourceLabel": "Panel -> main_geometry"
}
```

Export job response:

```json
{
  "job": {
    "jobId": "step_...",
    "clientId": "browser-generated-client-token",
    "kind": "step",
    "status": "queued",
    "sourceLabel": "Panel -> main_geometry",
    "outputPath": "/absolute/path/model.step",
    "elementSize": null,
    "createdAt": "2026-06-30T17:14:17.982428+00:00",
    "startedAt": null,
    "finishedAt": null,
    "durationSeconds": null,
    "nodeCount": null,
    "elementCount": null,
    "componentCount": null,
    "message": null,
    "warning": null
  }
}
```

Valid export job kinds are `json`, `step`, and `cdb`. Valid statuses are
`queued`, `running`, `success`, `failed`, `canceling`, and `canceled`.

Export job list:

```http
GET /api/export-jobs?clientId=browser-generated-client-token
```

Cancel job:

```http
POST /api/export-jobs/{jobId}/cancel

{
  "clientId": "browser-generated-client-token"
}
```

## Execution Semantics

Preview is read-only.

FastAPI validates the request, then calls the Python kernel's preview execution path. The kernel computes only the upstream closure required by the preview target:

- `geometryRef` preview resolves the selected geometry id.
- `stepOutput` preview executes the upstream steps needed to produce that source output.
- Terminal step output preview executes the requested step's upstream closure.

FastAPI calls the Python CadQuery/OCP exporter worker to convert the resulting `geometryStructure` into GLB for preview.

JSON, STEP, and CDB export jobs use the same ready preview snapshot. Job creation
does not re-run preview execution. JSON jobs write the import-ready
`GeometryEntity` payload. STEP jobs run the Python CAD worker and write STEP
AP242. CDB jobs run the Python mesher worker, build a `Dragger`, call
`Dragger.write(path)`, and update mesh counts for polling.

The text CDB artifact records mesh arrays in deterministic sections:

- `*NODES,index,x,y,z`
- `*ELEMENTS,index,n0,n1,n2,n3,n4,n5,n6,n7`
- `*ELEMENT_COMP,index,component_id`
- `*COMPS,component_id,name`

## Ownership Boundaries

| Layer | Responsibility |
| --- | --- |
| Flow editor | Maintains draft template and instance state. |
| Flow editor export drawer | Holds refresh state, displays browser-owned jobs, polls status, and sends cancel requests. |
| Preview panel | Sends draft data to FastAPI and manages overlay state. |
| Export dialog | Validates user input and creates JSON, STEP, or CDB export jobs from the ready preview snapshot. |
| FastAPI | Validates request, calls Python kernel, bridges CAD preview and export job creation. |
| Python kernel | Resolves flow graph and process step execution. |
| Python CAD exporter | Converts geometry structure to GLB or STEP AP242. |
| Python mesher exporter | Converts geometry structure to a `Dragger` and writes the text CDB artifact through `Dragger.write(path)`. |

General UI code should treat `GeometryEntity.structure` as an opaque payload and pass it to preview/export/viewer code when needed.
