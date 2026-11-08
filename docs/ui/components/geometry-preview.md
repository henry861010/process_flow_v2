---
title: Geometry Preview
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-11-08
last_verified_commit: 5e46f755
source_of_truth:
  - docs/architecture/decisions/0012-process-owned-schematic-preview.md
  - docs/conformance.md
  - apps/viewer/components/geometry-preview/geometry-preview-panel.tsx
  - apps/viewer/components/geometry-preview/geometry-preview-client.ts
  - packages/schematic-py
  - apps/api/src/process_flow_api/schematic_builder.py
---

# Geometry Preview

Saw 的輸出以 CoW assembly 呈現，保留內部元件來源並允許進入新的局部排列 phase。
TIM1／TIM2 各自在所有 CoW／lid targets 上顯示材料 slab，範圍取目標完整 XY 外接矩形，
厚度取實際 snapshot；不得因上層 substrate 較大而將 TIM 延伸至整片 substrate。
兩個 process steps 使用既有 material／number 表單與通用 schematic primitives。

## 目的與 context

`GeometryPreviewPanel` 是 Flow Editor 的 full-page overlay；input 與 step output 都可使用。
以 SVG 剖面顯示 process flow 與採用 recipes 計算後的結構、剩餘層厚與總厚度，協助確認 grinding
是否改變預期堆疊。代表顆數與示意符號不表示實際 PnP placement、bump／via 數量或 density。

```ts
type GeometryPreviewContext = {
  previewId: string;
  sourceLabel: string;
  slotLabel: string;
  sourceKind: "flowInput" | "stepOutput";
  request: GeometryPreviewRequest;
};
```

Draft request 帶 inline `flow: {definition, configuration}`；saved request 帶 `flowId`。
UI 依 target 有效 upstream closure 檢查 readiness；採用 recipe 為零 placement 的 `pnp/pnp`
不追蹤 die input，主流程 input 仍必要。Disabled control 顯示第一個 blocking reason。
下游或無關路徑尚缺 recipe、參數、geometry 或 wiring 不阻擋前面已完整 step 的預覽；
整條 flow 的 readiness 與儲存驗證仍維持嚴格檢查。Request 保留完整 definition 與 configuration，
供後端規劃共用水平版面，不以 target upstream closure 截短送出的 flow。

## Session 與資料 authority

依 [ADR-0012](../../architecture/decisions/0012-process-owned-schematic-preview.md)，以
`POST /api/preview-sessions` 建立 session。Step target 只執行 upstream closure 一次；manifest
保留所有 upstream snapshots，但 panel 只使用 `initialSnapshotId` 指定的 target。
Target 的 `schematic` 由 step／generator presenters 與共用 composer 產生；viewer 只畫通用圖形，
不依製程名稱或 semantic key 寫專屬分支。

水平版面會考慮同一依賴路徑後續可解析的 steps，提前保留 die 位置並固定 carrier 顯示寬度。
遇到第一個資料不足的 step 就停止該路徑的 lookahead，不跳過後繼續猜測；無關路徑不造成阻擋。
Lookahead 可解析 catalog／generator inputs，但不執行後續製程。每張圖仍只呈現 target snapshot
當下實際存在的結構；未來位置保持留白，不新增標籤、厚度明細或可選取的部件。

Preview 不建立 WebGL scene、不載入 GLB、不呼叫 exact section。沒有 process timeline、snapshot
切換、旋轉、切面或 density 控制。既有 mesh／section routes、standalone CAD viewer 與 generator
engineering preview 保留；legacy `POST /api/geometry-preview` 不供此 UI 使用。

Document 與 session 僅留在 interaction memory。JSON／CDB 匯出必須使用同一 target 的原始
`geometryEntityJson`／`structure`，不得使用代表 die 複製、顯示位置、符號或放大厚度。Schematic
失敗仍保留 snapshot 與匯出；`schematicWarnings`／document warnings 顯示為可讀提示。

