---
title: Flow Editor
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-11-06
last_verified_commit: aff005fa
source_of_truth:
  - apps/viewer/components/process-flow-editor/process-flow-editor.tsx
  - apps/viewer/components/process-flow-editor/geometry-input-editor-dialog.tsx
  - apps/viewer/components/geometry-generator/geometry-generator-editor.tsx
  - apps/viewer/components/process-flow-parameters/recipe-parameter-summary.tsx
  - apps/viewer/components/process-flow-save/save-information-dialog.tsx
  - apps/viewer/lib/process-flow/recipes.ts
---

# Flow Editor

Route: `/flow-editor`。`?flowId=<id>` 開啟編輯，`?draftId=<id>` 恢復草稿。舊 `&copy=1` 連結開啟原 flow、移除參數並提示目前在編輯原 flow。沿用原 topology editor 的三欄、圖形、參數、geometry、preview 與 export 元件。

## Sources 與保存

Start from… 提供 Flows／Drafts；flow 以 Use as starting point 載入完整 topology、geometry bindings、所有 recipe candidates 與採用狀態，建立尚未儲存的新 flow 分支，不補 defaults。此操作清除原儲存目標與網址的 flowId／draftId，顯示 Unsaved changes 並允許 Save Draft；來源的 ID 與載入時 revision 保存為 origin，而非繼承來源自身的 origin。名稱預填「來源名稱 (branch)」，相同 version 若重複則依序使用「來源名稱 (branch 2)」、「來源名稱 (branch 3)」；Version／Owner／Description 沿用，儲存前皆可修改。第一次 Save 才建立新 ID、revision 1，後續 Save 更新新 flow；來源內容與 revision 不變。名稱／版本衝突保留內容並提示修改，不轉為更新來源。

Drafts 分頁維持 Resume；切換來源前須確認放棄未儲存內容。切換時只解除原草稿連結，不刪除該草稿；新分支可另存草稿、恢復後正式建立。直接使用 flowId 開啟或衝突後 Reload 仍編輯該 flow。新增 flow 預設從空畫布開始。正式 flow 不保存畫布座標；draft 保存 nodes、edges、viewport 和完整 configuration。舊 draft 的 `editingRecipeIds` 仍可讀取，但不控制 recipe 列表。

未正式建立的 flow 可 Save Draft；第一次正式 Save 建立 flow 並刪除草稿。已建立的 flow 僅能 Save 更新原 ID，不顯示 Save Draft。Save Draft 反覆使用同一草稿 ID，網址保存 `draftId`；正式 Save 後網址改為 `flowId`。Name／Version／Owner／Description 在保存視窗編輯。拓樸不完整或已提供值無效時禁止正式保存；此時只有新 flow 可存草稿。Geometry／required recipe 尚未完成只阻擋相應預覽和執行。

409 保留全部編輯內容，既有 flow 可取消或確認 Reload 重新載入正式版本。草稿 commit 失敗不刪草稿；舊的既有-flow 草稿在資料庫遷移時刪除，其舊連結顯示 Draft unavailable，不進入空白編輯器。

## Library 新增位置

Geometry library 與 step library 支援點擊、Enter／Space 新增，拖曳則放在滑鼠落點。
點擊新增及 generator 建立新 geometry 時，以中央畫布當下可視範圍的中心計算位置，
換算目前平移與縮放後讓元件本體置中，不移動畫布、不自動 fit view。新增後沿用選取新元件的行為。
Generator 修改既有 input 時維持其位置。停用項目不可新增；拖曳結束不額外觸發點擊新增。

中心被節點占用時，在中心為基準的 7×7 候選格點中依距離由近到遠尋找可視範圍內的空位，
格點間距為新元件寬／高加 24 個畫布單位。使用既有節點實測尺寸，尚未量測時 geometry
使用 132×132、step 使用 248×132。每次新增最多檢查 49 個位置；沒有空位或畫布小於元件時
回退中心並允許重疊，不重新排版既有節點。Draft 持續保存新增後的座標與目前 viewport。

