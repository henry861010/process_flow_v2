---
title: Geometry input direct editing verification
status: descriptive
owner: Process Flow UI
audience:
  - frontend
  - QA
last_verified: 2026-11-06
last_verified_commit: eeb83566
source_of_truth:
  - apps/viewer/components/process-flow-editor/geometry-input-editor-dialog.tsx
  - apps/viewer/components/process-flow-editor/process-flow-editor-sources.test.tsx
  - docs/ui/screens/flow-editor.md
---

# Geometry input 編輯驗證

Route：`/flow-editor/`，Viewer port 3001、現有本機 API port 8000。
使用 Geometry library 建立尚未保存的 Wafer carrier input；只操作此瀏覽器的暫存 flow，
沒有 reset、保存 flow／draft 或建立 catalog geometry。截圖是目前介面的操作證據，
不是 canonical fixture 的 pixel regression baseline；未指定的 browser defaults 沿用環境。

| Case | 操作與預期／觀察 | Evidence |
| --- | --- | --- |
| UI-FLOW-014 | Wafer carrier generator → Define → 雙擊 geometry；直接顯示 Diameter、Carrier thk、Carrier material 與工程預覽。 | [1440×900](geometry-input-1440x900.png) |
| UI-FLOW-013 | 將厚度 775 改為 800 → Change source → Back to geometry；保留暫存 800，來源頁焦點在 Choose geometry source，返回後焦點在 input heading。 | Browser 操作與 session tests |
| UI-FLOW-015 | Apply changes → 重開；厚度為 800。修改為 850 → 點背景關閉 → 重開；仍為 800。修改 Name 與來源後 Escape 關閉 → 重開；仍為原名稱與 generator binding。 | Browser 操作與 session tests |
| UI-FLOW-016 | Name 暫改 Carrier draft、來源暫選 200 mm Silicon Wafer → Preview；顯示 Carrier draft 與 725 µm。Escape 只關閉 preview，保留 Geometry 編輯器；再取消不套用。 | [Pending catalog preview](catalog-preview-390x844.png) |
| UI-FLOW-017 | 1440×900、1024×768 顯示參數／預覽雙欄；390×844 參數在前，footer 保持可見。dialog clientWidth／scrollWidth 分別為 1238／1238、982／982、364／364；document width 與 viewport 一致。 | [1440×900](geometry-input-1440x900.png)、[1024×768](geometry-input-1024x768.png)、[390×844](geometry-input-390x844.png) |
| UI-FLOW-017 | 390px 的來源頁無水平溢出；桌面 Shift+Tab 從首個 Change source 到最後的 Cancel，Tab 從 Cancel 回到 Change source（無修改時 Apply 停用）。 | [Source picker](geometry-source-390x844.png)、Browser focus observations |

本次操作沒有觀察到上述案例的新 gap。版本／預覽失敗、重試、重複請求、關閉／卸載／
取消來源後的延遲回應，以及無 resolved geometry 的直接續編由 session tests 覆蓋。
本紀錄不宣稱已完成整個 Flow Editor 的 pixel regression 或所有既有 gap。

驗證命令與限制：

- Geometry editor、generator、recipes 與 click-connection 的五個相關測試檔：58 tests 通過。
- Production build 通過，包含 production bundle 與 static export。
- 完整 Viewer suite：491 tests 通過、2 tests 失敗；既有 schematic-preview.test.tsx 的兩個 inspector dock tests 引用未匯出的 SchematicInspectorCard。
- 獨立 `tsc --noEmit --incremental false` 亦回報上述缺少 export，以及既有 flow-editor-source.test.ts 的 fixture 型別斷言與缺少 recipe description；本次 Geometry 程式碼與 session tests 無型別錯誤。
- 文件檢查另有三份既有規格缺少 last_verified_commit；本次新增／更新的 Geometry 文件無該錯誤。
