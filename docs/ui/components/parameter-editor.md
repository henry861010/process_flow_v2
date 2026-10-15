---
title: Parameter Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-15
last_verified_commit: bed1b3d9223073ef7cef59b9f54c548813a626dd
source_of_truth:
  - apps/viewer/components/process-flow-parameters/parameter-value-editor.tsx
  - apps/viewer/lib/process-flow/parameter-values.ts
  - apps/viewer/lib/process-flow/configuration.ts
  - apps/viewer/components/process-flow-parameters/repeatable-group-csv-import.tsx
  - apps/viewer/lib/process-flow/repeatable-group-csv.ts
---

# Parameter Editor

## 目的

`ParameterValueEditor` 根據 `ParameterDefinition[]` render working `parameterValues`。它只更新
values，不修改definitions；required/type/range/enum/repeat completeness由configuration validator
判斷。

## Container 與 row 版面

無definitions時顯示 dashed block `No parameters`、padding `16px 24px`。有definitions時是
white bordered card + dividers。

Primitive row desktop grid：`minmax(180px,.8fr) minmax(240px,1.2fr)`、gap16、padding16；
`<768px` one column。Coordinates 是例外，label 在 control 上方並使用完整 row 寬度，避免四個
bounds values 被 description column 壓縮。Label顯示 name、required `*`（`required !== false`）、monospace
`id / unit`、非compact時description。

呼叫端可傳入 ordered parameter groups。每個非空 group render成獨立 bordered card，header使用
muted background，rows依group的`parameterIds`順序排列；未被group引用的definitions必須保留並在
groups後方以一般card顯示。沒有groups時版面維持單一flat card。

## Control 解析矩陣

判斷順序 MUST 與下表一致：

| Definition | Render | Serialization |
| --- | --- | --- |
| `placements` 或 `placementList` | [Placement List](coordinate-list.md) | target region + pose + anchor array |
| `select` + array type | option checkboxes | typed array |
| `select` + primitive | native select，首項 `Select value` | coerced primitive/empty |
| `checkbox` + boolean | checkbox + `True/False` | boolean |
| `checkbox` + options | option checkboxes | single primitive或multiple array |
| other array | comma-separated text input | split、trim、remove empty、typed array |
| numeric | number input + optional unit | number或empty string |
| fallback | text input | string |

Integer step `1`，float `any`；numeric min/max來自validation。Option UI MUST 只產生
`optionSource.options`中的值；canonical `optionSource`是enum，不是自由文字hint。

Option checkbox card最小寬140px、padding12px/8px；multiple依
`selectionMode="multiple"` toggle membership，single selection勾新值時取代、取消時變empty。

## Repeatable group 規格

`fieldGroupArray` + `repeatDefinition` render full-width repeater：

- header保留Parameter label與description；清單底部靠右保留 `Add`，與清單間距12px；
- 每個item標題右上角顯示小叉叉，直接刪除指定item；底部不再顯示 `Remove`。items等於或低於`minItems`時叉叉disabled；
- 第一個item上方及相鄰item之間是高度32px的插入位置button。hover、keyboard focus或選取時顯示 `Insert here`，選取以插入線及`aria-pressed`表達；點擊只設定位置，不新增item；
- 未選取位置時Add追加至最後；選取後Add插入該位置，連續Add接續插在上一個新增item後方。底部顯示 `Insert before <item heading>` 與 `Add at end`，後者清除選取並聚焦Add（Add disabled時聚焦最後一組heading），不直接新增；
- 選取位置以右側item的`itemId`作anchor，編號變動及刪除其他item不改變anchor。anchor被刪除、CSV成功匯入或外部替換清單時清除選取；一般欄位edit保留選取；
- Add在`maxItems`時disabled；增刪handler同樣防止超出min/max及disabled限制；
- 每次成功增刪後，該層items依array order從`indexBase`連續編號；既有`itemId`、values與nested values保留。初次載入及一般edit不重新編號；新item沿用definition default；
- Add後以新item的`itemId`定位，DOM更新後即時捲到新item heading並聚焦heading；
- 刪除後聚焦原位置的下一個item heading，沒有下一個時聚焦前一個，清單清空時聚焦Add；不觸發自動捲動；
- 每個item是 muted/20 card、padding12，heading由`itemNameTemplate`格式化；child definitions在`md`兩欄、gap12；nested group跨兩欄並recursive render；
- empty顯示 `No items` dashed block，Add仍在block下方；
- nested repeater沿用相同版面與互動，每個repeater獨立保存插入位置；新增只定位該repeater的新item，增刪只重新編號該層。初次載入與edit不觸發自動捲動或focus。

Value shape：

```json
{
  "items": [
    { "itemId": "stable-id", "index": 1, "values": {} }
  ]
}
```

React key MUST 用`itemId`，不可用array index；edit child不得重建item identity。

