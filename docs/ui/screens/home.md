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
`GET /api/bootstrap` and renders one full-card link for every enabled flow template.

## Layout and behavior

- Header: `Process Flow Workspace`, short task description, and a small `Management` link.
- Template area: responsive one/two/three-column card grid. Each compact card shows only template
  name, version, owner, and Enabled status. The name owns the 70% primary column.
- A card links to `/flow-instance-editor?templateId=<encoded id>`.
- The lower `Create resources` area links to `/flow-template-editor` and all generators whose
  `uiPlacements` includes `home`. HBM and DRAM use `/geometry-generator?generatorId=<id>`.
- Loading uses stable card skeletons. API errors keep known content and expose `Retry`. Empty data
  shows `No process flow templates` while preserving all create commands.

## Acceptance

- `UI-HOME-001`: enabled bootstrap templates produce one keyboard-accessible card each; disabled templates are hidden.
- `UI-HOME-002`: every card carries the correct encoded `templateId` route and only the required
  name, owner, version, and Enabled status metadata.
- `UI-HOME-003`: Create Template/HBM/DRAM and Management navigate to their configured routes.
- `UI-HOME-004`: loading, empty, and API-error states do not flash false data.
- `UI-HOME-005`: 390px viewport has no document-level horizontal overflow.

## Template availability

Home filters out disabled flow templates entirely. The template count and empty state reflect only
enabled templates; when all templates are disabled, the grid shows the existing empty state.
Disabled templates remain available in Management for inspection and re-enabling.
Bootstrap continues to include them so historical references and instance previews still resolve.
