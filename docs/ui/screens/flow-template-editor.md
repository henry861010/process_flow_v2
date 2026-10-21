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
edges. Its compact white toolbar separates Home and `Start from…` on the left from `Save Draft`
and the only filled primary command, `Save…`, on the right. The title is 16px with a 12px flow
name underneath (active draft name, template name, then `Untitled flow`). Buttons are 36px high.
At narrow widths navigation and save actions occupy two rows without hiding their labels.
The geometry library, graph and process-step library retain their existing layout.

## Source selection and progress

`Start from…` opens a 720px dialog with keyboard-accessible Templates and Drafts tabs.
Templates are searchable by name/version/owner and show their status. Selecting a row does
not replace the graph: `Use template` creates a new working copy only after confirmation.
Disabled templates remain inspectable, with disabled step references blocking formal save.
Missing step dependencies are reported in the dialog before any working state is replaced.
Drafts offer name/user search and user filtering, sorted newest first; select a row then use
`Resume draft`. Draft deletion is a separate icon command and confirmation.

The compact status strip independently shows `Not saved`, `Unsaved changes`, `Saving…`, or
`Draft saved · time` and a Flow/Configuration issue count. The issue count expands a bounded,
scrollable list. Notifications and request failures appear separately and do not conceal
progress or readiness. No automatic saving is implied.
Home and source replacement protect unsaved changes with a named dialog offering
`Keep editing` and `Discard changes`; browser unload retains its native protection.

## Formal save dialog

`Save…` can open even when topology or configuration is incomplete. A 760px dialog titled
`Save flow` presents radio cards for Template only and Template & Instance, defaulting to
Template & Instance for each new source. Switching modes and cancel/reopen retain metadata
and the selected mode. Template only hides instance fields and can submit with incomplete
configuration. Invalid topology or disabled steps block both modes; incomplete instance
configuration is accepted in both modes. Blocking topology and metadata reasons remain visible.
Required name/version/owner fields show inline errors after submit and focus the first invalid
field. The footer stays fixed while the body scrolls. Dialogs trap focus, support Escape when
idle, and return focus on close, including nested source/delete confirmations.

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

`Save…` in Template & Instance mode displays separate template and instance metadata.
The instance's name, version, owner, and description follow the template until individually edited;
an edited field, including an explicitly cleared field, no longer follows template changes.
Cancel/reopen preserves edits. Loading another template or draft resets instance metadata overrides.
These overrides are session state and are not added to the template draft snapshot.

The combined command accepts incomplete instance configuration. It sends `initialConfiguration`
in `POST /api/process-flow-template-instances`, without caller-generated IDs or a caller-generated
relationship. The backend assigns both IDs, copies each provided station parameterValues into its
first immutable active recipe, retains generator parameters without executing them, and atomically
creates template, instance and any materialized embedded geometry. An active Template Draft uses
its revision-checked commit endpoint with the additional `processFlowInstance` payload instead.

Saving validates template name, version, owner, and topology. The dialog has no ID field;
`POST /api/process-flow-templates` omits `id`, and the server assigns a 32-character lowercase
UUID4 hex ID without a prefix.
Both save commands submit a fixed snapshot, prevent concurrent editor mutations and duplicate
submission. Template-only save returns Home; combined creation opens the new instance ID route. Failed saves retain the dialog, metadata, configuration,
and active draft. Required metadata validation applies to both records for combined save.

## Graph interaction

The step settings dialog shows the editable `Step label`, followed by a shared card containing
the process-step template name and full description, then a divider and `Parameters`. The card
omits the template ID. Descriptions preserve line breaks and wrap long tokens without horizontal
overflow; blank descriptions omit the description paragraph. The dialog does not list Input Ports.
Graph ports, connections, topology validation, Preview, and parameter controls keep their existing
behavior. Step labels remain disabled when topology is locked.

Single-click a step block to select it and start a pointer-following connection preview from its
output. Click the exact target input handle to commit; clicking a target block does not choose a
port. Validity and conflict replacement use the same rules as handle dragging. Invalid targets
preserve the preview and existing edges. Another step click switches the source; the same source,
blank pane, or Escape cancels. Double-click or the always-visible top-right pencil cancels the
preview and opens the existing step dialog. The pencil supports Tab and Enter/Space.
Geometry input single-click keeps its existing dialog behavior, and source handles support click
connections and dragging. Node dragging and target reconnect remain available. Replacing the
flow/draft, deleting the source, or entering saving/locked state clears the pending connection.
In topology-locked view mode, step single-click only selects; double-click and pencil still edit values.

## Acceptance

- `UI-FTE-001`: fresh editor provides catalog geometry, process steps, graph, draft commands, and the formal save command.
- `UI-FTE-002`: HBM/DRAM generator commands are available for working previews and new flow inputs;
  template save does not persist their bindings.
- `UI-FTE-003`: valid topology can save while preview-only configuration is incomplete.
- `UI-FTE-004`: scalar step values are saved as flow defaults; the source geometry category is saved as the flow-input contract, while its catalog id and collection values remain preview-only.
- `UI-FTE-005`: template-only save returns Home; combined save opens the newly created tracking instance.
- `UI-FTE-006`: valid topology and metadata enable combined creation even with missing inputs/parameters.
- `UI-FTE-007`: instance metadata follows template fields until edited; cancel/reopen preserves edits,
  and loading another template/draft resets them.
