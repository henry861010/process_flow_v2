---
title: ADR-0012：Semantic scene 與共用 schematic kernel
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - process-step 與 generator 開發者
  - API、viewer 與 QA 開發者
last_verified: 2026-11-08
last_verified_commit: 5e46f755
verified_against:
  - packages/schematic-py
  - packages/process-step-py/src/process_flow_steps/schematic_presenters.py
  - packages/geometry_generators/src/process_flow_geometry_generators/schematic_presenters.py
  - apps/api/src/process_flow_api/schematic_builder.py
  - apps/api/src/process_flow_api/schematic_planning.py
  - apps/api/src/process_flow_api/preview_sessions.py
  - apps/viewer/components/geometry-preview/geometry-preview-panel.tsx
---

# ADR-0012：Semantic scene 與共用 schematic kernel

## 決策與範圍

Flow Editor 的 Geometry Preview 以 SVG 結構剖面取代互動 3D。目的為確認目前結構、實際剩餘厚度與
grinding 結果；PnP 的實際 XY、die 顆數與 feature density 不作為畫圖密度。保留 semantic preview
session、target snapshot、JSON／CDB 匯出與既有 standalone CAD viewer、generator engineering preview。

本決策取代 ADR-0004／0005 中要求 Geometry Preview 載入 GLB、操作 section／density 與使用 WebGL
的 UI 條款。既有 mesh／exact-section API、CAD 幾何精度與保留的 3D renderer 契約繼續有效。

## 責任與依賴

- Geometry kernel 計算實際 geometry、Z、thickness，並提供通用 execution provenance；execution 不載入 presenters。
- `process-flow-schematic` 擁有 Scene／Delta 契約、flow planner、來源 binding、registry、composer、基本圖形、共用佈局與 Z 顯示轉換；
  不依賴 API、step 或 generator 套件。
- 各製程的語意 descriptor、局部圖樣 presenter 與 operation 放在所屬 step 套件，generator presenter 放在 generator 套件；
  以獨立 companion modules 維護，不修改 `execute(context)` 介面。Step 不分配全域顯示座標或代表顆數。
- API composition root 負責資源解析、註冊 enabled descriptors／presenters 及呼叫共用 planner，僅對 target snapshot 呼叫 composer；viewer
  消費通用 document，不依 program、key 或製程名稱選擇畫法。

Presenter 使用 `present_schematic(context) -> list[SchematicPart]`，讀取唯讀最終 snapshot，回傳
局部圖形、來源關聯、實際 Z 區間與語意角色。Registry 依 container/body semantic role 與 feature kind
選擇 presenter；未登記的節點使用通用呈現，個別 presenter 失敗以通用圖形與 warning 代替。
不得保存 step 執行當下的第二套實體圖形狀態；grind、flip、saw、debond 的存活範圍與量測透過當步 geometry 反映。

## Scene 物件與 step 契約

`SchematicObject` 定義穩定 logical ID、parent、source reference、class／cohort、role、symbol／version、
色彩角色／覆寫、anchors 與 layout intent；不保存 physical placement 數、全域 X 座標或未來的精確 Z。
Layout intent 為 `group`、`member`、`span`、`distributed`、`boundary`。`LayoutRegion` 表示 assembly
的承載面／局部排版區域；同類 die 位於不同 region 時分別排列。`structural` composite 保持完整內部結構，
`arranged` composite 可以包含獨立排版的子 region。

`SceneRelation` 用具型別的 object／anchor／region 引用表達附著、連接、包含、避讓、填充、包圍與覆蓋。
`SceneState` 保存不可變物件圖、symbolic cursor region、orientation、assembly phase、lineage 與 notes。
Step companion 的 `describe_schematic(context) -> SchematicDelta` 宣告新增、更新、移除、重掛與关系改變；
`apply_delta` 原子套用並驗證引用與循環。描述流程只推導結構與版面需求，不重新執行幾何演算法。

Logical object、representative cohort 與 physical source 是不同 identity。同一類來源分兩次 PnP
仍形成兩個 cohort；一次 PnP 的多顆實際 placement 共享該 class 的代表。`SceneDerivation` 記錄來源與
目標 logical IDs 及 input port，支援 clone／transform／crop 與未來 split／merge 的來源表達。
`PhysicalSample`／`ResolvedPhysicalData` 另由所選 snapshot 綁定材料、Z、厚度與 density，不平均異質來源。

