---
title: Flow Instance Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-21
last_verified_commit: 04a77e132dd0777e3ddc029dd77f56a0c25b0692
source_of_truth:
  - apps/viewer/components/process-flow-instance-editor/process-flow-instance-editor.tsx
  - apps/viewer/lib/process-flow/instance-editor.ts
---

# Flow Instance Editor

Routes: `/flow-instance-editor?templateId=<id>` for Create, and
`/flow-instance-editor?instanceId=<id>` for an existing tracking instance.

## Create

A template route shows name, version (default `V0.0.0`), owner and description before configuration.
`Create Instance` requires valid metadata and an enabled template; geometry and recipes may be empty.
An optional same-template source copies its current active recipes and input bindings into
`initialConfiguration`. Source identity and inactive recipes are not copied. Blank creation does not
create recipes or copy template defaults. Success opens the assigned instance ID route.
Missing template/instance IDs preserve the shell and expose Home with a recoverable error.

## Instance management

Home and Management offer links to reopen saved instances. The header shows instance identity,
fixed template and revision. A persistent, solid primary `Return Home` link with a left arrow sits
at the top left, separated from the editor identity and wrapping above it on narrow screens. The
link is unavailable during an in-flight update. There is no Reload instance, global Save Instance or
Save Draft. A status row reports stored revision or applying progress and expandable readiness issues.
Instance metadata and topology stay fixed. Disabled templates block new creation, while existing
instances remain manageable and executable.

The existing graph layout, zoom, pan and fixed topology are retained. A step double-click or pencil
opens station recipes. Clicking a geometry input opens the shared geometry picker. Selection in the
picker is local until `Apply geometry`; clearing the selection also requires Apply. Generator editing
returns to the picker for review. Each mutation persists immediately with the current revision;
failures preserve pending content. A stale revision shows the server message and directs the user
to Return Home and reopen the instance for the latest saved version, without automatic resubmission.

## Station recipes

The station dialog uses one column: the current step label and template description, the actual
active recipe's read-only parameters, then a compact list of saved recipes. Each row shows only
name and full ID, plus an Active badge and distinct background/border for the actual active recipe.
The selection indicator is independent of Active. Clicking a row selects it and expands its read-only
details below that row; only one row expands at a time. Clicking it again collapses the details while
retaining selection. Details include name, full ID, description, creation time, completeness and values.
Opening the dialog selects the active recipe with all row details collapsed.

Inspection never changes the active parameter panel or execution settings. The fixed footer contains
only `Add recipe` and `Set active`. The latter is disabled without a candidate, for the existing active
recipe, or during a request. Active content updates only after a successful API response. Empty
stations may have no active recipe; once any recipe exists, active can only be changed, never cleared.

`Add recipe` opens a separate dialog with a Start from selector. Template defaults copies defaults
(PnP starts with `placements: []`); a saved recipe copies its exact parameters and description without
applying defaults, and uses the original name plus `copy`. The form has name, description, parameter
controls and an optional Set as active when created checkbox. `Create recipe` accepts incomplete
parameters. The first recipe automatically becomes active; subsequent additions preserve active
unless requested. Success returns to the list with the new recipe selected and expanded. Saved
recipe content is immutable, including incomplete parameters, name and description.

Closing a modified form or switching its source asks Keep editing / Discard changes. Failed requests
retain the form while the editor remains open; there is no automatic resubmission. Browser
reload/close warns about edited pending content. Dialogs trap focus in the topmost dialog and return
it to the trigger. Content scrolls while the footer remains reachable at narrow viewport sizes.

## Readiness and preview

The client projects only active recipe parameterValues into `FlowConfiguration`, with current shared
inputBindings. A required executed station with no active recipe is incomplete even when it has no
required parameters. There is no fallback to another recipe or template defaults.

Readiness and preview follow the requested target's upstream dependencies. Zero PnP placements
ignore die geometry and its otherwise-unused upstream branch; main geometry remains required.
Unused branches retain their bindings and recipes and can be configured independently. Direct
preview of such a branch checks that branch's own active recipes and resources.

Changing active recipes or applying geometry recomputes readiness and closes the old live preview;
the next preview uses the new projection. Already-created preview/export snapshots remain immutable.
Shared geometry changes can affect all recipes' later outputs; the instance has no history of prior
active/geometry combinations.

## Acceptance

- `UI-FIE-001`: template entry offers Create; incomplete configuration does not block metadata creation.
- `UI-FIE-002`: source picker is template-scoped and copies only active settings with new recipe IDs.
- `UI-FIE-003`: blank creation initializes every station with no recipes and null active selection.
- `UI-FIE-004`: missing or mismatched template/instance IDs show recoverable errors.
- `UI-FIE-005`: creation opens the assigned instance route; Home and Management reopen it.
- `UI-FIE-006`: failed create/update preserves entered metadata or pending recipe/geometry choices.
- `UI-FIE-007`: previews and exports use only active settings and retain existing snapshots.
- `UI-FIE-008`: geometry picker retains existing category filtering and catalog/generator placements.
- `UI-FIE-009`: geometry selection, generator edits and clearing persist only on Apply geometry.
- `UI-FIE-010`: graph pan, zoom and fixed topology remain available.
- `UI-FIE-011`: new recipes use copied defaults/PnP zero placements; duplicates preserve exact values.
- `UI-FIE-012`: zero placements preserve unused-branch dependency behavior.
- `UI-FIE-013`: switching active recipes restores dependency validation without discarding other recipes.
- `UI-FIE-014`: first recipe auto-activates; later additions preserve selection unless requested.
- `UI-FIE-015`: saved recipe fields are read only; no recipe edit/delete action exists.
- `UI-FIE-016`: discarded or failed new-recipe forms cannot silently overwrite stored recipes.
- `UI-FIE-017`: stale revision preserves pending content while open and explains how to reopen the latest instance; no automatic retry.
- `UI-FIE-023`: a prominent arrow-and-text Return Home link stays visible at desktop and narrow widths; no instance reload controls remain.
- `UI-FIE-018`: keyboard focus remains visible and contained in the topmost dialog.
- `UI-FIE-020`: inspecting/expanding candidates leaves the actual active parameters unchanged.
- `UI-FIE-021`: nonempty stations always have an active recipe; no clear action exists.
- `UI-FIE-022`: source changes protect modified forms; successful additions select/expand the new row.
- `UI-FIE-019`: 1440×900, 1024×768 and 390×844 keep dialog content and footer reachable.

Instance Draft routes, controls, Management tab and database table are removed. Template Draft is
unaffected. Migration retains formal instance identity, bindings and values as first active recipes.
