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
last_verified: 2026-08-31
last_verified_commit: 283d28057aae3d2cde2a6383740f4c2551cb2a6a
source_of_truth:
  - docs/reference/hbm-generator.md
  - docs/ui/components/geometry-generator.md
  - apps/api/src/process_flow_api/geometry_generation/hbm.py
  - apps/viewer/components/geometry-generator/backend-geometry-generator-dialog.tsx
verified_against:
  - apps/viewer/app/page.tsx
  - apps/viewer/lib/process-flow-api.ts
---

# HBM Geometry Generator UI

HBM 是通用 [Geometry Generator Framework](./geometry-generator.md) 的 backend manifest，
不是獨立前端 generator。Home 使用 catalog mode；Flow Template Editor 使用 flow-input mode。
入口、dialog lifecycle、Save metadata 與 Define result 均由通用 component 負責。

## Manifest 與 parameters

Viewer 從 `GET /api/geometry-generators` 取得 `id="hbm"` 的 label、defaults、
`ParameterDefinition[]` 與 `hbm-package@1` adaptation contract。欄位順序、default、unit、range
與error以manifest/preview response為準；viewer不得保存另一份HBM constants或validation。

目前 manifest version 是 `2`。厚度輸入使用代表最終封裝厚度的 `hbmThickness`，以及只套用於最上層
core die 的 `topCoreDieThickness`；v1 的 `topMoldingThickness` 不再顯示或送出。Backend 從總厚度
扣除 base die、gaps 與所有 core dies 後衍生 top molding thickness。總厚度不足以容納 stack 時，
error 對應 `hbmThickness` 欄位，所有 materialize actions 維持 disabled。

目前backend parameters與domain規則見
[HBM Geometry Generator](../../reference/hbm-generator.md#參數)。Number/material controls依通用
parameter editor渲染，所有dimension使用`um`。

HBM manifest將parameter editor排成四個card，且card與欄位順序皆由`parameterGroups`決定：

1. `Package & core die size`：Package X、Package Y、Core die X、Core die Y。
2. `Core die count`：Core die count。
3. `Thickness & gap`：HBM thickness，接著依stack由下而上排列 Base die
   thickness、Core-base gap、Core die thickness、Core-core gap、Top core die thickness。
4. `Material`：Molding material、Die material。

Viewer不得依`generatorId`自行重排欄位；未來版面調整應修改backend manifest。

Name、Vendor、Type 1與Type 2不是engineering parameters，只在使用者按Save後的catalog
metadata dialog收集；optional空白欄位不寫入。Materialized GeometryEntity的`dim`由backend以
package X/Y與total thickness產生。

## Preview

參數修改後UI debounce呼叫HBM preview endpoint。Valid response顯示backend提供的Top與Cross
Section views；generic renderer只解讀rectangle/polygon/circle、dimension與semantic role，
不得自行推導package/core尺寸。Invalid response顯示field-level errors並disable
Download、Save與Define。

Preview是schematic；dimension labels與materialized geometry才是authoritative。Out-of-order HTTP
response不得取代較新的parameter state；dialog close時必須cancel pending request。

Cross Section預設會改善過扁封裝的可讀性：真實長寬比超過6:3時，只放大厚度方向至6:3；
Top View維持真實比例。使用者勾選「Show original aspect ratio」後，Cross Section也使用相同的水平與垂直
scale。這項切換只影響schematic renderer，不得改變dimension labels、preview token或
materialized geometry。

Top View必須同時顯示`Overall X/Y`與代表性stack body的`Core die X/Y`；Cross Section必須顯示
`Total thickness`與`Core die thickness`。這些值直接取自backend產生的core geometry bounds，
不得由viewer從input parameter重新計算。多層 HBM 的 `Core die thickness` 維持代表第一層的一般
core die 厚度；單層 HBM 則代表唯一一層的 top core die 厚度。Preview 不另加 top core thickness
dimension。DRAM generator沿用相同dimension labels。

## Actions

| Mode | Actions | Contract |
| --- | --- | --- |
| `catalog` | Download JSON、Save to DB | 先以最後有效`previewToken` materialize，再下載或建立immutable `GeometryEntity`。 |
| `flowInput` | Define | Materialize為帶`generation`與`adaptationContract`的`EmbeddedGeometry`，不直接寫DB。 |

若目前parameter state與preview token不一致，action MUST disabled。Token失效時顯示error並重新
preview，不可在browser fallback build HBM。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-HBM-001` | Bootstrap含HBM manifest，開啟generator | 顯示manifest fields並取得Top/Cross Section preview。 |
| `UI-HBM-002` | 修改core/package參數 | 只呼叫backend preview；stale response不覆蓋最新結果。 |
| `UI-HBM-003` | Backend回傳validation errors | 對應field顯示error，所有materialize actions disabled。 |
| `UI-HBM-004` | Valid preview後Download | 下載內容hash對應該preview response的geometry hash。 |
| `UI-HBM-005` | Flow-input mode Define | Result保存normalized generation parameters與`hbm-package@1`。 |
| `UI-HBM-006` | 新增另一個backend generator manifest | 不修改viewer registry即可出現在共用入口並渲染fields/preview。 |
| `UI-HBM-007` | HBM thickness小於base、gaps與core stack總厚度 | `hbmThickness`顯示field error，Download、Save與Define皆disabled。 |
| `UI-HBM-008` | Cross Section真實長寬比超過6:3 | 預設放大厚度至6:3；勾選「Show original aspect ratio」後恢復真實比例，Top View不變。 |