`executionWarnings` 是獨立的製程執行結果，預設為空；舊回應缺少此欄位時視為沒有警告。
有警告時，在剖面圖上方顯示琥珀色 `Process warnings` 區塊，標示來源 step label 與說明，
最多佔內容區高度 30%，可獨立捲動，剖面圖依剩餘空間 fit。即使 schematic 缺少或不支援，
仍顯示製程警告，JSON／CDB 匯出維持可用。Joint 的高度保留警告必須說明設定與實際 SOH
及既有填充／支撐材料的原因，後續 snapshot 顯示原始 joint 的來源 label。

## Overlay shell

Outer fixed inset、z `50`、padding base `12px`／`sm` `24px`，backdrop `foreground/45`。
Panel fill remaining width/height、radius6、border、viewport shadow、column flex。
Header white、padding x16/md20 y12、bottom border；body flex fill、`min-height:0`；footer white、
padding x16 y12、top border、right aligned、wrap。

Step output 主標題為 `<sourceLabel>`（flow-local step label；未設定沿用 template 名稱），字級
`1.6875rem`、行高 `2.25rem`；次行 `<slotLabel>`（`Result`）。Geometry input 主標題維持
`Geometry Preview`，次行 `<sourceLabel> -> <slotLabel>`。保留 request badge `Loading/Ready/Error`、
source badge 與右側 Close；長標題可換行，Close 不縮小。

Footer actions 順序為 `Export JSON`、`Export CDB`。Snapshot ready 後可用，
不依 schematic 是否成功。Backdrop、Close、Escape 關閉；unmount abort session request，
不修改 editor draft、不取消已建立的 export jobs。

### CDB mesh settings 草稿

Export CDB 會在同一網站來源／瀏覽器的 `localStorage` 自動保存最後編輯的 mesh settings，
以 API 提供的完整 `geometryHash` 對應。關閉匯出表單、Cancel、關閉 preview、重新整理或重開
瀏覽器後，相同 hash 恢復原草稿；不同 hash 使用各自紀錄。不同 flow、step
若得到相同 hash，也共用該草稿。最多保留最近使用的 20 個 geometry，超出時移除最久未使用者。

保存內容包含 global element size 原始字串、symmetry、完整 local controls（含 reference、
box／polygon、inactive coordinates）及已套用 set 的原始來源／版本、rule details、customized
狀態。未填完或尚未通過驗證的內容也保存；只有匯出時才執行既有驗證。輸出路徑、展開狀態、
錯誤與進行中的請求不保存。沒有紀錄時維持 `500 / full / 空 controls`。

還原不重新呼叫 apply-set API，set 清單載入或更新也不得覆蓋草稿；已移除或更新的 set 仍顯示
保存的來源與版本。只有使用者主動選擇 set 才重新套用。JSON 匯出不讀寫 mesh settings 草稿。
儲存版本不支援或資料損壞時忽略該紀錄；瀏覽器儲存不可用／容量不足時顯示非阻擋提示，
仍可編輯與匯出。多分頁以最後寫入為準，不做即時同步；不跨裝置同步或跨 geometry 對應 references。

### Overlay review contract

Geometry Preview 可以承載 Export form。當 Export form 開啟時，Preview 必須保持 mounted，且
最上層 form 的 `Close`、`Cancel`、idle `Escape` 與 backdrop 只關閉 form；submitting 時不可關閉。
這是 target behavior，與 [Interaction Patterns](../interaction-patterns.md) 的 modal stack contract
一致。Preview、Export 與 Flow Node Editor 共用 topmost dialog stack，實測見
[Unified editor evidence](../evidence/unified-flow-editor/README.md)。

## 狀態與版面

```text
open/context change -> session loading -> target snapshot ready
                          \------------> error
close/context change -> abort session request
```

| State | Body | Header | Export |
| --- | --- | --- | --- |
| Loading | spinner 與生成提示 | Loading | disabled |
| Request error | API error 與 retry 提示 | Error | disabled |
| Snapshot ready | SVG 剖面；選取 feature 時顯示工程參數卡 | Ready | enabled |
| Snapshot ready、schematic unavailable | 明確提示與可用的 snapshot 匯出 | Ready | enabled |

