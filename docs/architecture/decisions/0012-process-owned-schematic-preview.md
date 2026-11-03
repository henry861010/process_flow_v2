---
title: ADR-0012：Process-owned schematic preview
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - process-step 與 generator 開發者
  - API、viewer 與 QA 開發者
last_verified: 2026-11-03
last_verified_commit: 039906db
verified_against:
  - packages/schematic-py
  - packages/process-step-py/src/process_flow_steps/schematic_presenters.py
  - packages/geometry_generators/src/process_flow_geometry_generators/schematic_presenters.py
  - apps/api/src/process_flow_api/schematic_builder.py
  - apps/api/src/process_flow_api/schematic_planning.py
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

## Flow 共用水平版面與未完成的後段

有 flow context 的 preview 先規劃同一 assembly 的 `SchematicLayoutPlan`，固定代表 slots、carrier
顯示範圍及畫布寬度。API planner 讀完整 flow，沿 `main_geometry` 主線傳遞抽象 component hierarchy；
各製程在 companion `schematic_layout` module 明確宣告保留或放置 component 的效果。Source 進入
另一 assembly 的 auxiliary port 後使用新的 cohort namespace，不將兩個場景的版面混在一起。

Planner 只驗證連線、selected recipe、必要參數及可解析的 catalog／generator sources，不呼叫未來
step 的 `execute()`，也不逐站重新 compile。第一個缺 recipe、參數、geometry、template、必要連線
或排版描述的 step 截止該路徑；獨立路徑各自繼續。未接線節點不依 editor 位置猜測先後。
`placements: []` 不新增 slots。截止原因放入 document notes；當步合法 preview 不因後段不完整失敗。

Preview 的嚴格編譯範圍為 target 的 structural upstream 與相關 configuration，直接 flow-input
preview 只驗證該 input。Request 仍保留完整 flow 供預讀；save 與 full execution 維持全圖驗證。
此條款更新 ADR-0004 的 preview readiness 邊界，不放寬所選 target 依賴內的驗證。

每個 PnP step／來源 component class 各有一組固定代表；來源進入時凍結 equivalence class，
placement 數量、之後的 Z、厚度與 bump stage 不重建 cohort。跨步對照以來源 lineage、PnP step
與代表序號決定，PnP 重掛 subtree 的新 container IDs 透過 preview sidecar 對應，不寫回 geometry。
同 cohort 畫 tree/placement 順序第一個仍存在的實例，其他實例量測全部保留；異質結構在 notes 明示。

尚未出現或已移除的 slot 留白，不產生未來 shapes、components、labels 或 items。UF 必須按完整
slot 順序判斷相鄰關係，不跨越空白位置。Composer 只接收通用 plan 與 container bindings，不讀 flow。
沒有 flow context 的 standalone composition 保留原本的當步等價分組與自動置中。

Layout fingerprint 包含完整 flow 設定、相關資源與 presentation 版本，排除所選 target 與顯示標題；
plan cache 同時受 entry 與 byte bounds 限制，暫時的 abstract prototypes 不保存在 cache。
補齊後段後重建共用版面，不自動更新先前已存的圖片。共用水平位置與 carrier 寬度固定在
document 座標；各 snapshot 的垂直 Z 示意轉換繼續獨立計算。Viewer 依圖形區可用寬高
等比例 fit 全圖，`preserveAspectRatio="xMidYMid meet"` 保留圓形與符號比例，開啟即可見全貌。
圖形使用獨立 flex viewport，不提供圖面捲動；不同高度 target 可有不同的螢幕縮放比例。

## Document 與相容性

Snapshot 新增 nullable `schematic` 與 `schematicWarnings`。只有 `initialSnapshotId` 指定的
target 有 document；upstream snapshots 不重複組圖。Document 含 `schemaVersion`、`unit`、
`viewBox`、`shapes`、`items`、`components`、`totalThickness`、`notes` 與 `warnings`。
完整型別由 schematic package 定義，API 不引入另一套製程規則。

`SchematicItem` 可選 `densityValues`，JSON 型別為 `(number | null)[]`；bump、via、circuit
按唯一 `sourceId` 從實際來源聚合 density，去重後數值遞增、`null` 排最後。數值為原始百分比，
有效範圍 `0–100` 且必須有限；缺值保留 `null`，不補零。Body 不提供此欄位。
Python、API Pydantic 與 TypeScript 契約保持一致；舊 document 可省略此欄位，schema version
維持 1。新增資料時更新 presentation 版本，避免沿用不含 density 的快取。

