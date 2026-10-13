---
title: Management
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-13
last_verified_commit: 04a77e132dd0777e3ddc029dd77f56a0c25b0692
source_of_truth:
  - apps/viewer/app/management/page.tsx
  - apps/viewer/components/process-step-edit/process-step-edit-dialog.tsx
  - apps/viewer/components/process-flow-template-edit/process-flow-template-edit-dialog.tsx
---

# Management

Route: `/management`

Management combines bootstrap resources with editor-draft summaries. It displays counts and tabbed semantic tables for
flow templates, flow instances, geometries, process-step templates, template drafts, and instance drafts, in that order. Template rows can open an
in-page edit modal. The tab bar has no Template or LSI create commands.

Every flow-template row has an `Edit` action. The modal keeps id、version、flow inputs、step
identities/order and edges locked；status、name、owner、description and each existing step ref's
`stepLabel` and scalar `parameterDefaults` are editable. Labels and defaults are grouped by flow-local
`stepRefId`, so repeated uses of the same process-step template remain independent and labels may
repeat. Each optional Step label input updates its section heading immediately; clearing it uses the
process-step template name. Saving trims label whitespace and updates local bootstrap state.
All instances sharing the template display the saved labels after reloading; their configurations
and the process-step template names remain unchanged. The update API preserves omitted labels and
clears labels explicitly set to an empty/whitespace string or `null`.
Enabling a default starts from the current
process-step default when one exists；`Reset to process-step defaults` copies the current eligible
scalar values as a snapshot. Parameter defaults only affect future instances created from blank;
existing instances and instances copied from another instance keep their parameter values.
Cancel、X、backdrop and Escape discard the draft. Saving disables editable fields and duplicate
submission; failures retain the draft and show an error. Locked metadata、flow-input definitions and
constraints、step identity fields and
topology edges remain visible in disabled controls for reference.

Every process-step row has an `Edit` action. It opens an in-page modal without navigation. The modal
keeps id、version、name、description、port definitions與parameter definitions locked；status、owner、category、
program、input port order and each parameter's optional default value are editable. Each input port
has keyboard-accessible Move up / Move down buttons; boundary buttons and all move buttons while
saving are disabled. Input order controls top-to-bottom handles and upstream branch placement in
all referencing flows, including existing flows when reloaded; output ports remain read-only. Save updates the row in local
bootstrap state；Cancel、X、backdrop與Escape discard the modal draft。The standalone process-step
editor route and its New、Clone、Delete UI do not exist。Locked metadata、input/output port fields
and complete parameter-definition details remain visible in disabled controls for reference.

The small fixture button at the bottom right opens `Export fixture`, `Reset from ZIP`, and `Reset`.
Export downloads the current database as a four-file fixture ZIP. Reset from ZIP asks the user to
choose a fixture ZIP, then confirms before replacing the database with its contents. Reset confirms
before restoring the canonical repo fixtures. Both reset actions refresh visible counts and lists
and expose a busy state; errors are shown on the page.

Acceptance: `UI-MGMT-001` validates counts and rows; `UI-MGMT-002` validates the
process-step edit modal; `UI-MGMT-009` validates input port reordering, boundary/saving controls, keyboard access, save/reopen and cancellation; `UI-MGMT-003` validates missing references remain visible using their raw ids.
`UI-MGMT-004` validates the fixture menu, ZIP selection and validation, confirmation, busy state,
reset success refresh, and reset error feedback.
`UI-MGMT-008` validates both draft tabs, cross-template listing, summary metadata, deletion and synchronized cleanup.
`UI-MGMT-005` validates flow-template metadata/label/default editing, flow-local label/default
isolation, blank-label fallback, locked topology, save refresh, cancel and error behavior,
shared labels after reloading, and the future-instance-only parameter defaults explanation.

## Resource deletion

Flow templates、Instances 與 Geometries 每列都有 `Delete`，flow template 保留 `Edit`。
Process steps 每列只提供 `Edit`，沒有 Delete，也沒有 process-step template 刪除 API。
沿用現有 management 存取方式，不新增登入或角色驗證。Flow template 被任何 instance
引用時停用 Delete，按鈕下方不顯示引用數量，instance 數量保留於 Instances 欄位。

