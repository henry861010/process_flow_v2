---
title: Shared geometry generator editor verification
status: descriptive
owner: Process Flow UI
audience:
  - frontend
  - QA
last_verified: 2026-11-06
last_verified_commit: aff005fa
source_of_truth:
  - apps/viewer/components/geometry-generator/geometry-generator-editor.tsx
  - apps/viewer/components/geometry-generator/backend-geometry-generator-dialog.tsx
  - apps/viewer/components/process-flow-editor/geometry-input-editor-dialog.tsx
  - apps/viewer/components/process-flow-editor/process-flow-editor-sources.test.tsx
---

# 共用 Geometry Generator 編輯主體驗證

使用本機 Viewer port 3001 與既有 API port 8000，對照同一個 LSI generator 的 catalog
page 與 flow input 編輯彈窗。只建立瀏覽器內尚未保存的 flow input；未保存 flow／draft，
也未建立 catalog geometry。截圖是本次版面驗證的操作證據，不是 pixel regression baseline。

## 版面（UI-FLOW-017）

兩個入口都由同一個 `GeometryGeneratorEditorContent` 顯示工程預覽，再顯示參數；
Flow 的 Advanced settings 位於參數下方。1024px 起 Top View／Cross Section 雙欄，
390px 單欄。Flow body 捲動時 header 與 Cancel／Apply changes footer 保持可見。

| Viewport | Flow dialog clientWidth／scrollWidth | Page content clientWidth／scrollWidth | Evidence |
| --- | --- | --- | --- |
| 1440×900 | 1238／1238 | 966／966 | [Flow](flow-1440x900.png)、[Page](page-1440x900.png) |
| 1024×768 | 982／982 | 675／675 | [Flow](flow-1024x768.png)、[Page](page-1024x768.png) |
| 390×844 | 364／364 | 358／358 | [Flow](flow-390x844.png)、[Page](page-390x844.png) |

各尺寸的 document scrollWidth 都等於 viewport width；預覽結束後 20px 才開始參數表單。
Flow footer 在 viewport 內，未觀察到 dialog 或 document 水平溢出。

## 互動與回歸

- LSI input 開啟即顯示保存版本參數與工程預覽。Si thickness 從 200 改為 250，Change
  source → Back to geometry 後仍為 250；Apply 後重開仍為 250。改成 275 → Escape →
  重開仍為 250。Advanced settings 可展開，位於完整參數表單之後。
- Shift+Tab 從 Change source 循環到 Cancel，Tab 從 Cancel 回到 Change source；來源頁
  焦點位於 Choose geometry source，返回時位於 input heading。Escape 正常關閉彈窗。
- Catalog page 將 Si thickness 設為 -1，顯示後端欄位錯誤並停用 Generate JSON／Save
  to DB。恢復有效值後成功下載 lsi-geometry.json，確認為 schemaVersion 1.0.0、unitSystem
  um、root key lsi 的 GeometryStructure；Save to DB 可開啟 metadata 表單，取消後返回原頁。
  DB 寫入與失敗回復由測試 mock 驗證，瀏覽器驗證未寫入 catalog。
- Session tests 透過共用內容操作參數與 retry，涵蓋保存版本、來源切換、過期請求、取消、
  normalized parameters 與 metadata-only 套用。新增 catalog 回歸涵蓋 JSON materialization、
  hash 檢查、metadata trim、保存成功停留原頁、失敗保留輸入，以及每次編輯只有一個 preview。

## 驗證結果與既有問題

- 五個相關測試檔共 61 tests 通過；Viewer production build 與 static export 通過。
- 完整 Viewer suite：495 tests 通過、2 tests 失敗，仍為既有 schematic inspector dock
  tests 引用未匯出的 SchematicInspectorCard。
- 獨立 TypeScript 檢查仍回報上述缺少 export，以及既有 flow-editor-source.test.ts 的
  fixture 型別斷言與缺少 recipe description；本次修改檔案沒有新型別錯誤。
- 文件檢查仍有三份既有文件缺少 last_verified_commit；本次文件沒有新增檢查錯誤。
