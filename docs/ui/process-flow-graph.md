# Process Flow Graph UI 設計

## 目的

Process Flow Graph UI 是 process flow editor family 共用的 graph canvas UI。
它負責呈現與操作 geometry dataflow DAG，包括 graph canvas、node、edge、
geometry input slot、geometry preview 入口、pan / zoom，以及 topology 是否可以被修改的互動模式。

Graph UI 不代表任何單一路由。它由上層 editor 嵌入使用：

| 上層 editor | Graph topology mode | 使用方式 |
|---|---|---|
| Flow Template Editor / topology editor | `topologyEdit` | 使用者可以建立與修改 flow topology。 |
| Flow Instance Editor / from-template editor | `readonlyTopology` | Topology 由 selected `ProcessFlowTemplate` 決定，使用者只做 instance-level editing。 |

Graph UI 的核心模型是 directed acyclic geometry dataflow graph。使用者看到的是
geometry state 如何流入各 process step 的 top-level geometry input slot，而不是
線性的 `previous` / `next` step list。

## 範圍邊界

Graph UI 負責：

- 中央 graph canvas 與背景。
- Pan、zoom、fit view、controls 與 minimap。
- Initial geometry node 的視覺呈現。
- Process step node 的視覺呈現。
- Dataflow edge 的視覺呈現。
- Geometry input port / slot 的顯示。
- Edge label 與 geometry preview button 的位置。
- Node status 的共用顏色語彙。
- 由上層 editor 控制的 topology interaction mode。
- Topology edit 開啟時的互動：node movement、connect、reconnect、delete，以及外部 drop integration。
- `readonlyTopology` 開啟時的互動：graph structure 鎖定，但仍允許上層 editor 接 node / edge callback。

Graph UI 不負責：

- 左側 geometry library palette。
- 右側 process step template library palette。
- Template selector。
- Product / instance metadata form。
- Step instance field dialog content。
- Geometry picker content。
- Status strip copy 與 validation priority。
- Save、export、abort 或 backend persistence。
- Domain validation，例如 wafer geometry 是否被接到語意正確的 field。

Geometry library 與 step template library 是上層 editor 的 UI，不屬於 Graph UI core。
Graph UI 只定義外部 palette item 或 command 如何在 canvas position 建立 graph node 的 integration contract。

## Topology 模式

Graph UI 提供由上層 editor 控制的 topology interaction mode。這是 component 層級設定，不是讓使用者在同一個畫面自由切換的 UI 開關。

建議使用的標準命名：

```ts
type ProcessFlowGraphTopologyMode = "topologyEdit" | "readonlyTopology";
```

實作可以把這兩個概念對應到較短的 component prop，例如 `edit` 與 `view`。
但 UI 規格應使用語意更清楚的 topology mode names 來描述行為。

### `topologyEdit`

用於 Flow Template Editor / topology editor。

允許：

- Pan / zoom。
- Fit view。
- 拖動 process step nodes 與 initial geometry nodes。
- 從外部 geometry library source 新增 initial geometry nodes。
- 從外部 process step template source 新增 process step nodes。
- 將 initial geometry output 連到 process step input slots。
- 將 process step output 連到 downstream process step input slots。
- 將既有 edge target reconnect 到另一個合法 input slot。
- 刪除 graph nodes。
- 刪除 graph edges。
- 點擊由上層 editor 提供的 process step node action，例如開啟 step instance dialog。
- 點擊由上層 editor 提供的 geometry preview button。

Graph UI 不決定：

- Geometry library 內列出哪些 geometry entities。
- Step template library 內列出哪些 process step templates。
- Palette item 是否支援 click-to-add。
- Save 時如何建立 `ProcessFlowTemplate` 與 `ProcessFlowInstance` payload。

### `readonlyTopology`

用於 Flow Instance Editor / from-template editor。

允許：

- Pan / zoom。
- Fit view。
- 點擊 initial geometry node 觸發上層 editor 擁有的 geometry picker。
- 點擊 process step node 觸發上層 editor 擁有的 step instance editor。
- 當上層 editor 標記 edge 可 preview 時，點擊 geometry preview button。

不允許：

- 新增 node。
- 刪除 node。
- 拖動 node。
- 建立 edge。
- 刪除 edge。
- Reconnect edge。
- 修改 `targetFieldId`。
- 修改 `ProcessFlowTemplate.stepRefs[]`。
- 修改 `ProcessFlowTemplate.flowEdges[]`。

`readonlyTopology` 不代表整個頁面 readonly。上層 editor 仍可以允許 instance-level editing，例如選擇 initial geometry、填寫 step values，以及查看 geometry preview。

## 視覺模型

Graph UI 使用 left-to-right dataflow visual model。

- Initial geometry node：圓形 node，代表 geometry state source。
- Process step node：矩形 node，代表 process step instance / step ref。
- Edge：有方向的 geometry state flow。
- Process step input slot：top-level geometry input field 的 target handle。
- Process step output handle：該 step 執行後 output geometry state 的 source handle。

Graph layout position 只屬於 UI。Runtime order 由 `flowEdges[]` 推導，不由 React Flow node order、畫面位置或 `stepRefs[]` array order 決定。

## Node 類型

### Initial Geometry Node

Initial geometry node 代表一個 geometry state source。

在 `topologyEdit` mode：

- 由外部 geometry library source 建立。
- 放到 graph 前已經 reference 一個具體的 `GeometryEntity.id`。
- 可以被移動。
- 可以被刪除。
- 沒有 incoming edge。
- 最多只能有一條 outgoing edge。
- 若保留在 graph 上但沒有連線，上層 editor validation 應阻止 Save。