Geometry execution provenance 使用 source kind、owner ID、output/input port、physical node ID，
並記錄建立 operation 與 ordinal。Clone、material instance 改寫、PnP adaptation 和保留 identity 的
幾何轉換維持此 sidecar；binder 依它與 derivation 解析來源，不再以 appended child 順序猜測 PnP lineage。
Provenance 不寫入 geometry JSON、不改變 geometry hash 或 JSON/CDB 匯出格式。

## Flow 共用水平版面與未完成的後段

有 flow context 的 preview 先規劃同一 assembly 的 `SchematicLayoutPlan`，固定代表 slots、carrier
顯示範圍及畫布寬度。Schematic package planner 讀完整可解析 flow，沿 `main_geometry` 主線套用抽象 Scene／Delta；
各製程在 companion `schematic_layout` registry 明確宣告物件、region 與關係。Source 進入
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
同 region 的一般 member 由共用 kernel 等寬等間距安排，arranged composite 可依局部 region 需求擴寬；
不同 region 可共用水平位置。TIV 之類的
`distributed` feature 先扣除該 region 的所有已知 member reservations，再決定固定符號位置；
因此先看 TIV step 也會避開後續 LSI slot。Density envelope 與 die 的 bounding-box 重疊本身不代表實體碰撞。
區域兩側預留足夠空間容納共用符號策略；無法滿足的顯式排除限制會以 note 說明。

尚未出現或已移除的 slot 留白，不產生未來 shapes、components、labels 或 items。UF 必須按完整
slot 順序在各 mounting region 內判斷相鄰關係，不跨越同 region 的空白位置；其他 region 的元件
即使水平位置交錯也不阻擋連接。實際連接映射到非相鄰 slots 或同一代表時，保留 UF
量測與來源，並在 notes 註明參與元件。Composer 接收通用 plan 與來源 bindings，不讀 flow。
當步存在未能綁定的 component 時，該 assembly 改用可見的 local layout 並發出 warning，不靜默隱藏物件。
若某一 assembly phase 的 region constraints 無法排版，保存該 phase 的失敗原因與 local-layout note；
其他 phase 繼續使用各自的 plan，受影響的當步 geometry 仍可透過 local fallback 顯示。
沒有 flow context 的 standalone composition 保留原本的當步等價分組與自動置中。
Standalone 與 local fallback 的 flat API 亦轉接同一個 Scene layout solver，不維護第二套水平排版演算法。
舊有未指定 role 的 low-level `ComponentHint` 可保留明確代表數；內建與新 producer 以 role 使用共用策略。

Layout fingerprint 包含完整 flow 設定、相關資源與 IR／descriptor／symbol registry／layout policy 版本，排除所選 target 與顯示標題；
plan cache 同時受 entry 與 byte bounds 限制，保存語意圖與排版資料，不保存 fake geometry prototypes。
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

`SchematicItem` 與 `SchematicComponent` 可選 `diagramLabel`，由 producer 指定圖面預設顯示的
名稱；未提供時不顯示文字，仍保留 `label` 作為工程明細名稱。內建 producers 只標記
Carrier、LSI、SoC、HBM、DMY；viewer 只依顯示形狀排版，不以材料名稱推測角色。
舊 document 可省略此欄位，schema version 維持 1，presentation registry 版本更新以重建快取。

Session/snapshot identity 包含 schematic 與 registry 版本；`geometryHash` 只表示原始結構。
Display-only 代表複製、XY 排列與薄層放大不得寫回 geometry、hash 或 export payload。
Unexpected composition failure 回傳可匯出的 snapshot、null document 與明確 warning，不觸發 GLB fallback。

## 呈現規則

