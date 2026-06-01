# Process Flow Template Editor UI Design

## Route

`/processFlowEditor`

## Purpose

建立一個可視化的 process flow template editor，讓使用者在白板上從 geometry library 建立 initial geometry roots，拖入 process step templates，將 geometry states 連接到 target step 的 `geometryRef` input slots，形成沒有 cycle 的 geometry dataflow DAG，並填寫建立 instance 所需的 step values。

此 editor 支援自訂 flow 建立 instance：

- 使用者不套用既有 flow template。
- 使用者可以自行拖拉 initial geometry、step template、排列白板 node、將 geometry state 接到 step input slot、填寫 instance values。
- Save 時依白板上的 graph 建立新的 process flow template snapshot，同時建立綁定該 template 的 process flow instance 與可匯出的 process JSON。

使用者在操作時的心理模型是「我正在建立一個 process flow instance」。系統在底層同時建立一份新的 flow template，是為了讓 instance 有不可變的 topology snapshot 可以綁定。UI 不要求使用者先建立一份沒有 values 的 process flow template，再到另一個流程補 process flow instance values；這會讓使用者覺得流程被拆成兩次不自然的工作。

Process flow 編輯有兩種建立模式：

1. `fromTemplate`：使用既有 process flow template 建立 instance。
2. `custom`：使用者自行建立 flow topology，Save 時同時建立新的 process flow template snapshot 與 process flow instance。

`fromTemplate` 模式中：

- 使用者不能編輯 flow 結構。
- 使用者只填寫 instance 所需 values 與 initial geometry instance selections。

本文件定義 `custom` 模式。`fromTemplate` 模式只在此說明概念，不在本文件展開完整 UI 規格。

此頁面不連接 backend service 或 database。process step templates、process flow templates 與 process flow instances 都從 browser `localStorage` 讀寫。

## Core Interaction Model

Editor 的核心模型是 geometry dataflow DAG。白板 UI 不以線性製程序列、每個 step 的 `previous` / `next` 指標，或 array order 建模流程；使用者是在把某個 geometry state 接到下一個 process step 的特定 `geometryRef` input slot。

白板上的 node 分成兩類：

- Initial geometry node：代表 geometry DB / mock geometry library 中的一個起始 geometry reference。
- Process step instance node：代表 flow 內的一個 `StepRef`，引用一個 global `ProcessStepTemplate`，並保存此 instance 的 draft field values。

白板上的 edge 代表 geometry state 的資料流。每條 edge 都必須有明確 source 與明確 target slot：

- Source 可以是 initial geometry node，也可以是 process step instance 的 output geometry state。
- Target 永遠是 process step instance 的某個 top-level `geometryRef` field。
- Target 不只指向 step node，還必須指向該 step node 上的 `targetFieldId`。

同一個 initial geometry reference 可以被多個 downstream steps 或多個 downstream slots 使用。Initial geometry 是既有 geometry DB 物件的 reference；多個 step slot 使用同一個 initial geometry 時，各 target step 的 `FieldValue.value` 都保存同一個 `GeometryEntity.id`。

Process step output 不支援 fan-out。每個 process step instance 的 output port 最多只能有一條 outgoing flow edge。若使用者從同一個 process step output 再建立一條 outgoing edge，新的 edge 會替換原本的 outgoing edge，原 target slot 回到未由 graph 提供的狀態。

Fan-in 也是原生支援的互動：同一個 target step 可以接收多條 incoming edges，但每條 incoming edge 必須落在不同的 top-level `geometryRef` input slot。也就是說，多對一發生在「多個 geometry states 進入同一個 process step 的不同 input slots」；同一 target slot 不接受多個 sources。

每個 target slot 最多只能有一條 incoming edge。若使用者把新的 source 接到已經有 source 的 slot，採用 slot-level replacement，只替換該 slot 的原 edge，不影響同一 target step 的其他 slots。

範例：

```text
incoming wafer -> Grind -> Micro bump -> PNP.main_geometry
incoming die   -> Die prep ------------> PNP.die_geometry
substrate      -> Clean substrate -----> PNP.substrate_geometry
```

在此範例中，`PNP` 是同一個 target process step instance，但它有三條 incoming edges，分別接到三個不同的 `geometryRef` input slots。Save 時會產生三筆 `flowEdges[]`，它們具有相同的 target `stepRefId`，但有不同的 `targetFieldId`。

Process step output 單一 outgoing 範例：

```text
Micro bump -> PNP.main_geometry
```

若使用者稍後從 `Micro bump` output 改接到 `Inspection.main_geometry`，原本的 `Micro bump -> PNP.main_geometry` edge 會被移除，只保留新的 `Micro bump -> Inspection.main_geometry` edge。

`stepRefs[]` array order 不代表流程順序。真正的 flow topology 只由 `flowEdges[]` 表示。UI layout position 只用於閱讀、整理與操作白板，不參與 runtime graph order 判斷。

## Technology

- React
- TypeScript
- Next.js
- shadcn/ui
- Tailwind CSS
- lucide-react icons

## Data Contract

### Storage

localStorage 內保存三類資料：