在 `readonlyTopology` mode：

- 由每一條 `flowEdges[]` 中 `source.sourceType === "geometryRef"` 的 edge 產生。
- 不是 persisted template node。
- 不能被移動或刪除。
- 會開啟上層 editor 擁有的 geometry picker 或 selection action。
- 使用者選到的 geometry id 由上層 editor 寫入 target step field value。

### Process Step Node

Process step node 代表 flow-local process step instance / `StepRef`。

它只顯示 graph 層級需要的簡短識別資訊：

- Process step template name。
- Template version。
- Field completion status。

它預設不顯示完整 category、field count、step instance id 或 parameter details。
這些資訊屬於上層 editor 的 palette item 或 step dialog。

Process step node 包含：

- 一個 output handle。
- 一個或多個 input slots，每個 slot 代表一個 top-level geometry field。
- 依 topology mode 決定是否顯示上層 editor 提供的 edit / delete actions。

## Geometry Input Slots

Graph UI 將每個 top-level geometry input field 視為 target input slot。
Viewer 實作的判斷是：

```ts
field.valueType === "geometryRef"
```

文件中若為了描述 dataflow source type 使用 `geometryRef`，指的是 saved
`flowEdges[].source.sourceType` 的 initial geometry source；若描述 process step
template field，則指 `valueType: "geometryRef"` 的 top-level geometry input field。

規則：

- 每條 edge target 都必須指向明確的 `targetFieldId`。
- Target field 必須存在於 target process step template。
- Target field 必須是 top-level geometry input field。
- Repeater child fields 不是 graph input slots。
- 非 geometry fields 不是 graph input slots。
- 每個 target slot 最多只能有一條 incoming edge。
- 同一個 process step 可以接收多條 incoming edges，但每條 edge 必須指向不同 slot。

當 process step 有多個 geometry input slots 時，Graph UI 必須讓 target slot choice 明確可見。
建立 edge 或 reconnect 時，slot labels 應足夠清楚，讓使用者能分辨
`main_geometry`、`die_geometry`、`substrate_geometry` 等欄位。

Slot label 不需要常駐顯示，避免大型 flow 畫面過於雜亂。Process step node 平常只顯示 input port indicators；當使用者 hover 到 process step / input slot，或正在拖曳 edge 靠近可連接的 target step 時，Graph UI 才展開或浮出 slot labels。滑鼠移開、drag-over 結束或 reconnect 結束後，slot labels 應自動收起。

Edge label 平常保持簡潔。實作會常駐顯示一個短 slot label pill，例如
`main_geometry` 或 `die_geometry`。Hover、selected、drag-over 或 reconnecting
狀態可以讓 slot label 更醒目；不要在 edge 上常駐顯示長 source/target 說明。

## Edge 規則

每條 edge 都代表 geometry state 從一個 source 流向一個 target input slot。

支援的 source types：

- `geometryRef`：initial geometry source。
- `stepOutput`：upstream process step output geometry state。

支援的 target：

- Process step 的 top-level geometry input slot。

Topology 規則：

- Source node 不可等於 target node。
- 新連線不可造成 cycle。
- 每個 initial geometry node 最多只能有一條 outgoing edge。
- 每個 process step output 最多只能有一條 outgoing edge。
- 每個 target input slot 最多只能有一條 incoming edge。
- 同一個 process step 可以有多條 incoming edges，但必須分別落在不同 slots。

`topologyEdit` mode 的 replacement rules：

- 若 source 已經有 outgoing edge，從該 source 建立新 outgoing edge 時會取代舊 edge。
- 若 target slot 已經有 incoming edge，將新 source 接到該 slot 時會取代舊 incoming edge。
- 取代某個 slot 的 incoming edge 時，不可以移除同一 target step 上其他 slots 的 incoming edges。

## Geometry Preview Button

Graph UI 提供共用的 geometry preview button style 與位置。Preview button 有兩種 placement：

- Edge preview button：位於 flow edge label center，preview 該 edge source 所代表的 geometry state。
- Terminal final preview button：位於 terminal process step 右側，preview 該 step 的 final output geometry state。

上層 editor 決定 preview button 的可見與可用狀態，因為 preview availability 取決於當前資料狀態：

- `geometryRef` edge 在上層 editor 已有具體 geometry id 時 preview selected geometry。
- `stepOutput` edge 在 source step 與其 upstream dependency 都完成時 preview source step output。
- Terminal final preview 在 terminal step 與其 upstream dependency 都完成時 preview terminal step output。

Terminal final preview button 只出現在符合下列條件的 process step：

- 該 process step 沒有 outgoing `stepOutput` flow edge。
- 該 process step 可從至少一個 `geometryRef` edge / initial geometry node 沿著 dataflow 抵達。
- 若有多個符合條件的 terminal process steps，每個 terminal process step 都顯示自己的 terminal final preview button。
- 在 topology edit mode 中，使用者開始從該 process step 的 output handle 拉出連線時，terminal final preview button 立即隱藏；若連線取消且 step 仍符合條件，button 再次顯示。
- 一旦該 process step 接上 outgoing `stepOutput` flow edge，terminal final preview button 消失，改由新的 edge preview button 提供 preview 入口。

Terminal final preview button 使用與 edge preview button 相同的 32x32 circular eye button style。
Button 放在 process step 右側、與 output handle 垂直置中，和 step 保持短距離。
Output handle 與 button 之間以一條低對比、無箭頭的短水平線連接。這條線只是 preview affordance，不是 persisted flow edge，不出現在 `flowEdges[]`，不參與 layout、validation、save 或 export。
Terminal final preview 不顯示 edge slot label pill；preview panel 中 target label 固定為 `F`。

