---
title: Parameter Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-14
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - apps/viewer/components/process-flow-parameters/parameter-value-editor.tsx
  - apps/viewer/lib/process-flow/parameter-values.ts
  - apps/viewer/lib/process-flow/configuration.ts
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

- header保留Parameter label與description；清單底部靠右依序排列 `Remove`、`Add`，與清單間距12px；
- Remove只移除最後一個item，items等於`minItems`時disabled；
- Add在`maxItems`時disabled；新index是空陣列用`indexBase`，否則current max + 1；
- Add後以新item的`itemId`定位，DOM更新後即時捲到新item heading並聚焦heading，按Tab可進入新item欄位；
- 每個item是 muted/20 card、padding12、gap12，heading由`itemNameTemplate`格式化；
- child definitions在`md`兩欄；nested group跨兩欄並recursive render；
- empty顯示 `No items` dashed block，Add/Remove仍在block下方；
- nested repeater沿用相同版面與互動，新增只定位該repeater的新item；初次載入、edit與Remove不觸發自動捲動或focus。

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

區塊列出 parameter ids 作為 CSV 表頭，提示每列產生一個 item、匯入取代目前整份清單、
optional 欄位可省略。使用瀏覽器內建 `File.text()` 與本機 TypeScript parser，無新增套件、
CDN、檔案上傳或外部服務。

RDL 範例（`thk` 使用 definition 的 `um` 單位，不轉換單位）：

```csv
Dielectric,Conductivity,thk,density
PI-2611,Cu,8,62
PI-2611,Cu,6,48
```

- UTF-8 CSV 支援 BOM、CRLF/LF、引號內逗號/換行與 doubled quotes；完全空白列忽略。
- 表頭 trim 後大小寫精確匹配 child `id`，順序不限；重複/未知/空 key、missing required
  header、欄數不一致、malformed quoting、empty file 或 header-only file 必須拒絕。
- Number cell trim 後完整解析 decimal/scientific notation，不接受單位、partial number、
  hex、NaN 或 Infinity；integer 必須 integral。Boolean 只接受 `true` / `false`。
- String/materialRef 保留 cell 內容；required 空白值拒絕，optional missing/blank cell
  省略，不套用 default。套用 range（含 exclusive bounds）、length、full-match regex、
  typed enum 與 repeat min/max 規則。
- 整份通過才一次取代該群組；每列產生新唯一 `itemId`，`index` 從 `indexBase` 遞增，
  CSV 列序就是執行順序。匯入不觸發 Add 的 heading focus/scroll，其他參數不變。
- 失敗保留原值，錯誤顯示 physical line 與 key（cell/header error），透過 `role=alert`
  宣告並聚焦錯誤訊息；成功透過 `role=status` 宣告檔名、item count 與取代結果。
- Read 期間顯示 `Importing…` 並停用匯入；群組 value/definition 改變、disabled 或卸載
  使舊讀取失效。手動 edit 不會被舊讀取覆寫；file input 清空以允許重選同一檔案。
  取消選檔不改值，後續仍可手動編輯或重新匯入。

## Disabled 與 read-only

所有native controls disabled；repeater Add/Remove/CSV import disabled。Readonly placements顯示ordered summary
與polygon SVG preview，但不render mutating actions。Disabled不代表值被清除。

## Validation 呈現

Editor現況不在每個primitive旁render validation message；screen status與graph readiness顯示第一個
blocking reason。重建不得用HTML coercion把invalid user input靜默改成default。Enum外值、invalid
placements、repeat min/max、nested required等均使configuration incomplete/error。

## 鍵盤、focus 與 ARIA

- Dynamic control用definition name作`aria-label`。
- Required star是視覺提示；semantic required/`aria-required`是target gap，應補但不能改copy/layout。
- Checkbox label包住control；select/input依DOM definition order。
- Add/Remove在disabled時仍保留位置；不得造成layout jump。
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
| `UI-PARAM-004` | repeat at min/max | Remove/Add各自在boundary disabled。 |
| `UI-PARAM-005` | edit nested child | itemId/index穩定、sibling values不變。 |
| `UI-PARAM-006` | committed/disabled | 值可讀但所有mutation commands不可用。 |
| `UI-PARAM-007` | repeat有多個items或empty | Remove/Add位於最後item或`No items`下方，靠右排列。 |
| `UI-PARAM-008` | 在可捲動dialog以mouse或keyboard連續Add | 每次尾端新增後即時捲到新item heading並聚焦；Tab進入該item欄位，小視窗下heading與focus仍可見。 |
| `UI-PARAM-009` | nested repeat Add，或載入/edit/Remove | nested Add只定位該層新item；其餘操作不觸發自動捲動或focus，既有itemId/index與sibling values維持穩定。 |
| `UI-PARAM-010` | simple repeat / complex repeat / simple nested repeat | 僅符合 scalar schema 的 repeater 顯示 CSV；nested 獨立判斷。 |
| `UI-PARAM-011` | 匯入合法 RDL CSV | 一次取代清單，fresh identities、indexBase 與列序正確；可手動 edit，save/reload 後層序不變。 |
| `UI-PARAM-012` | CSV 格式/表頭/值/項目數錯誤 | 原值不變，顯示列號/key/原因；同檔可重選。 |
| `UI-PARAM-013` | cancel / disabled / read 期間 edit 或卸載 | cancel 不改值，disabled 不允許匯入，stale read 不覆寫最新值或更新卸載元件。 |