```ts
const PROCESS_STEP_TEMPLATES_STORAGE_KEY = "processStepTemplates";
const PROCESS_FLOW_TEMPLATES_STORAGE_KEY = "processFlowTemplates";
const PROCESS_FLOW_INSTANCES_STORAGE_KEY = "processFlowInstances";
```

| localStorage key | Value shape | 此頁用途 | 此頁是否寫入 |
|---|---|---|---|
| `processStepTemplates` | `ProcessStepTemplate[]` | 右側 process step template palette 的資料來源。 | 不寫入。此頁只讀取既有 process step templates，不建立、不修改、不刪除 process step templates。 |
| `processFlowTemplates` | `ProcessFlowTemplate[]` | Save custom flow 後新增一份 process flow template snapshot。 | 寫入。Save 成功後 append 新 template。 |
| `processFlowInstances` | `ProcessFlowInstance[]` | Save custom flow 後新增一份綁定新 template 的 instance。 | 寫入。Save 成功後 append 新 instance。 |

三個 localStorage value 都是純 array，不包額外 metadata。

此頁先假設上述 localStorage key 若存在，其 JSON 格式與 schema 都正確；不需要做 malformed localStorage recovery UI。

Export all templates 時，下載內容為 `ProcessFlowTemplate[]`，來源是 `processFlowTemplates`。

Export all templates 行為：

- 下載檔名固定為 `processFlowTemplates.json`。
- Blob MIME type 使用 `application/json;charset=utf-8`。
- JSON 使用 2-space pretty print：`JSON.stringify(templates, null, 2)`。
- 即使 templates 為空陣列，也可以 export，檔案內容為 `[]`。

Save custom flow 時：

- 從 metadata form 取得 `Technology name` 與 `Product / instance name`。
- 從白板 draft graph 建立新的 `ProcessFlowTemplate`。
- 從白板中 flow graph 內的 step values 建立新的 `ProcessFlowInstance`。
- 將 `Technology name` 寫入新 `ProcessFlowTemplate.name`。
- 將 `Product / instance name` 寫入新 `ProcessFlowInstance.name`；若使用者留空，使用 `Technology name` 作為 fallback。
- 將新 template append 到 `processFlowTemplates`。
- 將新 instance append 到 `processFlowInstances`。
- 另行下載一份 process JSON，作為本次 custom flow 建立結果的匯出檔。

### Seed Templates

此頁不 seed process step templates。

`processStepTemplates` 由 process step template editor 或其他初始化流程先寫入 localStorage。若 `processStepTemplates` 不存在或為空陣列，右側 process step template palette 顯示 empty state，使用者無法拖入 process step，但本頁不自動建立 seed data。

此頁不 seed process flow templates 或 process flow instances。若 `processFlowTemplates` 或 `processFlowInstances` 不存在，初始化時以空陣列處理。

## Metadata Form

Editor 上方需要提供 metadata 區域，讓使用者在建立 flow topology 前先命名本次要建立的 technology 與 instance。

Metadata 區域至少包含：

- `Technology name`：必填。寫入 Save 後產生的 `ProcessFlowTemplate.name`，也是本次 custom flow 在 template list 中主要顯示的名稱。
- `Product / instance name`：選填。寫入 Save 後產生的 `ProcessFlowInstance.name`；若使用者留空，Save 時使用 `Technology name` 作為 instance name fallback。

Metadata 區域需要常駐在白板上方，與 Save 狀態列相鄰，讓使用者在任何白板縮放或捲動狀態下都能看見目前建立目標與 validation 狀態。

`Technology name` 空白時，Save button 必須 disabled，狀態列顯示 technology name required 類型的錯誤訊息。`Product / instance name` 空白時不阻止 Save。

若未來需要讓使用者填寫 `ProcessFlowTemplate.version`、`description`、`owner` 或其他 metadata，應優先擴充此 metadata 區域，不要把 template metadata 混入 step instance editor。

## Layout

畫面主要分成三個區域：

- 左側：geometry selection palette。
- 中央：process flow 白板區。
- 右側：process step template palette。

左側 geometry palette 依 geometry category 分組呈現。每個 category 可展開或收合，展開後列出該 category 下的 geometry references。每個 geometry item 顯示 geometry display name、entity type、geometry entity id 與必要摘要資訊。

右側 process step template palette 依 `process step template category` 分組呈現。每個 category 可展開或收合，展開後列出該 category 下的所有 process step templates。

每個 process step template item 顯示 step name、version、field 數量與 repeater 標記。右側 palette 承擔 template 瀏覽與選擇用途，因此保留比白板 node 更完整的 template 摘要資訊。

左側與右側 palette 都支援 scrollbar，避免可選 geometry 或 template 數量多時撐破版面。

本頁的主要工作區是 editor，不提供 marketing-style landing content。三欄 layout 在桌面版保持同屏可見；窄螢幕可改為 stacked 或 drawer layout，但白板、geometry palette 與 step palette 的功能分工不變。

## Whiteboard Flow Area

中央 flow 區是白板式 canvas。使用者可以將左側 geometry item 拖入白板，建立一個 initial geometry node。使用者也可以將右側 process step template 拖入白板，建立一個獨立的 process step instance。