## Repeatable group CSV 匯入

每個 repeater 獨立檢查 `itemParameterDefinitions`。子欄位非空，且全部為 `string`、
`materialRef`、`integer`、`float` 或 `boolean` 時，header 下方顯示 CSV 區塊與
`Import CSV` 按鈕。包含 `placements`、任一 array type 或 nested `fieldGroupArray`
的群組不提供匯入；其 nested repeater 若自身符合條件仍可匯入。判斷只依 definition，
不依目前值或特定 process program。

區塊列出 target parameter ids。`Import CSV` 選檔後只讀取並檢查 CSV 結構，在區塊內展開
`Column mapping`，顯示檔名、item count 與依 definition 順序排列的對應表；每列包含
field name、key、Required/Optional 與 native select。系統 key → CSV 欄名，由下拉選單選擇，
表頭 trim 後與 key 大小寫完全相同者自動預填。必填未對應時顯示行內提示，
`Confirm import` 停用；選填可選 `Do not import`，其他欄位已選的 CSV column 在選單內停用。
未對應的 CSV 欄位列於 `Columns that will be ignored`，匯入時忽略。

`Confirm import` 才驗證欄位值並一次取代整份清單；選檔與調整 mapping 不改值。
`Cancel` 清除檔案與 mapping，保留目前清單；`Choose another CSV` 選定新檔後重設 mapping，
取消檔案選擇器則保留既有待確認內容。Mapping 僅保留於本次匯入，不存 localStorage、
template 或 instance。使用瀏覽器內建 `File.text()` 與本機 TypeScript parser，無新增套件、
CDN、檔案上傳或外部服務。

RDL 範例（`thk` 使用 definition 的 `um` 單位，不轉換單位）：

```csv
Dielectric,Conductivity,thk,density
PI-2611,Cu,8,62
PI-2611,Cu,6,48
```

自訂表頭範例：將 `Dielectric` 選為 `pm`，`note` 不對應而忽略；材料內容不轉換。

```csv
pm,Conductivity,thk,density,note
PI-2611,Cu,8,62,first layer
ABF,Cu,6,48,second layer
```

- UTF-8 CSV 支援 BOM、CRLF/LF、引號內逗號/換行與 doubled quotes；完全空白列忽略。
- 表頭 trim 後不可空白或重複，欄位順序不限。欄數不一致、malformed quoting、empty file
  或 header-only file 必須拒絕。必填未對應、無效來源/目標 key、重複對應不可匯入。
- `importRepeatableGroupCsv` 第三參數為選填 `Record<string, string | null>`，表示系統 key →
  CSV 表頭，null/缺省略過該欄；不傳 mapping 的既有呼叫仍要求表頭精確匹配 child id，
  拒絕 unknown/missing required header。
- Number cell trim 後完整解析 decimal/scientific notation，不接受單位、partial number、
  hex、NaN 或 Infinity；integer 必須 integral。Boolean 只接受 `true` / `false`。
- String/materialRef 保留 cell 內容；required 空白值拒絕，optional missing/blank cell
  省略，不套用 default。套用 range（含 exclusive bounds）、length、full-match regex、
  typed enum 與 repeat min/max 規則。
- 整份通過才一次取代該群組；每列產生新唯一 `itemId`，`index` 從 `indexBase` 遞增，
  CSV 列序就是執行順序。匯入不觸發 Add 的 heading focus/scroll，其他參數不變。
- 失敗保留原值及待確認 mapping，錯誤顯示 physical line、target key 與 CSV column（cell error），透過 `role=alert`
  宣告並聚焦錯誤訊息；成功透過 `role=status` 宣告檔名、item count 與取代結果。
- Read 期間顯示 `Reading CSV…` 並停用選檔；群組 value/definition 改變、disabled 或卸載
  使舊讀取與待確認 mapping 失效。手動 edit 不會被舊匯入覆寫；file input 清空以允許
  重選同一檔案。讀取後 focus 第一個 mapping select；取消/成功後 focus 匯入按鈕，
  不使用新增 item 的 heading focus/scroll。錯誤 focus 訊息，修正 mapping 後清除舊錯誤。
- 對應表在 `sm` 以上為兩欄，窄螢幕 label/control 垂直排列；長 key/檔名可換行，
  select 不可撐寬容器，按鈕可換行。

## Disabled 與 read-only

所有native controls disabled；repeater Add/叉叉/插入位置/Add at end/CSV import disabled。Readonly placements顯示ordered summary
與polygon SVG preview，但不render mutating actions。Disabled不代表值被清除。

## Validation 呈現

Editor現況不在每個primitive旁render validation message；screen status與graph readiness顯示第一個
blocking reason。重建不得用HTML coercion把invalid user input靜默改成default。Enum外值、invalid
placements、repeat min/max、nested required等均使configuration incomplete/error。