Session/snapshot identity 包含 schematic 與 registry 版本；`geometryHash` 只表示原始結構。
Display-only 代表複製、XY 排列與薄層放大不得寫回 geometry、hash 或 export payload。
Unexpected composition failure 回傳可匯出的 snapshot、null document 與明確 warning，不觸發 GLB fallback。

## 呈現規則

`wafer-dmy` 每組兩顆置於左右；LSI 三顆；其他類型各一顆。Standalone composition 的相同 semantic
key、基礎材料、內部結構與實際 Z 區間可合併，忽略 placement 數量、XY 與 runtime material
`_dupN` 後綴；flow preview 使用上述固定 cohort 與代表規則。
RDL 使用固定少量短柱、landing 與水平線。Bump registry 僅依 stage 分派：`joined` 交給
`process_flow_steps/joint/schematic.py`，`reflowed` 交給 `process_flow_steps/pnp/schematic.py`；
`deposited` 隱藏。Bump formation 只產生單側資料，不負責雙側配對或 joined bump 的呈現。
Joined bump 使用等間距完整圓形；PnP presenter 逐層檢查 assembly 與直屬 child 底部 bump，
僅在雙側皆為 reflowed、density 大於零、XY 正面積重疊且 Z 接觸時畫一對半圓。
重疊與 Z 容差沿用 kernel；缺少唯一配對則不畫。上下半圓平面貼本體、弧面相對，
在 kernel Z 容差內的接觸邊界於顯示 bounds 對齊，原始測量維持精確值。
以配對上側 bump 的代表寬度為共同排列範圍，上下顆數與中心一致，下側不鋪滿整片 carrier。
兩側高度各依自身 Z 範圍縮放；正 density 大小不影響疏密，零 density 不畫。

Presenter 透過 `SchematicPart.source_id` 保留各側原始材料、Z、厚度、density 與來源 ID，
`display_bounds` 只控制顯示位置，`repeat_group` 讓同一 emitting node 的 circle／path 共用水平排列。
Composer 不辨識製程，僅展開通用 primitive；文件維持普通 circle／path 與 schema version 1。
等價分組納入 presenter 輸出，忽略來源 ID、絕對 XY 與 runtime material 後綴，避免混併不同配對狀態。
單側 reflowed 與 deposited 不畫符號或列入部件明細；原始 geometry、總厚度與匯出維持不變。

UF 必須已有實際 UF body，依其 Z 範圍畫在 scope 內有 bump 的代表 die 下方與相鄰合格 die 間；
不依 dummy key 排除、不穿越不合格 die、不自行新增 UF。RDL 與 UF producers 分別標記 `rdl`／`uf`
body key，舊資料不從材料名稱推測角色。

所有部件共用 Z 顯示轉換，保持實際同高度邊界對齊；薄層可以放大並明示「示意圖，不等比例」。
厚度數值取最終 snapshot；總厚度為最高與最低 Z 的差，不累加並排 die。本次不新增磨前比較或過磨判定。

## 工程 review 互動

未選取 feature 時剖面使用完整內容寬度，並依可用寬高顯示全貌；總厚度放在 `Cross section` 標題旁，
notes／warnings 放在圖下方的獨立捲動區，最多佔內容區高度 25%，不撐高圖面。
不顯示常駐全 feature 清單。點選 feature 開啟單張唯讀資訊卡，顯示所屬結構、feature 名稱、
`Material`、`THK`；bump、via、circuit 另顯示 `Density`。材料、實際厚度與 density 必須取自
同一實際來源；合併的不同 density 逐項顯示，不平均，缺值顯示 `Not specified`。
Density 的顯示不改變既有結構合併、代表數量或符號規則。

圖形可用滑鼠與 Enter／Space 選取，所有同 item shapes 同步反白。再次點同一 feature、空白、
Close 或第一次 Escape 關卡，Close／Escape 還原圖形焦點；卡已關閉時 Escape 才關 preview。
Export form 保持 topmost dialog 優先順序。資訊卡與圖形分別佔用版面，不覆蓋結構圖；
桌面 `lg` 以上卡片位於右側、寬 `288px`，窄螢幕位於圖下方，最多佔圖與卡片 review 區高度的
40%，可換行及卡內捲動。圖始終依剩餘可用寬高 fit 全貌，關卡後恢復全寬。
開關卡造成圖形區尺寸變化不會自行關卡；視窗或整體 review 區縮放、snapshot 改變時關卡，
圖形可視區收到捲動事件亦關卡。視窗 resize 自動重新 fit 全圖。
詳細互動與驗收案例以 [Geometry Preview](../../ui/components/geometry-preview.md) 為準。