可刪除項目使用 `window.confirm` 顯示名稱與 ID。刪除 flow template 的提示說明會永久刪除
相關 instance drafts；刪除 instance 的提示說明會永久刪除該正式 instance。
取消不送出請求。刪除期間顯示 `Deleting…` 並停用 Delete、Edit 與 fixture 操作，防止重複
送出。成功移除 row、更新 counts 與引用狀態，並顯示 `role="status"` 成功訊息。
失敗保留資料，使用 `role="alert"` 顯示原因；遇到 `409` 或 `404` 重新載入 bootstrap，
刷新引用狀態。刷新失敗時保留原畫面並提示重新載入頁面。

Flow template／instance 刪除在同一交易檢查引用與清理相關 instance drafts，衝突或失敗不留下部分刪除；geometry 保留。
Geometry 刪除使用 `DELETE /api/geometries/{geometry_id}`，確認視窗顯示名稱、ID 與永久刪除說明。
後端在同一 SQLite 交易中檢查 instance 與兩種 editor draft 的 `state.configuration.inputBindings`；
只有 `kind: "catalog"` 且 `geometryId` 完全相符才算引用，embedded／generator binding 不阻擋。
引用中回傳 `409`，頁面顯示引用資源類型與 ID 並刷新 bootstrap；不存在回傳 `404`。
成功回傳空內容 `204`，只移除該 geometry 並更新 row、count 與成功訊息，不連帶刪除其他資源。
Geometry 沿用上述取消、busy、防重送及錯誤處理，並記錄 `geometry.delete` 操作事件。
`UI-MGMT-006` 驗證 flow template 與 instance 刪除、確認與取消、引用保護、busy 與錯誤狀態，
以及 instance → flow template 的解除引用流程，並確認 process steps 只有 Edit 操作。
`UI-MGMT-007` 驗證 geometry 刪除、確認與取消、instance／editor draft 引用保護、解除引用後刪除、
busy 防重送、成功更新 row／count 與錯誤刷新。

## Editor draft management

`Template drafts` 與 `Instance drafts` 各有獨立分頁與數量卡片，列出所有 user 的草稿。
兩種草稿的數量卡片與分頁都放在正式資源之後，Template drafts 在前、Instance drafts 在後。
Template drafts 使用既有摘要列表；Instance drafts 依 bootstrap 中每個 template ID 並行取得
摘要後合併，維持既有 API 的 template scope，不讀取完整 `state`。兩種列表依 `updatedAt`
由新到舊排列，同時間以 ID 排序。整組資料載入成功後一起更新；任何請求失敗顯示錯誤，
刷新時保留原資料。載入中顯示 `Loading drafts…`，空列表顯示 `No drafts saved.`。

兩種草稿列顯示名稱、ID、User、Revision、Updated 與 Actions；時間依瀏覽器 locale/timezone
顯示，原始 timestamp 放於 `time` 的 `dateTime` 與 title。Instance drafts 另顯示所屬 template
名稱，找不到名稱時顯示原始 ID。每列只提供 Delete，不新增編輯入口、批次刪除或垃圾桶。

確認視窗顯示草稿類型、名稱、ID 與永久刪除說明。刪除 template draft 傳入當前 revision；
instance draft 同時傳入 revision 與所屬 template ID。取消不送出請求；busy、防重送、
成功與錯誤訊息沿用正式資源刪除。成功只移除該草稿、更新 count，不刪除正式資源或 geometry。
`404`／`409` 刷新 bootstrap 與兩種草稿，提示重新檢視資料後再確認 Delete，不自動重試。
刷新失敗保留畫面並提示 reload。刪除正式 template 成功後同步移除其 instance draft rows；
Reset／Reset from ZIP 成功後兩種草稿列表與 counts 同步清空，失敗保持原資料。
`UI-MGMT-008` 驗證跨 template 彙整、沒有正式 template 時仍列出 template drafts、欄位與排序、
空列表、取消／確認、revision 與 template scope、重送防護、錯誤刷新及連動清理。

## Template availability

Both template tables display an Enabled/Disabled status column. Their Edit modals expose a Status
select, saved with the existing Save command. Disabled templates remain visible and editable.
Saving disables duplicate submission and errors remain visible. A disabled flow cannot create new
instances; editor drafts remain editable; a disabled step cannot join new flows, while existing flows remain usable.
