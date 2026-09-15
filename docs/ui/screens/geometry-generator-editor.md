---
title: Geometry Generator Editors
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
  - apps/viewer/components/geometry-generator/geometry-generator-page.tsx
  - apps/viewer/components/geometry-generator/backend-geometry-generator-dialog.tsx
---

# HBM and DRAM Geometry Editors

Routes: `/hbm-editor`, `/dram-editor`

Each route loads the matching backend registry definition (`hbm` or `dram`) into the shared full-page
generator editor. The page preserves parameter editing, debounced engineering preview, validation,
JSON download, metadata dialog, and `Save to DB`. On tablet and desktop widths the editor is centered
and limited to 70% of the viewport; narrow screens retain the full-width layout.

Successful DB save shows the new catalog geometry id without navigating or resetting parameters and
preview. Home is available as a header command. A missing registry definition renders a recoverable
error and Home command.

Acceptance: `UI-GEN-001` validates route-to-definition mapping; `UI-GEN-002` validates save success
stays in-place; `UI-GEN-003` validates loading/error states.
