# Process Flow Instance Editor UI Design

## Route

`/flow-instance-editor`

## Purpose

The Flow Instance Editor creates a new `ProcessFlowInstance` from an existing immutable `ProcessFlowTemplate`.

This page is for instance-level editing only:

- Select an existing flow template.
- Select initial geometry records.
- Fill process step field values.
- Preview geometry states.
- Track server-side export requests.
- Save one new process flow instance.

The page does not edit topology and does not create or update flow templates.

## Shared Graph Boundary

This page uses shared Graph UI in `readonlyTopology` mode. The graph structure is locked, but instance data remains editable:

- Initial geometry selection.
- Step field values.
- Product / instance name.
- Geometry preview.
- Export requests drawer.

Shared node, edge, slot, preview button, pan/zoom, and topology mode behavior is defined in `docs/ui/process-flow-graph.md`.

## Technology

- React
- TypeScript
- Next.js
- shadcn/ui
- Tailwind CSS
- lucide-react icons
- `@xyflow/react`

## Data Source

The page reads catalog data from FastAPI through `apps/viewer/lib/process-flow-api.ts`.

Initial load uses:

```http
GET /api/bootstrap
```

The returned bootstrap payload supplies:

| Field | Usage |
| --- | --- |
| `processFlowTemplates` | Template selector source. |
| `processStepTemplates` | Resolves each selected template `stepRefs[].processStepTemplateId`. |
| `geometries` | Initial geometry picker source. |
| `processFlowInstances` | Not required for draft editing; available for consistency with Home bootstrap. |

The selector UI uses resource metadata such as `id`, `name`, `version`, and `category`. It does not parse geometry internals.

## Save API

Save calls:

```http
POST /api/process-flow-instances
Content-Type: application/json
```

Request body is the new `ProcessFlowInstance`.

Response is the created `ProcessFlowInstance`.

After a successful save, the page navigates to Home.

## Save Output

```json
{
  "id": "generated-instance-id",
  "name": "Product / instance name",
  "processFlowTemplateId": "flow_tpl_cowosl_demo_1_0_0",
  "stepValueSets": [
    {
      "stepRefId": "pnp_hbm",
      "processStepTemplateId": "step_tpl_pnp_1_0_0",
      "fieldValues": [
        {
          "fieldId": "main_geometry",
          "value": "geom_example_panel"
        }
      ]
    }
  ]
}
```

Save rules:

- `id` is generated client-side at save time.
- `processFlowTemplateId` must equal the selected `ProcessFlowTemplate.id`.
- `name` comes from the required `Product / instance name` field.
- `stepValueSets[]` are built only from selected template `stepRefs[]`.
- Each `StepValueSet.stepRefId` must match a selected template step ref.
- Each `StepValueSet.processStepTemplateId` must match the selected template step ref.
- `stepLabel` is read from the selected `ProcessFlowTemplate.stepRefs[]`; it is
  displayed in the instance editor but not copied into `StepValueSet`.
- `fieldValues[]` follow the resolved process step template `fieldDefinitions[]`.
- All field definitions are required.
- A geometry field supplied by a `geometryRef` edge stores the selected `GeometryEntity.id`.
- A geometry field supplied by a `stepOutput` edge stores `null`.

The server validates the instance against the selected template and process step templates before inserting it.

## Initial State

When the page opens:

- The graph area shows an empty state.
- Template selector is visible.
- `Product / instance name` is empty.
- Save is disabled.
- Home navigation is available.

The empty state only prompts the user to select a flow template.

## Header

Header contains:

- Page title.
- Top-right Home button.
- Top-right Cancel and Save actions.
- `Product / instance name` required input.
- Process flow template selector.
- Selected template name and version after selection.

`Product / instance name` is reset when the user confirms switching templates.

## Template Selection

The template selector lists `processFlowTemplates` from bootstrap.

If no templates exist:

- Selector shows no options.
- Graph stays empty.
- Status strip says no template is selected.
- Save stays disabled.

After selecting a template:

- The graph renders the selected template topology.
- Step templates are resolved from `processStepTemplates`.
- Draft field values are initialized from field defaults or empty values.
- Initial geometry circles start unselected.
- `Product / instance name` starts empty.

If a process step template cannot be resolved:

- The affected step cannot be rendered as an editable process step node.
- Validation reports the missing step template.
- Save stays disabled.

Switching templates with draft edits requires confirmation. Confirming clears:

- Product / instance name.
- Geometry selections.
- Step field values.
- Open dialogs and selected graph node.

## Layout

The graph uses left-to-right dataflow layout:

- Circular nodes are initial geometry selections.
- Rectangular nodes are process steps.
- Edges represent geometry state flow.
- Users may pan and zoom.
- Users may not drag nodes, create edges, delete edges, reconnect edges, or otherwise modify topology.

The layout prioritizes readable process depth and merge paths over decorative presentation.

## Initial Geometry Picker