未選取 feature 時，剖面使用完整內容寬度；不顯示所有 feature 的常駐明細清單。
總厚度放在 `Cross section` 標題旁。
圖形佔用獨立的 flex viewport，不提供圖面捲動。SVG 同時依可用寬度與高度等比例縮放，以
`preserveAspectRatio="xMidYMid meet"` 完整置中顯示目前 `viewBox`；開啟即能看到結構全貌，
不裁切、不將圓形拉成橢圓。視窗尺寸改變時自動重新 fit，保留 die 與符號比例。
Notes 預設隱藏，使用者點選 `Cross section` header 右上角的 Lucide `AlertCircle` 驚嘆號
按鈕（accessible name 與 title 為 `Reading this schematic`）才開啟右上方浮動說明卡。
按鈕提供 `aria-expanded` 與開啟時的 `aria-controls`；再次點擊、點卡片外、選取 feature、
Close 或 Escape 可關閉，Close／Escape 將焦點還給按鈕。第一次 Escape 只關說明卡，
下一次才關 preview；上層 Export form 保留自己的 Escape 優先權。Snapshot 改變時收合。
說明卡寬 `384px`，限制於圖面可用寬高，長內容在卡內捲動；開關不改變圖面尺寸。
Warnings 仍放在圖下方的獨立捲動區，最多佔內容區高度的 25%。圖面外距 base `8px`／
`md` `12px`、白色畫板內距 base `4px`／`md` `8px`，以增加全圖可用空間；
header 與 footer 保持可達。

共用 layout 仍固定後端 document 中的 die 水平位置與 carrier 寬度；Z 顯示轉換依各 target
的實際結構計算。預設最外側 die 距 carrier／support 邊緣至少保留 144 個顯示單位，
相鄰 die 間隔為 36 個顯示單位。共用與獨立預覽使用相同內距與間隔；
圖面寬度同步保留此空間，不壓縮 die 間隔。
Viewer 為顯示整張圖，可因 target 高度或 viewport 改變整體縮放比例，
不要求不同高度 target 在螢幕上維持相同水平顯示比例。

### Feature 工程參數卡

點選 feature，在圖形旁開啟一張唯讀資訊卡，顯示所屬結構、完整 feature 名稱、`Material` 與
`THK`；bump、via、circuit 另顯示 `Density`。THK 使用目前 snapshot 的實際厚度及單位，包含
grinding 後剩餘值。Material、THK 與 density 讀取同一實際來源，PnP 配對 bump 各自遵循
presenter 的 `source_id`。所有對應同一 item 的 shapes 同步以 `--schematic-selection` 紅框標示，
線寬為原始線寬加 `2px`、至少 `4px`，並加 `2px`、30% 不透明度的同色淡外暈；保留材料填色。
外框使用 `non-scaling-stroke`，fit 縮放後仍維持螢幕線寬。未選取圖形的鍵盤 focus 使用同色
`4px` 外框；已選取時保留選取線寬，不被 focus 樣式覆蓋。

Density 使用 `SchematicItem.densityValues` 的實際百分比，不平均、不按代表符號數量推算。
合併來源先按唯一 `sourceId` 聚合、去重，數值遞增且缺值排最後；例如顯示 `30%, 50%`，
缺值顯示 `Not specified`。`0%` 與 `100%` 都是有效值，缺值不補成 `0%`；body 不顯示 density。

同時只開一張卡；點其他 feature 更新內容，再點同一 feature、圖面空白或卡片 Close 可關閉。
Enter／Space 亦可開啟或切換卡片。第一次 Escape 關卡，下一次才關 preview；卡片 Close 與
Escape 關卡後將焦點還給原圖形。若 Export form 開啟，其 Escape／backdrop 仍由最上層 form
優先處理，不影響卡片或 preview。