Preview 不可用但 terminal step 符合顯示條件時，terminal final preview button 保持可見並呈現 disabled style。
Disabled button 不可點擊，title / accessible label 由上層 editor 提供，常見原因包含
`Select initial geometry first`、`Complete upstream fields first`、schema validation error。

Button 必須可以透過 pointer click 觸發，並提供可讀的 title / accessible label。
點擊 button 時呼叫上層 editor 擁有的 preview action；Graph UI 不擁有 preview dialog content 或 geometry kernel request。
上層 preview path 的命名必須與 geometry data model 對齊：kernel preview output 是
`geometryStructure: GeometryStructure`；API response 中可下載的 JSON 欄位是
`geometryEntityJson: GeometryEntityDownload`，不是 raw geometry structure。

Preview request 使用明確的 preview target，不用 virtual edge 表示 terminal final preview：

```ts
type GeometryPreviewTarget =
  | { type: "edge"; previewEdgeId: string }
  | { type: "stepOutput"; stepRefId: string };
```

Edge preview target 使用 `type: "edge"`。Terminal final preview target 使用
`type: "stepOutput"`，並以 `stepRefId` 指向要執行並回傳 output 的 process step。

## Status 語彙

Graph UI 提供共用的 visual status vocabulary。各上層 editor 決定如何計算 status。

Initial geometry node statuses：

- `complete`：對上層 editor 的 save contract 來說，已經選取或連接完成。
- `incomplete`：仍需要選取或連接。

Process step node statuses：

- `complete`：step 位於 active flow 中，且所有 required values 已完成。
- `incomplete`：step 位於 active flow 中，但仍缺 values 或 valid inputs。
- `outside`：node 存在於 topology-editing whiteboard，但無法從任何 initial geometry source 抵達。

`readonlyTopology` mode 通常不使用 `outside`，因為所有 nodes 都來自 selected template topology。

建議顏色語彙：

- 綠色 border：complete。
- 橘色 border：incomplete。
- 紅色 border：outside flow 或 invalid unconnected draft node。

## Layout 與 Navigation

Graph UI 支援 pan、zoom、fit view 與 minimap。

在 `topologyEdit` mode：

- 允許 user placement。
- Node position 是 visual draft state。
- 上層 editor 可以把新 node 放在 current viewport 或 selected node 附近。
- 大型 flows 應保持水平瀏覽能力。

在 `readonlyTopology` mode：

- Node movement 會被鎖定。
- 上層 editor 或 Graph UI layout helper 應將 graph 排成 left-to-right。
- Initial geometry sources 顯示在其 target step 之前。
- Process step rank 由 upstream dependency depth 推導。
- Merge steps 可以從不同 lanes 接收 incoming branch edges。
- Layout 不應暗示 `flowEdges[]` 以外的 process order。

## 外部 Source 整合

Graph UI 不 render geometry library 或 process step template library。
它只提供 canvas integration points，讓上層 editor 可以從外部 source 建立 nodes。

上層 editor 負責：

- Palette data loading。
- Palette grouping 與 empty states。
- Palette item summaries。
- Drag payload type。
- Click-to-add behavior。
- Palette item 是否 disabled。

Graph UI / graph adapter 負責或支援：

- Canvas drop target。
- 將 pointer position 轉換為 graph coordinates。
- 在指定 canvas position 建立 graph node。
- 將 node creation event 傳回上層 editor 擁有的 draft state。

典型 external source commands：

```ts
type AddInitialGeometryNodeCommand = {
  nodeKind: "initialGeometry";
  geometryEntityId: string;
  position: { x: number; y: number };
};

type AddProcessStepNodeCommand = {
  nodeKind: "processStep";
  processStepTemplateId: string;
  position: { x: number; y: number };
};
```

這些 commands 只描述 graph insertion intent，不定義 geometry library 或 step template library 要如何顯示。

## 上層 Editor 職責

Flow Template Editor / topology editor 負責：

- Geometry library palette。
- Process step template palette。
- Technology / product metadata。
- Step instance dialog。
- Status strip 與 validation message priority。
- Topology-to-template save conversion。
- Instance save conversion。
- Process JSON export。

Flow Instance Editor / from-template editor 負責：

- Template selector。
- Product / instance metadata。
- Initial geometry picker。
- Step instance dialog。
- Status strip 與 validation message priority。
- Template graph resolution。
- Instance save conversion。

Graph UI 擁有共用的 canvas 語言。上層 editors 擁有圍繞此 canvas 語言的工作流程。

## 前端復刻規格

本節定義 `apps/viewer` 前端的實際 UI 與互動。它不是新的產品概念，而是重建相同操作體驗時的復刻規格。

主要實作位置：

- Graph core：`apps/viewer/components/process-flow-graph/process-flow-graph.tsx`
- Template editor shell：`apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx`
- Instance editor shell：`apps/viewer/components/process-flow-instance-editor/process-flow-instance-editor.tsx`
- Geometry preview handoff：`apps/viewer/components/geometry-preview/geometry-preview-panel.tsx`
- 全域 tokens：`apps/viewer/app/globals.css` 與 `apps/viewer/tailwind.config.ts`

### 共用視覺 tokens

UI 使用 Next + Tailwind + shadcn-style primitives。復刻時應先建立同樣的
視覺語彙，再做 Graph。

全域顏色：

