# Geometry Preview UI Design

## Location

Geometry Preview is an overlay used inside the process flow editors. It is not a standalone route.

| File | Responsibility |
| --- | --- |
| `apps/viewer/components/geometry-preview/geometry-preview-panel.tsx` | Overlay shell, loading/error/ready state, download actions. |
| `apps/viewer/components/geometry-preview/geometry-preview-client.ts` | Client helpers for FastAPI preview and STEP export calls. |
| `apps/api/src/process_flow_api/main.py` | Preview request validation, Python kernel execution, response assembly. |
| `apps/api/src/process_flow_api/exporter.py` | GLB and STEP export through the Python CadQuery/OCP worker. |

The preview UI stays separate from the flow graph component. The graph owns topology and field editing; the preview overlay owns rendering and download behavior.

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
- Dim background click, as long as it does not conflict with future graph interactions.

## Panel Structure

| Area | Content |
| --- | --- |
| Header | Title, source/target context, status badge, close button. |
| Main viewport | Generated GLB in the shared CAD viewer scene. |
| Side controls | Section, camera, grid, and axes controls reused from CAD viewer behavior. |
| Footer actions | `Save JSON`, `Save GLB`, `Save STEP AP242`, `Export CDB`. |

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
- The generated geometry JSON stays in memory for download.
- The STEP action uses the exact same preview snapshot.
- The graph draft remains unchanged.

Viewer controls should include:

- Orbit, pan, and zoom.
- Camera fit.
- Grid toggle.
- Axes toggle.
- Section plane controls.

## Downloads

| Button | Output |
| --- | --- |
| `Save JSON` | Import-ready `GeometryEntity` JSON with `id: null`. |
| `Save GLB` | Generated binary GLB. |
| `Save STEP AP242` | STEP AP242 generated from the preview snapshot. |
| `Export CDB` | Server-side placeholder CDB export job written to an absolute `.cdb` path. |

Downloads are local browser downloads. They do not create database records.
`Export CDB` does not download through the browser. It starts a server-side job
that writes directly to the requested absolute path and appears in the preview
request list.

`Save STEP AP242` calls:

```http
POST /api/geometry-preview/step
```

with:

```json
{
  "geometryStructure": {}
}
```

The request uses `geometryEntityJson.structure` from the ready preview response. It does not re-read the current graph draft and does not re-run the kernel.

Filename format:

- JSON: `geometry-preview-{target}.json`
- GLB: `geometry-preview-{target}.glb`
- STEP AP242: `geometry-preview-{target}.step`

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

STEP response:

```json
{
  "stepBase64": "..."
}
```

CDB job request:

```json
{
  "clientId": "browser-generated-client-token",
  "geometryStructure": {},
  "elementSize": 500,
  "outputPath": "/absolute/path/model.cdb",
  "sourceLabel": "Panel -> main_geometry"
}
```

CDB job response:

```json
{
  "job": {
    "jobId": "cdb_...",
    "status": "queued",
    "outputPath": "/absolute/path/model.cdb"
  }
}
```

## Execution Semantics

Preview is read-only.

FastAPI validates the request, then calls the Python kernel's preview execution path. The kernel computes only the upstream closure required by the preview target:

- `geometryRef` preview resolves the selected geometry id.
- `stepOutput` preview executes the upstream steps needed to produce that source output.
- Terminal step output preview executes the requested step's upstream closure.

FastAPI then calls the Python CadQuery/OCP exporter worker to convert the resulting `geometryStructure` into GLB or STEP.

## Ownership Boundaries

| Layer | Responsibility |
| --- | --- |
| Flow editor | Maintains draft template and instance state. |
| Preview client | Sends draft data to FastAPI and manages overlay state. |
| FastAPI | Validates request, calls Python kernel, bridges CAD export. |
| Python kernel | Resolves flow graph and process step execution. |
| Python CAD exporter | Converts geometry structure to GLB or STEP AP242. |

General UI code should treat `GeometryEntity.structure` as an opaque payload and pass it to preview/export/viewer code when needed.
