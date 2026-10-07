---
title: Management
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-09-16
last_verified_commit: 04a77e132dd0777e3ddc029dd77f56a0c25b0692
source_of_truth:
  - apps/viewer/app/management/page.tsx
  - apps/viewer/components/process-step-edit/process-step-edit-dialog.tsx
  - apps/viewer/components/process-flow-template-edit/process-flow-template-edit-dialog.tsx
---

# Management

Route: `/management`

Management is a bootstrap-backed resource overview. It displays counts and tabbed semantic tables for
flow templates, flow instances, geometries, and process-step templates. Template rows can open an
in-page edit modal. The tab bar has no Template or LSI create commands.

Every flow-template row has an `Edit` action. The modal keeps id、version、flow inputs、step
identities/labels and edges locked；only status、name、owner、description and each existing step ref's scalar
`parameterDefaults` are editable. Defaults are grouped by flow-local `stepRefId`, so repeated uses of
the same process-step template remain independent. Enabling a default starts from the current
process-step default when one exists；`Reset to process-step defaults` copies the current eligible
scalar values as a snapshot. Existing instances and instances copied from another instance remain
unchanged. Locked metadata、flow-input definitions and constraints、step reference fields and
topology edges remain visible in disabled controls for reference.

Every process-step row has an `Edit` action. It opens an in-page modal without navigation. The modal
keeps id、version、name、description、ports與parameter definitions locked；only status、owner、category、
program and each parameter's optional default value are editable. Save updates the row in local
bootstrap state；Cancel、X、backdrop與Escape discard the modal draft。The standalone process-step
editor route and its New、Clone、Delete UI do not exist。Locked metadata、input/output port fields
and complete parameter-definition details remain visible in disabled controls for reference.

The small fixture button at the bottom right opens `Export fixture`, `Reset from ZIP`, and `Reset`.
Export downloads the current database as a four-file fixture ZIP. Reset from ZIP asks the user to
choose a fixture ZIP, then confirms before replacing the database with its contents. Reset confirms
before restoring the canonical repo fixtures. Both reset actions refresh visible counts and lists
and expose a busy state; errors are shown on the page.

Acceptance: `UI-MGMT-001` validates counts and rows; `UI-MGMT-002` validates the
process-step edit modal; `UI-MGMT-003` validates missing references remain visible using their raw ids.
`UI-MGMT-004` validates the fixture menu, ZIP selection and validation, confirmation, busy state,
reset success refresh, and reset error feedback.
`UI-MGMT-005` validates flow-template metadata/default editing, flow-local default isolation, locked
topology, save refresh, and the future-instance-only explanation.

## Template availability

Both template tables display an Enabled/Disabled status column. Their Edit modals expose a Status
select, saved with the existing Save command. Disabled templates remain visible and editable.
Saving disables duplicate submission and errors remain visible. A disabled flow cannot create new
workspaces or instances; a disabled step cannot join new flows, while existing flows remain usable.
