---
title: Process Step catalog
status: descriptive
owner: integration.platform
audience:
  - process developers
  - process-step authors
  - QA engineers
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - apps/api/src/process_flow_api/fixtures/process-step-templates.json
  - packages/process-step-py/src/process_flow_steps
---

# Process Step catalog

本 catalog 說明 repository 目前提供的 operation modules。下表的 parameter 欄只列 Python
program 實際讀取的 domain parameters，不等同現行 fixture 的完整 definition。Fixture 仍是
目前 ports/id 的實作輸入，而 Python module 是 behavior source of truth；fixtures 額外宣告的
legacy `workingTemp` 屬 [DM-006](../../conformance.md)，不得複製到新 template。新增或修改
step 必須同步 module、target contract、fixture 與 tests。

| Operation | Program | Geometry inputs | Program 實際讀取的 parameters | Effect |
| --- | --- | --- | --- | --- |
| molding | `layer/molding` | `main_geometry` | `material`, `thickness` | 依 current footprint deposit body 並前進 cursor |
| ECL | `layer/ecl` | `main_geometry` | `material`, `thk`, `koz` | 以 footprint inset deposit ECL body |
| RDL layer | `layer/rdl` | `main_geometry` | `layers` | 逐層建立 dielectric body；奇數層建立 via、偶數層建立 circuit |
| Grinding | `grinding/grinding` | `main_geometry` | `thk` | 以整體 geometry top 減去厚度計算 target Z 並 grind |
| saw | `saw/saw` | `main_geometry` | `bottomLeftX/Y`, `topRightX/Y` | XY clip 到指定 box |
| Carrier Bond | `carrier/bond` | `main_geometry`, `carrier_geometry` | — | 只複製 carrier root direct bodies 並疊到 main geometry top |
| Debond | `carrier/debond` | `main_geometry` | — | 移除所有 top-Z tie 的 direct root bodies |
| Flip | `flip/flip` | `main_geometry` | — | 以 XY plane flip、normalize Z min，反轉 via/bump direction |
| Under Fill | `uf/under_fill` | `main_geometry` | `material`, `thk`, `gap` | 填充 child bump cavities 與符合 gap 的 root regions |
| Micro Bump | `bump/uBump_formation` | `main_geometry` | `material`, `thk`, `density`, `koz` | 在 cursor 上方建立 `+z` bump feature |
| BGA Bump | `bump/bga_bump_formation` | `main_geometry` | `material`, `thk`, `density`, `koz` | 在 cursor 上方建立 `+z` bump feature |
| C4 Bump | `bump/c4_bump_formation` | `main_geometry` | `material`, `thk`, `density`, `koz` | 在 cursor 上方建立 `+z` bump feature |
| PnP | `pnp/pnp` | `main_geometry`, `die_geometry` | `coordinates` | 依 target rectangles clone、additive resize、place BoxGeometry-only die |

## 共同行為

每個 step template 都有 required primary `main_geometry` 與 output `result_geometry`。Auxiliary geometry 不是 parameter。Parameter validation 先由 compiler 執行，module 再 enforce operation-specific rules。

Material instance suffix 由 kernel 配置，module 不自行產生。所有 step output serialize 為 standard geometry structure。

### State transition matrix

| Operation | Cursor | Process footprint | Scope / geometry side effect |
| --- | --- | --- | --- |
| molding、ECL | 前進新增層厚度 | 不變 | 在 target scope 新增 body。 |
| RDL layer | 依 `items[]` order 前進各層 `thk` | 不變 | 新增 dielectric bodies 與交錯的 via/circuit features。 |
| Grinding | Clamp 到 grind target Z | 不變 | Grind target scope；可能移除或截短 primitives。 |
| saw | 不變 | 改成指定 box | 對 target scope subtree 做 XY clip。 |
| Carrier Bond | 設為 bonded direct bodies 的 top Z | 不變 | 只 copy source root direct bodies 到 main root；不複製 children/features。 |
| Debond | 有移除時設為剩餘 root direct-body top Z | 不變 | 一次移除所有最高 `zMax` tie bodies；沒有 body 時 no-op。 |
| Flip | 設為 normalized 後的 root direct-body top Z | 不變 | 以 Z plane flip 全 subtree，normalize min Z，反轉 via/bump direction。 |
| Under Fill | 不變 | 不變 | 新增 child cavity/root gap fill bodies。 |
| Micro/BGA/C4 Bump | 不變 | 不變 | 在 cursor 上方新增 bump envelope。 |
| PnP | 不變 | 不變 | 依 coordinates order resize 並 attach cloned child scopes。 |

## 重要 operation 說明

- `molding` 需要既有 process footprint 與正的 thickness。
- ECL `koz` 在此 operation 直接用作 body footprint inset；這與 feature payload 中保存、交由 consumer 解讀的 `koz` 不同。
- RDL `layers` 是 repeatable group；每 item 必須含 stable `itemId`，runtime normalized item 另含 `_itemId`/`_index`。
- Grinding 的 `thk` 是移除厚度，不是 absolute target Z。
- Saw 不接受 empty/inverted XY box。
- Saw 對 Box/Polygon 支援 partial clip；Cylinder/Cone 只有全包含或完全分離，partial XY
  intersection 會 reject。
- ECL 的 non-zero `koz` 會作為 XY inset；Polygon process footprint 目前不支援此 inset。
- Carrier Bond 要求 source 至少一個 root direct body；以 source direct-body minimum Z 對齊
  target overall geometry maximum Z。Carrier child containers、via/circuit/bump 都不複製。
- Debond 只看 direct root bodies，不依 material name 搜尋 carrier；最高 `zMax` 相同時全部
  移除，empty root 是 no-op。
- PnP coordinate item 是 `[[xMin,yMin],[xMax,yMax]]` target rectangle，必須 finite、
  positive-area，並以 `1e-6 um` tolerance unique。Source size 取完整 subtree aggregate bounds；
  每個 BoxGeometry 固定 lower-left、將 upper-right 加上 target/source size delta，再把 resized
  aggregate lower-left 對齊 target lower-left，bottom Z 對齊 current cursor。
- PnP resize 允許負 delta，但任何 BoxGeometry collapse 時整個 placement 失敗且不得 attach child。
  Source 中任何 PolygonGeometry、CylinderGeometry 或 ConeGeometry 都會明確 reject。
- Bump feature envelope 不會預先套用 `koz`；各 exporter 的 current behavior 見 [geometry-semantics.md](../../concepts/geometry-semantics.md)。

## 開發與驗證

新增 operation 前先讀 [Process Step Authoring Guide](../kernel/process-step-authoring.md)。最低驗收為 template graph validation、module resolution、valid execution、invalid input、serialization round trip，以及會受影響的 CAD/CDB consumer test。
