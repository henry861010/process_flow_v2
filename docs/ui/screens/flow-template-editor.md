---
title: Flow Template Editor
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
  - apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx
---

# Flow Template Editor

Route: `/flow-template-editor`

## Purpose

This editor authors immutable process-flow topology: metadata, flow inputs, step references, and
edges. The header contains Home, `Start from template...`, and the single primary command
`Save Template`.

## Working configuration

The left library offers catalog geometry and available generators. A generator can define a new flow
input or serve as the working binding of an existing input. Its parameter editor and preview use the
backend registry; defining it does not create a geometry catalog record.

Geometry bindings remain preview-only working state. Step parameter values initialize from the
step template's `defaultValue`; `Save Template` snapshots currently populated scalar values into
the corresponding `StepRef.parameterDefaults`. Array values, repeat groups, and placements remain
preview-only and are never persisted by `Save Template`.

Adding a catalog geometry or generator creates a flow input whose
`geometryConstraints.categories` contains that geometry's category. The category is part of the
saved template contract, while the selected catalog geometry id or generator recipe remains a
preview-only binding.
Before saving, the author may adjust the allowed category list in Advanced settings; after saving,
the existing topology lock makes those constraints read-only.

`Save Instance` and `Save Template & Instance`, their dialogs, and their materialization flows are
not part of this screen.

Saving validates template name, id, version, owner, topology, and uniqueness. Success locks
topology while preview-only geometry bindings and collection test values remain usable.

## Acceptance

- `UI-FTE-001`: fresh editor provides catalog geometry, process steps, graph, and one save command.
- `UI-FTE-002`: HBM/DRAM generator commands are available for working previews and new flow inputs;
  template save does not persist their bindings.
- `UI-FTE-003`: valid topology can save while preview-only configuration is incomplete.
- `UI-FTE-004`: scalar step values are saved as flow defaults; the source geometry category is saved as the flow-input contract, while its catalog id and collection values remain preview-only.
- `UI-FTE-005`: successful save locks topology and reports the immutable template id.
