---
title: ADR-0012：Process-owned schematic preview
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - process-step 與 generator 開發者
  - API、viewer 與 QA 開發者
last_verified: 2026-10-31
last_verified_commit: 039906db
verified_against:
  - packages/schematic-py
  - packages/process-step-py/src/process_flow_steps/schematic_presenters.py
  - packages/geometry_generators/src/process_flow_geometry_generators/schematic_presenters.py
  - apps/api/src/process_flow_api/schematic_builder.py
  - apps/api/src/process_flow_api/preview_sessions.py
  - apps/viewer/components/geometry-preview/geometry-preview-panel.tsx
---

# ADR-0012：Process-owned schematic preview

## 決策與範圍

Flow Editor 的 Geometry Preview 以 SVG 結構剖面取代互動 3D。目的為確認目前結構、實際剩餘厚度與
grinding 結果；PnP 的實際 XY、die 顆數與 feature density 不作為畫圖密度。保留 semantic preview
session、target snapshot、JSON／STEP／CDB 匯出與既有 standalone CAD viewer、generator engineering preview。

本決策取代 ADR-0004／0005 中要求 Geometry Preview 載入 GLB、操作 section／density 與使用 WebGL
的 UI 條款。既有 mesh／exact-section API、CAD 幾何精度與保留的 3D renderer 契約繼續有效。

## 責任與依賴

- Kernel 只計算與保存實際 geometry、Z、thickness 與 semantic key；execution 不載入 presenters。
- `process-flow-schematic` 擁有純資料契約、registry、composer、基本圖形、共用佈局與 Z 顯示轉換；
  不依賴 API、step 或 generator 套件。
- 各製程的 presenter 與 operation 放在所屬 step 套件，generator presenter 放在 generator 套件；
  以獨立 companion modules 維護，不修改 `execute(context)` 介面。
- API composition root 註冊 enabled presenters，僅對 target snapshot 呼叫 composer；viewer
  消費通用 document，不依 program、key 或製程名稱選擇畫法。

Presenter 使用 `present_schematic(context) -> list[SchematicPart]`，讀取唯讀最終 snapshot，回傳
圖形、來源關聯、實際 Z 區間與排列提示。Registry 依 container/body semantic role 與 feature kind
選擇 presenter；未登記的節點使用通用呈現，個別 presenter 失敗以通用圖形與 warning 代替。
不得保存 step 執行當下的第二套圖形狀態；grind、flip、saw、debond 透過最終 geometry 自然反映。

## Document 與相容性

Snapshot 新增 nullable `schematic` 與 `schematicWarnings`。只有 `initialSnapshotId` 指定的
target 有 document；upstream snapshots 不重複組圖。Document 含 `schemaVersion`、`unit`、
`viewBox`、`shapes`、`items`、`components`、`totalThickness`、`notes` 與 `warnings`。
完整型別由 schematic package 定義，API 不引入另一套製程規則。

Session/snapshot identity 包含 schematic 與 registry 版本；`geometryHash` 只表示原始結構。
Display-only 代表複製、XY 排列與薄層放大不得寫回 geometry、hash 或 export payload。
Unexpected composition failure 回傳可匯出的 snapshot、null document 與明確 warning，不觸發 GLB fallback。

## 呈現規則

`wafer-dmy` 每組兩顆置於左右；LSI 三顆；其他類型各一顆。相同 semantic key、基礎材料、內部結構
與實際 Z 區間可合併，忽略 placement 數量、XY 與 runtime material `_dupN` 後綴。
RDL 使用固定少量短柱、landing 與水平線。Bump registry 僅依 stage 分派：`joined` 交給
`process_flow_steps/joint/schematic.py`，`reflowed` 交給 `process_flow_steps/pnp/schematic.py`；
`deposited` 隱藏。Bump formation 只產生單側資料，不負責雙側配對或 joined bump 的呈現。
Joined bump 使用等間距完整圓形；PnP presenter 逐層檢查 assembly 與直屬 child 底部 bump，
僅在雙側皆為 reflowed、density 大於零、XY 正面積重疊且 Z 接觸時畫一對半圓。
重疊與 Z 容差沿用 kernel；缺少唯一配對則不畫。上下半圓平面貼本體、弧面相對，
在 kernel Z 容差內的接觸邊界於顯示 bounds 對齊，原始測量維持精確值。
以配對上側 bump 的代表寬度為共同排列範圍，上下顆數與中心一致，下側不鋪滿整片 carrier。
兩側高度各依自身 Z 範圍縮放；正 density 大小不影響疏密，零 density 不畫。

Presenter 透過 `SchematicPart.source_id` 保留各側原始材料、Z、厚度與來源 ID，
`display_bounds` 只控制顯示位置，`repeat_group` 讓同一 emitting node 的 circle／path 共用水平排列。
Composer 不辨識製程，僅展開通用 primitive；文件維持普通 circle／path 與 schema version 1。
等價分組納入 presenter 輸出，忽略來源 ID、絕對 XY 與 runtime material 後綴，避免混併不同配對狀態。
單側 reflowed 與 deposited 不畫符號或列入部件明細；原始 geometry、總厚度與匯出維持不變。

UF 必須已有實際 UF body，依其 Z 範圍畫在 scope 內有 bump 的代表 die 下方與相鄰合格 die 間；
不依 dummy key 排除、不穿越不合格 die、不自行新增 UF。RDL 與 UF producers 分別標記 `rdl`／`uf`
body key，舊資料不從材料名稱推測角色。

所有部件共用 Z 顯示轉換，保持實際同高度邊界對齊；薄層可以放大並明示「示意圖，不等比例」。
厚度數值取最終 snapshot；總厚度為最高與最低 Z 的差，不累加並排 die。本次不新增磨前比較或過磨判定。