右側 process step template palette 同時支援 click-to-add。使用者點擊某個 process step template item 時，系統立即在目前白板 viewport 內建立一個新的 process step instance node；這是快速建立 step 的主要操作，不要求使用者一定要拖曳。

Click-to-add 建立 step 時：

- 新 node 需要取得新的 `stepRefId`，即使同一個 process step template 已經被加入過也不可共用既有 `stepRefId`。
- 新 node 初始位置放在目前 viewport 可見範圍內，優先放在最後選取 node 或目前 flow 右側；若無可參考 node，放在 viewport 中央附近。
- 新 node 初始狀態為未加入 flow graph，依 Flow Membership 規則顯示紅色外框或 outside flow 狀態。
- 建立後立即開啟該 step 的 step instance editor dialog，讓使用者可以直接填寫 values。
- 使用者關閉 dialog 後回到白板；該 node 仍保留在白板上，直到使用者刪除或 Save 時依 flow membership 規則處理。

同一個 process step template 可以被拖入多次，每次都是不同 step instance，並擁有不同的 `stepRefId`。

同一個 geometry reference 代表一個真實物件。使用者可以把同一個 initial geometry node 接到多個 downstream process step geometry input slots。

Initial geometry node 是 UI draft state，用來讓使用者在白板上看見與操作初始 geometry。它不是 persisted data model 物件，也不會在 Save 後保存成 `geometrySlots[]` 或 `initialGeometryRefs[]`。

當 initial geometry node 連到 process step input slot 時，UI draft edge 需要記住來源是哪個白板 node 與哪個 `GeometryEntity.id`，以便畫線、刪除、狀態判斷與 Save 轉換。Save 時，這條連線輸出為 `flowEdges[]` 中的 `sourceType: "geometryRef"` edge；實際 `GeometryEntity.id` 保存於 target step 對應的 `FieldValue.value`。

白板初始化時不自動建立 initial circle。所有 initial geometry nodes 都由使用者從左側 geometry palette 拖入。

使用者可以任意移動白板上的 initial geometry node 與 process step instance 位置。位置是視覺編輯用途，不代表 flow 順序；真正的 flow topology 由 arrows / edges 決定。

白板上的 initial geometry node 以圓圈表示。圓圈本身代表該 initial geometry 的 geometry status，因此 initial geometry node 到第一個 process step 的 edge 不顯示額外 geometry state button。

白板上的 process step block 是流程結構的輕量代表。Block 只顯示必要辨識資訊：

- 上層：process step template name，以主要文字呈現。
- 下層左側：template version，以小字呈現。
- 下層 version 右側：field completion status，顯示 `Complete` 或 `Incomplete fields`。

Block 不顯示 category、field 數量、step instance id 或完整參數內容。這些資訊集中在右側 palette 與 step instance editor 中呈現，避免白板在大型 flow 中變得雜亂。

## Geometry Input Slots

每個 process step template 必須有一個 top-level `main_geometry` field，且該 field 的 `valueType` 必須是 `"geometryRef"`。這個欄位是 process step 接收 geometry state 的必要 input slot。

Flow editor 不提供額外的 generic input slot，也不使用 `targetFieldId: null`。所有 edge target 都必須指向 target step template 中實際存在的 top-level `geometryRef` field；使用 `main_geometry` 欄位時，edge target 必須明確保存 `targetFieldId: "main_geometry"`。

當 process step template 的 top-level `fieldDefinitions[]` 中存在 `valueType: "geometryRef"` 的 field 時，每個這類 field 都可以成為 geometry input slot。Slot name 使用該 `FieldDefinition.name`。Edge 資料只保存 `FieldDefinition.id`，不保存 name。

Process step node 的左側 input dock 需要依 top-level `geometryRef` fields 顯示一個或多個 input slots。只有一個 `main_geometry` field 的 step 顯示單一 input slot；有多個 geometry fields 的 step 顯示多個 named slots，讓使用者明確把 source geometry state 接到指定 target field。

Step node 的 incoming edges 規則是 slot-level，而不是 node-level：

- 同一個 process step instance 可以有多條 incoming edges。
- 每條 incoming edge 必須接到不同的 top-level `geometryRef` input slot。
- 同一個 target input slot 最多一條 incoming edge。
- 一個 process step instance 的 incoming edge 上限等於它的 top-level `geometryRef` field count。

同一個 process step output 不可同時供應多個 target slots。若要讓同一加工結果進入另一個 branch，使用者需要在 flow 中建立明確的 downstream process step，或重新接線到新的單一 target slot。

只有 top-level `valueType: "geometryRef"` 可以成為 edge input slot。

以下欄位不支援 edge input slot：

- `fieldGroupArray` repeater 內的 child fields。
- 非 geometry reference 的 material、layout 或 primitive fields。

Top-level `geometryRef` field 有兩種供值來源：

