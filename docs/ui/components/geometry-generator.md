---
title: Geometry Generator Framework
status: normative
owner: Process Flow UI
last_verified: 2026-07-13
last_verified_commit: b838db68cf0ec0ed
audience:
  - frontend
  - API
  - QA
  - generator developers
source_of_truth:
  - apps/api/src/process_flow_api/geometry_generation
  - apps/viewer/components/geometry-generator/backend-geometry-generator-dialog.tsx
  - apps/viewer/components/geometry-generator/engineering-preview-renderer.tsx
---

# Geometry Generator Framework

所有geometry generators透過後端registry對Home與Flow Template Editor公開。Flow editor不得以
generator id寫HBM/DRAM條件分支；新增generator只需在後端註冊definition、validation、geometry
builder與preview evaluator。只要沿用通用contract，前端不需修改。

`GET /api/geometry-generators`提供id/version、label/icon、default parameters、通用
`ParameterDefinition[]`、optional ordered `parameterGroups`與adaptation contract。前端依definition
渲染parameter control及分組；沒有groups時維持單一flat parameter card。修改值後debounce呼叫
`POST /api/geometry-generators/{id}/preview`。

Preview response包含normalized/computed parameters、validation errors、geometry hash、opaque
`previewToken`、download JSON與versioned engineering preview document。前端只負責generic CAD
renderer，支援views、rectangle、polygon、circle、dimensions與semantic roles；shape與engineering
dimensions由後端決定。Save/Define使用`POST /api/geometry-materializations`加preview token，確保
materialized geometry就是使用者最後看見的版本。

HBM/DRAM目前在Top View提供overall與core die X/Y dimensions，Cross Section提供total與core die
thickness。Renderer依dimension axis各自配置callout offset，新增horizontal或vertical dimension
不得使另一axis的label產生不必要位移。

HBM與DRAM的version 2 generator都以最終package thickness反推top molding，並允許最上層core die
使用獨立厚度。DRAM的最終厚度包含既有SBT substrate；substrate layer結構與計算不因v2改變。

Generator parameter editor只放dimensions、materials與其他結構參數；geometry `dim`固定由
package X/Y與total thickness產生。Name、Vendor、Type 1與Type 2只在使用者按Save後的catalog
metadata dialog收集，optional欄位trim後為空時不寫入GeometryEntity。

共用層負責modal lifecycle、catalog metadata save UI、兩種action mode與Define result contract：

| Mode | Actions | Persistence |
| --- | --- | --- |
| `catalog` | Generate JSON、Save to DB | Save明確建立immutable GeometryEntity。 |
| `flowInput` | Define | 只回傳EmbeddedGeometry；呼叫端建立binding，不寫DB。 |

Define result必須包含suggested flow input name、完整EmbeddedGeometry與`generation` metadata。
重新編輯時呼叫端只在resolved geometry的generator id與選擇的definition一致時傳入saved
parameters；backend仍須validate輸入。Malformed value顯示field errors，不可由前端另算geometry。

Catalog geometry immutable。即使參數來自catalog record，Define也必須產生新的embedded draft，
不得更新原record。後續instance save由通用materialization transaction負責建立新catalog
snapshot。
