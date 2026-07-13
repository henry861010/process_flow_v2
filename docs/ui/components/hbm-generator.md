---
title: HBM Geometry Generator UI
status: normative
owner: Process Flow UI
audience:
  - product
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-13
last_verified_commit: 7a94eded086c7a18bd082cf315e413cf97fc698c
source_of_truth:
  - docs/reference/hbm-generator.md
  - apps/viewer/components/hbm-generator/hbm-generator-dialog.tsx
  - apps/viewer/components/hbm-generator/hbm-engineering-drawings.tsx
  - apps/viewer/lib/hbm-generator.ts
verified_against:
  - apps/viewer/app/page.tsx
  - apps/viewer/lib/process-flow-api.ts
---

# HBM Geometry Generator UI

## 目的與入口

HBM Generator 是 Home route 上的 modal authoring tool。使用者不離開 `/` 即可調整 HBM
package、base die、core stack 與材料，下載 GeometryStructure，或把 geometry snapshot 存入
catalog。

本 component 不負責列出、更新或刪除既有 geometry，也不在本版直接建立 FlowInput binding。
Geometry 產生與座標契約由 [HBM Geometry Generator](../../reference/hbm-generator.md) 定義。

入口是 Home header nav 第一個 32px outline button：`Boxes + HBM Generator`。Click 後開啟
`HbmGeneratorDialog`；不 navigate、不修改 Home bootstrap data。

## Dialog 版面

Root overlay 使用 `z-index:80`、foreground 45% backdrop與1px blur。Dialog：

- width `min(1240px, viewport - 24px)`；`sm` 以下外距12px，`sm` 以上外距20px；
- max-height是viewport減24px，`sm`以上減40px；
- header與footer固定，中央內容是唯一 vertical scroll owner；
- background使用app token、8px radius、border與viewport shadow。

Header 左側顯示 `Boxes`、`HBM Geometry Generator` 與說明：

```text
Define a centered core-die stack inside a full molding package. All dimensions use micrometres.
```

右側是 accessible name `Close HBM generator` 的 ghost close button。

中央區域順序固定：

1. Top View 與 Cross Section drawing cards；`lg` 以上兩欄，以下單欄。
2. Package、Base Die、Core Stack parameter cards；`lg` 以上三欄，以下單欄。
3. Download 或 Save 成功 notice；沒有 action result 時不render。

不得在 parameter cards 與 footer 之間額外顯示 `Total package thickness`、`Side molding X` 或
`Side molding Y` summary cards；這些衍生值只由工程圖尺寸標註呈現。

Footer 左側顯示 root molding / child priority 說明或 invalid summary；右側依序是
`Download + Generate JSON` outline button與`Database + Save to DB` primary button。

## Engineering drawings

兩張圖都是responsive inline SVG，必須提供 `role="img"` 與包含目前數值的 accessible label。
圖面是 schematic；dimension text 才是authoritative。Cross Section 底部必須顯示：

```text
Schematic — dimensions are authoritative
```

### Top View

Top View 使用 molding teal、die amber與gray dashed centerlines，並標註：

- `Core die X <value> µm`
- `Package X <value> µm`
- `Package Y <value> µm`
- `Core die Y <value> µm`
- `Side molding X <value> µm / side`
- `Side molding Y <value> µm / side`
- `Base die footprint = package footprint`

Package 與 core die 必須共用中心線；core die X/Y ratio依參數獨立繪製。

### Cross Section

Cross Section 顯示一個完整 molding envelope、底部全寬 base die與置中的 core die stack。必須
標註 top molding、代表性的 core die thickness、core-core gap、core-base gap、base die
thickness、core count與derived total thickness。`coreDieCount = 1` 時不顯示 core-core gap
callout。

圖面使用目前參數的相對比例；非常薄的 body至少保留可見 stroke，但不得把顯示高度回寫成
geometry 數值。

## Parameter fields

所有 dimension inputs 是 native number input，右側固定顯示 `µm`；`Core die count` 不顯示 unit。
錯誤使用 destructive border、`aria-invalid=true` 與 field-level message。Material 使用text input。

| Card | Field | Default | Validation |
| --- | --- | --- | --- |
| Package | Package X | `12000` | finite，`> 0` |
| Package | Package Y | `8000` | finite，`> 0` |
| Package | Top molding | `100` | finite，`>= 0` |
| Package | Molding material | `EMC` | trim 後非空 |
| Base Die | Base die thickness | `100` | finite，`> 0` |
| Base Die | Die material | `Si-HBM` | trim 後非空；base/core共用 |
| Core Stack | Core die X | `8000` | finite，`> 0`，不得大於 Package X |
| Core Stack | Core die Y | `6000` | finite，`> 0`，不得大於 Package Y |
| Core Stack | Core die thickness | `50` | finite，`> 0` |
| Core Stack | Core die count | `4` | integer `1..64` |
| Core Stack | Core–base gap | `20` | finite，`>= 0` |
| Core Stack | Core–core gap | `20` | finite，`>= 0` |