- Geometry DB 或 mock geometry library reference：使用者從 geometry library 選取 geometry entity，值保存在 target step 的 `FieldValue.value`，其值必須是 `GeometryEntity.id`。
- Upstream process step output：由 `flowEdges[]` 中指向該 `targetFieldId` 的 incoming edge 提供，且 edge source 必須是 `sourceType: "stepOutput"`。此時 target step 對應的 `FieldValue.value` 可以是 `null`，表示 runtime 會從上游 step output resolve geometry DB id。

當 top-level `geometryRef` field 的 incoming edge source 是 geometry DB / initial geometry 時，`FieldValue.value` 仍必須保存明確的 `GeometryEntity.id`，不可保存 `null`。

當 top-level `geometryRef` field 的 incoming edge source 是 upstream process step output 時，該 field 的 effective geometry 由 graph resolution 提供，不需要在 `FieldValue.value` 中保存特殊 geometry id。Editor 不使用 `ffffffff` 或其他 sentinel id 表示 graph-provided geometry。此時對應 form field 可顯示為 read-only mapping，例如 `Provided by Micro bump formation output`，而 `FieldValue.value` 保存 `null`。

當使用者 unlink 該 incoming edge 後，該 `geometryRef` field 回到一般 geometry library picker 狀態，可由使用者從 DB 或 mock geometry library 選取 geometry reference，並在 `FieldValue.value` 保存明確的 geometry DB id。

Process step block 平常保持乾淨，不常駐顯示 `wafer_geometry`、`soic_geometry` 等 field text。若 step template 有 geometry input fields，block 左側需要顯示 input port indicators；當 field 數量大於一個時，hover、drag-over、selected、new edge dragging 或 edge target reconnecting 狀態需要展開 slot labels，避免使用者把 edge 接錯 field。

使用者拖拉 edge 接近某個 process step 時，該 step 暫時展開 input dock。Input dock 顯示：

- 每個 top-level `geometryRef` field 的 label。

使用者必須 drop 到某個 slot 才建立連線。若 target step 有多個 geometry input slots，drop 到 step body 但沒有明確 slot 時，不應自動建立連線；UI 應維持 slot dock 開啟或提示使用者選擇 slot。Edge 建立後綁定到該 slot。

Edge 平常不顯示長 label；edge hover 或 edge selected 時才顯示 slot label。Step modal 內完整顯示 input mapping，例如 `SOIC geometry <- Micro bump formation output`，並提供 unlink 或 change source 操作。

Input mapping 的顯示需要強調「source geometry state -> target slot」：

```text
main_geometry      <- Micro bump output
die_geometry       <- Die prep output
substrate_geometry <- substrate:incoming-substrate
```

Flow editor 只驗證 topology 與 schema-level slot 合法性，不判斷 wafer、die、SOIC 等 domain geometry 是否接對。若使用者把 wafer 接到 die geometry field，editor 可保存該 graph，後續由 geometry kernel 或 simulation validation 回報幾何語意錯誤。

Top-level `geometryRef` field 的 completion 規則：

- 有 incoming `stepOutput` edge 指向該 field 時，`FieldValue.value` 可以是 `null`，但 upstream source step 必須已完成欄位，該 field 才算 complete。
- 有 incoming geometry DB / initial geometry edge 指向該 field 時，`FieldValue.value` 必須是明確的 `GeometryEntity.id`。
- 沒有 incoming edge 指向該 field 時，必須檢查使用者是否已從 geometry library picker 選取 geometry entity，並使 `FieldValue.value` 保存明確的 `GeometryEntity.id`。

## Large Flow Navigation

當 process flow step 數量很多時，白板採用水平 dataflow 跑道設計。白板以左到右閱讀為主；多 input 匯流 node 可以放在主要閱讀路徑的上方或下方，避免 edge 交錯。

白板區使用水平 scrollbar 讓使用者左右查看大量 steps。支線與匯流 node 可以使用垂直空間整理，但 graph topology 仍完全由 `flowEdges[]` 決定。

使用者手動拖動 node 時，不限制 node 只能位於固定跑道上。

## Flow Membership

從任何 initial geometry node 沿著 arrows 可抵達的 process step instance，才算加入目前 flow graph。

已加入 flow 且 fields 已完成的 step 使用綠色外框。

已加入 flow 但 fields 尚未完成的 step 使用橘色外框。

未加入 flow 的 step 可以暫時存在白板上，但使用紅色外框。

未連接的 initial geometry node 使用紅色或 warning 狀態呈現，並使 Save button 不可點選。使用者必須手動刪除未連接 initial geometry node，或將其接入 graph。

白板顏色狀態定義如下：

- 綠色：step 已經在 flow graph 中，而且 instance fields 已完成。
- 橘色：step 已經在 flow graph 中，但 instance fields 尚未完成。
- 紅色：step 不在 flow graph 中，或 initial geometry 尚未連接。

Save 時：

- 檢查所有已連接 initial geometry nodes 與從它們可達的 process step instances。
- 不檢查未加入 flow graph 的 process step instances。
- 未加入 flow graph 的 process step instances 會被移除，不會進入產生結果。
- 未連接 initial geometry nodes 不會自動移除；它們會讓 Save button 不可點選，直到使用者手動刪除或連接。

## Flow Shape Rules

此 editor 建立的是 directed acyclic geometry dataflow graph，不允許 cycle。