| Token | HSL | 用途 |
|---|---:|---|
| `background` | `204 28% 97%` | editor page 與 graph 周邊底色。 |
| `foreground` | `204 24% 14%` | 主要文字。 |
| `primary` | `168 76% 25%` | teal primary、source handle、主要按鈕、可用 preview button。 |
| `secondary` | `203 22% 91%` | 次要 badge / muted control。 |
| `muted` | `202 19% 92%` | panel header、card sub-surface。 |
| `muted-foreground` | `204 12% 42%` | 輔助文字。 |
| `accent` | `46 88% 55%` | outline button hover background。 |
| `destructive` | `0 74% 48%` | invalid / outside / delete hover。 |
| `border` / `input` | `203 17% 82%` | card、panel、input border。 |
| `ring` | `190 90% 38%` | focus ring。 |

共用 shape：

- 基礎 radius 是 `0.5rem`，常用 `rounded-md`。
- Cards、panels、buttons 大多使用 6-8px radius，不使用大圓角。
- Button 高度預設 36px；小按鈕 32px；icon button 36x36。
- Badge 是 `rounded-md border px-2 py-0.5 text-xs font-medium`。
- `signal` badge 使用 `border-cyan-300 bg-cyan-50 text-cyan-900`。
- Dialog / preview overlay shadow 使用 `0 24px 80px rgba(9, 22, 34, 0.18)`。
- 字體 stack：system UI + `Noto Sans TC` / `PingFang TC` / `Microsoft JhengHei`。

### Graph canvas chrome

`ProcessFlowGraph` 自身是一個 `section`，佔滿上層 editor 剩餘高度：

- `relative min-h-0 flex-1`
- 背景是白底加淡 teal 32px grid：
  `linear-gradient(90deg, rgba(15,118,110,0.05) 1px, transparent 1px)` 與
  `linear-gradient(180deg, rgba(15,118,110,0.05) 1px, transparent 1px)`。
- React Flow `Background` 再疊一層 `color="rgba(15, 118, 110, 0.18)"`、`gap={32}`。
- Controls 固定在 `bottom-left`，順序為 zoom in、zoom out、fit view、toggle interactivity。
- MiniMap 固定在 `bottom-right`，`pannable` 與 `zoomable` 都開啟。
- React Flow attribution 留在右下角。

Graph core props 與預設：

| Prop | 值 / 預設 | 行為 |
|---|---|---|
| `mode` | `"edit"` 或 `"view"` | 對應本文件的 `topologyEdit` / `readonlyTopology`。 |
| `minZoom` | template `0.35`，instance `0.28` | Template editor 保持較高最小縮放以利 topology editing；instance readonly graph 可縮得更小，讓 terminal final preview button 在長鏈 flow 中保留可見空間。 |
| `maxZoom` | `1.4` / instance `1.45` | Template editor 使用 1.4，Instance editor 使用 1.45。 |
| `fitView` | template true，instance 選 template 後手動 fit | Template editor 初次顯示自動 fit；instance 選 template 後 `fitView({ padding: 0.26, duration: 220 })`，保留 terminal final preview button 的右側空間。 |
| `panOnScroll` | instance true | Readonly graph 允許用 scroll pan。 |
| `elementsSelectable` | instance true | Readonly topology 仍可選取元素。 |
| `showMiniMap` | 預設 true；instance 空圖 false | 空狀態不顯示 minimap。 |
| `defaultEdgeOptions` | `markerEnd: ArrowClosed` | Edge 都帶閉合箭頭。 |

Mode 對 React Flow interaction 的對應：

- `mode="edit"`：`nodesDraggable` true、`nodesConnectable` true、
  `edgesReconnectable` 由 prop 控制。
- `mode="view"`：`nodesDraggable` false、`nodesConnectable` false、
  `edgesReconnectable` false。

### Template editor shell

Template editor route 是 `/flow-template-editor`。這個 shell 不屬於 Graph core，
但它定義了使用者實際操作 topology-edit graph 的畫面。

Header：

- 左側 icon 是 `GitBranch`，標題 `Process Flow Template Editor`。
- subtitle：`Custom mode builds an immutable topology snapshot and a bound instance.`
- 右側 actions：`Home`、`Start from template`、`Clear`、`Save`。
- `Save` 在 `analysis.canSave === false` 時 disabled。
- Metadata form 是一列三欄，在 `xl` 以上為：
  `technologyName`、`productInstanceName`、validation pill。
- `Technology name` 是 required，placeholder 是
  `Example: HBM4 glass carrier flow`。
- `Product / instance name` placeholder 是 `Falls back to technology name`。
- Validation pill 是 border + `bg-muted/30`，左側 icon：
  `Check` green 或 `AlertCircle` destructive，文字會 truncate。

Status strip：

- 位於 header 下方，`border-b bg-background px-5 py-2`。
- Badges 順序固定：
  `flow steps N`、`outside flow N`、`nodes N`、`edges N`。
- 右側再顯示同一個 `analysis.validationMessage`。

Main workbench：

- Desktop grid：`280px | minmax(540px, 1fr) | 320px`。
- 左欄 Geometry library：border-right white panel。
- 中欄 Graph canvas：`min-h-[560px]`，desktop 佔滿剩餘高度。
- 右欄 Process step templates：border-left white panel。
- 窄版時改為單欄垂直堆疊，整個 section `overflow-y-auto`。

Palette group：

- 每個 category 是一張 `rounded-md border bg-white` 的 accordion。
- Header 是 `bg-muted/40 px-3 py-2 text-sm`。
- 左側 category name truncate；右側 count badge + `ChevronDown`。
- Collapsed 時 chevron `-rotate-90`；open 時顯示 children，`p-2`、`gap-2`。

Geometry palette item：

- 只支援 drag，不支援 click-to-add。
- `draggable`，drag payload type 是 `application/process-flow-geometry`，
  value 是 `GeometryEntity.id`。