資訊卡與圖形分別佔用版面，不覆蓋結構圖。桌面 `lg` 以上將卡片放在圖右側，寬度為 `288px`；
窄螢幕改放圖下方，最多佔圖與卡片 review 區高度的 40%，長內容可在卡片內捲動及換行。
圖形始終依剩餘可用寬高 fit 全貌；關卡後恢復完整寬度。開關卡造成的圖形區尺寸變化不會
自行關卡；視窗或整體 review 區縮放、snapshot 改變時關卡，圖形可視區收到捲動事件亦關卡。
圖面提示引導使用者點選 feature review 工程參數。

### 剖面視覺樣式

圖面使用白色、圓角、有細邊框的畫板，背景為淡灰；層與部件使用平面實體色塊，
一般外框為 `0.6px`，細導體不加外框。材料色由後端共用 palette 與各 presenter 提供：

| 材料角色 | 色彩 |
| --- | --- |
| Silicon | `#bcbcbc` |
| SoC／HBM 的 Pass2、USG、ELK，HBM 內部 molding，LSI 的 USG 與 PM 層 | `#808182` |
| RDL 的 PM／dielectric | `#e5e7eb`（淺灰） |
| Molding／其他 dielectric | `#424547` |
| DAF／FOW（含 flow 材料別名） | `#a8d8f0`（淺藍） |
| Underfill | `#1e40af`（深藍） |
| Conductor／bump 接點 | `#ffcf00`（黃色） |
| Bump 焊料 | `#a3a6aa`（灰色） |
| Carrier（含 LSI Si carrier） | `#ddd6fe`（淺紫） |
| Substrate／support | `#006b57` |
| 未分類材料 | `#a3a6aa` |

Schematic 圖預設顯示 Carrier、LSI、SoC、HBM、DMY 的文字 label；其餘 component 與
layer 名稱維持隱藏，名稱資料、工程參數卡、hover title 與鍵盤操作的 accessible name 仍保留。
Producer 以可選 `diagramLabel` 指定圖面名稱，viewer 不從材料名稱推測元件種類。
共用預覽與繪圖元件的 `showLabels` 預設為 `"primary"`，只顯示 producer 指定的名稱；
`true` 顯示所有既有名稱，`false` 隱藏全部 label，目前 UI 不提供開關。
Component 名稱以粗體優先放在其最大可見矩形區域；不足以容納時放在部件上方。
同一部件不重複標示內層名稱，carrier 在最大的可見區域標示一次。文字必須避開
裁切孔洞、被覆蓋的實體與線路，並依背景亮度採黑／白文字。長名稱可以縮寫，完整名稱
保留在工程參數卡。圖內不重複放厚度數字；實際厚度與材料在選取後的卡片呈現。
配色與文字佈局不得改變原始幾何、厚度、代表顆數或匯出資料。

## Schematic 行為

- 共用 schematic kernel 決定代表策略：每組 `wafer-dmy` 兩顆置於最左與最右；LSI、DRAM、SoC、SoIC 與其他類型各一顆。
  Flow preview 每個 PnP step／來源 class 保留獨立 cohort；相同來源分兩次 PnP 不合併，實際 placement 數不影響代表數。
  Standalone preview 仍依當步相同結構分組；子層不當成額外 die，flow cohort 不因後續厚度或 bump stage 改變而重建。
  一般 die 示意寬度為 320、左右 dummy 為 224，水平間距為 36（SVG 顯示單位）；
  畫布依代表顆數展開，呈現寬扁外觀，實際厚度與共用 Z 顯示轉換不受影響。