每個 initial geometry node：

- 零個 incoming edge。
- 可以有零個或多個 outgoing edges。
- 若保留在白板上，Save 前至少需要一個 outgoing edge，否則視為未連接 initial geometry node。

每個 process step instance：

- 可以有零個或一個 outgoing edge。零個 outgoing edge 表示此 step 是目前 flow 的終點。
- 可以有零個或多個 incoming edges。
- 每個 top-level `geometryRef` field 最多一個 incoming edge。

Process step instance 的 incoming edge 上限為：

```text
top-level geometryRef field count
```

合法的 process step template 必須至少有 `main_geometry` 這個 top-level `geometryRef` field，因此每個 step 至少會有一個可接入的 geometry input slot。

同一個 process step instance 可以作為 fan-in 匯流點。只要每條 incoming edge 指向不同 target slot，多條 incoming edges 指向同一個 target step 是合法 graph。

同一個 process step output 只能供應一個 downstream target slot。單一 process step source 若建立新的 outgoing edge，會以 source-level replacement 移除原 outgoing edge。

不允許 cycle。使用者拉線時，如果新連線會形成 cycle，UI 必須阻止該連線成立。

Save 使用 `stepRefs[]` 與 `flowEdges[]` 表示 graph topology。Initial geometry 不保存成 `initialGeometryRefs[]`；geometry DB source 由 `flowEdges[].source` 表示，實際 geometry DB id 由 target step 對應的 instance `FieldValue.value` 保存。

## Connection Interaction

每個 initial geometry node 與 process step instance 都有一個可拖拉的 outgoing arrow 或 handle。使用者將 arrow 拖到另一個 process step 的 input slot 並放開後，才會建立連線。

連線互動需要讓 target slot 成為明確可選的互動目標。拖曳新 edge 或 reconnect 既有 edge target 時，所有可接的 process step 需要展開 input dock 並顯示 top-level `geometryRef` slot labels。使用者 hover 某個 slot 時，該 slot 需要清楚高亮。使用者 drop 後，edge target 立即綁定該 slot 的 `FieldDefinition.id`。

為了避免誤接，當拖拉中的 arrow 指向某個可連接 step 或 input slot 時，被指到的 target 需要有明顯 UI feedback，例如 slot 高亮、邊框變亮、背景變化，或其他 hover target indication。

連線驗證規則：

- source 不可等於 target。
- source 可以是 initial geometry node 或 process step instance。
- target 只能是 process step instance。
- 新連線不可造成 cycle。
- 同一個 initial geometry source 可以指向多個 targets。
- 同一個 process step output source 最多只能指向一個 target。
- 同一個 target step 可以接收多條 incoming edges，只要每條 edge 指向不同 input slot。
- 不允許同一 target step 的同一 input slot 同時有多個 sources。
- `targetFieldId` 必須存在於 target step template 的 top-level `fieldDefinitions[]`，且該 field 必須是 `valueType: "geometryRef"`。

當使用者建立新連線時，採取 slot-level 與 process-step-source-level replacement 規則：

- 若 target input slot 原本已有 incoming edge，該 slot 的原 incoming edge 會被移除。
- Target step 上其他 input slots 的既有 incoming edges 會保留。
- 若 source 是 initial geometry node，source 上其他 outgoing edges 會保留。
- 若 source 是 process step output，該 source 原本的 outgoing edge 會被移除，只保留新 edge。
- 被移除連線後造成的 flow 斷裂，由使用者自行重新接線。

範例：

```text
原本:

wafer_initial -> A -> PNP.main_geometry
soic_initial -> Micro bump -> PNP.SOIC geometry

操作:

new_soic_initial -> PNP.SOIC geometry

結果:

wafer_initial -> A -> PNP.main_geometry
soic_initial -> Micro bump
new_soic_initial -> PNP.SOIC geometry
```

也就是只有 `PNP.SOIC geometry` slot 原本的 incoming edge 被移除；`PNP.main_geometry` 或其他 target slots 的 incoming edges 保留。

若使用者從同一個 process step output 再拉一條 edge 到其他 target slot，原 outgoing edge 會被移除，原 target slot 回到一般 geometry picker 或未選取狀態。

既有 edge 必須支援 target reconnect。使用者可以拖動 flow edge 的 target endpoint，將它改接到另一個 process step 的合法 `geometryRef` input slot。Reconnect 時 source endpoint 不變，仍套用 cycle validation、target slot validation、slot-level replacement，以及 process step output 單一 outgoing 規則。Reconnect 成功後，舊 target slot 的 graph-provided mapping 被清除，新 target slot 立即顯示新的 input mapping。

## Delete Interaction

使用者可以刪除白板上的 initial geometry node 或 process step instance node。

刪除 node 時：

- 該 node 從白板移除。
- 所有連到該 node 的 incoming edges 與 outgoing edges 一併移除。
- 若被刪除的是 process step instance，該 step instance 的 draft values 一併丟棄。
- 若 edge 移除後造成 downstream step 不再從任何 initial geometry node 可達，該 downstream step 依 Flow Membership 規則變成未加入 flow graph。

使用者可以刪除單一 flow edge。