- Card：`cursor-grab rounded-md border bg-white p-3 text-sm shadow-sm`，
  hover 時 `border-primary/60 bg-muted/20`。
- 內容：`Box` icon、geometry name、`entityType / id`、兩行 description。

Step template palette item：

- 支援 click-to-add 與 drag-to-drop。
- Drag payload type 是 `application/process-flow-step-template`，value 是 template id。
- Card 本身是 button：`rounded-md border bg-white p-3 text-left text-sm shadow-sm`。
- 顯示 template name、`version / field count fields`。
- Badge 顯示 `N geometry slots`；若有 repeater field，再顯示 `repeater` signal badge。
- 若 template 沒有 top-level geometry input slot，整張 card disabled，title 是
  `This template has no top-level geometryRef input slot.`
  這是 UI 的實際 title 文案；判斷條件是 top-level `geometryRef` field。
- Enabled title 是 `Click to add, or drag to the whiteboard`。

Click-to-add placement：

- 若有 selected node，新 step 放在 selected node 右側 `x + 330`、同一個 `y`，
  並立即打開 step editor dialog。
- 若沒有 selected node 但已有 nodes，新 step 放在最右 node 的 `x + 330`、
  `y = 160`，並立即打開 dialog。
- 若是空圖，新 step 放在 canvas viewport center 附近：
  `center.x - 120`、`center.y - 60`，並立即打開 dialog。
- Drag-to-drop step 會放在 drop point，不會自動打開 dialog。

Drop behavior：

- Canvas `onDragOver` 會 `preventDefault()` 並設定 `dropEffect = "move"`。
- Drop point 透過 `reactFlow.screenToFlowPosition({ x: clientX, y: clientY })`
  轉成 graph coordinates。
- Geometry drop 建立 initial geometry node。
- Step template drop 建立 process step node。

### Instance editor shell

Instance editor route 是 `/flow-instance-editor`。這個 shell 使用同一個 Graph core，
但 topology 是 selected template 解出的 readonly graph。

Header：

- 左側 icon 是 `GitBranch`，標題 `Process Flow Instance Editor`。
- subtitle：`Create a product instance from an immutable flow template.`
- 右側 action group 有 `Home`、`Cancel`、`Save`。
- Form 是三欄：
  `Product / instance name`、`Process flow template` select、selected template summary card。
- Product / instance name required，placeholder 是
  `Example: TV42 HBM4 qualification build`。
- Template select 第一個 option 是 `Select template` 或 `No process flow templates`。
- 選到 template 後 summary card 顯示 template name 與 `version ...`。

Status strip：

- Badges 順序固定：
  `template selected/not selected`、`flow steps N`、
  `initial geometries complete/total`、`steps complete/flow steps`。
- Validation message 佔剩餘寬度，完成時綠色，否則 muted。

Graph empty state：

- 未選 template 時，Graph canvas 中央顯示 dashed card：
  icon `Layers3`、標題 `Select a flow template`、
  copy `The graph appears here after a process flow template is selected.`
- Empty state 是 `pointer-events-none absolute inset-0 flex items-center justify-center p-6`。
- 空圖仍顯示 React Flow controls，但不顯示 minimap。

Header actions：

- 位置與 Flow Template Editor 相同，在 header 右上角。
- Buttons：`Cancel` outline + `RotateCcw` icon、`Save` primary + `Save` icon。
- Save disabled until `analysis.canSave`。

Readonly graph after selecting template：

- Graph 自動 fit view，padding `0.26`、duration `220ms`。
- 所有 node 都 `draggable: false`。
- Node click：
  - initial geometry node 打開 Geometry picker。
  - process step node 打開 Step instance dialog。
- Topology 不可新增、刪除、拖動、connect 或 reconnect。
- Edge preview button 仍會依 availability enabled / disabled。
  Disabled button 仍留在 edge label 中，使用 `title` 說明原因，例如
  `Select initial geometry first`、`Complete upstream fields first`、
  `Selected geometry no longer exists` 或 schema validation message。

### Node visual spec

Initial geometry node：

| Mode | Size | Shape | Cursor / action |
|---|---:|---|---|
| edit | `132 x 132` | circle, `border-4 bg-white p-4 shadow-sm` | draggable；hover 顯示 delete。 |
| view | `138 x 138` | circle, `border-4 bg-white p-4 shadow-sm` | cursor pointer；click 或 double click 觸發 pick。 |

Initial geometry node content：

- 右側 source handle：`id="out"`，`Position.Right`，
  16x16 visual size，white 2px border，primary fill。
- Icon：`CircleDot`，`h-5 w-5 text-primary`。
- Label：兩行 clamp，`text-xs font-semibold leading-tight`。
- Sublabel：`text-[10px] text-muted-foreground`，edit max width 92px，
  view max width 100px。
- View mode status badge：
  - complete：`signal`，text 預設 `Selected`。
  - incomplete：outline + amber text，text 預設 `Required`。
- Edit mode delete button：
  - 右上角 `absolute -right-1 -top-1`。
  - 28x28 circle，border white background，shadow。
  - 只有 group hover 顯示。
  - icon `Trash2` 14px，title `Delete geometry node`。

Initial geometry status border：

- complete：`border-emerald-500`。
- edit incomplete：`border-destructive`。
- view incomplete：`border-amber-500`。

Process step node：

| Mode | Width | Shape | Cursor / action |
|---|---:|---|---|
| edit | `248px` | `rounded-md border-2 bg-white shadow-sm` | draggable；hover 顯示 edit/delete actions。 |
| view | `252px` | `rounded-md border-2 bg-white shadow-sm` | cursor pointer；click 或 double click 開啟 step values。 |