這些值只是 authoring UI 初始值，不代表 HBM product standard或自動選型結果。

Base Die card底部顯示唯讀 `Inherited footprint` 與目前
`<packageX> × <packageY> µm`，不得再提供 editable base die X/Y。

## State matrix

| State | Diagrams | Generate JSON | Save to DB | Footer / feedback |
| --- | --- | --- | --- | --- |
| Initial valid | defaults 即時繪製 | enabled | enabled | child-priority說明 |
| Editing valid | 立即反映新值 | enabled | enabled | 清除上一個action notice |
| Editing invalid | 使用safe display fallback，不crash | disabled | disabled | invalid summary + field errors |
| Downloaded | 不變 | enabled | enabled | `Geometry JSON downloaded.` |
| Save dialog open | 下層保留 | 不可操作 | 不可操作 | metadata dialog置頂 |
| Saving | 下層保留 | 不可操作 | submitting disabled | spinner + controls disabled |
| Save failed | 下層保留 | 不可操作 | 可retry | destructive API message，metadata保留 |
| Save succeeded | 保留目前參數 | enabled | enabled | 顯示saved name與server id |

## Save dialog

`Save to DB` 開啟 `z-index:100` metadata dialog。Fields：

| Field | Default | Required |
| --- | --- | --- |
| Name | `Generated HBM` | yes |
| Version | `current` | yes |
| Owner | empty | yes |
| Description | empty | no |

Dialog 同時顯示read-only constants：`die`、`die.hbm`、`die.stack`。任一 required field trim後
為空時 submit disabled。Submit exact copy `Save to DB`；saving 時使用 spinning `Loader2`。

Save payload、download filename與structure mapping不得由UI spec重新解讀，必須遵循
[HBM Geometry Generator](../../reference/hbm-generator.md#輸出模式)。

## Keyboard、focus 與 ARIA

- Generator 與 Save form 都使用 `role="dialog"`、`aria-modal=true`、label與description ids。
- 開啟 Generator 時保存previous focus；unmount後restore。
- Generator 開啟期間鎖定document body scroll，關閉後恢復原值。
- Escape 在 Save dialog 未開啟時關閉 Generator；Save dialog 開啟時只關閉最上層 Save dialog。
- Saving期間 Escape、overlay click、Cancel與close都不得關閉 Save dialog。
- Save dialog open時focus先到Name；關閉後回到先前focus owner。
- DOM/tab順序必須和圖面、parameters、footer actions的視覺順序一致。

現行 dialog 尚未實作完整 focus trap；這是共用 `UI-GAP-A11Y-001`，不得因此移除既有
focus restore、Escape guard或ARIA attributes。

## Responsive behavior

- `1440×900`：兩張drawing cards同列、三張parameter cards同列；中央內容可捲動。
- `1024×768`：drawing cards可依`lg`邊界換列；footer可wrap但actions維持右對齊。
- `390×844`：所有cards單欄，dialog水平外距12px；只有中央內容vertical scroll，document不得
  horizontal overflow。
- Drawings以SVG viewBox縮放，不建立獨立horizontal scrollbar。

## Reference screenshots

| Viewport | Asset |
| --- | --- |
| `1440×900` | `../assets/reference/hbm-generator-1440x900.png`（pending） |
| `1024×768` | `../assets/reference/hbm-generator-1024x768.png`（pending） |
| `390×844` | `../assets/reference/hbm-generator-390x844.png`（pending） |

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-HBM-001` | Home ready，click `HBM Generator` | 不navigate並開啟帶兩張drawing的Generator dialog。 |
| `UI-HBM-002` | default state | 參數、工程圖與480 µm total thickness一致；不顯示derived summary cards。 |
| `UI-HBM-003` | 將Core die X/Y設為不同合法值 | Top View保持置中並獨立反映兩個ratio。 |
| `UI-HBM-004` | valid parameters，click Generate JSON | 下載合法純GeometryStructure，檔名為`hbm-geometry.json`。 |
| `UI-HBM-005` | core X大於package X或任一非法值 | 對應field顯示error，Generate與Save disabled。 |
| `UI-HBM-006` | click Save to DB | metadata dialog預填name/version，owner required，constants正確。 |
| `UI-HBM-007` | complete metadata，server save success | request建立`die.hbm` GeometryEntity，Generator顯示saved name與id。 |
| `UI-HBM-008` | Save dialog open，press Escape | 只關閉Save dialog，Generator保持開啟。 |
| `UI-HBM-009` | 390px viewport | cards單欄、中央可捲動、document無horizontal overflow。 |