代表策略集中於 schematic kernel：`wafer-dmy` 每組兩顆置於左右；LSI 與其他類型各一顆。
Generator／step 只宣告角色，不自行選擇代表數。Standalone composition 的相同 semantic
key、基礎材料、內部結構與實際 Z 區間可合併，忽略 placement 數量、XY 與 runtime material
`_dupN` 後綴；flow preview 使用上述固定 cohort 與代表規則。
RDL 使用固定少量短柱、landing 與水平線。Bump registry 僅依 stage 分派：`joined` 交給
`process_flow_steps/joint/schematic.py`，`reflowed` 交給 `process_flow_steps/pnp/schematic.py`；
`deposited` 隱藏。Bump formation 只產生單側資料，不負責雙側配對或 joined bump 的呈現。
Joined bump 使用等間距的黃色上接點、灰色鼓形焊料、黃色下接點，顯示高度比例為 1:4:1。
PnP presenter 逐層檢查 assembly 與直屬 child 底部 bump，
僅在雙側皆為 reflowed、density 大於零、XY 正面積重疊且 Z 接觸時畫一對 bump。
各側由 1/3 高度的黃色接點與 2/3 高度的灰色圓底焊料組成。
重疊與 Z 容差沿用 kernel；缺少唯一配對則不畫。上下接點貼本體、圓底焊料相對，
在 kernel Z 容差內的接觸邊界於顯示 bounds 對齊，原始測量維持精確值。
以配對上側 bump 的代表寬度為共同排列範圍，上下顆數與中心一致，下側不鋪滿整片 carrier。
兩側高度各依自身 Z 範圍縮放；正 density 大小不影響疏密，零 density 不畫。

Presenter 透過 `SchematicPart.source_id` 保留各側原始材料、Z、厚度、density 與來源 ID，
`display_bounds` 只控制顯示位置，`repeat_group` 讓同一 emitting node 的 circle／path 共用水平排列。
Composer 不辨識製程，僅展開通用 primitive；文件維持普通 circle／path 與 schema version 1。
等價分組納入 presenter 輸出，忽略來源 ID、絕對 XY 與 runtime material 後綴，避免混併不同配對狀態。
單側 reflowed 與 deposited 不畫符號或列入部件明細；原始 geometry、總厚度與匯出維持不變。

UF 必須已有實際 `uf` body。元件內的 cavity UF 只畫 slab，不額外推導爬升，也不要求當步仍有 bump。
Gap UF 沿用 kernel 的獨立無 key helper scope（只有 `uf` PolygonGeometry bodies，無其他 features／children）；
producer 依保留 polygon 的連通區域、孔洞及同 assembly 元件的非 UF bounding box，判斷正面積重疊
或正長度邊接觸，單點相切不算，XY 精度與正 Z 重疊採 kernel 的 1e-5 容差。不同 die 種類及有無 bump
皆可參與；carrier／frame 等 support 不列為代表 die。每塊連通區域以 `SchematicPart.bridge_groups`
提供實體 container IDs，不將分離區域的參與者混合。
Composer 將所有實例 IDs 映射至 cohort（不限第一個代表），只有同一實際 UF 區域、且完整 slot
順序在同一 mounting region 內相鄰的不同 cohort 才畫 bridge，高度限於保留 UF 與兩側實體及代表元件的共同 Z 範圍。
非相鄰、合併成同一代表或不足兩個當步端點的連接保留 items、來源與 notes，不穿越其他元件或空白 slots，
不自行新增 UF。RDL 與 UF producers 分別標記 `rdl`／`uf` body key，舊資料不從材料名稱推測角色。

所有部件共用 Z 顯示轉換，保持實際同高度邊界對齊；薄層可以放大並明示「示意圖，不等比例」。
厚度數值取最終 snapshot；總厚度為最高與最低 Z 的差，不累加並排 die。本次不新增磨前比較或過磨判定。

## 未來 assembly 轉換的驗證範圍

CoW、ring、lid 與 split lineage 以 synthetic Scene fixtures 驗證通用契約：複合 assembly 可保有局部
region；ring 用 `boundary`／`surrounds` 產生左右兩段但共用同一物件 identity；lid 用 `span`／`covers`
覆蓋指定區域；fill 可以扣除占用物。Saw 現在於單一 geometry output 的 XY crop 完成後，
將 root 標記為 `cow`，其 descriptor 保留 identity／crop lineage 並進入 CoW 局部排列 phase。
CoW source presenter 以 arranged component hint 保留內部代表元件；TIM1／TIM2 descriptors
對應各個 `cow`／`lid` target，新增實體依 parent scope 與 creation provenance 綁定到正確 cohort。
本版仍不新增 ring／lid producer 或多輸出 saw；真正分割多個 assembly 時需 execution output contract 配合。
新的 assembly phase 可以重新安排局部版面，來源對應由 lineage 保留。

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