- RDL via 使用較細的梯形：`-z` 為上寬下窄，`+z` 為上窄下寬，flip 後依最終方向翻轉。
  TIV／TMV 與其他未位於同範圍 RDL dielectric 層的 via 使用上下等寬的矩形直柱。
  Flow 的直柱位置由共用 region plan 決定，預留後續 die slots 並在剩餘間隔分布；同 revision／assembly phase
  不因後續 LSI 出現而重新移動既有 TIV，HBM 內部柱則保留在該 component 的局部範圍。
  Circuit 每個實際層只畫同一排較寬的長方形導線，不在同一層內上下錯開。兩者各使用固定 9 根代表符號，
  完全不依 density（含零或缺省）改變。各路徑採可重現的隨機錯位，上下 via 分別接於 circuit 左右對側；
  flip 保留水平位置並反轉上下方向。符號填滿各自層厚，僅連接同一 footprint 且實際 Z 接觸的層，
  不跨越間隙；重新開啟預覽不重新亂排，也不改變原始幾何。Joint presenter 以黃色上接點、灰色鼓形焊料、
  黃色下接點顯示 `joined` bump，三段顯示高度比例為 1:4:1。
  PnP presenter 僅在上下兩側 reflowed bump 有唯一的 XY 正面積重疊與 Z 接觸、且雙側 density 大於零時，
  畫成接點貼本體、圓底焊料相對的上下鏡像 bump；各側黃色接點與灰色焊料高度比例為 1:2。
  兩側共用顆數與水平中心，各自保留實際高度和厚度明細。
  下側只畫在上側 bump 的代表寬度內，carrier 外側保持空白。正 density 大小不影響符號疏密。
  單側 reflowed、deposited 與零 density 不畫符號或列入部件明細，原始幾何及總厚度仍保留。
  已配對與未配對元件分組保留；Joint 後改為單顆鼓形焊料與上下接點，沒有同一接點的殘留 reflowed 符號。
- 只有 target 實際存在 `uf` body 才顯示 UF；元件內 cavity UF 只畫 slab，無需當步仍有 bump。
  Die 間爬升依保留 gap polygon 的連通區域、孔洞與實際接觸決定，不限制 die 種類或有無 bump。
  同一連通區域的參與者映射至同 mounting region 的相鄰代表 slots 時才畫 bridge，其他層的
  水平交錯 slot 不阻擋；高度取 UF 與兩端元件的共同 Z 區間。
  不穿越其他元件或空白 slots；非相鄰、同一代表內或不足兩個當步端點的連接保留明細與 notes。
- 厚度使用最終 snapshot 的實際 Z 區間，包含磨薄、整層移除與翻轉。零厚度不畫成有厚度實體。
  薄層可放大，但所有部件共用 Z 顯示轉換，保持同高度邊界對齊。
- 明示「示意圖，不等比例」；明細與總厚度維持實際值。總厚度取最高與最低 Z 的差，
  不累加並排 die。此次不提供 grinding 前後比較或自動過磨判定。

完整 producer、分派與 fallback 契約以 ADR-0012 與 schematic package 為準。

## Accessibility 與驗收

Overlay 使用共用 dialog stack／focus lifecycle；nested Export 的 Escape／backdrop 只影響最上層。
剖面有可讀 title／description，feature 可用 keyboard 聚焦與 Enter／Space 操作，提供可讀標籤與
選取狀態；卡片與圖形保持對應，提示不能只依顏色表達。卡片 Escape 必須在共用 dialog 的
capture handler 之前攔截，且僅在 preview 為最上層 dialog 時生效。

