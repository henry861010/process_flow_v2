---
title: Parameter Editor
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
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

## Control 解析矩陣

判斷順序 MUST 與下表一致：

| Definition | Render | Serialization |
| --- | --- | --- |
| `coordinates` 或 `coordinateList` | [Coordinate List](coordinate-list.md) | `[[xMin,yMin],[xMax,yMax]][]` |
| disabled coordinates | muted monospace JSON/`Not set` | no change |
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

- header左為Parameter label，右依序 `Remove`、`Add`；
- Remove只移除最後一個item，items等於`minItems`時disabled；
- Add在`maxItems`時disabled；新index是空陣列用`indexBase`，否則current max + 1；
- 每個item是 muted/20 card、padding12、gap12，heading由`itemNameTemplate`格式化；
- child definitions在`md`兩欄；nested group跨兩欄並recursive render；
- empty顯示 `No items` dashed block。

Value shape：

```json
{
  "items": [
    { "itemId": "stable-id", "index": 1, "values": {} }
  ]
}
```

React key MUST 用`itemId`，不可用array index；edit child不得重建item identity。

## Disabled 與 read-only

所有 native controls disabled；repeater Add/Remove disabled。Readonly coordinates顯示compact JSON，
其餘primitive保留相同control layout。Disabled不代表值被清除。

## Validation 呈現

Editor現況不在每個primitive旁render validation message；screen status與graph readiness顯示第一個
blocking reason。重建不得用HTML coercion把invalid user input靜默改成default。Enum外值、duplicate
coordinates、repeat min/max、nested required等均使configuration incomplete/error。

## 鍵盤、focus 與 ARIA

- Dynamic control用definition name作`aria-label`。
- Required star是視覺提示；semantic required/`aria-required`是target gap，應補但不能改copy/layout。
- Checkbox label包住control；select/input依DOM definition order。
- Add/Remove在disabled時仍保留位置；不得造成layout jump。

## 測試 fixture

Component fixture至少包含：text、integer+unit、float range、boolean、single enum、multi enum、array、
coordinates、one-level repeat、nested repeat、disabled state。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-PARAM-001` | definitions empty | exact `No parameters` state。 |
| `UI-PARAM-002` | select enum | UI只能產生options內值，type coercion正確。 |
| `UI-PARAM-003` | comma array input | trim/remove empty並輸出typed array。 |
| `UI-PARAM-004` | repeat at min/max | Remove/Add各自在boundary disabled。 |
| `UI-PARAM-005` | edit nested child | itemId/index穩定、sibling values不變。 |
| `UI-PARAM-006` | committed/disabled | 值可讀但所有mutation commands不可用。 |
