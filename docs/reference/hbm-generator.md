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
  - apps/viewer/lib/hbm-generator.ts
  - apps/viewer/components/hbm-generator/hbm-generator-dialog.tsx
---

# HBM Geometry Generator

## 目的與範圍

HBM Geometry Generator 將一組 package、base die、core die stack 與 molding 參數轉為
`standard` GeometryStructure `1.0.0`。產物可以直接下載，或包裝成 immutable
`GeometryEntity` 寫入 geometry catalog。

本版只描述矩形 HBM package，且所有 core dies 使用相同尺寸、厚度、間距與材料。下列項目不在
本版範圍：

- 每層 core die 使用不同尺寸、厚度或材料；
- core die XY offset、rotation 或非置中排列；
- TSV、bump、circuit、underfill 與其他 density feature；
- bottom molding 或 base die 小於 package footprint；
- 從 Process Flow editor 直接建立或綁定 HBM geometry。

## 座標與結構契約

- `unitSystem` 必須是 `um`。
- Package 中心必須位於 XY 原點，底面必須位於 `Z = 0`。
- Root container key 必須是 `hbm-package`，且 direct body 是佔滿完整 package envelope 的
  molding body。
- Base die 與每一層 core die 必須各自是 root 的 direct child container。
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
| `topMoldingThickness` | finite number | `>= 0` | 最上層 core die 上表面至 package 上表面的 molding 厚度。 |
| `moldingMaterial` | string | trim 後非空 | Root molding body material。 |
| `baseDieThickness` | finite number | `> 0` | Base die 厚度。 |
| `coreDieX` | finite number | `> 0` 且 `<= packageX` | 每層 core die 的 X 尺寸。 |
| `coreDieY` | finite number | `> 0` 且 `<= packageY` | 每層 core die 的 Y 尺寸。 |
| `coreDieThickness` | finite number | `> 0` | 每層 core die 厚度。 |
| `coreDieCount` | integer | `1..64` | Core die 層數。 |
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
  + N * coreDieThickness
  + (N - 1) * coreCoreGap
  + topMoldingThickness

sideMoldingX = (packageX - coreDieX) / 2
sideMoldingY = (packageY - coreDieY) / 2

coreBottomZ(i) =
    baseDieThickness
  + coreBaseGap
  + i * (coreDieThickness + coreCoreGap)
```

各 BoxGeometry bounds 必須依下列規則建立：

| Body | `bottom_left` | `top_right` | `thk` |
| --- | --- | --- | --- |
| Molding | `[-packageX/2, -packageY/2, 0]` | `[packageX/2, packageY/2, 0]` | `totalThickness` |
| Base die | `[-packageX/2, -packageY/2, 0]` | `[packageX/2, packageY/2, 0]` | `baseDieThickness` |
| Core die `i` | `[-coreDieX/2, -coreDieY/2, coreBottomZ(i)]` | `[coreDieX/2, coreDieY/2, coreBottomZ(i)]` | `coreDieThickness` |

Root 的 molding 會自然保留在 core die 四周、core-base gap、core-core gaps 與 top molding
區域；producer 不得為這些區域另外建立互相重疊的 sibling molding bodies。

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
```

Core sequence 是從 `01` 開始的 zero-padded display sequence。這些 id 只需在單一 structure 內
unique，不是 catalog identity，也不得被 consumer 當成跨 revision durable reference。

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
| `version` | 使用者輸入，預設 `current`，trim 後非空。 |
| `owner` | 使用者輸入，trim 後非空。 |
| `description` | 選填；空字串轉為 `null`。 |
| `entityType` | `die` |
| `category` | `die.hbm` |
| `icon` | `die.stack` |
| `structureFormat` | `standard` |
| `structure` | Generator 產生的完整 GeometryStructure。 |

Catalog persistence 與 server-generated geometry id 的一般規則見
[Persistence](./persistence.md) 與 [Geometry structure](./geometry-structure.md#2-geometryentity-外層結構)。

## Error behavior

- 任一參數不合法時，generator 不得建立或下載 geometry，也不得開啟 Save dialog。
- `buildHbmGeometry` 收到不合法參數時必須 throw，不得輸出部分 structure。
- Save request 失敗時，Save dialog 必須保留使用者 metadata 與 geometry parameters，並顯示 API
  error；不得把失敗顯示成已儲存。
- Save 成功後必須顯示 server 回傳的 geometry name 與 id。

UI 版面、field placement、diagram 與 accessibility 規格見
[HBM Generator UI](../ui/components/hbm-generator.md)。

