---
title: Management
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-09-15
last_verified_commit: 04a77e132dd0777e3ddc029dd77f56a0c25b0692
source_of_truth:
  - apps/viewer/app/management/page.tsx
  - apps/viewer/components/process-step-edit/process-step-edit-dialog.tsx
---

# Management

Route: `/management`

Management is a bootstrap-backed resource overview. It displays counts and tabbed semantic tables for
flow templates, flow instances, geometries, and process-step templates. Template rows can open the
matching Instance Editor or an in-page edit modal; template, HBM, and DRAM create commands are
available.

Every flow-template row has an `Edit` action next to `Open`. The modal keeps id、version、flow
inputs、step identities/labels and edges locked；only name、owner、description and each existing
step ref's scalar `parameterDefaults` are editable. Defaults are grouped by flow-local `stepRefId`,
so repeated uses of the same process-step template remain independent. Enabling a default starts
from the current process-step default when one exists；`Reset to process-step defaults` copies the
current eligible scalar values as a snapshot. Existing instances and instances copied from another
instance remain unchanged.

Every process-step row has an `Edit` action. It opens an in-page modal without navigation. The modal
keeps id、version、name、description、ports與parameter definitions locked；only owner、category、
program and each parameter's optional default value are editable. Save updates the row in local
bootstrap state；Cancel、X、backdrop與Escape discard the modal draft。The standalone process-step
editor route and its New、Clone、Delete UI do not exist。

The header also owns the destructive `Reset Database` command. It requires confirmation, restores
the canonical POC data, refreshes all visible counts and lists, and exposes a reset-busy state.

Acceptance: `UI-MGMT-001` validates counts and rows; `UI-MGMT-002` validates authoring links and the
process-step edit modal; `UI-MGMT-003` validates missing references remain visible using their raw ids.
`UI-MGMT-004` validates confirmation, busy state, reset success refresh, and reset error feedback.
`UI-MGMT-005` validates flow-template metadata/default editing, flow-local default isolation, locked
topology, save refresh, and the future-instance-only explanation.
