---
title: CSV Column Mapping Browser Evidence
status: historical
owner: Process Flow UI
audience:
  - frontend
  - QA
last_verified: 2026-10-15
last_verified_commit: bed1b3d9223073ef7cef59b9f54c548813a626dd
source_of_truth:
  - docs/ui/components/parameter-editor.md
  - docs/ui/acceptance/README.md
verified_against:
  - apps/viewer/components/process-flow-parameters/repeatable-group-csv-import.tsx
  - apps/viewer/lib/process-flow/repeatable-group-csv.test.ts
---

> 歷史 UI 證據：此處的舊路由／資料模型已退場，現行規格見 [Flow Editor](../../screens/flow-editor.md)。

# CSV 欄位對應檢閱

2026-10-15，使用 Codex in-app browser 檢閱本機 Viewer，沒有執行資料庫 reset 或儲存實例。
以下為 implementation observation，不是 normative visual baseline。

## 實際編輯器

- Route：`/flow-instance-editor/?templateId=flow_tpl_aaa_demo`，開啟 RDL layer。
- Entry state：blank instance，先填入 `Original material`，使用
  [CSV fixture](csv-mapping-valid.csv) 選檔，將 Dielectric 對應至 pm，其他同名欄位自動預填。
- Expected/observed：選檔與對應不改原值；Cancel 保留原值並回到匯入按鈕。
  Confirm import 才取代為兩層，材料依序為 PI-2611、ABF，note 明示忽略。
- 非法第二列 height=0：保留整份原值與 mapping，聚焦錯誤訊息
  `Line 3, key "thk": CSV column "height": Value must be > 0.`。
- Desktop 1440×900：[對應表](desktop-1440x900.jpg)。
- Mobile 390×844：[對應表](mobile-390x844.jpg)。document scrollWidth=390；四個 select
  的左右邊界為 63/327px，無水平溢出。以 Tab 依序到達四個 select、Cancel、Confirm import，
  modal 內容捲動後確認按鈕與 focus 可見。
- 對應 cases：UI-PARAM-020～024。上述 mapping 操作沒有觀察到新 gap。

## 隔離元件生命週期

使用實際 ParameterValueEditor 與 RDL fixture，包含 nested repeater。測試 adapter 提供
延遲/釋放 File.text、切換 disabled、修改 definition 與卸載/重新掛載等控制。
[檢查結果](lifecycle-checks.json) 記錄已通過的瀏覽器 assertions：

- required 未對應阻擋確認，同名欄位自動預填，其他欄位不能重複選已用來源。
- pending mapping 在手動 edit、disabled 或 definition 改變時取消。
- delayed read 在手動 edit 或卸載後完成，不會覆寫最新值或重開 mapping。
- nested repeater 匯入不改外層值。
- 非法後列保留原值與 mapping；改選合法來源欄位後可直接重試成功。
- 更換 CSV 清除舊 mapping，依新檔表頭重新預填。

## 程式驗證

- CSV unit tests：61 passed；TypeScript noEmit：passed。
- Viewer 全套：285 passed、4 failed；4 個失敗均位於既有 CDB mesh-control export tests。
  以 HEAD bed1b3d 的隔離 baseline 執行同一 suite，重現相同四項失敗，與 mapping 變更無關。
- Documentation validation：passed。
