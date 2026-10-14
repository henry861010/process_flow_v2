---
title: Flow Template Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-14
last_verified_commit: 990aaf71
source_of_truth:
  - apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx
---

# Flow Template Editor

Route: `/flow-template-editor`

## Purpose

This editor authors immutable process-flow topology: metadata, flow inputs, step references, and
edges. The header contains Home, `Start from template...`, `Save Draft`, `From Draft`, `Save Template`,
and the primary command `Save Template & Instance`.

## Working configuration

The left library offers catalog geometry and generators with `templateGeometryLibrary` placement.
The geometry input picker offers generators with `flowInputPicker` placement that also match the input's
geometry constraints. HBM and DRAM are selected from catalog geometry. A generator can define a new flow
input or serve as the working binding of an existing input. Its parameter editor and preview use the
backend registry; defining it does not create a geometry catalog record.

Geometry bindings remain working state until explicitly saved with an instance. Step parameter values initialize from the
step template's `defaultValue`; `Save Template` snapshots currently populated scalar values into
the corresponding `StepRef.parameterDefaults`. Array values, repeat groups, and placements remain
working state and are never persisted by `Save Template`; `Save Template & Instance` preserves
them in the instance's complete configuration.

Adding a catalog geometry or generator creates a flow input whose
`geometryConstraints.categories` contains that geometry's category. The category is part of the
saved template contract, while the selected catalog geometry id or generator recipe remains a
working binding that is persisted only by combined save.
Catalog geometry with an omitted or blank category uses an `entityTypes` constraint instead;
the library groups these records under `uncategorized`.
Before saving, the author may adjust the allowed category list in Advanced settings. The saved
template's topology and geometry constraints are immutable.

`Save Template & Instance` opens the shared dialog with separate template and instance metadata.
The instance's name, version, owner, and description follow the template until individually edited;
an edited field, including an explicitly cleared field, no longer follows template changes.
Cancel/reopen preserves edits. Loading another template or draft resets instance metadata overrides.
These overrides are session state and are not added to the template draft snapshot.

The combined command requires complete instance configuration using the same validation as the
instance editor. Missing inputs or step parameters appear in a visible requirements list, and the
command remains disabled until they are resolved. Zero PnP placements skip unused die branches;
their values and recipes are retained. Template-only save remains available with incomplete values.

Combined save uses `POST /api/process-flow-template-instances`, without caller-generated IDs or
a caller-generated instance/template relationship. The backend assigns both IDs, compiles and
canonicalizes the configuration, preserves generator recipes without creating catalog geometry,
and atomically creates both resources. An active template draft uses its revision-checked commit
endpoint with the additional `processFlowInstance` payload instead.

Saving validates template name, version, owner, and topology. The dialog has no ID field;
`POST /api/process-flow-templates` omits `id`, and the server assigns a 32-character lowercase
UUID4 hex ID without a prefix.
Both save commands submit a fixed snapshot, prevent concurrent editor mutations and duplicate
submission, and return Home on success. Failed saves retain the dialog, metadata, configuration,
and active draft. Required metadata validation applies to both records for combined save.

## Acceptance

- `UI-FTE-001`: fresh editor provides catalog geometry, process steps, graph, draft commands, and the formal save command.
- `UI-FTE-002`: HBM/DRAM generator commands are available for working previews and new flow inputs;
  template save does not persist their bindings.
- `UI-FTE-003`: valid topology can save while preview-only configuration is incomplete.
- `UI-FTE-004`: scalar step values are saved as flow defaults; the source geometry category is saved as the flow-input contract, while its catalog id and collection values remain preview-only.
- `UI-FTE-005`: successful template-only or combined save returns Home with the new template available.
- `UI-FTE-006`: complete configuration enables combined save; missing inputs/parameters disable it
  with visible requirements, while template-only save remains available.
- `UI-FTE-007`: instance metadata follows template fields until edited; cancel/reopen preserves edits,
  and loading another template/draft resets them.
- `UI-FTE-008`: combined save persists arrays, repeat groups, placements, bindings, and recipes in the
  instance, while the template keeps topology and scalar defaults only.
- `UI-FTE-009`: failed combined save retains editor values and creates no partial resources;
  successful draft commit consumes only its source draft.

## Template availability

Disabled steps remain in the library with a Disabled text badge; clicking and dragging them into
a new flow is disabled. Starting from a saved template preserves its disabled step references for
inspection and preview. Because this creates a new flow, Save Template is blocked until those steps
are removed, replaced, or re-enabled, and the editor names the blocking steps. The backend enforces
the same rule for changes occurring after page load. Already-saved flows keep their references.

## Editor drafts

Save Draft requires separate user/name and accepts incomplete topology or values. It snapshots metadata, complete configuration (including collections and recipes), node IDs/positions, edges/handles and viewport. From Draft opens the searchable shared picker showing name, user and updated time; it offers user filtering and revision-checked deletion.

Loading restores exact working values without defaults, validates dependencies before replacing the graph, and resets transient dialogs/preview. Updating a loaded draft retains its identity; Save as New Draft creates another record. Dirty state tracks the last loaded/successfully saved snapshot and protects source replacement, Home and unload. Async draft saving does not erase newer changes. Formal Save Template uses the current editor payload and atomically consumes its draft; failures preserve it.

Save Template & Instance applies the same rule to both new resources: insert template, required
geometries and instance, then delete the active draft in one transaction, rechecking its revision
before any writes. A stale revision or any failure preserves the draft and rolls back all inserts.

Acceptance `UI-FTE-DRAFT-001`: save an unfinished graph, reload the page, load via From Draft and verify positions/viewport, connections, metadata and full values. `UI-FTE-DRAFT-002`: verify update/new-copy, filtering, delete, missing dependencies, failed requests, stale revision and dirty confirmation. `UI-FTE-DRAFT-003`: verify either formal save consumes only the active draft and returns Home.