Clicking an initial geometry node opens a geometry picker backed by `geometries` from bootstrap. The picker uses the same shared category browser pattern as the Flow Template Editor palettes.

Category model:

- `GeometryEntity.category` is the only hierarchy source.
- `.` separates category path segments.
- Empty category values are displayed under `uncategorized`.
- Root displays the first category segment for every geometry.
- Category folders are sorted alphabetically.
- Geometry cards keep repository order within their direct category level.

Navigation model:

- The picker displays a clickable breadcrumb in the form `Root / segment / segment`.
- The breadcrumb is an unframed inline path indicator, not a card or category folder.
- Clicking `Root` returns to the root category level.
- Clicking a breadcrumb segment returns to that category level.
- If the current level has no direct geometry and exactly one child folder, the browser advances through that single-child chain automatically.
- The breadcrumb always shows the resolved full path after automatic advancement.

Level content:

- Child category folders appear before geometry cards.
- A folder represents the next category segment and is navigation only.
- A folder is not selectable as a geometry because it can contain multiple geometry records.
- Geometry cards appear only at their exact category path. For example, `die.hbm` records appear under `Root / die / hbm`, not under `Root / die`.

Geometry cards display:

- `name`
- `version`
- `id`
- `entityType`
- `description`

Selecting a geometry writes that id into the target step field value for the corresponding `geometryRef` edge.

Search:

- The search input matches `name`, `id`, `version`, `category`, `entityType`, and `description`.
- Search results are a flat list across all category paths.
- Search results do not render category folders or category grouping.
- Each search result card displays its full category path beneath the geometry name.
- The currently selected geometry remains highlighted when it appears in the active view.

The picker does not inspect `GeometryEntity.structure`.

If the selected geometry id disappears from the loaded repository snapshot, validation marks the draft invalid.

## Step Dialog

Clicking a process step node opens its instance field editor.

The dialog renders fields from the resolved `ProcessStepTemplate.fieldDefinitions[]`.

Field value behavior:

- Non-geometry fields are edited directly in the dialog.
- Geometry fields supplied by `geometryRef` edges are shown as graph-provided and use the selected geometry id.
- Geometry fields supplied by `stepOutput` edges are shown as graph-provided and store `null`.
- Geometry fields with no incoming edge can use a direct geometry select when the UI exposes that control.

The dialog edits draft state only. Save is the only action that writes to the backend.

## Validation

Save is enabled only when:

- A template is selected.
- Product / instance name is non-empty.
- All selected template step refs resolve to process step templates.
- Required field values are complete.
- Initial geometry ids required by `geometryRef` edges are selected and exist.
- Step output geometry fields use `null`.
- The flow graph validates as acyclic, one incoming edge per target slot, and no step output fan-out.

Validation messages identify the first actionable issue.

## Preview

Preview buttons call FastAPI preview endpoints through the shared preview client.

For an edge preview:

```json
{
  "target": {
    "type": "edge",
    "previewEdgeId": "edge_id"
  },
  "flowTemplate": {},
  "draftInstance": {},
  "geometries": [],
  "processStepTemplates": []
}
```

For terminal step output preview:

```json
{
  "target": {
    "type": "stepOutput",
    "stepRefId": "step_ref_id"
  },
  "flowTemplate": {},
  "draftInstance": {}
}
```

Preview is read-only. It never saves the draft instance.

## Export Requests Drawer

The page mounts the shared export requests drawer at the editor root.

The drawer is independent from the preview overlay:

- It is visible on the editor page before a preview is opened.
- It remains visible after a preview is closed.
- It uses the browser's stable `clientId` to list only that browser's jobs.
- It receives newly created export jobs from the preview overlay through `onExportJobCreated`.
- It polls job state through `GET /api/export-jobs?clientId=...`.

Collapsed state:

- Fixed to the right edge at vertical center.
- Icon-only tab with left chevron and export icon.
- Active dot appears when any visible job is `queued`, `running`, or `canceling`.

Expanded state:

- Opens from right to left.
- Width is `min(420px, calc(100vw - 16px))`.
- Header shows `Export requests`, active or recent count, and `Running` or `Idle`.
- Body shows an error banner, empty state, and the latest 20 export jobs for the browser.
- Footer states that the drawer is showing the latest 20 requests for this browser.

Job row behavior:

- `queued` and `running` jobs expose a cancel icon button.
- Terminal jobs remain in the recent list until they age out of the latest 20.
- CDB success rows show element count, node count, component count, and duration. JSON and STEP success rows show format and duration.
- Failure rows show a clamped error message in the row.
- Hovering a row on desktop opens a detail popover to the drawer's left with the full output path, kind, duration, timestamps, job id, full message, and warning. CDB details also show element size and mesh summary.

The export dialog is opened from the Geometry Preview footer. A successful job creation closes the dialog and opens this drawer.

## Cancel

Cancel discards the current draft and returns to Home. It does not call a delete API because no resource is created until Save succeeds.