## Geometry 來源與重新編輯

畫布維持單擊接線、雙擊編輯。雙擊 geometry input 開啟單一 Geometry 編輯視窗：
generator binding 直接查詢保存 ID／version 的 definition 並帶入完整參數，不依賴
resolved preview geometry；catalog binding 顯示唯讀資料與 Preview；未設定則直接選擇來源。
不經摘要卡片、鉛筆或來源選擇器才能續編，不升級 generator 版本。

Header 顯示 input 名稱、來源及 `Change source`。Generator 編輯主體直接共用 Geometry
Generator page 的 `GeometryGeneratorEditorContent`：所有尺寸皆為工程預覽在上、驗證訊息與
參數在下，預覽 views 在 1024px 起雙欄、窄視窗單欄。Body 負責捲動，footer 固定提供
`Cancel`／`Apply changes`。
`Advanced settings` 預設收合，提供 Name、Required、Description、entity/category constraints、
唯讀連線數及 Flow input ID；修改 constraints 保留隱藏的 structureFormats。Delete geometry input
位於進階區域，沿用刪除節點、binding 與連線的獨立操作並關閉視窗。Generator 的進階區域
接在共用參數表單下方；catalog 繼續顯示唯讀資料與 Preview。

`Change source` 在同一個 dialog 切換內容；`Back to geometry` 取消選來源、保留原編輯草稿，
並忽略取消前尚未完成的來源請求。來源頁保留 catalog 搜尋與分類，每個 generator ID 只提供
一個 manifest label 入口；目前可續編來源與符合 constraints 的 generators 合併去重，
維持 registry 順序及 flowInputPicker 限制。選回目前 generator 保留編輯草稿；重新選回原
binding generator 使用保存版本與參數；其他 generator 使用所選 definition 的 defaults。

參數、來源與 input 設定皆為 session 暫存。只有 `Apply changes` 一次寫回 definition 與
binding；generator 使用目前有效 preview 的 normalized parameters，僅修改 input 設定時保留
原 binding。無修改、來源未選定、generator 載入中或最新 preview 尚未有效時停用 Apply。
Catalog Preview 使用暫存來源與 input 設定，不先套用到 flow。站點／畫布的其他 preview
仍使用已套用的 flow 設定。正式保存使用 Flow Save，不新增 Geometry DB 紀錄。

Cancel、Close、Escape 與背景點擊放棄整個 session；單純開啟、預覽與取消不產生 dirty state。
修改既有 input 保留節點位置、連線與其他 bindings。版本載入失敗留在視窗顯示錯誤、Retry
及 Change source，不回退新版。預覽失敗可 Retry preview；版本／預覽請求在關閉、卸載、
取消選來源或切換來源後忽略過期回應，載入來源時禁止重複選擇。

Dialog 提供 focus trap；切換來源頁時焦點移至該頁標題，返回編輯時移至 input 標題。
Preview 的 Escape 只關閉最上層 preview；關閉編輯器還原先前焦點。
Geometry library 建立新 input 仍使用既有 generator `Define` 流程。

## 站點 recipes

### 共用 Data fields

Recipe 編輯視窗在計算參數下方提供 Data fields。Add data field 建立同 template 共用的 proposed 欄位，必填名稱、型別、提出原因，range／單位／操作人名稱選填；未提供姓名記為 unknown，相似名稱會提示沿用既有欄位。建立直接寫入 DB，取消 recipe 編輯不會撤銷。欄位於開啟 recipe、視窗重新取得焦點或 Refresh fields 時更新。

欄位均為選填，清空移除 key，0／false 保留。Proposed 有文字 Badge 與未定版提示；型別或 range 問題顯示在欄位旁，仍可保存原始 scalar 值。Formal 不合法時停用 Save data。被移除欄位的尚未保存輸入會顯示，需明確放棄該值後再保存。

