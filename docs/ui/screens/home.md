---
title: Home / Process Flow Workspace
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
  - apps/viewer/app/page.tsx
---

# Home / Process Flow Workspace

Route: `/`

## Purpose

Home is the primary entry point for creating immutable `ProcessFlowInstance` records. It loads
`GET /api/bootstrap` and renders one full-card link for every immutable flow template.

## Layout and behavior

- Header: `Process Flow Workspace`, short task description, and a small `Management` link.
- Template area: responsive one/two/three-column card grid. Each compact card shows only template
  name, version, and owner. The name owns the 70% primary column.
- A card links to `/flow-instance-editor?templateId=<encoded id>`.
- The lower `Create resources` area links to `/flow-template-editor`, `/hbm-editor`, and
  `/dram-editor`.
- Loading uses stable card skeletons. API errors keep known content and expose `Retry`. Empty data
  shows `No process flow templates` while preserving all create commands.

## Acceptance

- `UI-HOME-001`: bootstrap templates produce one keyboard-accessible card each.
- `UI-HOME-002`: every card carries the correct encoded `templateId` route and only the required
  name, owner, and version metadata.
- `UI-HOME-003`: Create Template/HBM/DRAM and Management navigate to their dedicated routes.
- `UI-HOME-004`: loading, empty, and API-error states do not flash false data.
- `UI-HOME-005`: 390px viewport has no document-level horizontal overflow.
