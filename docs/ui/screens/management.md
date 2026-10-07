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

## Resource deletion

Flow templates 與 Instances 每列都有 `Delete`，flow template 保留 `Edit`。
Process steps 每列只提供 `Edit`，沒有 Delete，也沒有 process-step template 刪除 API。
沿用現有 management 存取方式，不新增登入或角色驗證。Flow template 被任何 instance
引用時停用 Delete，按鈕下方不顯示引用數量，instance 數量保留於 Instances 欄位。

可刪除項目使用 `window.confirm` 顯示名稱與 ID。刪除 flow template 的提示說明會永久刪除
相關 workspace 草稿；刪除 instance 的提示說明會永久刪除產生它的已提交 workspace。
取消不送出請求。刪除期間顯示 `Deleting…` 並停用 Delete、Edit 與 fixture 操作，防止重複
送出。成功移除 row、更新 counts 與引用狀態，並顯示 `role="status"` 成功訊息。
失敗保留資料，使用 `role="alert"` 顯示原因；遇到 `409` 或 `404` 重新載入 bootstrap，
刷新引用狀態。刷新失敗時保留原畫面並提示重新載入頁面。

後端以同一交易檢查引用與刪除相關 workspace，衝突或失敗不留下部分刪除；geometry 保留。
`UI-MGMT-006` 驗證 flow template 與 instance 刪除、確認與取消、引用保護、busy 與錯誤狀態，
以及 instance → flow template 的解除引用流程，並確認 process steps 只有 Edit 操作。

## Template availability

Both template tables display an Enabled/Disabled status column. Their Edit modals expose a Status
select, saved with the existing Save command. Disabled templates remain visible and editable.
Saving disables duplicate submission and errors remain visible. A disabled flow cannot create new
workspaces or instances; a disabled step cannot join new flows, while existing flows remain usable.