既有 `UI-PREVIEW-004..006`、`010..021` 的 3D／density／section 案例由本 ADR 取代；
`UI-PREVIEW-001..003`、`007..009` 的開啟、取消、modal 與 target-only 行為繼續有效，
其中 009 現在要求完全不載入 mesh／section。新增案例：

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-SCHEMATIC-001` | Ready input／step target | 只顯示 target schematic，無 WebGL、mesh 或 section 請求。 |
| `UI-SCHEMATIC-002` | 相同結構改變 PnP 顆數與正 density | 代表 die 與符號密度維持固定。 |
| `UI-SCHEMATIC-003` | Grind 削薄／整層移除／flip | 圖、實際層厚與總厚度吻合 target snapshot。 |
| `UI-SCHEMATIC-004` | 多 die 類型、極薄 RDL | 代表顆數與左右位置正確，薄層可辨識、同高度對齊。 |
| `UI-SCHEMATIC-005` | 滑鼠點選或 Enter／Space 選取 feature | 開啟單張工程參數卡且不因圖形區重新分配尺寸自行關卡；所有同 item 圖形同步顯示至少 4px 的紅框與淡外暈，保留材料填色，縮放後線寬不變；鍵盤選取不變回綠框。顯示結構、名稱、Material、實際 THK；bump／via／circuit 另有 Density。 |
| `UI-SCHEMATIC-006` | 缺 presenter／presenter 失敗 | 通用 fallback 與提示可讀；原始匯出仍可用。 |
| `UI-SCHEMATIC-007` | 390px 與桌面 viewport，含長卡片與 notes／warnings | 未選取時圖全寬；選取後桌面卡片置右側 288px，窄螢幕置下方且最多佔 review 區高度 40%，可卡內捲動。卡片不覆蓋圖，圖依剩餘寬高顯示全貌、不捲動且圓形不扭曲；notes 預設收合在右上角驚嘆號按鈕，開啟不壓縮圖面；總厚度、獨立限高 25% 的 warnings 區與 footer 可達。 |
| `UI-SCHEMATIC-008` | 寬 carrier 與窄 HBM 的 bump geometry | 依上側代表寬度等間距排列黃色接點與灰色焊料，符號不超界；接合區不重複，選取卡片對應各側原始來源的材料、厚度與 density。 |
| `UI-SCHEMATIC-009` | 多材料、裁切與深色部件 | 使用封裝剖面配色，預設只顯示 Carrier、LSI、SoC、HBM、DMY label，避開遮蔽區並採黑／白對比文字；同一 component 不重複標示內層名稱，實際厚度與材料在選取卡片呈現。 |
| `UI-SCHEMATIC-010` | 前步已完整、下游缺 recipe／參數／geometry／wiring | 前步預覽可開啟；request 保留完整 flow，後端在該路徑第一個不完整 step 停止 lookahead。 |
| `UI-SCHEMATIC-011` | 相同 viewport 的連續 PnP steps 與不同結構高度，含開關工程參數卡 | Document 的共用 die 水平位置與 carrier 寬度一致；viewer 依當下可用寬高 fit 全圖，容許螢幕縮放比例隨 target 高度與卡片版面改變，無裁切、圖卡重疊或圖面捲動。 |
| `UI-SCHEMATIC-012` | 後續 die 已預留位置、尚未實際放置 | 該位置留白，沒有 future die 標籤、厚度明細或選取目標。 |
| `UI-SCHEMATIC-013` | 合併來源有單值／多值／重複／缺失 density，以及 0、100 | Density 去重並排序，缺值顯示 Not specified；0% 不被隱藏或當成缺值，body 不顯示 Density。 |
| `UI-SCHEMATIC-014` | 已開卡後切換 feature、再點同一 feature、點空白、Close、兩次 Escape | 切換時更新同一張卡；其餘操作關卡，圖恢復全寬，Close／Escape 還原圖形焦點；第一次 Escape 保留 preview，第二次才關閉 preview。 |
| `UI-SCHEMATIC-015` | 開卡後縮放 viewport／整體 review 區、圖形可視區收到捲動事件或更新 snapshot | 卡片關閉；resize 自動重新 fit 全圖，不保留舊 snapshot 的工程參數。開關卡引起圖形區尺寸變化不視為整體 review 區縮放。 |
| `UI-SCHEMATIC-016` | 已開卡再開 Export form，按 Escape 或點 form backdrop | 只關閉最上層 Export form，卡片與 preview 保留；submitting 時沿用 form 的不可關閉規則。 |
| `UI-SCHEMATIC-017` | 點擊／Enter／Space 開啟右上角驚嘆號，關閉再重新開啟 | 預設無說明文字區；開啟顯示完整 notes、可捲動且不改變 SVG 尺寸。再次點擊、Close、點外部或 Escape 可關閉；Close／Escape 還原按鈕焦點，preview 保持開啟；notes 與 feature 卡不同時開啟。 |

紅色選取外框的單次 browser observation 見 [Schematic Selection Evidence](../evidence/schematic-selection/README.md)。
右上角說明卡與三種 viewport 的觀察見 [Schematic Notes Disclosure Evidence](../evidence/schematic-notes/README.md)。
自動測試與完整 browser 驗收進度以 [conformance](../../conformance.md) 為準，不以此規格宣稱已完成。
