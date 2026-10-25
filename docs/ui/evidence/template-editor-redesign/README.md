---
title: Template Editor Toolbar Redesign Evidence
status: historical
owner: Process Flow UI
audience:
  - design
  - frontend
  - QA
last_verified: 2026-10-14
last_verified_commit: 782194d8
source_of_truth:
  - apps/viewer/components/process-flow-editor/process-flow-editor.tsx
  - apps/viewer/components/process-flow-save/flow-source-dialog.tsx
  - apps/viewer/components/process-flow-save/save-information-dialog.tsx
---

> 歷史 UI 證據：此處的舊路由／資料模型已退場，現行規格見 [Flow Editor](../../screens/flow-editor.md)。

# Template Editor Toolbar Redesign Evidence

Route: `/flow-template-editor/`. Reviewed the exported production build at
`http://localhost:3001/flow-template-editor/`, light scheme, browser zoom 100%.
These JPEG captures record current observations, not normative fixture baselines.
Existing AAA Demo data was used without resetting the database. Two temporary
`codex-ui-review` drafts were created to verify first save, direct update, resume,
and new-copy save, then deleted by their exact IDs and revisions.

## Browser observations

| Entry state / action | Expected and observed | Evidence |
| --- | --- | --- |
| Fresh editor, 1440×900 | Four toolbar entries; only Save is filled; independent progress and issue count | [Toolbar](toolbar-1440x900.jpg) |
| Saved draft resumed, 390×844 | Draft split button and all action labels fit within the viewport; rightmost button edge 374px | [Draft toolbar](toolbar-draft-390x844.jpg) |
| Start from opened, Templates tab | Explicit row selection and footer confirmation; body scroll with fixed tabs/search/footer | [1440×900](source-1440x900.jpg), [1024×768](source-1024x768.jpg), [390×844](source-390x844.jpg) |
| AAA Demo copy, Save opened | Combined default; visible four configuration requirements; combined submit blocked; template-only submit enabled | [1440×900](save-1440x900.jpg), [1024×768](save-1024x768.jpg), [390×844](save-390x844.jpg) |
| Resumed incomplete draft, Save opened, 390×844 | Incomplete topology visible and both save modes blocked; footer stays within the screen | [Draft save](save-draft-390x844.jpg) |

Additional functional checks: cancel/reopen preserves mode and metadata; a new source resets
combined mode; missing name including whitespace gets an inline error and first-field focus;
source selection alone preserves the graph; Keep editing retains unsaved changes; Save Draft
updates the same identity without opening a modal; Save as new draft creates a separate identity;
a failed draft request retains fields and can be retried. Tab/Shift+Tab wrap within the dialog,
Escape closes it, and focus returns to Save or Draft options. Source confirmations use the
same modal lifecycle with focus on Keep editing.

No new toolbar/dialog gaps were observed (no gap ID). The existing 1024px graph minimum-width
constraint remains outside this change and corresponds to `UI-GAP-RESP-001`.

## Executable checks

- 35 relevant Viewer tests pass, including 9 save-dialog regressions.
- 28 API draft/identity tests pass using temporary databases.
- Production build, TypeScript and Next.js lint validation pass.
- The full Viewer suite has 251 passing tests and 4 existing failures in
  `components/geometry-preview/file-export-dialog.test.ts` due to the mesh-control label
  contract. That suite imports `file-export-mesh-control.ts`; neither file was changed here.
