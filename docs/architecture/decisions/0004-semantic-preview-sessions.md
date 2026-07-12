---
title: ADR-0004：Semantic preview session 與精確 body section
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - 架構與產品負責人
  - API、kernel、CAD 與 viewer 開發者
  - QA 與 coding agent
last_verified: 2026-07-12
last_verified_commit: bdf2338e402dbd6e88a5dc494c874969d3be19b0
verified_against:
  - apps/api/src/process_flow_api/preview_sessions.py
  - apps/api/src/process_flow_api/services.py
  - apps/viewer/components/geometry-preview/
  - apps/viewer/components/viewer/
  - packages/kernel-py/src/process_flow_kernel/application/geometry_kernel.py
  - packages/cad-py/src/process_flow_cad/exporter.py
  - packages/cad-py/src/process_flow_cad/section.py
---

# ADR-0004：Semantic preview session 與精確 body section

## 狀態

Accepted。這是 target contract；現行 implementation gap 集中記錄於
[conformance.md](../../conformance.md) 的 `PV-*` entries。

## 背景

現行 preview 以單一 target 為 request boundary：API compile/execute selected upstream closure，
同步產生一份 GLB，再將 `geometryEntityJson` 與 base64 GLB 放在同一 JSON response。Viewer 每次
切換 target 都重新載入完整 scene。

此方式有下列結構性問題：

- single GLB response不具session/upstream step identity，無法在一次execution內瀏覽process states；
- 完全相同的snapshot geometry跨request仍重複tessellate、傳輸、parse與配置GPU buffer；
- base64 增加傳輸與 browser copy/decode 成本；
- fragment clipping 只丟棄 clipping plane 一側，沒有 material-aware section cap；
- viewer 以透明 density envelope 表達 estimated feature，容易被誤認為 materialized geometry；
- continuous renderer、固定高 DPR、shadow 與單一 tessellation quality 無法在低規格裝置維持穩定操作。

Kernel execution result 已保存 execution plan 中每個已執行 step 的 output，因此 upstream snapshots
不需要改變 process-step module contract。CAD exporter 也已將 structure resolve 成 materialized
`CadBody` shapes，適合作為 exact body section 的 authority。

## 決策

### 1. Preview session 是新的 preview boundary

1. 新 preview path MUST 以 `POST /api/preview-sessions` 建立 semantic preview session。
2. Request 的 template selection、configuration 與 target rules MUST 與既有 preview readiness／
   compiler contract 一致。
3. `flowInput` target 的 session MUST 至少包含該 resolved input snapshot。
4. `stepOutput` target MUST compile/execute target upstream closure exactly once，並在同一 session manifest
   暴露每個已執行 upstream step（含 target）的 immutable output snapshot；MUST NOT 執行 downstream
   steps。
5. 每個 snapshot MUST 有 content-derived `snapshotId`、`geometryHash`、`stepRefId` 或 flow-input
   identity、order、label、normalized `geometryEntityJson`、`meshUrl` 與 `sectionUrl`。
6. 切換 session 內 snapshot MUST NOT 重新 compile 或 execute flow。
7. Session 是 bounded in-memory LRU中的ephemeral interaction resource，不是committed
   ProcessFlowInstance或durable export record。Eviction後asset URL回`404`；client以原request重新POST，
   MUST得到相同content-derived identities。

### 2. Body identity、diff 與 content-addressed binary mesh

1. Snapshot `geometryHash` MUST由normalized GeometryStructure content產生；snapshot/session identity另須
   包含contract/cache version與request identity，避免不同semantics誤用同一cache entry。
2. Mesh bytes MUST由`geometryHash + mesh cache version`定位；相同key MUST對應相同immutable bytes。
   Hash是opaque API value，caller不得自行重建或假設特定digest algorithm。
3. Mesh MUST由manifest提供的
   `GET /api/preview-sessions/{sessionId}/snapshots/{snapshotId}/mesh` 以`model/gltf-binary`傳輸；
   new session path MUST NOT把mesh base64 inline到JSON。
4. Mesh response MUST提供content-derived `ETag`與`private, max-age=31536000, immutable`；client MUST
   支援`If-None-Match`／`304`並以`geometryHash` reuse已decode的model/GPU resource。
5. Server session、mesh與section caches MUST同時有entry與byte bounds，並coalesce相同in-flight work。
   Resolved OCC prepared-model cache MUST至少有entry bound。Session、mesh、position section與prepared
   model的unique in-flight registries MUST各自有finite bound；capacity已滿時new unique work MUST回
   retryable `503`，相同key仍 MUST join既有work。
