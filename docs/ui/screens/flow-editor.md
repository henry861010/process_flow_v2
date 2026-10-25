---
title: Flow Editor
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - apps/viewer/components/process-flow-editor/process-flow-editor.tsx
  - apps/viewer/components/process-flow-save/save-information-dialog.tsx
  - apps/viewer/lib/process-flow/recipes.ts
---

# Flow Editor

Route: `/flow-editor`。`?flowId=<id>` 開啟編輯，`&copy=1` 複製，`?draftId=<id>` 恢復草稿。沿用原 topology editor 的三欄、圖形、參數、geometry、preview 與 export 元件。

## Sources 與保存

Start from… 提供 Flows／Drafts；flow 可 Open 或 Copy，草稿可 Resume。新增 flow 從空畫布開始。正式 flow 不保存畫布座標；draft 保存 nodes、edges、viewport 和目前編輯候選。

Save 可更新已開啟 flow 或另存；Name／Version／Owner／Description 在保存視窗編輯。拓樸不完整或已提供值無效時禁止正式保存，但可保存草稿。Geometry／required recipe 尚未完成只阻擋相應預覽和執行。

409 保留全部編輯內容，顯示 Reload／Save as new flow。Reload 重新載入正式版本；另存以目前內容建立獨立 flow。草稿 commit 失敗不刪草稿。

## 站點 recipes

面板同時顯示 **Currently editing** 與 **Adopted**。下拉選單只切換查看；Adopt 才改變 selectedRecipeId。可新增、複製、改名、改描述和刪除候選。

- 新增站點建立並採用 Recipe 1，複製目前 step defaults。
- Add recipe 複製目前 step defaults，不改變採用。
- Copy recipe 深拷貝目前查看候選的值，使用新 ID，不改變採用。
- 刪除已採用候選設為 null，不自動選其他候選。空候選集合可保存。
- 刪除站點連帶移除 step configuration；刪除 input 移除 binding。
- Preview 永遠依採用候選與其上游依賴，查看不同候選不切換計算結果。

## 驗收

| ID | 操作與預期 |
| --- | --- |
| UI-FLOW-001 | 建立合法拓樸；未完成 geometry／recipe 可正式存，未完成接線只能存 draft |
| UI-FLOW-002 | 建立兩組候選、分別編輯、採用；查看切換不採用；刪除採用後 null |
| UI-FLOW-003 | 保存／重載保留全部候選、選擇與 bindings，讀取不補 defaults |
| UI-FLOW-004 | 修改拓樸與另存；來源更新／刪除不影響副本 |
| UI-FLOW-005 | 保存／恢復 draft 保留 positions、viewport、目前查看與 target revision |
| UI-FLOW-006 | 模擬其他 client 更新；409 不丟內容，可 reload 或另存 |
| UI-FLOW-007 | Input／上游 preview、JSON／STEP／CDB 匯出使用採用設定 |
| UI-FLOW-008 | Dialog focus、Escape、Tab、candidate labels 與鍵盤刪 node 正確 |

舊 flow-template-editor 和 flow-instance-editor route 已移除。既有 screenshots 是歷史參考；新驗收應使用以上路由與契約。