刪除 flow edge 時：

- 使用者將滑鼠移到 edge 上時，edge 靠近 target 端顯示一個 small delete icon button。
- 使用者點擊該 delete icon button 後，只移除該 edge。
- Source node、target node、source node 的其他 outgoing edges，以及 target node 其他 input slots 的 incoming edges 都保留。
- 若被刪除的 edge 原本供值給 target step 的 `geometryRef` field，該 field 回到一般 geometry library picker 或未選取狀態；若沒有其他有效值，該 field 會依 completion rule 變成 incomplete。

## Geometry State Button

每個 process step 結束後會產生一個 geometry state。白板上的 process step output edge 中間需要提供一個圓形 geometry view button，讓使用者知道此連線位置可用來查看該 source step 結束後的 geometry state。

Initial geometry node 本身代表初始 geometry state，因此 initial geometry node 的 outgoing edge 不顯示 geometry state button。

Geometry view button 是 button element，必須可透過 pointer click 觸發，也需要有可辨識的 accessible label 或 title。

使用者點擊 geometry view button 時，系統開啟一個 geometry view dialog。Dialog 顯示在白板上方，背景以遮罩變暗，並提供 close button 與 Escape 關閉。Geometry kernel 尚未接入時，dialog body 顯示 placeholder message：

```text
geometry is not supported now
```

此 button 是 geometry view 功能的入口。本 editor 提供 UI 入口與 placeholder feedback；未來 geometry kernel 接入後，dialog body 會替換為 source step 結束後的 geometry state view。

## Instance Editing

使用者點擊白板上的 process step instance 時，畫面中央會開啟一個 modal dialog，用來編輯該 step instance 的 values。

Modal dialog 會覆蓋在白板上方，背景以遮罩變暗，讓使用者明確知道目前正在編輯 process step instance。使用者必須關閉 dialog 後才能回到白板進行拖曳、連線或其他 canvas 操作。

Dialog 佔據主要可視區域的大部分寬度，桌面版約為螢幕寬度的 2/3 到 3/4，並保留最大寬度與邊界，避免欄位內容被白板或 viewport 裁切。

Dialog responsive layout 需要符合以下要求：

- Dialog width 使用 viewport-relative constraint，例如 `min(960px, calc(100vw - 32px))`，並在窄螢幕保留左右邊界。
- Header 內的 title、step instance id、flow membership badge 與 completion badge 不可互相重疊；空間不足時 badge 換行，step instance id 以 ellipsis 截斷。
- Field row 在桌面可使用 label / controls / unknown action 的多欄配置；當可用寬度不足時，必須改為單欄堆疊。
- Option controls 使用可換行的 grid 或 flex-wrap，不可固定成會裁切文字的窄欄。每個 option 至少保留可讀文字寬度，長文字允許換行。
- Unknown action 不可覆蓋或擠壓主要 control；窄螢幕時 Unknown 應移到該 field row 的下一行或同列尾端自然換行。
- Numeric input、unit label 與 Unknown action 需要保持同一 field context；若寬度不足，unit label 可跟 input 同列，Unknown 另起一列。
- Dialog body 的垂直捲動只發生在表單內容區，header 與 close button 保持可見。

Dialog 內部表單區支援垂直捲動，讓欄位較多、repeater 欄位展開或小螢幕情境下仍可完整編輯。

表單欄位根據 process step template 的 schema 動態產生。欄位型別、control type、validation、computed field、repeater value shape 與 field completion 規則以 `docs/data-model.md` 的 `FieldDefinition`、`StepValueSet` 與 `FieldValue` 定義為準；本文件不重複定義完整表單 schema 規則。

Dialog header 顯示正在編輯的 step template 名稱、step instance id、flow membership 狀態，以及 field completion 狀態。白板 block 未顯示的 instance details 與欄位內容都在此 dialog 中呈現。

Dialog 內需要顯示 input mapping 區塊：

- 每個 top-level `geometryRef` field 對應的 source。
- 未連接且尚未選值的 input slot 狀態。
- 已連接 input slot 的 unlink 或 change source 操作。

若某個 `geometryRef` field 已由 incoming `stepOutput` edge 提供，該欄位在表單區顯示為 graph-provided input，不要求使用者再從 DB 選值，並以 `FieldValue.value: null` 保存。若 incoming edge 來自 geometry DB / initial geometry，或沒有 incoming edge，該欄位都必須對應明確的 `GeometryEntity.id`。

Dialog 內的欄位編輯採用 live update。使用者在 dialog 中修改任一 field value 時，該 value 立即寫回白板上的 process step instance draft state，並立即重新計算此 step 的 field completion、flow graph validation、status strip 訊息與 Save button enabled 狀態。

關閉 dialog 時：

- 使用者按下 close、Esc，或點擊 backdrop 關閉 dialog，只是關閉 editor overlay 並回到白板。
- 關閉 dialog 不會 rollback 本次 dialog 開啟期間已修改的 values。
- Dialog 不需要額外提供 Apply / Save / Cancel 按鈕來提交欄位；全頁 Save button 才是將目前白板 draft graph 寫入 localStorage 並 export process JSON 的動作。

