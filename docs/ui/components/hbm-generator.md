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

目前backend parameters與domain規則見
[HBM Geometry Generator](../../reference/hbm-generator.md#參數)。Number/material controls依通用
parameter editor渲染，所有dimension使用`um`。

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

Top View必須同時顯示`Overall X/Y`與代表性stack body的`Core die X/Y`；Cross Section必須顯示
`Total thickness`與`Core die thickness`。這些值直接取自backend產生的core geometry bounds，
不得由viewer從input parameter重新計算。DRAM generator沿用相同dimension labels。

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