6. Native CAD work MAY移至thread，但caller cancellation不得被宣稱可硬中止已執行的native call；bounded
   registries與build concurrency是required overload protection。
7. Manifest MAY在future加入多個tessellation profiles／LODs或body-level diff，但在另行定義前不是
   本ADR的required contract；display mesh仍不是BRep authority。

### 3. Exact body section 由 CAD kernel 產生

1. `GET /api/preview-sessions/{sessionId}/snapshots/{snapshotId}/section` MUST接受vertical
   `axis=x|y`、canonical finite `position`（`um`），以及positive finite `tolerance`（default `0.1`）。
   `axis=x`回傳YZ coordinates；`axis=y`回傳XZ coordinates。Plane flip是viewer display state，不改變
   同一平面的section geometry。
2. Section MUST 對已 resolve 的 materialized CAD body shapes 執行 OpenCascade section／cut；GLB
   fragment clipping 或從 rendered pixels 推測輪廓不得作為 exact authority。
3. Response MUST按body/material identity提供closed 2D `outer`/`holes` contours與CAD face area。
   Outer loop MUST counter-clockwise、holes MUST clockwise，loop起點與region order MUST deterministic。
   CAD region/topology與area是exact authority；curved-edge polyline受request tolerance控制。
4. Section result MUST使用snapshot resolved bodies與unit；tangent、coplanar、empty cut MUST有
   deterministic response，不得顯示上一個stale section。Response中的material regions MUST在平面上
   互斥；當section恰好落在parent cavity wall與nested child body的共平面邊界時，較深container的body
   MUST先取得material ownership，ancestor／低優先face MUST以OpenCascade planar difference扣除已取得的
   面積。相同container depth的退化共平面face MUST以stable body identity決定固定優先序，不能交由SVG
   painter order或GPU depth test決定顏色。
5. 第一次對某`geometryHash`請求section時，server MUST可prepare/cache normalized、boolean-resolved OCC
   bodies；後續position MUST reuse prepared model，不得重做primitive conversion、overlap resolution或
   parent/child subtraction。同一prepared model的section algorithms MUST序列化；不同geometry model
   MAY在configured concurrency內平行執行。
6. Section strong ETag MUST涵蓋完整response identity（至少包含`snapshotId`與section cache key）；相同
   geometry但不同snapshot的response bytes不得共用同一strong validator。
7. Viewer MAY在slider drag/debounce期間先使用shader clipping；`Computing`狀態必須表示exact contours
   尚未ready。Settle後 MUST以response生成material-aware 3D cap與2D section，且stale request MUST cancel或忽略。
8. 2D orthographic section 與 3D cap MUST 使用相同 exact response，並保留 material legend/hatch mapping。

### 4. Three.js demand renderer 是 baseline backend

1. Accepted baseline 是 Three.js WebGL2；本 ADR 不核准全面改用 WebGPU、Babylon.js、vtk.js 或
   xeokit。
2. Renderer MUST 封裝在 semantic manifest adapter 後，使 future backend 可用同一 snapshot／section
   contract 評估替換。
3. React Three Fiber Canvas MUST 使用 demand rendering；idle scene 不得維持 continuous animation
   loop。Camera controls、asset ready、selection、section 與 resize 必須 explicit invalidate。
4. Default engineering view MUST 以 opaque body materials、depth-tested overlays、tight camera clipping
   range、bounded DPR 與無 realtime shadow 的低成本 profile 為基準。
5. Renderer MAY根據measured frame time／capability降低DPR、display LOD與互動更新率。無可用
   accelerated 3D context時 MUST提供可操作的exact 2D section path與明確fallback message，不得只有
   空白canvas。
6. Performance conformance MUST 以 representative fixtures 的 first-view latency、frame time、draw calls、
   triangles、bytes 與 idle renders 衡量，不得只以 library 名稱或 nominal GPU support 判定。

### 5. Density features 保持 estimated semantics

1. Via、circuit、bump 的 `geometry` 仍是 envelope，`density` 仍是 percentage；preview glyph／hatch 是
   deterministic estimate，不是 physical placement 或 exact materialization。
2. Body mesh asset 與 exact body section MUST NOT 暗示 density features 已 materialize。除非 future ADR
   定義 materialization policy，exact body section MUST 排除 density feature volume。