未加入 flow graph 的紅框 step 可以被點擊與填寫，但 Save 時不會檢查，也不會保留。

## Status Strip

Metadata 區域與白板之間需要顯示 status strip，提供目前 draft graph 的摘要與下一個需要修正的問題。

Status strip 至少顯示：

- `flow steps`：目前可從任一已連接 initial geometry node 觸達的 process step instance 數量。
- `outside flow`：已在白板上但不可從任何 initial geometry node 觸達的 process step instance 數量。
- 主要 validation message：目前阻止 Save 的最高優先順序問題，或 `Ready to save`。
- Save button：永遠顯示，但依 validation 結果 enabled 或 disabled。

Validation message 優先順序：

1. Metadata 錯誤，例如 `Technology name is required.`
2. Initial geometry root 錯誤，例如沒有任何已連接 initial geometry root，或存在未連接 initial geometry node。
3. Graph topology 錯誤，例如 cycle、同一 target slot 多 incoming edge、edge target field 不合法。
4. Geometry input value 錯誤，例如 geometry DB / initial geometry input 沒有明確 `GeometryEntity.id`。
5. Flow graph 中 reachable process step 的 required fields 尚未完成，訊息需包含 step name 與第一個 blocking field，例如 `Add layer12: Candidate materials is required.`
6. 全部檢查通過時顯示 `Ready to save`。

Status strip 的 count 與 validation message 必須隨白板操作與 live field editing 即時更新。未加入 flow graph 的 process step instances 只影響 `outside flow` count，不影響 required field validation message，也不阻止 Save。

## Save Button

Save button 必須在所有 graph-level 與 instance-level validation 都通過後才能點選。

`disabled` 的意思是 Save button 仍顯示在畫面上，但處於不可點選狀態。使用者必須修正下列條件後，Save button 才能點選。

Save button 不可點選條件包含：

- `Technology name` 為空白。
- 沒有任何已連接 initial geometry root。
- 有 initial geometry node 未連接。
- Graph 內存在 cycle。
- 任一 target step input slot 有多個 incoming edges。
- 任一 edge 的 `targetFieldId` 不存在於 target step template，或不是 top-level `valueType: "geometryRef"` field。
- 任一 `geometryRef` field 的 `FieldValue.value` 為 `null`，但沒有 incoming `stepOutput` edge。
- 任一 geometry DB / initial geometry input 沒有保存明確的 `GeometryEntity.id`。
- Flow graph 中的 process step fields 尚未完成。

判斷 field completion 的範圍只包含 flow graph 中可達的 process step instances。

不在 flow graph 中的 process step instances 不影響 Save button 狀態。

按下 Save 時：

- 移除所有不在 flow graph 中的 process step instances。
- 依 flow graph 中的 step instances 建立 `stepRefs[]`。
- 依連線建立 `flowEdges[]`。
- 對 geometry DB / initial geometry 供值的 `geometryRef` field，將 target `FieldValue.value` 保存為明確的 `GeometryEntity.id`。
- 對 upstream `stepOutput` 供值的 `geometryRef` field，將 target `FieldValue.value` 保存為 `null`。
- 建立 process flow template。
- 建立 process flow instance。
- 建立所有 flow graph 中 step refs 對應的 `StepValueSet` 與其填寫 values。
- 將 process flow template 存入 local catalog。
- 將 process flow instance 存入 local instance store。
- 下載一份包含 process flow template、process flow instance、相關 process step templates、categories 與 geometry refs 的 process JSON。
- 回到 workspace 首頁，讓剛建立的 process flow template 出現在 template list 中。

Save 後，使用者可以在首頁 template list 中選取剛建立的 process flow template，也可以透過匯出的 JSON 保存同一份建立結果。

## Frontend Resources

前端實作此 editor 時使用以下資源。

### React Flow / @xyflow/react

使用 `@xyflow/react` 實作中央白板。

使用範圍：

- node 拖拉、定位、pan、zoom。
- edge、arrow、handle。
- custom node UI，呈現 initial geometry circle、step card、template name、version、completion status、綠框/橘框/紅框狀態。
- multiple target input handles / slots。
- initial geometry reuse：同一 initial geometry node 可連到多個 downstream target slots。
- process step output 單一 outgoing：同一 process step source 最多只能連到一個 downstream target slot。
- fan-in：同一 target step 可從多個 sources 接收 incoming edges，但每條 edge 必須落在不同 target slot。
- connection validation，阻止 cycle 與同一 target slot 多 incoming。
- edge target reconnect，允許拖動既有 edge target endpoint 改接到其他合法 input slot。
- 從 geometry palette drag/drop 到 canvas 建立 initial geometry node。
- 從 step palette drag/drop 到 canvas 建立 process step node。
- 從 step palette click-to-add 建立 process step node，並立即開啟 step instance editor dialog。
- 水平瀏覽與大量 node 顯示。

### UI Component System

前端專案若已有 UI component library，左側 geometry palette、右側 process step template palette、modal dialog 與表單元件優先沿用既有系統。

需要的 UI 元件：

