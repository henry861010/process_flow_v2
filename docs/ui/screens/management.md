---
title: Management
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - apps/viewer/app/management/page.tsx
---

# Management

Route: `/management`。管理 Process steps、Flows、Geometries、Flow drafts，並提供 Field review；首頁與管理頁使用同一 processFlows 集合。

Flow rows 顯示 metadata 與 revision，提供 Edit、Delete。Edit 前往統一 Flow Editor，僅能更新同一 flow；Delete 帶目前 revision，409／404 刷新資料並提示，不自動重試刪除。既有 Origin 歷史資訊不阻擋來源刪除。

Draft rows 跨所有 flows，顯示 user、name、revision、updated time，可 Resume 或 CAS Delete。正式 flow 刪除不刪草稿；target 不存在的草稿可另存。Reset 成功才清除草稿與列表。

ProcessStepTemplate 既有 Edit、啟停、defaults、program、ports 順序與 JSON transfer 保留；停用 step 只禁止新增引用。Geometry 刪除保護正式 flow 與草稿的 catalog bindings。

Fixture menu 沿用 Export fixture、Reset from ZIP、Reset 和確認／busy／錯誤行為。ZIP 改為三檔 steps／flows／geometries；舊格式拒絕。

驗收：數量／空列表／錯誤、flow Edit/Delete、revision 409、draft Resume/Delete、geometry 引用保護、step 編輯與新 ZIP round trip。鍵盤與錯誤提示使用原管理介面樣式。

## Field review

預設列出 proposed 共用資料欄位，可依名稱／提出原因、process step 和 proposed／formal 篩選。
列表顯示使用 flow／draft 數、填值筆數與問題筆數。每列 Actions 提供明確的 Edit 按鈕，沿用 Process steps 樣式；點開即可修改 proposed 規格、Approve as formal 或 Delete field。Formal 列改為 View，僅供檢視。詳細視窗列出規格、提出者、時間、原因，以及所有已填值的 step／recipe。包含未採用候選與草稿，可篩選有問題值，並透過連結直接開啟對應 recipe。

Proposed 可修改名稱、型別、range、單位與原因；既有值不自動換算。Refresh review 重新取得檢查結果，只有全部值通過才能 Approve as formal，零筆資料也可核准。核准保留原欄位 ID 和值。Formal 僅供查看，本介面不提供改規格、降回 proposed 或移除。

Delete field 先顯示名稱、flow／draft／填值筆數，確認後永久移除定義及對應值；沒有封存或還原。核准與移除都帶 review token，資料或定義改變時回傳 409，需刷新後重試。失敗保留視窗與錯誤訊息。

提出者與 reviewer 名稱由操作人填寫，沿用內部工具模式，並非登入或角色權限。欄位狀態以文字 Badge 呈現；沿用 EditorDialog 的焦點管理。
