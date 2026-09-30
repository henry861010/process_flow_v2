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
  - packages/geometry_generators/src/process_flow_geometry_generators
  - apps/viewer/components/geometry-generator/backend-geometry-generator-dialog.tsx
  - apps/viewer/components/geometry-generator/engineering-preview-renderer.tsx
---

# Geometry Generator Framework

所有geometry generators由後端registry公開。Definition schema version 2的必填
`uiPlacements`指定建立入口，可選`home`、`management`、`templateGeometryLibrary`與
`flowInputPicker`；最後一項同時控制Flow Template Editor與Flow Instance Editor的geometry
input選擇器。Flow editor不得以generator id寫條件分支；新增generator只需在後端註冊
definition、validation、geometry builder與preview evaluator，並明確宣告入口。

HBM與DRAM只在Home提供catalog建立入口；flow input從Geometry DB選擇公版。SoC與VRM出現在
Template Geometry library及兩種flow input選擇器。LSI另在Management提供catalog建立入口。
Management和Home的catalog入口共用`/geometry-generator?generatorId=<id>`靜態頁。

SoC與VRM generator v1都只提供`thickness`及`material`兩個參數，使用8000 × 10000 um作為預覽基準
footprint，並以`box-rescale@1`在PnP時配合target region調整XY。兩者僅從flow editor的
generator selector使用；fixture catalog不提供SoC或VRM geometry。VRM生成的root container key為`vrm`。

LSI generator v1以`generation`參數選擇`gen1`或`gen2`，使用固定8000 × 10000 um
footprint。gen1要求一組material與正的thickness；gen2要求四組，依layer 1至4由下往上
相貼堆疊。四層提供可編輯的範例材料與厚度；預設為gen1並在開啟時顯示有效預覽，切換
gen2後也能立即預覽四層。LSI從flow editor的
generator selector及Management的共用catalog頁面使用，生成的geometry使用`box-rescale@1`；fixture catalog不提供LSI geometry。

`GET /api/geometry-generators`提供id/version、`uiPlacements`、label/icon、default parameters、通用
`ParameterDefinition[]`、optional ordered `parameterGroups`與adaptation contract。前端依definition
渲染parameter control及分組；沒有groups時維持單一flat parameter card。修改值後debounce呼叫
`POST /api/geometry-generators/{id}/preview`。編輯舊instance的配方時使用
`GET /api/geometry-generators/{id}/versions/{version}`取得指定版本definition。

Generator parameter definition可另外提供`visibleWhen: { parameterId, equals }`。此條件
以同一definition中top-level scalar select的目前值做嚴格相等比較；未提供條件的欄位永遠
顯示。條件由通用generator dialog評估，並將不可見欄位從preview request排除；編輯期間
保留不可見欄位的草稿值以便切回。後端仍依`generation`獨立驗證，正規化配方只包含當前
gen所需欄位，不能依賴前端隱藏來保證資料正確。沒有可見欄位的group不顯示。

Preview response包含normalized/computed parameters、validation errors、geometry hash、opaque
`previewToken`、download JSON與versioned engineering preview document。前端只負責generic CAD
renderer，支援views、rectangle、polygon、circle、dimensions與semantic roles；shape與engineering
dimensions由後端決定。Catalog Save使用`POST /api/geometry-materializations`加preview token；
flow-input Define直接保存最後有效preview回傳的normalized parameters作為generator binding。

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
| `flowInput` | Define | 回傳versioned generator binding及當次preview geometry；不寫DB。 |

Define result必須包含suggested flow input name、generator binding與當次preview geometry。
重新編輯時呼叫端只在resolved geometry的generator id與選擇的definition一致時傳入saved
parameters；backend仍須validate輸入。Malformed value顯示field errors，不可由前端另算geometry。

Catalog geometry immutable。Generator binding是獨立於catalog的配方；後續instance save
保存完整正規化參數，compile時產生structure，不建立新catalog snapshot。