Process step status border：

- `outside`：`border-destructive`。
- `complete`：`border-emerald-500`。
- `incomplete`：`border-amber-500`。

Process step handles：

- Input handles 放在 node 左側，容器是
  `absolute left-0 top-3 flex -translate-x-1/2 flex-col gap-2`。
- 每個 input slot 是 16x16 cyan handle，white 2px border，顏色 `bg-cyan-600`。
- Handle id 必須等於 field id。
- Slot label 是浮動 tooltip：
  `absolute left-5 z-20 max-w-[150px] rounded-md border bg-white px-2 py-1 text-[10px] font-medium shadow-sm`。
- Slot label 平常 hidden；hover 該 input、focus-within，或正在連到該 target handle 時顯示。
- Output handle 在右側，`id="out"`，16x16 primary fill。
- Terminal final preview button 放在 node 右側 output handle 外側，與 output handle 垂直置中。
- Terminal final preview connector 是一條淡色短水平線，從 output handle 右側延伸到 button 左側。
  線段使用低對比 border color，不顯示箭頭，不顯示 label，也不接受 connect / reconnect。
- Terminal final preview button 與 node 之間保留短距離，button 不覆蓋 output handle，
  不阻擋使用者從 output handle 拉出 edge。
- Topology edit mode 中，使用者正在從該 output handle 拉出連線時，
  terminal final preview button 與 connector 同步隱藏。

Process step content：

- Header：`border-b bg-muted/40 px-3 py-2`。
- Template name：`text-sm font-semibold leading-snug`，最多兩行。
- Edit mode header 右側 hover actions：
  - Pencil button：title `Edit values`，打開 dialog。
  - Trash button：title `Delete step`，刪除 node 與相關 edges。
  - Actions 是 28x28 rounded-md，hover 時白底，delete hover destructive。
- View mode header 會在 template name 下方顯示 `displaySublabel`，
  通常是 `stepRefId`。
- Footer：`px-3 py-2 text-xs`，左側 template version，右側 status badge。
- Status badge text 預設：
  - outside：`outside flow`
  - complete：`Complete`
  - incomplete：`Incomplete fields`

### Edge visual spec

Edge 使用 React Flow Bezier path：

- `getBezierPath(props)` 算 path 與 label center。
- Base edge stroke width 是 `2.5px`。
- 非 selected：`stroke-cyan-700`。
- selected：`stroke-primary`。
- `interactionWidth`：edit 18，view 16。
- Marker end 由上層 editor 給 `ArrowClosed`。

Edge label renderer：

- Label container 位於 Bezier label center：
  `absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 text-[10px]`。
- Container 必須是 `nodrag nopan pointer-events-auto`，讓 button 可點。
- 順序固定：
  1. Geometry preview button，若可顯示。
  2. Slot label pill。
  3. Delete edge button，edit mode 且 edge 有 `onDelete` 時顯示。

Preview button：

- 32x32 circle，`border-2 border-primary bg-white text-primary shadow-sm`。
- Hover 變成 `bg-primary text-primary-foreground`。
- Icon 是 `Eye` 16px。
- Disabled 時：
  `cursor-not-allowed border-muted-foreground/30 text-muted-foreground opacity-60`。
- Title 由 `geometryViewTitle` 決定。
  常見 disabled title：
  `Select initial geometry first`、`Complete upstream fields first`。
- Click 時只呼叫上層的 `onGeometryView`，Graph core 不處理 preview content。
- Terminal final preview button 使用同一套尺寸、icon、enabled style、disabled style 與 click behavior。
- Terminal final preview button 的 target label 是 `F`，但 button 旁不顯示文字 pill。

Slot label pill：

- `rounded-md border bg-white/95 px-2 py-1 text-muted-foreground shadow-sm`。
- Edit mode max width 120px；view mode max width 132px。
- 文字是 target field display name，例如 `main_geometry`、`die_geometry`。

Delete edge button：

- 只在 edit mode 出現。
- 24x24 circle，border white background。
- Icon 是 `X` 14px。
- Title `Delete edge`。

Preview button visibility rule：

- 若 `data.onGeometryView` 存在，且
  `geometryViewVisible === true` 或 `sourceType === "stepOutput"`，就顯示。
- 也就是 step output edge 即使沒有顯式打開 visible flag，也可以顯示 preview 入口。
- Enabled / disabled 由上層 editor 計算，Graph core 只呈現。
- Terminal final preview 由 process step node data 控制，Graph core 只呈現 button / connector。
- Terminal final preview 的顯示條件由上層 editor 計算：
  1. step 沒有 outgoing `stepOutput` edge。
  2. step 可從至少一個 `geometryRef` edge / initial geometry node 抵達。
  3. topology edit mode 沒有正在從該 step output handle 拉出連線。
- Terminal final preview 的 enabled / disabled 由上層 editor 計算：
  terminal step 本身與 upstream dependency 都完成時 enabled，否則 disabled。

### Topology edit interaction details

在 Template editor 中：

- Click process step node 會選取並打開 step dialog。
- Click canvas pane 會清除 selected node。
- Delete node action 會同步刪掉 source 或 target 包含該 node 的 edges。
- Delete edge action 會清除該 target field 的 graph-provided value。
- Terminal final preview button 可在符合條件的 terminal step 上顯示。
  Button disabled 時仍顯示灰色狀態，enabled 時點擊打開 geometry preview panel。
- 使用者開始從 terminal step output handle 拉線時，terminal final preview button 立即隱藏。
  若連線取消且 step 仍沒有 outgoing edge，button 重新顯示；若連線完成，button 維持隱藏並由 edge preview button 接手。