Save data 只更新目前 recipe 的 dataValues，不保存其他計算參數修改；成功顯示 Saved to database，失敗保留輸入供重試。新 flow 首次保存資料前要求草稿名稱與操作人，先保存包含當前 recipe 的草稿。既有 flow 中尚未保存的新 recipe，先開啟 Save flow；完成後回到原 recipe 再按 Save data，資料輸入仍保留。

Active recipe 摘要顯示已填資料與 proposed 標記。這些欄位不參與 geometry 預覽／執行。管理介面連結可使用 `stepRefId`／`recipeId` 配合 `flowId` 或 `draftId` 直接開啟 recipe，開啟本身不產生未儲存修改。

### 候選 recipe 操作

站點視窗最上方直接顯示 Step details 的 step label 與 template 資訊，不顯示內部 `stepRefId`。接著以 Active recipe 顯示已套用 recipe 的 parameter 值，再於 Candidate recipes 列出全部 recipe 卡片。卡片只顯示名稱、ID 與 parameter 名稱；點卡片或右側 Edit 按鈕開獨立編輯視窗，按 Save recipe 才寫回，Cancel／Close 放棄。recipe 與 parameter description 不顯示，但既有 recipe description 資料保留。

- 新增站點建立並採用 Recipe 1，複製目前 step defaults。
- 列表右下 Add recipe 以 step defaults 預填編輯視窗；儲存才新增，取消不新增。非空列表新增時不改變採用；空列表新增後採用新 recipe。
- Apply recipe 選單直接改變 `selectedRecipeId`，不提供未套用選項。既有資料若有候選但未套用，保持原狀並提示手動選擇。
- 每張卡片右側 Delete 需確認；刪除已套用候選時採用下一個候選，沒有下一個才採用前一個。刪除最後一個後設為 null；空候選集合可保存。
- 已套用 recipe 的 placements 參數只顯示 placement graph，不列出每筆 placement；編輯視窗仍可編輯每筆資料。
- 已套用 recipe 的所有 `fieldGroupArray` 依 definition 顯示唯讀表格，不限 RDL：每個 item 一列，首欄以 `itemNameTemplate` 與既有 index 命名，其餘欄位依 child definitions 的順序、名稱與單位顯示。保留資料列序與數值，不顯示 `itemId` 或原始 JSON。
- 摘要中的 scalar 顯示文字（保留 `0`／`False`），array 顯示清單；nested `fieldGroupArray` 遞迴顯示表格，placements 沿用唯讀 graph。未設定顯示 `Not set`、空群組／array 顯示 `No items`、不合法結構顯示 `Invalid value`，不補 defaults。placements 的空值與無效值沿用既有 preview 提示。
- 群組表格提供 caption、列／欄標題與可鍵盤操作的局部水平捲動區域；固定欄位寬度下長文字可換行，nested table 也在自身範圍捲動，不撐寬站點視窗。
- 刪除站點連帶移除 step configuration；刪除 input 移除 binding。
- 站點 Preview 依已套用於 flow 的採用候選與其上游依賴；recipe 編輯視窗中尚未儲存的變更不影響摘要或站點 Preview。Geometry 編輯器的 catalog Preview 則依該視窗暫存來源。

## 驗收