3. Viewer 顯示 density envelope、hatch 或 glyph 時 MUST 標示 `Estimated density`，並在 legend/details
   區分 `Materialized body` 與 `Estimated feature`。
4. `direction` 與 `koz` 可保存在 feature metadata；未實作 direction-aware placement／KOZ inset 時
   MUST NOT 以畫面暗示已套用。

## Target endpoint 摘要

| Endpoint | Target responsibility |
| --- | --- |
| `POST /api/preview-sessions` | Execute selected upstream closure once；建立 session 與 snapshot manifest。 |
| `GET /api/preview-sessions/{sessionId}/snapshots/{snapshotId}/mesh` | 以geometryHash/version cache傳回immutable binary display mesh。 |
| `GET /api/preview-sessions/{sessionId}/snapshots/{snapshotId}/section?axis=x\|y&position=...&tolerance=...` | 傳回OCC exact body regions/contours；viewer由此建立cap。 |

Legacy `POST /api/geometry-preview` 與其 base64 response MAY 在 migration window 保留，但新 UI 完成
session cutover 後 MUST 不再依賴。File export job endpoints 不因本 ADR 改成 session durability API；
export 仍需保存或提交明確 snapshot payload。

## 影響

Positive：

- Terminal target session 在 single-terminal flow 中可呈現完整 upstream process state。
- 完全相同的snapshot geometry mesh可跨step、session與browser cache reuse。
- Display mesh LOD 可降低而不犧牲由 BRep 產生的 exact section。
- Material-aware cap、2D section 與 step diff直接服務工程整合討論。
- Renderer library 不再控制 domain/API shape，未來可用同一 contract客觀比較替代 backend。

Trade-offs：

- 需要session lifecycle、content hash、asset cache與eviction policy。
- Prepared OCC model提高process memory residency，必須以entry bound、single-flight及per-model serialization
  控制；`to_thread` cancellation不會終止已開始的native call。
- OCC section 在 tangent/coplanar planes 需 tolerance contract與golden tests。
- Future body-level diff／LOD若採用，mesh batching必須同時保留picking/body identity。
- Exact body section與estimated density feature會同時存在，UI必須清楚標示不同 authority。

## 評估過的替代方案

### A. 只在目前 Three.js clipping 上補 stencil cap

Rejected as architecture。可作 interaction preview，但每個 object/material 增加 render passes，且 cap
來自 display mesh，不是 resolved CAD authority，也不解決 step reuse、Base64或identity。

### B. 立即全面替換 Three.js

Rejected。Babylon.js不會自動提供CAD-exact section；vtk.js client filter仍以triangle mesh為authority；
xeokit section cap需保留readable geometry且有額外license/memory評估。先修正domain與transport boundary，
再以同一fixtures benchmark backend，才能判斷library差異。

### C. Browser 直接以GeometryStructure重建所有CAD body

Rejected。Current descendant subtraction、same-material union與overlap validation由CadQuery/OpenCascade
執行；在browser重寫會產生第二套boolean semantics並增加CPU-only裝置負擔。

### D. 預先輸出每個slider position的section

Rejected。Position space無界且資產量過大。Target採drag approximate、settle exact與content cache。

## Migration

1. 先加入 contract tests、representative geometry fixtures與renderer telemetry。
2. 建立geometry content hash與binary mesh/section cache，不移除legacy endpoint。
3. 建立 preview session/upstream snapshots，讓新舊UI可並行比對。
4. 加入 OCC exact section endpoint、3D cap與2D section；drag path保留approximate clipping。
5. 將viewer切至demand renderer與binary asset reuse；session保留ordered snapshots能力，但preview UI只呈現
   `initialSnapshotId`指定的target stage，不提供timeline navigation。
6. 關閉 `PV-*` conformance gaps後，才移除legacy base64 preview path。

## 驗證

Contract／integration tests至少必須證明：

- step target只執行一次upstream closure，manifest含每個已執行step且不含downstream；
- snapshot切換不觸發第二次compile/execute；
- unchanged snapshot geometry跨session得到相同geometryHash且只build一次mesh，changed geometry得到不同hash；
- binary mesh response支援ETag/304，session response不含base64 mesh；
- exact section對multi-material、hole、empty、tangent與coplanar fixtures deterministic；
- 3D cap與2D contours引用相同body/material identities；
- density feature始終標示estimated且不出現在exact body section；
- idle viewer不連續render，interaction與exact section completion都正確invalidate；
- 無accelerated 3D context時仍可開啟exact 2D section。
