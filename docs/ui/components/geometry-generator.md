---
title: Geometry Generator Framework
status: normative
owner: Process Flow UI
last_verified: 2026-10-13
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

HBM與DRAM只在Home提供catalog建立入口；flow input從Geometry DB選擇公版。SoC、VRM與DMY die出現在
Template Geometry library及兩種flow input選擇器。LSI另在Management提供catalog建立入口。
Management和Home的catalog入口共用`/geometry-generator?generatorId=<id>`靜態頁。

SoC generator v1由下而上提供Pass2、usg、elk與si四層的厚度及材料參數；VRM generator v1
提供`thickness`及`material`兩個參數。兩者使用8000 × 10000 um作為預覽基準footprint，
並以`box-rescale@1`在PnP時配合target region調整XY。兩者僅從flow editor的generator selector
使用；fixture catalog不提供SoC或VRM geometry。VRM生成的root container key為`vrm`。

DMY die generator v1的id為`wafer-dmy`，category為`die.wafer-dmy`，只有一層Si。
`si`分組提供`siThickness`與`siMaterial`，預設200 um與`si`，皆可編輯；厚度須為有限且非負
數值，材料須為非空字串並trim。厚度0仍保留唯一body。預覽基準footprint為8000 × 10000 um，
XYZ置中，root container key為`wafer-dmy`，唯一body key為`wafer-dmy.si`。透過`box-rescale@1`
配合PnP的矩形或多邊形target調整XY，保留厚度與材料。它僅出現在Template Geometry library
及Flow Template／Instance的geometry input選擇器，Home與Management不提供入口，fixture catalog
不提供DMY die geometry。wafer邊緣的放置位置、數量與形狀由既有flow／PnP設定；generator
不自動排列die，也不計算warpage。

LSI generator v1以`generation`參數選擇`gen1`、`gen2`或`gen2-bs-first`
（選單顯示`gen2 (bs-first)`），使用固定8000 × 10000 um
footprint。gen1由下往上為`Si`、`USG`、`FsPm0`；gen2由下往上為`DAF`、`BsPm0`、`Si`、
`USG`、`PrePm0`、`FsPm0`、`Fow`、`Si carrier`。gen2 (bs-first)由下往上為
`Micro bump (reflowed)`、`Si`、`USG`、`PrePm0`、`FsPm0`、`Fow`、`Si carrier`，
不產生DAF、BsPm0與BsVia0。所有層使用完整footprint並相貼堆疊，
XYZ置中，root key為`lsi`。Si carrier使用body key=`carrier`，DAF使用`daf`；其他層不提供body key。

每層提供`<prefix>Material`與`<prefix>Thickness`，全部可編輯，預設如下：

| Layer | Prefix | Material | Thickness (um) |
| --- | --- | --- | --- |
| Si | `si` | `Si` | 200 |
| USG | `usg` | `usg` | 15.5 |
| FsPm0 | `fsPm0` | `lsi_top_molding` | 26 |
| DAF | `daf` | `DAF` | 10 |
| BsPm0 | `bsPm0` | `Mat_MCA7UUU0P1` | 15 |
| PrePm0 | `prePm0` | `Mat_PIBL301UUU0P1` | 15 |
| Fow | `fow` | `Fow` | 10 |
| Si carrier | `siCarrier` | `Si` | 200 |

DAF、Fow與Si carrier預設為暫定值。gen1總厚度預設241.5 um，gen2預設491.5 um；
gen2 (bs-first)預設494.5 um。`totalThickness`加總材料層厚及bs-first的bump高度，
不重複加入via高度。厚度0仍保留body，負值或非有限數值無效。

Micro bump位於`root.bumps`，使用完整footprint的Box density region，ID為
`bump:lsi-micro-bump`，上表面貼齊Si下表面，方向固定`-z`，`stage`固定`reflowed`。
其欄位只在gen2 (bs-first)顯示：`microBumpMaterial`預設`Cu/Ni/SnAg`、
`microBumpThickness`（Height）預設28 um、`microBumpDensity`預設42%、
`microBumpKoz`（KOZ）預設0 um。材料須非空並trim；高度與KOZ須有限且非負；
密度為inclusive 0–100%。高度0仍保留bump。

三種結構皆提供`fsVia0Material`、`fsVia0Thickness`、`fsVia0Density`；原gen2另提供`bsVia0*`。
Via使用完整footprint的Box density region，與bodies位於同一root scope，不建立個別via陣列。
Height單位um，正面三種結構共用預設26，背面預設15；材料皆預設`Cu`、密度皆預設50%。
所有值可獨立編輯，材料須非空並trim，密度為inclusive 0–100%，`koz`固定0。
FsVia0由USG上表面向`+z`延伸，gen1高度不得超過FsPm0厚度，兩種gen2不得超過PrePm0＋FsPm0。
BsVia0由Si下表面向`-z`延伸，高度不得超過BsPm0。高度須有限且非負，0仍保留via。
修改層厚後重新驗證，超出上限在對應Height欄位顯示錯誤，不自動截短。

專用欄位依`visibleWhen`隱藏；PrePm0、Fow與Si carrier在兩種gen2共用。
切換世代保留草稿，送出與正規化配方只保存當前世代參數。
LSI從flow editor的generator selector及Management的共用catalog頁面使用，生成geometry使用
`box-rescale@1`，可將所有body、via與bump共同調整為矩形或多邊形target footprint；fixture catalog
不提供LSI geometry。本次直接修改v1，舊`layer1*`至`layer4*`、`lsiTopMolding*`與`bsmc*`
參數不再接受，不提供遷移或相容處理。

`GET /api/geometry-generators`提供id/version、`uiPlacements`、label/icon、default parameters、通用
`ParameterDefinition[]`、optional ordered `parameterGroups`與adaptation contract。前端依definition
渲染parameter control及分組；沒有groups時維持單一flat parameter card。修改值後debounce呼叫
`POST /api/geometry-generators/{id}/preview`。編輯舊instance的配方時使用
`GET /api/geometry-generators/{id}/versions/{version}`取得指定版本definition。

Generator parameter definition可另外提供`visibleWhen: { parameterId, equals }`或
`visibleWhen: { parameterId, in: [...] }`，兩個operator互斥且必須擇一，`in`不得為空。
此條件以同一definition中top-level scalar select的目前值做嚴格相等或集合成員比較；未提供條件的欄位永遠
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

HBM與DRAM的version 2 generator都允許最上層core die使用獨立厚度。HBM總厚度由完整stack自動
衍生，molding與top core die頂面齊平；DRAM則以最終package thickness反推top molding，且其最終
厚度包含既有SBT substrate。DRAM substrate layer結構與計算不因v2改變。

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