- Reconnect 只允許改 target，不允許改 source；若 `connection.source !== oldEdge.source` 直接忽略。
- 新 connect 與 reconnect 都會先跑 `validateConnection`。

Connection validation：

- Source 必須存在。
- Target 必須是 process step node。
- Target handle 必須對應 target template 的 top-level geometry field。
- Source 與 target 不可相同。
- Source output 不可已經造成違規；若建立新 edge，會用 replacement rules 取代同 source outgoing 或同 target slot incoming。
- 不可造成 cycle，cycle 用 graph path 檢查。

Replacement behavior：

- 從同一 source 接新 edge，會取代舊 outgoing edge。
- 接到同一 target slot，會取代舊 incoming edge。
- Reconnect 到新 slot 時，舊 target slot 的 field value 會被清掉。
- 取代不會刪掉同一 target step 上其他 slot 的 incoming edges。

Template editor validation priority：

1. Technology name required。
2. 至少要有一個 connected initial geometry root。
3. 不能保留 unconnected initial geometry node。
4. 不能有 cycle。
5. 不能有 duplicate target slot。
6. 不能有 duplicate outgoing source。
7. Edge source / target / target field 必須合法。
8. Reachable steps 的 geometry input 必須有 graph edge 或 explicit geometry id。
9. Reachable steps 的 required step values 必須完成。

Status strip 的 `flow steps` 只計算從 connected initial geometry root 可抵達的 process steps；
不在 active flow 內的 process step 會顯示 `outside flow`。

### Readonly topology interaction details

在 Instance editor 中：

- Template select 會把 `ProcessFlowTemplate.stepRefs` 與 `flowEdges` 解成 nodes / edges。
- `geometryRef` source edge 會生成一個 initial geometry node。
- 每條 `geometryRef` edge 都有自己的 initial geometry node，因此同一個 target step
  有兩個 initial geometry inputs 時，畫面會出現兩個圓形 source。
- Initial geometry node label 初始是 `Select geometry`；選取後變成 geometry name。
- Initial geometry node sublabel 是 target field name。
- Initial geometry node status badge 初始是 `Required`，選取後是 `Selected`。
- 選取 geometry 後：
  - initial node border 從 amber 變 emerald。
  - status strip 的 `initial geometries complete/total` 增加。
  - 對應 edge preview button 可能從 disabled 變 enabled。
  - 符合條件的 terminal final preview button 可能從 disabled 變 enabled。
  - target step field value 寫入 selected geometry id。
- Process step node sublabel 是 `stepRefId`。
- Process step status 由 step completion 計算；只要 upstream 或 required field 未完成，就保持 incomplete。
- Terminal final preview button 在 readonly topology 中同樣顯示於符合條件的 terminal step 右側。
  Topology readonly 不影響 preview；button 的 enabled / disabled 只取決於資料 completeness 與 schema validity。

Instance editor validation priority：

1. 必須選 process flow template。
2. Product / instance name required。
3. Template schema 必須合法：
   step ref 不重複、step template 可 resolve、target field 存在且是 geometry input、
   target slot 不重複、step output 不多重 outgoing、無 cycle、每個 geometry input 有 incoming edge。
4. 所有 initial geometry nodes 必須選到存在的 geometry entity。
5. 依 template order 找第一個 incomplete step，顯示 `${StepName}: ${FieldName} is required.`。

### Readonly layout algorithm

Instance editor 的 readonly graph 使用 deterministic left-to-right layout。
重做時應保持這個大方向，避免同一份 template 每次打開 node 位置不同。

Layout constants：

- `xGap = 330`
- `yGap = 190`
- step base y = `280`
- normalize 後最小 x 不小於 40，最小 y 不小於 70。

Step rank：

- 所有 step 初始 rank 是 1。
- 對每個 `stepOutput` edge，target rank 至少是 `sourceRank + 1`。
- Pass 次數是 step count，讓長鏈能推進。

Lane：

- 找最長 step output path，作為 main path，lane = 0。
- 非 main path 依 rank、template order、stepRefId 排序。
- Lane pattern 是 `-1, 1, -2, 2, ...`。
- 若某個非 main step 有 non-zero lane 的 upstream，沿用 upstream lane。
- 否則拿下一個 lane pattern。

Initial geometry position：

- 依 target step 分組。
- Initial node rank 是 `targetRank - 1`，但不小於 0。
- 同一 target 的多個 geometryRef source 用 centered offsets 分散在 target lane 周邊。
- 會避開已被 step 佔用的 `(rank, lane)` cell。

### Dialog handoff

Graph core 不擁有 dialog content，但 node / edge actions 必須能交給上層 editor。
Overlay 有三種。

Step instance dialog：

- Overlay：`fixed inset-0 z-50 flex items-center justify-center p-4`。
- 背景遮罩：`bg-foreground/40`。
- Panel：`w-[min(960px,calc(100vw-32px))]`、
  `max-h-[calc(100vh-32px)]`、`rounded-md border bg-background shadow-viewport`。
- Header：白底 border-bottom，title 是 template name。
- Header badges：
  - Template editor：`in flow` / `outside flow`，以及 `Complete` / `Incomplete`。
  - Instance editor：`from template`，以及 `Complete` / `Incomplete`。
- Close：右上角 ghost icon button，title `Close`；Escape 也會關閉。

Template editor 的 Input mapping：

- 每個 geometry input row 是 `180px | 1fr | auto` 三欄。
- 若該 field 有 incoming edge，顯示 mapping card：
  `${field.name} <- ${sourceLabel}`。