| ID | 操作與預期 |
| --- | --- |
| UI-FLOW-001 | 建立合法拓樸；未完成 geometry／recipe 可正式存，未完成接線只能存 draft |
| UI-FLOW-002 | 建立兩組候選、編輯時取消／儲存、由選單採用；刪除已採用者改採下一個或前一個，刪除最後一個後為 null |
| UI-FLOW-003 | 保存／重載保留全部候選、選擇與 bindings，讀取不補 defaults |
| UI-FLOW-004 | 直接編輯既有 flow 後 Save 保留原 ID、遞增 revision，不顯示 Save Draft；Start from 改為尚未儲存的新分支 |
| UI-FLOW-005 | 新 flow 保存／恢復 draft 保留同一 ID、positions、viewport、候選與採用狀態；正式 Save 刪除草稿，舊 `editingRecipeIds` 可讀取 |
| UI-FLOW-006 | 模擬其他 client 更新；409 不丟內容，可取消或確認 reload；舊 `copy=1` 顯示編輯原 flow 提示 |
| UI-FLOW-007 | Input／上游 preview、JSON／CDB 匯出使用採用設定 |
| UI-FLOW-008 | Dialog focus、Escape、Tab、candidate labels 與鍵盤刪 node 正確 |
| UI-FLOW-009 | 已套用 placements 只顯示 graph；recipe 編輯視窗保留 placement 清單，空值／無效值顯示正確且 mobile 無水平溢出 |
| UI-FLOW-010 | RDL 與任意 `fieldGroupArray` 以 schema 驅動的表格摘要顯示，保留列序、編號、單位、0／False；nested group、array、placements 正確，缺值／空值／不合法結構不回退 JSON；切換採用 recipe 後摘要同步更新，窄視窗只在表格內水平捲動 |
| UI-FLOW-011 | Start from 複製完整內容並預填不重複分支名稱，未修改也能 Save 成新 ID／revision 1；後續 Save 僅更新分支，origin 記錄直接來源且來源不變；Save Draft／Resume／commit 保留 origin，取消切換與載入／儲存失敗保留內容，原草稿不被刪除 |
| UI-FLOW-012 | 在長 flow 尾端平移／縮放後，點擊或鍵盤新增 geometry、step 及 generator 新 geometry 出現在中央畫布中心附近，保持 viewport；連續新增避讓，無可用候選時回退中心；拖曳依落點且只新增一個，停用項目不可新增；bindings、預設 recipe、選取狀態與 draft 恢復正確 |
| UI-FLOW-013 | 同一 generator 只顯示一個名稱入口；續編保留保存版本與參數（含 0／False）；其他來源使用 defaults，catalog 搜尋／分類正常；取消選來源保留編輯草稿，取消後延遲回應不得替換草稿 |
| UI-FLOW-014 | 雙擊 generator input 直接顯示參數與工程預覽，即使 resolved geometry 失敗也可續編；catalog 顯示唯讀資訊與 Preview，未設定直接選來源；單擊接線維持 |
| UI-FLOW-015 | 參數、來源及 Advanced settings 僅 Apply 才一併寫回；Cancel／Close／Escape／背景點擊保留原 flow，無修改不能 Apply；套用只更新目標 input，位置、連線、其他設定與隱藏 constraints 保留；不寫 Geometry DB |
| UI-FLOW-016 | 保存版本失敗可 Retry 或 Change source，失敗保留 binding；無效／失敗／尚未完成的 preview 禁止套用且可重試；重複操作不重複請求，關閉／卸載後的回應無效；catalog Preview 使用暫存 binding，關閉 Preview 不套用 |
| UI-FLOW-017 | 1440×900、1024×768、390×844 的 generator 編輯主體與 Generator page 共用同一版面：預覽在上、參數在下、Advanced settings 最後；預覽 views 在桌面雙欄、窄視窗單欄，無 dialog 或 document 水平溢出；footer 固定，Tab focus trap／來源頁焦點切換／Escape／focus restore 正確，Preview Escape 只關閉最上層 |

舊 flow-template-editor 和 flow-instance-editor route 已移除。既有 screenshots 是歷史參考；新驗收應使用以上路由與契約。

Geometry 共用 Generator page 編輯主體的操作與三尺寸畫面見
[驗證紀錄](../evidence/shared-geometry-generator/README.md)。先前開啟即編輯的操作見
[歷史驗證紀錄](../evidence/geometry-input-editor/README.md)。