## 鍵盤、focus 與 ARIA

- Dynamic control用definition name作`aria-label`。
- Required star是視覺提示；semantic required/`aria-required`是target gap，應補但不能改copy/layout。
- Checkbox label包住control；select/input依DOM definition order。
- Add與叉叉在disabled時仍保留位置；不得造成layout jump。叉叉有包含item heading的accessible name，icon為decorative。
- 插入位置button可透過Tab、Enter或Space操作；`aria-pressed`宣告選取狀態，選取提示使用`role=status`。
- Item heading使用`tabIndex=-1`供新增後程式聚焦，不加入一般Tab順序；鍵盤focus須有可見指示，捲動不得被dialog header/footer遮住。

## 測試 fixture

Component fixture至少包含：text、integer+unit、float range、boolean、single enum、multi enum、array、
rectangle/polygon placements、one-level repeat、nested repeat、disabled state。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-PARAM-001` | definitions empty | exact `No parameters` state。 |
| `UI-PARAM-002` | select enum | UI只能產生options內值，type coercion正確。 |
| `UI-PARAM-003` | comma array input | trim/remove empty並輸出typed array。 |
| `UI-PARAM-004` | repeat at min/max | 叉叉/Add各自在boundary disabled，handler同樣拒絕越界。 |
| `UI-PARAM-005` | edit nested child | itemId/index穩定、sibling values不變。 |
| `UI-PARAM-006` | committed/disabled | 值可讀但所有mutation commands不可用。 |
| `UI-PARAM-007` | repeat有多個items或empty | Add位於最後item或`No items`下方，靠右排列；叉叉位於各item右上角。 |
| `UI-PARAM-008` | 在可捲動dialog以mouse或keyboard連續Add | 每次新增後即時捲到新item heading並聚焦；小視窗下heading與focus仍可見。 |
| `UI-PARAM-009` | nested repeat Add，或載入/edit/Delete | nested Add只定位該層新item；載入/edit不移動focus或編號；Delete只重新編號該層並依指定規則移動focus。 |
| `UI-PARAM-010` | simple repeat / complex repeat / simple nested repeat | 僅符合 scalar schema 的 repeater 顯示 CSV；nested 獨立判斷。 |
| `UI-PARAM-011` | 選擇合法 RDL CSV 並確認 mapping 匯入 | 一次取代清單，fresh identities、indexBase 與列序正確；可手動 edit，save/reload 後層序不變。 |
| `UI-PARAM-012` | CSV 格式/表頭/值/項目數錯誤 | 原值不變，顯示列號/key/原因；同檔可重選。 |
| `UI-PARAM-013` | cancel / disabled / read 期間 edit 或卸載 | cancel 不改值，disabled 不允許匯入，stale read 不覆寫最新值或更新卸載元件。 |
| `UI-PARAM-014` | 點第一組上方／組間位置後連續Add | 插入位置正確，連續新增順序穩定；Add at end恢復尾端新增。 |
| `UI-PARAM-015` | 刪除指定頭／中／尾item | 只刪除指定item；該層從indexBase重新編號，sibling identity、values及nested值保留。 |
| `UI-PARAM-016` | 選取位置後edit／刪除其他item／刪除anchor | edit及其他item刪除保留anchor；刪除anchor清除選取。 |
| `UI-PARAM-017` | 巢狀repeater獨立選取與增刪 | 不影響其他repeater的插入位置、identity或編號。 |
| `UI-PARAM-018` | 鍵盤選取、新增及刪除 | 選取可用Enter/Space；新增focus新heading，刪除focus下一組／前一組／Add。 |
| `UI-PARAM-019` | CSV成功匯入或外部替換清單 | 清除插入位置，CSV不觸發新增focus/scroll；失敗匯入保留原值及選取。 |
| `UI-PARAM-020` | 選擇同名或含 `pm` 的 CSV | 選檔不改值；同名預填，`pm` 可手動對應 `Dielectric`；缺 required 對應停用 Confirm import。 |
| `UI-PARAM-021` | mapping 含額外欄位或 optional field | 未選 CSV 欄位列出並忽略；optional 可不匯入且不套 default；已選來源不可重複對應。 |
| `UI-PARAM-022` | 調整 mapping 後 Confirm import／Cancel／Choose another CSV | 確認後一次取代；取消保留原值；選新檔清除舊 mapping；取消選檔保留待確認內容。 |
| `UI-PARAM-023` | 後列值不合法、待確認期間 edit/disabled/卸載 | 錯誤保留原值與 mapping，顯示行號/CSV 欄名/target key；群組異動使待確認內容失效。 |
| `UI-PARAM-024` | mapping 區塊在 1440×900 與 390×844，以鍵盤操作 | label/select 關聯、必填錯誤可讀、第一個 select 有 focus，無區塊水平溢出；確認/取消焦點回匯入按鈕。 |
