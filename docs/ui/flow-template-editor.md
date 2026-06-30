# Process Flow Template Editor UI Design

## Route

`/flow-template-editor`

## Purpose

The Flow Template Editor creates a new immutable `ProcessFlowTemplate` snapshot and its initial bound `ProcessFlowInstance`.

Users edit topology and instance values in one workflow:

- Add initial geometry nodes from the geometry library.
- Add process step nodes from process step templates.
- Connect geometry states to target step input slots.
- Fill the initial instance values.
- Preview geometry states and track server-side export requests.
- Save a new flow template and a new instance in one transaction.

Existing templates can be used as a starting point, but they are never updated in place.

## Shared Graph Boundary

This page uses shared Graph UI in `topologyEdit` mode.

Shared graph behavior is defined in `docs/ui/process-flow-graph.md`. This page owns:

- Left geometry palette.
- Right process step template palette.
- Technology and product metadata form.
- `Start from template` picker.
- Step instance dialog behavior for editable topology.
- Export requests drawer.
- Save validation and save API call.

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
POST /api/admin/seed

{ "mode": "ifEmpty" }
```

The returned bootstrap payload supplies:

| Field | Usage |
| --- | --- |
| `processStepTemplates` | Right-side process step template palette. |
| `processFlowTemplates` | `Start from template` picker. |
| `geometries` | Left-side initial geometry palette. |
| `processFlowInstances` | Not required for topology editing; available for consistency with Home bootstrap. |

Palette and selector UI should use metadata fields such as `id`, `name`, `category`, `version`, and `entityType`.

## Save API

Save calls:

```http
POST /api/process-flow-template-instances
Content-Type: application/json
```

Request body:

```json
{
  "processFlowTemplate": {},
  "processFlowInstance": {}
}
```

Response:

```json
{
  "processFlowTemplate": {},
  "processFlowInstance": {}
}
```

The server inserts both resources in one transaction. If either id is duplicated or validation fails, neither resource is committed.

After a successful save, the page returns to Home.

## Core Interaction Model

The editor models a geometry dataflow DAG.

Node types:

- Initial geometry node: a reference to a `GeometryEntity`.
- Process step node: a `StepRef` bound to a `ProcessStepTemplate` and draft field values.

Edge types:

- Initial geometry to target geometry field: `source.sourceType: "geometryRef"`.
- Process step output to target geometry field: `source.sourceType: "stepOutput"`.

Edge rules:

- Every edge has one source and one target field slot.
- Each target field slot has at most one incoming edge.
- A process step output has at most one outgoing edge.
- The graph must be acyclic.
- Multiple initial geometry nodes may reference the same `GeometryEntity.id`.
- `stepRefs[]` order is not process order; `flowEdges[]` is the topology source of truth.

## Metadata

The header metadata form contains:

- `Technology name`: required; saved as `ProcessFlowTemplate.name`.
- `Product / instance name`: optional; saved as `ProcessFlowInstance.name`; falls back to `Technology name`.

Header actions:

- Home.
- Start from template.
- Clear.
- Save.

`Technology name` is required before Save can succeed.

## Palettes

### Geometry Palette

The geometry palette lists `geometries` from bootstrap.

It displays:

- `name`
- `category`
- `entityType`
- `id`

Adding a geometry creates an initial geometry node. The editor does not parse `GeometryEntity.structure`.

### Process Step Template Palette

The process step palette lists `processStepTemplates` from bootstrap.

It displays:

- `name`
- `category`
- `version`
- field count
- `program`

Adding a step creates a draft process step node with a generated `stepRefId`.

## Start From Template

`Start from template` copies an existing `ProcessFlowTemplate` topology into the editable draft.

Behavior:

- Existing source template is not modified.
- Source template instances are not loaded.
- Metadata fields keep their current values.
- Imported steps get default or empty field values.
- Imported `geometryRef` edges create placeholder initial geometry nodes that must be mapped to concrete geometry records before Save.

If the current draft has nodes, edges, metadata, or field edits, starting from a template requires confirmation.

## Step Dialog

Clicking a process step node opens the field editor for that step instance.

Field behavior:

- Fields come from the selected step template `fieldDefinitions[]`.
- Non-geometry fields are edited directly.
- Geometry fields with incoming `geometryRef` edges store the selected `GeometryEntity.id`.
- Geometry fields with incoming `stepOutput` edges store `null`.
- Direct geometry select is allowed only for geometry fields not supplied by an edge.

The dialog updates the draft only.

## Clear

`Clear` removes all graph nodes, edges, step values, selection, and open preview state from the current draft.

It does not clear metadata fields and does not call the backend.

If the draft has content, Clear requires confirmation.

## Save Output

`ProcessFlowTemplate` output:

```json
{
  "id": "generated-template-id",
  "name": "Technology name",
  "version": "V1.0.0",
  "description": "",
  "owner": "process-flow",
  "stepRefs": [],
  "flowEdges": []
}
```

`ProcessFlowInstance` output:

```json
{
  "id": "generated-instance-id",
  "name": "Product / instance name",
  "processFlowTemplateId": "generated-template-id",
  "stepValueSets": []
}
```

Save rules:

- Template and instance ids are generated client-side.
- `ProcessFlowInstance.processFlowTemplateId` must match the new template id.
- Each node becomes one `stepRefs[]` item and one `stepValueSets[]` item.
- Each graph edge becomes one `flowEdges[]` item.
- Geometry DB ids are stored in target field values, not in saved edge objects.
- Step output geometry fields store `null`.

## Validation

Save is enabled only when:

- `Technology name` is non-empty.
- The draft contains at least one connected initial geometry root and one process step.
- Every process step node resolves to a process step template.
- Every required field is complete.
- Every `geometryRef` edge has a concrete existing geometry id.
- Each target field slot has at most one incoming edge.
- Each process step output has at most one outgoing edge.
- The graph is acyclic.

Validation should report the first actionable issue.

## Preview

Preview uses the same FastAPI preview contract as the Flow Instance Editor.

The preview request includes the draft template, draft instance, and optional repository snapshots. Preview never saves the draft.

## Export Requests Drawer

The page mounts the shared CDB export requests drawer at the editor root.

The drawer is independent from graph topology editing:

- It is visible before a preview is opened.
- It remains visible after a preview is closed.
- It does not participate in topology validation, save output, clear behavior, or `flowEdges[]`.
- It uses the browser's stable `clientId` to list only that browser's jobs.
- It receives newly created CDB jobs from the preview overlay through `onCdbJobCreated`.
- It polls job state through `GET /api/export-jobs?clientId=...`.

Collapsed state:

- Fixed to the right edge at vertical center.
- Icon-only tab with left chevron and database icon.
- Active dot appears when any visible job is `queued`, `running`, or `canceling`.

Expanded state:

- Opens from right to left.
- Width is `min(420px, calc(100vw - 16px))`.
- Header shows `Export requests`, active or recent count, and `Running` or `Idle`.
- Body shows an error banner, empty state, and the latest 20 CDB jobs for the browser.
- Footer states that the drawer is showing the latest 20 requests for this browser.

Job row behavior:

- `queued` and `running` jobs expose a cancel icon button.
- Terminal jobs remain in the recent list until they age out of the latest 20.
- Success rows show element count, node count, component count, and duration.
- Failure rows show a clamped error message in the row.
- Hovering a row on desktop opens a detail popover to the drawer's left with the full output path, element size, mesh summary, duration, timestamps, job id, full message, and warning.

The CDB export dialog is opened from the Geometry Preview footer. A successful job creation closes the dialog and opens this drawer.

## Abort

Abort discards the current draft and returns to Home. No backend delete is needed because no resources exist until Save succeeds.
