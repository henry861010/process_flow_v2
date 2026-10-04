---
title: HBM Geometry Generator
status: normative
owner: integration.platform
audience:
  - geometry 開發者
  - frontend 開發者
  - process-flow 整合開發者
  - QA 與自動化 agent
last_verified: 2026-07-13
last_verified_commit: 7a94eded086c7a18bd082cf315e413cf97fc698c
source_of_truth:
  - docs/reference/geometry-structure.md
  - docs/concepts/geometry-semantics.md
verified_against:
  - packages/geometry_generators/src/process_flow_geometry_generators/hbm.py
  - packages/geometry_generators/src/process_flow_geometry_generators/engineering_preview.py
  - apps/viewer/components/geometry-generator/backend-geometry-generator-dialog.tsx
---

# HBM Geometry Generator

HBM generator implementation與validation位於backend registry；viewer使用
[`Geometry Generator Framework`](../ui/components/geometry-generator.md)的通用parameter與2D CAD
preview renderer，不保存另一份HBM計算邏輯。

## 目的與範圍

HBM Geometry Generator 將一組 package、base die、core die stack 與 molding 參數轉為
`standard` GeometryStructure `1.0.0`。產物可以直接下載，或包裝成 immutable
`GeometryEntity` 寫入 geometry catalog。

本版只描述矩形 HBM package。所有 core dies 使用相同尺寸、間距與材料；最上層使用獨立的
top core die 身分與厚度，其餘 core dies 共用一般 core die 厚度。Molding 頂面與 top core die
頂面齊平，不覆蓋 top core die 上表面。下列項目不在本版範圍：

- 每層 core die 使用不同尺寸、材料，或除最上層外再個別設定厚度；
- core die XY offset、rotation 或非置中排列；
- TSV、bump、circuit、underfill 與其他 density feature；
- bottom molding 或 base die 小於 package footprint；
- 從非generator legacy GeometryStructure反推 HBM authoring parameters。

## 座標與結構契約

- `unitSystem` 必須是 `um`。
- Package 中心必須位於 XY 原點，底面必須位於 `Z = 0`。
- Root container key 必須是 `hbm`，且 direct body 是佔滿完整 package footprint、厚度至 top core die
  頂面的 molding body；該 body key 必須是 `envelope`，供 package adapter 選取可變 footprint。
- Child containers 不提供 semantic key；base die body 必須使用 `hbm.base_die`，一般 core die
  bodies 必須依由下到上的 1-based、未補零編號使用 `hbm.core_die_1` 至
  `hbm.core_die_63`，top core die body 必須使用 `hbm.top_die`。
- Base die、每一層一般 core die 與 top core die 必須各自是 root 的 direct child container。
- Base die footprint 必須和 package footprint 完全相同。
- 所有 core dies 必須在 XY 原點置中；`coreDieX` 與 `coreDieY` 彼此獨立，不要求相等。
- Base die 與 core dies 必須使用同一個 `dieMaterial`；molding 使用獨立的
  `moldingMaterial`。
- Root molding 與 child die bodies 重疊時，必須依 GeometryStructure 的
  descendant-over-ancestor priority 解讀；die volume 不表示 double volume。
- Base die 與 core die siblings 不得有實體 volume overlap。Gap 可以是 `0`，此時相鄰 bodies
  只共用邊界。

