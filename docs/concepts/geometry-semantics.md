---
title: Geometry 解讀語意
status: descriptive
owner: integration.platform
audience:
  - process-step authors
  - CAD and mesher developers
  - viewer developers
last_verified: 2026-07-12
last_verified_commit: bdf2338e402dbd6e88a5dc494c874969d3be19b0
source_of_truth:
  - docs/architecture/decisions/0004-semantic-preview-sessions.md
  - docs/conformance.md
  - packages/kernel-py/src/process_flow_kernel/domain
  - packages/kernel-py/src/process_flow_kernel/serialization
  - packages/cad-py/src/process_flow_cad/exporter.py
  - packages/cad-py/src/process_flow_cad/section.py
  - packages/mesher-py/src/translater/translater_standard_v1.py
---

# Geometry 解讀語意

本頁描述目前程式實際採用的 geometry semantics。Geometry JSON schema 欄位定義見 [data-model.md](../data-model.md)；kernel callable API 見 [runtime-api.md](../reference/kernel/runtime-api.md)。

## Structure 與座標

Canonical structure 包含 `schemaVersion`、`unitSystem` 與 `root` container。目前 kernel geometry schema version 是 `1.0.0`，default unit 是 `um`。

所有 geometry primitive 都使用 global coordinates；container 不提供 local transform。Move、flip、placement 等 operation 會直接產生更新後的 global coordinates。Thickness 必須為正值，flip 不以負 thickness 表達。

Normalization 會補齊 container collections 與 deterministic ids。呼叫者提供的 id 會保留；缺少 id 時，id 由 item kind、tree path 與 canonical payload 產生。Array reorder 可能改變自動產生的 id，因此需要跨 reorder 穩定 identity 的 producer 應自行提供 id。

Semantic preview session的mesh reuse以完整normalized GeometryStructure `geometryHash`與cache version
為key，不使用GLB node order或body array index。Auto-generated id因reorder改變時會使geometryHash改變，
因此只降低cache hit，不會誤用舊mesh。Exact section region另保存resolved body/source/container/material
identity；producer若需要跨reorder追蹤單一body，仍必須提供explicit stable id。

## Container、Body 與 Feature

Container 是 hierarchy 與 scope，不是 material。Body 宣告 solid volume 與 material ownership。Via、circuit、bump 是 density-based feature，scope 由它們所在的 container collection 決定，不會因空間 overlap 自動傳播到 parent、child 或 sibling container。

Via 與 bump 必須有 global-Z `direction`（`+z` 或 `-z`）；circuit 沒有 direction。XY-plane flip 會反轉被 flip scope 內 via 與 bump 的 direction。

Feature `geometry` 是 envelope，`density` 是 0–100 percentage，`koz` 是保留給 consumer 的 non-negative distance。Kernel 保存 `koz`，不會在建立 feature 時預先 inset envelope。

## 空間優先順序

目前 materialized CAD path 採用 descendant-over-ancestor：child subtree solid 會從 ancestor direct bodies/features 中扣除。這避免 ancestor 與 descendant 在同一 volume 重複表達 material。

Exact section延續相同ownership語意。切面若恰好與child wall及ancestor cavity wall共平面，OpenCascade
可能同時回傳兩個有效boundary faces；section resolver會讓較深container先取得平面區域，再從ancestor
face精確扣除已取得面積。因此response中的material regions互斥，material顏色不依賴回傳順序、SVG
painter order或3D depth test。相同depth的退化共平面face以stable body identity決定固定優先序。

同一 container 內的 sibling bodies：

- 同 material 且有實體 overlap 時，CAD exporter 在 export time union，並保留 source ids。
- 不同 material 且有實體 overlap 時，CAD exporter 拒絕 export。

Geometry structure 本身不為不同 sibling branches 定義通用 ownership priority；producer 不應依賴這種 ambiguous overlap。

## Consumer 行為矩陣

| Consumer | Bodies | Density features | `direction` | `koz` | Primitive limits |
| --- | --- | --- | --- | --- | --- |
| Kernel serialization | 保存 | 保存 envelope、material、density | 保存；flip 反轉 | 保存 | Box、Polygon、Cylinder、Cone |
| Legacy GLB preview（current） | 輸出 materialized bodies | 不輸出 feature bodies；viewer 可由 JSON overlay | JSON overlay 可讀 | JSON overlay 可讀 | Box、Polygon、Cylinder、Cone |
| Session binary display mesh（current） | 以geometryHash/version cache的binary GLB顯示resolved bodies | 仍不輸出feature bodies；manifest/viewer只顯示estimated overlay | metadata可讀，不改變body mesh | metadata可讀，不預先inset | Box、Polygon、Cylinder、Cone |
| OCC exact body section（current） | 對resolved CadBody shape產生X/Y vertical body/material regions；viewer由contours產生caps | 排除density feature envelope，除非future ADR定義materialization | 不改變body section | 不對body section套feature KOZ | 跟隨CadBody resolver支援範圍 |
| STEP AP242 | 輸出 materialized bodies | 以完整 feature envelope 輸出獨立 solid，名稱包含 feature/material/density | 不改變 solid 形狀 | 目前未做 XY inset | Box、Polygon、Cylinder、Cone |
| Text CDB | 2.5D extrusion | 在 envelope 內以 deterministic density cell selection materialize | 目前忽略 | 目前忽略 | Cone 不支援；Cylinder 只支援單一 distinct circular base face |

因此「所有 downstream consumer 都已套用 `koz`」不是現況。若 workflow 依賴 `koz` 或 direction-aware mesh，必須先補 consumer implementation 與 tests，不能只更新此文件。

### Display mesh 與 exact section authority

Session GLB是display artifact，不是BRep或geometry semantics authority。工程截面由resolved
OpenCascade body shape產生；viewer shader clipping只作drag/debounce期間feedback。Section response的
CAD face area與region topology是exact authority；curved edge輸出的polyline依positive tolerance近似。

`Exact section`只表示materialized body的CAD section在documented tolerance內exact。Via、circuit、
bump的envelope、density hatch與glyph仍是estimated representation，不表示actual feature placement；
2D/3D viewer必須標示`Estimated density`。Exact body section不得把feature envelope填成實體材料。

## Material instance name

Kernel 在每個 step 執行前建立 runtime material instances。External primary geometry 的 terminal `_dup<number>` suffix 會先還原成 base material；同一步新引入且已存在的 base material會配置下一個 name，例如 `Cu_dup2`。Process-step module 不應自行添加 suffix。

Material instance name 是 runtime/mesh identity，不是 material database identity。

## 未決 future considerations（非 contract）

ADR-0004已接受semantic preview session、binary display mesh與exact body section，但明確保留density
features為estimated semantics。下列方向仍未有accepted ADR，不是current或target contract：

- CAD 與 CDB 對 `density`、`direction`、`koz` 採用完全一致的 materialization policy。
- Geometry schema 由 machine-readable schema 驗證所有 consumer，而不只由 kernel hydration/consumer validation 驗證。

採用前必須先建立 ADR、更新 conformance 與 contract tests。歷史討論見
[Geometry Kernel target API RFC 封存](../archive/rfcs/geometry-kernel-target-api.md)。
