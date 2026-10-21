---
title: Instance Editor Toolbar Redesign Evidence
status: descriptive
owner: Process Flow UI
audience:
  - design
  - frontend
  - QA
last_verified: 2026-10-14
last_verified_commit: 782194d8
source_of_truth:
  - apps/viewer/components/process-flow-instance-editor/process-flow-instance-editor.tsx
  - apps/viewer/components/process-flow-save/editor-shell-header.tsx
  - apps/viewer/components/process-flow-save/save-information-dialog.tsx
---

# Instance Editor Toolbar Redesign Evidence

> The toolbar and Instance Draft captures below are historical. The current instance lifecycle and
> station recipe dialog are specified in [Flow Instance Editor](../../screens/flow-instance-editor.md).
> On 2026-10-21, the replacement station dialog was verified at 1440×900, 1024×768 and 390×844
> using an isolated temporary database. Checks covered separate active/inspection state, inline
> recipe details, defaults and exact-copy creation, dirty-source confirmation, revision conflict
> retention and explicit reload without resubmission, long names and ten-recipe lists, fixed footer,
> nested focus trapping and return to the station's Edit step button.

Route: `/flow-instance-editor/?templateId=flow_tpl_aaa_demo`. Reviewed the exported production
build at `http://localhost:3001`, light scheme and browser zoom 100%. These JPEG captures record
current observations rather than normative fixture baselines. Existing AAA Demo data was used
without resetting the database. Two temporary `codex-ui-review` drafts verified first save, direct
update, new-copy save, listing and failure retention, then were deleted by exact IDs and revisions.

## Browser observations

| Entry state / action | Expected and observed | Evidence |
| --- | --- | --- |
| AAA Demo, editor ready | Four toolbar entries, fixed-template subtitle, separate save progress and issue count | [1440×900](toolbar-1440x900.jpg), [1024×768](toolbar-1024x768.jpg), [390×844](toolbar-390x844.jpg) |
| Start from opened, Instances tab | Search, blank defaults, template-scoped instances, explicit selection and footer confirmation | [1440×900](source-1440x900.jpg), [1024×768](source-1024x768.jpg), [390×844](source-390x844.jpg) |
| Incomplete blank configuration, Save opened | Two requirements visible and final submit disabled; instance metadata remains editable | [1440×900](save-1440x900.jpg), [1024×768](save-1024x768.jpg), [390×844](save-390x844.jpg) |
| First Save Draft, 390×844 | Draft name/user form and footer stay inside the viewport | [Draft save](save-draft-390x844.jpg) |

At 390px, the toolbar uses two rows with the primary button ending at 374px and no document-level
horizontal overflow. Source selection alone leaves the editor unchanged. Loading `HBM4 Alpha
Build` retains `New instance`; a later blank replacement opens the named confirmation. `Keep
editing` preserves the working metadata and source dialog, while `Discard changes` resets to blank.

The complete source configuration enables final save. Submitting blank metadata shows inline name
and owner errors and focuses name. Shift+Tab from Close wraps to Save Instance; Tab wraps back to
Close. Escape closes Save and restores focus to the toolbar trigger. First draft save, direct update,
and Save as new draft produced the expected active identity and list rows. A simulated failed delete
retained its row and visible error; the test-only row was then removed through its revision-checked
local API route.

## Executable checks

- 26 relevant Viewer dialog, draft, instance, and configuration tests pass.
- Viewer production build, TypeScript, Next.js lint, and documentation validation pass.
- Instance API draft and identity tests use a temporary database and do not modify fixture data.
- The full Viewer suite has 251 passing tests and 4 existing mesh-control label contract failures
  in `components/geometry-preview/file-export-dialog.test.ts`; this redesign does not import or
  modify that component.
