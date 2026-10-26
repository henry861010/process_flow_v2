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

Route: `/flow-editor`。`?flowId=<id>` 開啟編輯，`?draftId=<id>` 恢復草稿。舊 `&copy=1` 連結開啟原 flow、移除參數並提示目前在編輯原 flow。沿用原 topology editor 的三欄、圖形、參數、geometry、preview 與 export 元件。

## Sources 與保存

Start from… 提供 Flows／Drafts；flow 可 Open，草稿可 Resume。新增 flow 從空畫布開始。正式 flow 不保存畫布座標；draft 保存 nodes、edges、viewport 和完整 configuration。舊 draft 的 `editingRecipeIds` 仍可讀取，但不控制 recipe 列表。

未正式建立的 flow 可 Save Draft；第一次正式 Save 建立 flow 並刪除草稿。已建立的 flow 僅能 Save 更新原 ID，不顯示 Save Draft。Save Draft 反覆使用同一草稿 ID，網址保存 `draftId`；正式 Save 後網址改為 `flowId`。Name／Version／Owner／Description 在保存視窗編輯。拓樸不完整或已提供值無效時禁止正式保存；此時只有新 flow 可存草稿。Geometry／required recipe 尚未完成只阻擋相應預覽和執行。

409 保留全部編輯內容，既有 flow 可取消或確認 Reload 重新載入正式版本。草稿 commit 失敗不刪草稿；舊的既有-flow 草稿在資料庫遷移時刪除，其舊連結顯示 Draft unavailable，不進入空白編輯器。

## 站點 recipes

站點視窗最上方直接顯示 Step details 的 step label 與 template 資訊，不顯示內部 `stepRefId`。接著以 Active recipe 顯示已套用 recipe 的 parameter 值，再於 Candidate recipes 列出全部 recipe 卡片。卡片只顯示名稱、ID 與 parameter 名稱；點卡片或右側 Edit 按鈕開獨立編輯視窗，按 Save recipe 才寫回，Cancel／Close 放棄。recipe 與 parameter description 不顯示，但既有 recipe description 資料保留。

- 新增站點建立並採用 Recipe 1，複製目前 step defaults。
- 列表右下 Add recipe 以 step defaults 預填編輯視窗；儲存才新增，取消不新增。非空列表新增時不改變採用；空列表新增後採用新 recipe。
- Apply recipe 選單直接改變 `selectedRecipeId`，不提供未套用選項。既有資料若有候選但未套用，保持原狀並提示手動選擇。
- 每張卡片右側 Delete 需確認；刪除已套用候選時採用下一個候選，沒有下一個才採用前一個。刪除最後一個後設為 null；空候選集合可保存。
- 已套用 recipe 的 placements 參數只顯示 placement graph，不列出每筆 placement；編輯視窗仍可編輯每筆資料。
- 刪除站點連帶移除 step configuration；刪除 input 移除 binding。
- Preview 永遠依已儲存於 flow 草稿的採用候選與其上游依賴；編輯視窗中尚未儲存的變更不影響摘要或 Preview。

## 驗收

| ID | 操作與預期 |
| --- | --- |
| UI-FLOW-001 | 建立合法拓樸；未完成 geometry／recipe 可正式存，未完成接線只能存 draft |
| UI-FLOW-002 | 建立兩組候選、編輯時取消／儲存、由選單採用；刪除已採用者改採下一個或前一個，刪除最後一個後為 null |
| UI-FLOW-003 | 保存／重載保留全部候選、選擇與 bindings，讀取不補 defaults |
| UI-FLOW-004 | 編輯既有 flow 後 Save 保留原 ID、遞增 revision；沒有 Copy、Save As、Save Draft |
| UI-FLOW-005 | 新 flow 保存／恢復 draft 保留同一 ID、positions、viewport、候選與採用狀態；正式 Save 刪除草稿，舊 `editingRecipeIds` 可讀取 |
| UI-FLOW-006 | 模擬其他 client 更新；409 不丟內容，可取消或確認 reload；舊 `copy=1` 顯示編輯原 flow 提示 |
| UI-FLOW-007 | Input／上游 preview、JSON／STEP／CDB 匯出使用採用設定 |
| UI-FLOW-008 | Dialog focus、Escape、Tab、candidate labels 與鍵盤刪 node 正確 |
| UI-FLOW-009 | 已套用 placements 只顯示 graph；recipe 編輯視窗保留 placement 清單，空值／無效值顯示正確且 mobile 無水平溢出 |

舊 flow-template-editor 和 flow-instance-editor route 已移除。既有 screenshots 是歷史參考；新驗收應使用以上路由與契約。
