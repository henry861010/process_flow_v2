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
`parameterDefaults`; collections and placements remain unset. Replacing dirty values requires
confirmation.

`Save` becomes enabled when the selected template resolves, configuration is complete, and no save
is in progress. Its dialog requires name, id, version, and owner; description is optional. Version
defaults to `V0.0.0`. Submit calls `POST /api/process-flow-instances`; success returns Home.

## Graph and state

Topology is always view mode and is rebuilt from the selected template. Geometry bindings and step
parameters remain editable through single-click node dialogs. Preview/export behavior is unchanged.
Dirty state protects reload/close and Home/source replacement. Source metadata is never copied.

## Acceptance

- `UI-FIE-001`: Home template card opens the matching fixed template and default configuration.
- `UI-FIE-002`: source list contains only instances of that template.
- `UI-FIE-003`: loading a source copies values without carrying id/name/version/owner/description.
- `UI-FIE-004`: missing template and legacy workspace URLs render a recoverable error without a selector.
- `UI-FIE-005`: complete values plus valid unique metadata create a new immutable instance and return Home.
- `UI-FIE-006`: duplicate/invalid id or empty required metadata preserves the dialog and configuration.
- `UI-FIE-007`: input and step preview/export journeys remain available.