Container 與 overlap 的一般規則由
[Geometry structure](./geometry-structure.md#9-scope-與-overlap-語意) 定義，本文件不另建第二套
ownership contract。

## 參數

| Parameter | Type | Rule | Meaning |
| --- | --- | --- | --- |
| `packageX` | finite number | `> 0` | Package 與 base die 的 X 尺寸。 |
| `packageY` | finite number | `> 0` | Package 與 base die 的 Y 尺寸。 |
| `moldingMaterial` | string | trim 後非空 | Root molding body material。 |
| `baseDieThickness` | finite number | `> 0` | Base die 厚度。 |
| `coreDieX` | finite number | `> 0` 且 `<= packageX` | 每層 core die 的 X 尺寸。 |
| `coreDieY` | finite number | `> 0` 且 `<= packageY` | 每層 core die 的 Y 尺寸。 |
| `coreDieThickness` | finite number | `> 0` | 除最上層外，各 core die 的共用厚度。 |
| `topCoreDieThickness` | finite number | `> 0` | 最上層 core die 的厚度。 |
| `coreDieCount` | integer | `1..64` | 包含最上層在內的 core die 總層數。 |
| `coreBaseGap` | finite number | `>= 0` | Base die 上表面至第一層 core die 下表面的距離。 |
| `coreCoreGap` | finite number | `>= 0` | 相鄰 core dies 之間的距離。 |
| `dieMaterial` | string | trim 後非空 | Base die 與所有 core dies 共用的 material。 |

所有 geometry 數值的單位都是 `um`；UI 不提供 unit selector。

## 衍生尺寸與座標

令 core die index `i` 從 `0` 開始，`N = coreDieCount`。

```text
totalThickness =
    baseDieThickness
  + coreBaseGap
  + (N - 1) * coreDieThickness
  + topCoreDieThickness
  + (N - 1) * coreCoreGap

sideMoldingX = (packageX - coreDieX) / 2
sideMoldingY = (packageY - coreDieY) / 2

coreBottomZ(i) =
    baseDieThickness
  + coreBaseGap
  + i * (coreDieThickness + coreCoreGap)

coreThickness(i) =
    topCoreDieThickness  if i = N - 1
    coreDieThickness     otherwise
```

`totalThickness` 永遠由實際堆疊衍生，molding envelope 的頂面等於 top core die 頂面，因此沒有
top molding。當 `N = 1` 時沒有一般 core die，唯一一層是專屬 top core die，並使用
`topCoreDieThickness`。

各 BoxGeometry bounds 必須依下列規則建立：

| Body | `bottom_left` | `top_right` | `thk` |
| --- | --- | --- | --- |
| Molding | `[-packageX/2, -packageY/2, 0]` | `[packageX/2, packageY/2, 0]` | `totalThickness` |
| Base die | `[-packageX/2, -packageY/2, 0]` | `[packageX/2, packageY/2, 0]` | `baseDieThickness` |
| 一般 core die `i` | `[-coreDieX/2, -coreDieY/2, coreBottomZ(i)]` | `[coreDieX/2, coreDieY/2, coreBottomZ(i)]` | `coreDieThickness` |
| Top core die | `[-coreDieX/2, -coreDieY/2, coreBottomZ(N-1)]` | `[coreDieX/2, coreDieY/2, coreBottomZ(N-1)]` | `topCoreDieThickness` |

Root 的 molding 會自然保留在 core die 四周、core-base gap 與 core-core gaps；producer 不得為
這些區域另外建立互相重疊的 sibling molding bodies，也不得讓 molding 高於 top core die。

Generator輸出的`adaptationContract`是`hbm-package@1`。Unified PnP只改變package/molding
footprint（以及generator定義的package-sized base die），所有core child bodies維持原XY尺寸；
target無法容納fixed core時必須失敗。

## Structure identity

Generator 必須輸出 normalized empty arrays與structure-local ids：

```text
container:hbm-root
body:hbm-molding
container:hbm-base-die
body:hbm-base-die
container:hbm-core-die-01
body:hbm-core-die-01
...
container:hbm-top-core-die
body:hbm-top-core-die
```

一般 core sequence 是從 `01` 開始的 zero-padded display sequence；最上層不占用 sequence，固定使用
top core die 專屬 id。這些 id 只需在單一 structure 內 unique，不是 catalog identity，也不得被
consumer 當成跨 revision durable reference。

Body semantic key 與 id 的顯示編號不同：一般 core body key 從 `hbm.core_die_1` 開始且不補零；
base 與 top core body key 分別固定為 `hbm.base_die` 與 `hbm.top_die`。當 `coreDieCount = 1` 時不會
出現任何 `hbm.core_die_{number}`，唯一的 core body 使用 `hbm.top_die`。

## 輸出模式

### Generate JSON

`Generate JSON` 必須下載純 GeometryStructure，不得包含 `GeometryEntity` metadata。檔名固定為
`hbm-geometry.json`，內容必須使用 two-space indentation 並以 newline 結尾。

### Save to DB

Save 必須用同一份 GeometryStructure 建立 `GeometryEntity`：

| Field | Value |
| --- | --- |
| `id` | `null`，由 server 產生。 |
| `name` | 使用者輸入，trim 後非空。 |
| `dim` | Backend依package X/Y與total thickness產生的`X x Y x Z um`。 |
| `vendor` | 使用者在Save dialog輸入；trim後非空才寫入。 |
| `type1` | 使用者在Save dialog輸入；optional。 |
| `type2` | 使用者在Save dialog輸入；optional。 |
| `owner` | 使用者輸入，trim 後非空。 |
| `description` | 選填；空字串轉為 `null`。 |
| `entityType` | `die` |
| `category` | `die.hbm` |
| `icon` | `die.stack` |
| `structureFormat` | `standard` |
| `structure` | Generator 產生的完整 GeometryStructure。 |
| `adaptationContract` | `hbm-package@1`，包含backend manifest提供的parameters。 |

Catalog record MUST 同時保存通用`generation` metadata：`generatorId = "hbm"`、parameter
schema version與建立structure所用的完整parameters。此metadata供authoring UI重新載入參數；
GeometryStructure仍是compiler與kernel使用的authoritative geometry。

目前 HBM generator parameter schema 是 version `2`。Version `1` 的
`topMoldingThickness` 與舊 v2 request 的 `hbmThickness` 都不再是 authoring parameters；backend
會忽略這些 legacy 欄位，normalized generation parameters 不保存它們。Backend 不提供 v1 preview
重算；既有已保存的 immutable geometry 與其 generation metadata 不遷移也不重建。

`name`、`vendor`、`type1`、`type2`、`owner`與`description`都是Save階段的catalog metadata，
不得出現在generator engineering parameter editor；該editor只描述dimensions、materials與結構。

### Flow Input

HBM的`uiPlacements`只有`home`。Flow Template Editor與Flow Instance Editor不提供HBM
generator新建或配方編輯入口；使用者從Geometry DB選擇已保存的公版。後端仍可依版本解析
既有generator binding，不會因UI入口設定而停用preview或compile。

Catalog persistence 與 server-generated geometry id 的一般規則見
[Persistence](./persistence.md) 與 [Geometry structure](./geometry-structure.md#2-geometryentity-外層結構)。

## Error behavior

- 任一參數不合法時，generator 不得建立或下載 geometry，也不得開啟 Save dialog。
- Backend HBM evaluator收到不合法參數時不得輸出部分structure或preview token。
- Save request 失敗時，Save dialog 必須保留使用者 metadata 與 geometry parameters，並顯示 API
  error；不得把失敗顯示成已儲存。
- Save 成功後必須顯示 server 回傳的 geometry name 與 id。

UI 版面、field placement、diagram 與 accessibility 規格見
[HBM Generator UI](../ui/components/hbm-generator.md)。