- `geometryRef` edge 顯示 saved value 是 geometry id。
- `stepOutput` edge 顯示 saved `FieldValue.value` 是 null。
- 有 incoming edge 時提供 `Unlink` button，icon `Link2Off`。
- 沒有 incoming edge 時提供 geometry select，可以直接選 geometry entity；
  旁邊 badge 是 `selected` 或 `unmapped`。

Instance editor 的 Input mapping：

- 不提供 select 或 unlink。
- 每 row 是 `180px | 1fr`，窄版改單欄。
- 只讀顯示 `${field.name} <- ${mappedLabel}` 與 saved value。
- 若 template edge missing，顯示 `No incoming edge`，底色 destructive/5。

Step values：

- 非 geometry fields 都在 `Step values` section。
- Primitive controls 依 field type 顯示 text / number / checkbox / select。
- Repeater field 顯示 Add / Remove，item title 用 `itemNameTemplate`。
- Repeater min items 會讓 Remove disabled。

Geometry picker：

- 只在 Instance editor 由 initial geometry node 觸發。
- Panel width：`min(760px, calc(100vw - 32px))`。
- Header 顯示 `Geometry picker` 與 `${targetStepRefId} / ${targetFieldName}`。
- Header 內有 search input，placeholder `Search geometry`，左側 `Search` icon。
- Body 依 geometry category 分組，每組有 header、count badge。
- Geometry card 顯示 name、`version / id`、entityType badge、description。
- 已選 geometry card 加 `border-primary ring-2 ring-primary/20`。
- Search 會比對 name、id、version、category、entityType、description。

Geometry preview panel：

- 由 edge preview Eye button 或 terminal final preview Eye button 觸發。
- Preview request 由上層 editor 建立，送到 `POST /api/geometry-preview`。
- Edge preview request 使用 `{ type: "edge", previewEdgeId }` target。
- Terminal final preview request 使用 `{ type: "stepOutput", stepRefId }` target。
- Kernel 回傳 `geometryStructure: GeometryStructure`；API route 以此產生 GLB，並包成
  `geometryEntityJson: GeometryEntityDownload` 供 `Export JSON` 使用。
- `Export JSON`、`Export STEP AP242`、`Export CDB` 都會開啟 export dialog，
  送出 `POST /api/geometry-preview/export-jobs`，由後端直接寫入指定 path。
- Panel 是全畫面 overlay，`fixed inset-0 z-50 p-3 sm:p-6`。
- Header 顯示：
  - `Geometry Preview`
  - status badge：`Loading` / `Ready` / `Error`
  - source kind badge：`Initial geometry` / `Step output`
  - `${sourceLabel} -> ${slotLabel}`
- Terminal final preview 的 header label 是 `${StepName} -> F`。
- Loading 狀態中央顯示 spinner 與 `Generating geometry preview...`。
- Ready 狀態嵌入 CAD workbench：
  - 左側 3D viewer。
  - 右側 controls：Section、Measure、View、Camera、Model。
  - Section 預設 enabled，plane tabs 是 XZ / YZ，position slider 依 bounds。
  - View toggles：Grid、Axes。
  - Camera buttons：Fit camera、X、Y、Z。
  - Model stats 顯示 meshes、materials、vertices、triangles、bounds。
- Footer buttons：
  - `Export JSON` outline，ready 前 disabled。
  - `Export STEP AP242` outline，ready 前 disabled。
  - `Export CDB` outline，ready 前 disabled。
- Export request list 不屬於 graph core 或 preview overlay；它由 flow editor root render 成右側中間 drawer。

### Rebuild checklist

從零重做時，至少要做到以下幾點，才算還原此 UI 效果：

- 建立同樣的 design tokens、button、badge、input、dialog shadow。
- Graph canvas 要有 32px 淡 teal grid、React Flow controls、minimap、arrow edges。
- Template editor 要有 header actions、metadata form、validation pill、status strip、
  左 geometry library、右 process step templates、中間 editable graph。
- Instance editor 要有 template selector、template summary、status strip、
  readonly graph empty state、右上角 Cancel / Save header actions。
- Flow editors 要有右側中間 export request drawer：collapsed icon tab、right-to-left expanded panel、
  latest 20 browser-owned jobs、cancel action、desktop hover full-detail popover。
- Initial geometry node 要是圓形，edit 132px、view 138px，狀態用 emerald / amber / destructive border。
- Process step node 要是 248/252px 矩形，左側多 slot handles、右側 output handle，
  header 顯示 template name，footer 顯示 version + status badge。
- Slot labels 要在 hover / reconnect target active 時顯示，不要常駐鋪滿畫面。
- Edge label center 要包含 preview eye、slot label、edit mode delete button。
- Terminal process step 若沒有 outgoing stepOutput edge，且可從 initial geometry source 抵達，
  右側要顯示 terminal final preview eye button 與淡色短 connector。
- Terminal final preview button disabled 時保持可見灰色狀態；step 與 upstream 完成後變成可點。
- Terminal final preview panel header 要顯示 `StepName -> F`。
- Edit mode 要支援 step click-to-add、palette drag-to-drop、node drag、connect、target reconnect、delete。
- Replacement rules 要保持 single outgoing source 與 single incoming target slot。
- Instance mode 要從 template edges 生成 initial geometry nodes，不可讓使用者改 topology。
- Instance mode 選 geometry 後要同步更新 initial node label/status、edge preview availability、
  target step field value 與 status strip。
- Step dialog、geometry picker、geometry preview panel 要用 overlay handoff，
  Graph core 只提供 action callbacks，不擁有 dialog body。
