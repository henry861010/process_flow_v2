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

Route: `/management`。管理 Process steps、Flows、Geometries、Flow drafts 四組資源；首頁與管理頁使用同一 processFlows 集合。

Flow rows 顯示 metadata 與 revision，提供 Edit、Copy、Delete。Edit／Copy 前往統一 Flow Editor；Delete 帶目前 revision，409／404 刷新資料並提示，不自動重試刪除。Origin 不阻擋來源刪除，也不連帶刪除副本。

Draft rows 跨所有 flows，顯示 user、name、revision、updated time，可 Resume 或 CAS Delete。正式 flow 刪除不刪草稿；target 不存在的草稿可另存。Reset 成功才清除草稿與列表。

ProcessStepTemplate 既有 Edit、啟停、defaults、program、ports 順序與 JSON transfer 保留；停用 step 只禁止新增引用。Geometry 刪除保護正式 flow 與草稿的 catalog bindings。

Fixture menu 沿用 Export fixture、Reset from ZIP、Reset 和確認／busy／錯誤行為。ZIP 改為三檔 steps／flows／geometries；舊格式拒絕。

驗收：數量／空列表／錯誤、flow Edit/Copy/Delete、revision 409、draft Resume/Delete、geometry 引用保護、step 編輯與新 ZIP round trip。鍵盤與錯誤提示使用原管理介面樣式。
