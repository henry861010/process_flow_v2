---
title: Geometry JSON Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-11
last_verified_commit: 990aaf71
source_of_truth:
  - apps/viewer/app/geometry-editor/page.tsx
  - apps/viewer/components/geometry-editor/geometry-editor-page.tsx
  - apps/viewer/components/geometry-editor/geometry-editor-state.ts
  - apps/api/src/process_flow_api/geometry_validation.py
---

# Create Geometry by JSON

Route: `/geometry-editor`。首頁底部 `+ Geometry` 位於 generator commands 之後。

## 表單與版面

- Header 顯示 `Create Geometry by JSON` 與 `Return Home`；1024px 起 JSON 與 metadata
  雙欄，較窄螢幕上下排列。390px 不得產生 document-level horizontal overflow。
- 等寬 JSON textarea 預填合法空 GeometryStructure，包含 `schemaVersion: "1.0.0"`、
  `unitSystem: "um"`、`root` 與五個空 collections。只接受 structure，不接受完整 entity。
- `Format JSON` 驗證 wrapper 後格式化；收合的 `BoxGeometry example` 提供
  20 × 20 × 5 um silicon body 範例與 `Copy example`，不覆寫使用者輸入。
- `Name`、`Entity type`、`Owner` 必填。`Category`、`Dim`、`Vendor`、`Type 1`、
  `Type 2`、`Description` 選填；Dim 只作為顯示文字。
- Entity type／Category 使用 bootstrap catalog 去重後的建議，並允許自由輸入新值。
  載入失敗顯示提示，表單仍可儲存。
- 未設定 Category 的 geometry 在 library 歸入 uncategorized；以它新增 flow input 時，使用
  entityType constraint，避免產生無限制的 Any input。
- 收合的 `Advanced settings` 提供 optional Icon（Default、carrier.panel、carrier.wafer、
  die.stack、die.piece）及 optional Icon scale（`0 < scale ≤ 1`）。

## 儲存、驗證與狀態

`Save to DB` 使用既有 `POST /api/geometries`，固定 structureFormat 為 standard；文字 trim、
空白 optional metadata 省略、Dim 可為空字串。Server 指派 catalog ID；此流程不產生 generation
或 adaptationContract。Owner 必填僅屬此 UI，不改變底層 API 的 optional-owner contract。

前端檢查必填欄位、JSON 語法與 wrapper；API 在寫入前驗證 schema、unit、collections、feature
與 primitive contract，再使用 kernel semantic-key、polygon、ID validation 和 normalization。
缺少的 IDs／空 collections 補齊，合法 explicit IDs 保留。無效 structure 回傳含欄位路徑的
400 message，不寫入資料；metadata request 格式錯誤維持 422。

失敗保留所有輸入，欄位旁顯示 inline errors，表單上方顯示可聚焦且有欄位連結的 error summary。
摘要連結可展開進階設定並聚焦錯誤欄位。送出期間停用表單，避免同時發送重複 request。

成功停留原頁並顯示已儲存名稱、server ID、`Open Management` 連結。相同輸入再次儲存停用；
修改 JSON 或 metadata 後可建立新 immutable snapshot。不提供 3D preview、檔案上傳或更新功能。

## 驗收

- `UI-GEN-004`：首頁入口與直接導頁可開啟 JSON editor；空 catalog 或建議載入失敗仍可操作。
- `UI-GEN-005`：wrapper、必填欄位、icon scale 與 server 結構錯誤皆有清楚提示，失敗保留輸入。
- `UI-GEN-006`：合法 JSON 可儲存並補齊 IDs／collections；Management／geometry picker 可使用。
- `UI-GEN-007`：儲存成功停留原頁顯示 ID，相同內容與送出中均不得連續建立重複資料。
- `UI-GEN-008`：390px 無水平溢出；textarea、範例、進階欄位、錯誤摘要與儲存均可鍵盤操作。