- Accordion：category 展開/收合。
- ScrollArea：左右 palette list 滾動。
- Modal/Dialog：step instance editor。
- Button：Save、unlink、change source。
- Form fields：依 schema 動態產生 instance value input。
- Tooltip：input port、edge label 與 icon button 說明。

若使用 Radix UI 或 shadcn/ui，這些元件對應到 Accordion、ScrollArea、Dialog、Button、Form、Tooltip。

### Drag And Drop

React Flow 負責處理從 geometry palette 與 step palette 拖入 canvas 的流程。

初期不引入 `dnd-kit`。當左右 palette 需要排序、拖曳重排、複雜拖放互動時，再引入 `dnd-kit`。

## Data Model

此頁需要區分兩種資料：

- UI draft graph state：React Flow 與表單編輯時使用，可包含畫面位置、白板 node id、暫存 values、hover/selection 狀態等 UI-only 欄位。
- Saved data model：Save 後寫入 `ProcessFlowTemplate.flowEdges[]`、`ProcessFlowTemplate.stepRefs[]` 與 `ProcessFlowInstance.stepValueSets[]` 的資料。

UI draft state 可以使用以下 TypeScript shape 作為實作基準。`FieldDefinition`、`FieldValue`、`ProcessStepTemplate`、`ProcessFlowTemplate` 與 `ProcessFlowInstance` 的完整定義以 `docs/data-model.md` 為準。

```ts
type DraftNodePosition = {
  x: number;
  y: number;
};

type DraftEditorMetadata = {
  technologyName: string;
  productInstanceName: string;
};

type DraftValidationStatus = "complete" | "incomplete" | "unconnected" | "invalid";

type DraftInitialGeometryNode = {
  id: string;
  nodeType: "initialGeometry";
  geometryEntityId: string;
  geometryDisplayName: string;
  entityType: string;
  position: DraftNodePosition;
  isConnected: boolean;
  validationStatus: DraftValidationStatus;
};

type DraftProcessStepNode = {
  id: string;
  nodeType: "processStep";
  stepRefId: string;
  processStepTemplateId: string;
  templateName: string;
  templateVersion: string;
  categoryId: string;
  position: DraftNodePosition;
  fieldDefinitions: FieldDefinition[];
  geometryInputFieldIds: string[];
  fieldValues: FieldValue[];
  isReachableFromInitialGeometry: boolean;
  validationStatus: DraftValidationStatus;
};

type DraftFlowEdge = {
  edgeId: string;
  sourceNodeId: string;
  sourceType: "geometryRef" | "stepOutput";
  sourceStepRefId?: string;
  sourceGeometryEntityId?: string;
  targetNodeId: string;
  targetStepRefId: string;
  targetFieldId: string;
};
```

`DraftFlowEdge` 欄位規則：

- `sourceNodeId` 與 `targetNodeId` 對應白板上的 React Flow node id，用於畫線、hover、delete 與 selection。
- `sourceType: "geometryRef"` 表示 source 是 initial geometry node。此時 `sourceGeometryEntityId` 必須存在，並對應該 initial geometry node 的 `geometryEntityId`。
- `sourceType: "stepOutput"` 表示 source 是 process step output。此時 `sourceStepRefId` 必須存在。
- 對 `sourceType: "stepOutput"` 而言，同一個 `sourceStepRefId` 在 draft graph 中最多只能出現在一條 outgoing edge。
- `targetStepRefId` 必須對應 target process step node 的 `stepRefId`。
- `targetFieldId` 表示該 edge 接到 target step template 的哪一個 top-level `geometryRef` field。必要 geometry input 使用 `main_geometry`。

Save 時將 `DraftFlowEdge` 轉成 `ProcessFlowTemplate.flowEdges[]`：

```ts
type SavedFlowEdge = {
  edgeId: string;
  source:
    | { sourceType: "geometryRef" }
    | { sourceType: "stepOutput"; stepRefId: string };
  target: {
    stepRefId: string;
    targetFieldId: string;
  };
};
```

Save 轉換規則：

- `DraftFlowEdge.sourceType: "geometryRef"` 轉成 `source: { sourceType: "geometryRef" }`。
- geometry DB id 不保存在 saved edge 裡；必須寫入 target step 對應的 `FieldValue.value`，其值為 `DraftFlowEdge.sourceGeometryEntityId`。
- `DraftFlowEdge.sourceType: "stepOutput"` 轉成 `source: { sourceType: "stepOutput", stepRefId: sourceStepRefId }`。
- step output edge 對應 target `geometryRef` field 的 `FieldValue.value` 保存為 `null`。
- `target` 永遠保存 target step 的 `stepRefId` 與 top-level `geometryRef` field id。

Save 前使用 graph validation 與 reachable traversal 取得要保存的 nodes 與 edges。

## Implementation Dependencies

實作時需要對應既有系統中的以下資料與 API：

- geometry library / geometry DB reference mock data 與 category registry。
- process step template schema 的格式與欄位型別。
- top-level `geometryRef` field detection。
- instance value validation 規則。
- process flow template 與 process flow instance 的 graph payload 格式。
- Save 時送出前的 draft graph state 格式。
- 白板 node position 的保存策略。
