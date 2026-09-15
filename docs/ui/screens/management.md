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
---

# Management

Route: `/management`

Management is a read-only bootstrap-backed resource overview. It displays counts and tabbed semantic
tables for flow templates, flow instances, geometries, and process-step templates. Template rows can
open the matching Instance Editor; process-step authoring opens `/admin/processstepeditor`; template,
HBM, and DRAM create commands are available. Immutable resources have no edit/delete action.
The header also owns the destructive `Reset Database` command. It requires confirmation, restores
the canonical POC data, refreshes all visible counts and lists, and exposes a reset-busy state.

Acceptance: `UI-MGMT-001` validates counts and rows; `UI-MGMT-002` validates all authoring links;
`UI-MGMT-003` validates missing references remain visible using their raw ids.
`UI-MGMT-004` validates confirmation, busy state, reset success refresh, and reset error feedback.
