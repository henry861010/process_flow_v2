---
title: Flow Instance Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-14
last_verified_commit: 04a77e132dd0777e3ddc029dd77f56a0c25b0692
source_of_truth:
  - apps/viewer/components/process-flow-instance-editor/process-flow-instance-editor.tsx
  - apps/viewer/lib/process-flow/instance-editor.ts
---

# Flow Instance Editor

Route: `/flow-instance-editor?templateId=<id>`

## Purpose and entry

The editor creates a new immutable instance from a template selected on Home. It never edits or
overwrites an existing instance and supports separately persisted editor drafts.

- A valid `templateId` resolves against bootstrap and initializes the template's default
  configuration.
- Missing or unknown `templateId` preserves the app shell, reports the error, and directs the user
  to Home; no template selector is rendered.

## Header and source instance

The compact header has four entry points: low-emphasis `Home`, neutral `Start from…`, outlined
`Save Draft`, and filled primary `Save…`. Its subtitle shows the active draft name or instance
name, falling back to `New instance`, followed by the fixed template name and version. The status
bar independently reports manual-save progress (`Not saved`, `Unsaved changes`, `Saving…`, or
`Draft saved · time`) and a count of configuration or flow issues. The issue count expands to a
scrollable reason list; notices and errors render on a separate line.

`Start from…` opens a selection dialog with `Instances` and `Drafts` tabs. The Instances tab has a
fixed search field and contains `Start from blank` followed only by instances whose
`processFlowTemplateId` equals the route template. A row click only selects it; `Use configuration`
performs the replacement. Loading an instance deep-copies `inputBindings` and `stepConfigurations`
exactly, discards embedded geometries, and resets all new-instance identity fields. It does not
reapply defaults. `Start from blank` copies the template's scalar
`parameterDefaults` and initializes every `pnp/pnp` step to `placements: []`; other collections
remain unset and geometry bindings remain empty. Template editor drafts do not receive this
instance-specific placement default. Home, blank, instance, and draft replacement all use the
named `Keep editing` / `Discard changes` confirmation when the current content is dirty. Cancel and
load failure preserve the current editor.

`Save…` can open as soon as the selected template resolves, including while configuration is
incomplete or the template is disabled. Its fixed-footer dialog shows the complete blocking reason
list together with name, version, owner, and optional description. The final `Save Instance` action
is enabled only when the template is enabled and the configuration is complete. Version defaults
to `V0.0.0`. Required-field errors render inline and submit focuses the first error. Submit uses one
captured editor snapshot, calls `POST /api/process-flow-instances` without `id`, and synchronously
prevents duplicate requests. The server assigns a 32-character lowercase UUID4 hex ID without a
prefix, and success returns Home; failure preserves metadata, configuration, and the active draft.

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
- `UI-FIE-004`: missing or unknown template URLs render a recoverable error without a selector.
- `UI-FIE-005`: complete values plus valid required metadata create a new immutable instance and return Home.
- `UI-FIE-006`: empty required metadata or a failed save preserves the dialog and configuration.
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
- `UI-FIE-015`: toolbar exposes four grouped actions, compact fixed-template identity, and separate
  progress, issue, notice, and error states at desktop and narrow widths.
- `UI-FIE-016`: source and draft rows require explicit footer confirmation; Keep editing, cancel,
  missing sources, and failed loads retain the current editor.
- `UI-FIE-017`: incomplete and disabled flows can open Save; reasons are visible and only final
  instance submission is blocked.
- `UI-FIE-018`: required metadata errors are inline with first-error focus; Tab is trapped, Escape
  closes the topmost modal, and focus returns to its trigger.
- `UI-FIE-019`: 1440×900, 1024×768, and 390×844 keep toolbar actions and modal footers within the
  viewport while modal content owns scrolling.

## Template availability

A direct URL referencing a disabled flow still loads its graph and source instances for viewing and
previewing. The status bar and Save dialog explain why final submission is disabled, including after copying an instance.
Referenced disabled steps do not block new instances when the saved flow itself remains enabled.
The backend also checks status when saving, covering templates disabled after page load.

## Editor drafts

Instance drafts belong to the fixed route template. The `Drafts` tab lists only that template's
drafts, sorted by update time with name/user search and a user filter; list/detail/delete remain
scoped on the backend. Row selection is separate from `Resume draft`, and deletion has its own icon
and confirmation. Loading restores exact metadata and complete configuration without defaults or
source instance metadata resets. User/name remain separate from final owner/name.

The first Save Draft requests draft name and user. Once a draft is active, the main action directly
updates that revision; its menu offers `Edit draft details…` and `Save as new draft…`. Save Draft
accepts incomplete values, starts at revision 1, and revision-checks updates; Save as new creates a
separate identity. Disabled templates still permit draft editing. Formal Save submits the captured
current editor snapshot and atomically inserts the immutable instance and consumes the active
draft; failures preserve both editor and draft. Dirty state compares with the last loaded or
successfully saved snapshot and keeps changes made during a request.

Acceptance `UI-FIE-DRAFT-001`: save incomplete values, reload and resume from the same template. `UI-FIE-DRAFT-002`: verify source replacement detaches the draft, template isolation, user/search filtering, copy/delete and revision conflicts. `UI-FIE-DRAFT-003`: restore arrays/placements/recipes and final metadata, finish Save and verify only the active draft disappears.