- `UI-FTE-008`: combined save persists arrays, repeat groups, placements, bindings, and recipes in the
  instance, while the template keeps topology and scalar defaults only.
- `UI-FTE-009`: failed combined save retains editor values and creates no partial resources;
  successful draft commit consumes only its source draft.

## Template availability

### Step library previews

Hovering a process-step card for 300ms opens a read-only preview, and keyboard focus opens it
immediately. The preview shows only the full step name and description. Blank descriptions are
omitted. Parameter information, controls, and addition/availability hints are not included.

The preview is portaled outside the scrolling library, prefers the card's left side, and falls
back to the right while keeping 12px viewport margins. It is at most 360px wide and 420px high,
shrinking to fit the viewport, with wrapping text and vertical scrolling. Its layer stays below
editor dialogs. Moving into the preview retains it for reading and scrolling; leaving both the
card and preview closes it after 150ms unless focus remains inside. Escape, adding, dragging,
library/page scrolling, and resizing dismiss it, including pending hover timers. Only one preview
is open at a time. Keyboard focus brings an offscreen card into view before positioning its
preview; the resulting automatic scroll does not dismiss it. Dismissing a focused preview returns
focus to its card. Disabled/locked cards retain a focusable preview wrapper while their native
add button stays disabled and cannot be dragged. Native title tooltips are not used.

Acceptance `UI-FTE-STEP-PREVIEW-001`: verify hover/focus, switching cards, moving into and scrolling
the preview, Escape, leave delay, library scroll and resize dismissal, and existing click/drag
addition. `UI-FTE-STEP-PREVIEW-002`: verify previews show only name and description, disabled/locked
previews cannot add steps, blank descriptions, long text, and viewport-edge placement.

Disabled steps remain in the library with a Disabled text badge; clicking and dragging them into
a new flow is disabled. Starting from a saved template preserves its disabled step references for
inspection and preview. Because this creates a new flow, Save Template is blocked until those steps
are removed, replaced, or re-enabled, and the editor names the blocking steps. The backend enforces
the same rule for changes occurring after page load. Already-saved flows keep their references.

## Editor drafts

Save Draft requires separate user/name and accepts incomplete topology or values. It snapshots metadata, complete configuration (including collections and recipes), node IDs/positions, edges/handles and viewport. `Start from…` → Drafts opens the searchable picker showing name, user and updated time; it offers user filtering and revision-checked deletion. The first Save Draft opens name/user fields. Subsequent clicks directly update the active draft using its saved identity; the adjacent menu offers Edit draft details and Save as new draft. Canceling detail edits does not rename a subsequent quick save. Failed updates preserve the active draft and show an error; revision conflicts never overwrite or retry automatically.

Loading restores exact working values without defaults, validates dependencies before replacing the graph, and resets transient dialogs/preview. Updating a loaded draft retains its identity; Save as New Draft creates another record. Dirty state tracks the last loaded/successfully saved snapshot and protects source replacement, Home and unload. Async draft saving does not erase newer changes. Formal Save Template uses the current editor payload and atomically consumes its draft; failures preserve it.

Save Template & Instance applies the same rule to both new resources: insert template, required
geometries and instance, then delete the active draft in one transaction, rechecking its revision
before any writes. A stale revision or any failure preserves the draft and rolls back all inserts.

Acceptance `UI-FTE-DRAFT-001`: save an unfinished graph, reload the page, load via Start from… → Drafts and verify positions/viewport, connections, metadata and full values. `UI-FTE-DRAFT-002`: verify update/new-copy, filtering, delete, missing dependencies, failed requests, stale revision and dirty confirmation. `UI-FTE-DRAFT-003`: verify either formal save consumes only the active draft; combined creation opens the new instance.


## Toolbar and dialog acceptance

- `UI-FTE-010`: toolbar exposes Home, Start from, Save Draft and Save, with only Save filled;
  the status strip independently presents progress and expandable readiness requirements.
- `UI-FTE-011`: selecting a source does not replace working contents; confirm uses the selected
  template/draft, cancellation retains changes, and dependency/load failure preserves the graph.
- `UI-FTE-012`: combined mode is the initial default; incomplete configuration prevents combined
  submission while template-only remains available. Switching/canceling preserves mode and fields;
  changing source restores combined mode and resets instance overrides.
- `UI-FTE-013`: first draft save asks for name/user; direct update opens no dialog, updates the same
  revision-checked identity, and marks only the submitted snapshot clean. Detail edits and new-copy
  saves are separate menu commands; failed/stale updates retain contents.
- `UI-FTE-014`: missing metadata shows inline errors and focuses the first invalid field. Keyboard
  focus stays in the topmost modal, Escape cancels only that modal, and focus returns to its trigger.
- `UI-FTE-015`: toolbar and dialogs fit 1440×900, 1024×768 and 390×844. Dialog footers remain visible
  with body scrolling. This does not change the desktop graph's existing minimum width contract.
