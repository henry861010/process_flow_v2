---
title: Flow Instance Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-09-15
last_verified_commit: 04a77e132dd0777e3ddc029dd77f56a0c25b0692
source_of_truth:
  - apps/viewer/components/process-flow-instance-editor/process-flow-instance-editor.tsx
  - apps/viewer/lib/process-flow/instance-editor.ts
---

# Flow Instance Editor

Route: `/flow-instance-editor?templateId=<id>`

## Purpose and entry

The editor creates a new immutable instance from a template selected on Home. It never edits or
overwrites an existing instance and does not expose the workspace lifecycle.

- A valid `templateId` resolves against bootstrap and initializes the template's default
  configuration.
- Missing or unknown `templateId` preserves the app shell, reports the error, and directs the user
  to Home; no template selector is rendered.
- `workspaceId` is no longer a supported frontend entry. Backend workspace APIs remain available.

## Header and source instance

The header shows immutable template identity, a `From instance` select, Home, and primary `Save`.
`From instance` contains `Start from blank` followed only by instances whose
`processFlowTemplateId` equals the route template. Selecting one deep-copies `inputBindings` and
`stepConfigurations` exactly, discards embedded geometries, and resets all new-instance identity
fields. It does not reapply defaults. `Start from blank` copies the template's scalar
`parameterDefaults` and initializes every `pnp/pnp` step to `placements: []`; other collections
remain unset and geometry bindings remain empty. Template editor drafts do not receive this
instance-specific placement default. Replacing dirty values requires
confirmation.

`Save` becomes enabled when the selected template resolves and is enabled, configuration is complete, and no save
is in progress. Its dialog requires name, id, version, and owner; description is optional. Version
defaults to `V0.0.0`. Submit calls `POST /api/process-flow-instances`; success returns Home.

The geometry input picker lists only category-compatible generators with `flowInputPicker`
placement. HBM and DRAM inputs use the Geometry DB catalog records; hidden generators do not
offer an `Edit current recipe` action.

## Graph and state

Topology is always view mode and is rebuilt from the selected template. Geometry bindings and step
parameters remain editable through single-click node dialogs.
Dirty state protects reload/close and Home/source replacement. Source metadata is never copied.

Completeness follows dependencies backwards from the original terminal steps. A `pnp/pnp` step
with exactly `placements: []` requires its main geometry but does not use its die geometry. Its
output preserves the main state. Steps and inputs reachable only through that unused die input
use the neutral style and the `Unused` label; their bindings and parameters do not block Save.
The template topology is still validated in full, including all required incoming edges.

Unused branches remain editable and retain their bindings, recipes, and parameters. Adding a
placement immediately restores their requirements. Missing, null, or malformed placement values
are not equivalent to an empty array. Directly previewing an unused branch validates that target's
dependencies independently; downstream preview/export snapshots contain only executed steps.

Mouse-wheel scrolling zooms around the pointer, matching the template editor. Dragging the canvas
pans the view; the bottom-left zoom controls remain available. Zoom limits are `0.28` to `1.45`.

The geometry picker filters catalog records and available generators using the selected flow input's
`geometryConstraints`. A category constraint accepts the exact category and dot-delimited
descendants, but not sibling categories. A generator opens the shared parameter editor and keeps a
versioned recipe in the binding. Instance save normalizes recipes used by the execution plan and
preserves unused recipes without generating geometry or adding a catalog record. A source instance
copies that recipe exactly. The API compiler applies geometry constraints to used inputs when an
instance is saved; unused generator-preview errors do not block the main flow.

## Acceptance

- `UI-FIE-001`: Home template card opens the matching fixed template and default configuration.
- `UI-FIE-002`: source list contains only instances of that template.
- `UI-FIE-003`: loading a source copies values without carrying id/name/version/owner/description.
- `UI-FIE-004`: missing template and legacy workspace URLs render a recoverable error without a selector.
- `UI-FIE-005`: complete values plus valid unique metadata create a new immutable instance and return Home.
- `UI-FIE-006`: duplicate/invalid id or empty required metadata preserves the dialog and configuration.
- `UI-FIE-007`: input and step preview/export journeys remain available.
- `UI-FIE-008`: geometry browsing and search expose only geometries accepted by the template's category constraints.
- `UI-FIE-009`: generator recipes can be selected, edited, previewed, copied from a source instance,
  and saved without creating a geometry catalog record.
- `UI-FIE-010`: scrolling the mouse wheel zooms around the pointer; canvas dragging pans and the
  bottom-left zoom controls remain usable.
- `UI-FIE-011`: blank instances start with zero placements for every PnP; source copies preserve values.
- `UI-FIE-012`: zero placements allow an unconfigured die subflow while keeping main requirements.
- `UI-FIE-013`: reactivation restores validation without discarding unused branch settings or recipes.
- `UI-FIE-014`: unused branches can be previewed when configured; downstream snapshots omit them.

## Template availability

A direct URL referencing a disabled flow still loads its graph and source instances for viewing and
previewing. A visible notice explains that Save is disabled, including after copying an instance.
Referenced disabled steps do not block new instances when the saved flow itself remains enabled.
The backend also checks status when saving, covering templates disabled after page load.
