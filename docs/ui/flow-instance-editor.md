# Process Flow Instance Editor UI Design

## Route

`/flow-instance-editor`

## Purpose

建立一個 from-template process flow instance editor，讓 engineer 從既有
`ProcessFlowTemplate` 建立新的 `ProcessFlowInstance`。

此頁對應 process flow 建立模式中的 `fromTemplate`：

- 使用者選擇既有 process flow template。
- 使用者不能編輯 flow topology。
- 使用者只能填寫本次 TV/Product instance name、initial geometry selections 與各 process step instance values。
- Save 時只建立新的 process flow instance，並 append 到 local instance store。

使用者在此頁的心理模型是「我正在從標準 process flow template 建立一個具體 product / TV instance」。Template 是不可變的 topology source；此頁不修改 template，也不建立新的 template snapshot。

## Technology

- React
- TypeScript
- Next.js
- shadcn/ui
- Tailwind CSS
- lucide-react icons
- `@xyflow/react`

## Data Contract

### Storage

此頁目前使用 browser `localStorage` 作為 database substitute。未來資料來源會改為 real database / service repository；UI 行為、validation 與 saved payload shape 不應依賴 localStorage 的實作細節。

localStorage keys：

```ts
const PROCESS_STEP_TEMPLATES_STORAGE_KEY = "processStepTemplates";
const PROCESS_FLOW_TEMPLATES_STORAGE_KEY = "processFlowTemplates";
const PROCESS_FLOW_INSTANCES_STORAGE_KEY = "processFlowInstances";
const GEOMETRY_ENTITIES_STORAGE_KEY = "GeometryEntity";
```

| localStorage key | Value shape | 此頁用途 | 此頁是否寫入 |
|---|---|---|---|
| `processStepTemplates` | `ProcessStepTemplate[]` | Resolve selected flow template 的 `stepRefs[].processStepTemplateId`，並產生 step instance editor form。 | 不寫入。 |
| `processFlowTemplates` | `ProcessFlowTemplate[]` | 右上角 template selector 的資料來源。 | 不寫入。 |
| `processFlowInstances` | `ProcessFlowInstance[]` | Save 後 append 新 instance。 | 寫入。 |
| `GeometryEntity` | `GeometryEntity[]` | Geometry circle 點擊後的 geometry picker 資料來源。 | 不寫入。 |

四個 localStorage value 都是純 array，不包額外 metadata。

此頁先假設上述 localStorage key 若存在，其 JSON 格式與 schema 都正確；不需要做 malformed localStorage recovery UI。

### Save Output

Save 時建立新的 `ProcessFlowInstance`：

```ts
type ProcessFlowInstance = {
  id: string;
  name: string;
  processFlowTemplateId: string;
  stepValueSets: StepValueSet[];
};
```

Save 規則：

- `ProcessFlowInstance.processFlowTemplateId` 必須等於目前選取的 `ProcessFlowTemplate.id`。
- `ProcessFlowInstance.name` 來自上方必填的 `Product / instance name`。
- `stepValueSets[]` 只依 selected template 的 `stepRefs[]` 建立。
- 每個 `StepValueSet.stepRefId` 必須對應 selected template 的 `stepRefs[].stepRefId`。
- 每個 `StepValueSet.processStepTemplateId` 必須與 selected template 中該 step ref resolve 出來的 `processStepTemplateId` 一致。
- `fieldValues[]` 依 resolved process step template 的 `fieldDefinitions[]` 建立。
- 對 `sourceType: "geometryRef"` flow edge 對應的 target `geometryRef` field，`FieldValue.value` 保存使用者在 geometry circle 選到的 `GeometryEntity.id`。
- 對 `sourceType: "stepOutput"` flow edge 對應的 target `geometryRef` field，`FieldValue.value` 保存 `null`。
- 此頁 Save 不下載 process JSON。
- 此頁 Save 不新增或修改 `processFlowTemplates`。
- 此頁 Save 不新增或修改 `processStepTemplates`。
- 此頁 Save 不新增或修改 `GeometryEntity`。

Save 成功後留在 `/flow-instance-editor`，不自動導頁。

## Initial State

使用者一開始進入頁面時：

- 中央 graph 區為 empty state。
- 右上角顯示 template selector。
- 上方顯示 `Product / instance name` 必填欄位。
- Save disabled。
- Abort enabled 或 disabled 皆可，但若目前沒有 draft，點擊後不需要產生資料變化。

Empty state 只需要告知使用者選擇 flow template 後開始建立 instance，不提供 marketing-style landing content。

## Header

Header 需要包含：

- 左側頁面名稱，例如 `Process Flow Instance Editor`。
- `Product / instance name` 必填欄位。
- 右上角 `Process flow template` selector。
- 選到 template 後，在 selector 附近顯示 selected template name，並以小字顯示 `version`。

Template metadata 顯示只需要：

- `ProcessFlowTemplate.name`
- `ProcessFlowTemplate.version`

不需要顯示 owner、description 或完整 metadata panel。

`Product / instance name` 是 Save 必填資訊。若使用者切換 template 並確認放棄現有 draft，此欄位也會被清空。

## Template Selection

Template selector 來源為 `localStorage.processFlowTemplates`。

使用者選擇 template 後：

- 中央 graph 區立即顯示該 template 對應的 process flow graph。
- 不跳轉到其他頁面。
- 系統依 selected template 的 `stepRefs[]`、`flowEdges[]` 與 resolved process step templates 建立 draft instance state。
- `Product / instance name` 初始為空白。
- 所有 step values 初始為 default / empty values。
- 所有 initial geometry circles 初始為未選 geometry。

若使用者在已經有 draft content 時切換 template：

- 先跳出確認 dialog。
- Dialog 需清楚表示切換 template 會放棄目前填寫內容。
- 使用者確認後，清空目前 draft，包括 product / instance name、geometry selections、step field values 與 selected node/dialog state。
- 清空後載入新 template graph。
- 使用者取消時，維持目前 template 與 draft 不變。

Draft content 包含：

- `Product / instance name` 非空。
- 任一 geometry circle 已選 geometry。
- 任一 process step field value 被修改。

## Layout

中央 graph 使用 left-to-right dataflow layout。Graph 是靜態 topology view：使用者可以 pan / zoom，但不能拖動 node、建立 edge、刪除 edge、reconnect edge 或修改 topology。

此 layout 未來也會套用到 custom flow editor / process flow editor，作為 flow graph 自動排版規則。

### Visual Model

- 圓形 node 代表 initial geometry selection。
- 方形 node 代表 process step。
- Edge 代表 geometry state flow。
- 所有主要方向都由左到右。
- 同一層級或相近 processing depth 的 node 以 column 對齊。
- 不顯示額外 vertical stage guide lines；column alignment 是 layout 行為，不是 visible UI element。

### Longest Path Main Axis

Layout 以 DAG 中最長 path 作為 main axis。

Main axis 規則：

- 找出 selected template graph 中 step 數最多的 directed path。
- 若有多條同長 path，使用 deterministic tie-breaker，例如依 path 中 step ref id lexical order 或 template `stepRefs[]` order。
- Main axis 放在畫面中心 lane。
- Main axis nodes 由左到右排列。
- Merge 後的 downstream steps 繼續沿 main axis 往右排。

### Branch Lanes

非 main-axis flow 視為 branch。

Branch lane 規則：

- Branch 可以放在 main axis 上方或下方。
- Branch nodes 仍然由左到右排列。
- Branch 應盡量保持水平，不因為 merge edge 斜率而讓 node 上下跳動。
- Branch lane 分配優先減少 edge crossing，其次縮短 merge edge 長度。
- 多條 branch 可上下分配，保持 main axis 清楚可讀。
- Branch 匯入 main axis 或其他 branch 的 merge step 時，edge 可以彎折，但 node 位置仍維持 lane 排列。

### Columns And Rank

Node 的 x position 由 graph rank / processing depth 決定。

Rank 規則：

- Initial geometry circle 放在其 target step 前一個 column。
- Process step 的 rank 由 upstream dependency 推導。
- 若 step 有多個 incoming edges，其 rank 必須大於所有 upstream process step 的 rank。
- 同 rank 的 process steps 使用同一 column x position。
- 不因 array order 表示 process order；真正順序只由 `flowEdges[]` 決定。

### Merge Points

Merge step 是具有多個 incoming geometry edges 的 process step。

Merge layout 規則：

- 若 merge step 位於 main axis，保留在 main axis lane。
- Branch edge 匯入 merge step 的 target geometry input slot。
- 多個 incoming edges 可以從上方、下方或左方進入同一 merge step。
- Merge step 後若有 downstream step，downstream step 繼續沿 merge step 所在 lane 往右。

### Geometry Source Nodes

每一條 `flowEdges[]` 中 `source.sourceType === "geometryRef"` 的 edge 會產生一個獨立 initial geometry circle。

Geometry source node 規則：

- Initial geometry circle 是 UI draft node，不是 persisted template node。
- 每個 initial geometry circle 對應一條 geometryRef source edge。
- Initial geometry circle 點擊後開啟 geometry picker。
- 使用者選到的 `GeometryEntity.id` 寫入該 edge target step 對應的 `FieldValue.value`。
- Initial geometry circle 不支援 fan-out。
- Initial geometry circle 不可拖動。

## Graph Interaction

此頁 graph 是 from-template static graph，不是 topology editor。

允許：

- Pan / zoom。
- Fit view。
- 點擊 initial geometry circle 開啟 geometry picker。
- 點擊 process step node 開啟 step instance editor dialog。
- 點擊 process step output edge 中間的 geometry preview button。

不允許：

- 拖動 node。
- 新增 node。
- 刪除 node。
- 建立 edge。
- 刪除 edge。
- Reconnect edge。
- 修改 target geometry input slot。
- 修改 `ProcessFlowTemplate.stepRefs[]` 或 `flowEdges[]`。

## Node Status

為了讓使用者知道哪些資訊還沒有填完，graph node 以 border color 表示 completion status。

Initial geometry circle：

- 橘色框：尚未選 geometry。
- 綠色框：已選 geometry。

Process step node：

- 橘色框：該 step 的 required field values 尚未完成。
- 綠色框：該 step 的 required field values 已完成。

此頁沒有 custom editor 的紅色 outside-flow state，因為 topology 來自 selected template，所有 template step 都屬於目前 flow。

## Geometry Picker

使用者點擊 initial geometry circle 時開啟 geometry picker。

Picker 行為：

- 資料來源為 `localStorage.GeometryEntity`。
- 依 `GeometryEntity.category` 分組或提供可搜尋列表。
- 每個 geometry item 顯示 `name`、`version`、`id`，以及必要摘要資訊。
- 使用者選取 geometry 後，該 geometry circle 顯示 selected geometry 的主要名稱。
- 該 target geometryRef `FieldValue.value` 更新為 selected `GeometryEntity.id`。
- Picker 關閉不 rollback 已選結果。

若 `GeometryEntity` 不存在或為空陣列：

- Picker 顯示 empty state。
- 使用者無法完成 initial geometry selection。
- Save disabled。

## Geometry Preview

每個 process step output edge 中間提供一個圓形 geometry preview button，風格與 `/flow-template-editor` 的 geometry view button 一致。

Initial geometry circle 本身代表 initial geometry state，因此 initial geometry circle 到第一個 process step 的 edge 不需要額外 geometry preview button。

使用者點擊 geometry preview button 時：

- 開啟 geometry view dialog。
- Dialog 顯示在 graph 上方，背景遮罩變暗。
- 支援 close button 與 Escape 關閉。
- Geometry kernel 尚未接入時，dialog body 顯示：

```text
geometry is not supported now
```

## Step Instance Editing

使用者點擊 process step node 時，開啟 step instance editor dialog。

Step dialog 沿用 custom editor 的 step instance dialog 行為與 field controls：

- 依 `ProcessStepTemplate.fieldDefinitions[]` 動態產生 fields。
- 支援 text、number、checkbox、select、repeater。
- 支援 fieldGroupArray repeater 的 add/remove item 與 child fields。
- 欄位編輯採用 live update。
- 關閉 dialog 不 rollback 已編輯 values。
- 全頁 Save 才是將 draft instance 寫入 localStorage 的動作。

此頁 step dialog 不提供 geometryRef field picker。所有 geometryRef 欄位由 graph topology 與 initial geometry circle 管理。

Step dialog 內可顯示 read-only input mapping：

- `geometryRef` field 由 initial geometry circle 提供時，顯示 selected geometry 或未選狀態。
- `geometryRef` field 由 upstream step output 提供時，顯示 graph-provided mapping，並說明 saved `FieldValue.value` 為 `null`。
- 不提供 unlink、change source 或 geometry picker 操作。

## Completion And Validation

Save button 只有在所有 required data complete 時 enabled。

Save disabled 條件包含：

- 尚未選擇 process flow template。
- `Product / instance name` 為空白。
- 任一 initial geometry circle 尚未選 geometry。
- 任一 selected geometry id 不存在於 `GeometryEntity[]`。
- 任一 template `stepRefs[].processStepTemplateId` 無法 resolve 到 `processStepTemplates[]`。
- 任一 flow edge target step ref 不存在。
- 任一 flow edge target field id 不存在於 target process step template。
- 任一 flow edge target field 不是 top-level `valueType: "geometryRef"` field。
- Template graph 有 cycle。
- 任一 target geometryRef field 有多條 incoming edges。
- 任一 process step required field 尚未 complete。

Field completion 規則以 `docs/data-model.md` 的 `FieldDefinition`、`StepValueSet` 與 `FieldValue` 定義為準。

Top-level `geometryRef` completion 規則：

- 若 incoming edge source 是 `geometryRef`，使用者必須在對應 initial geometry circle 選到明確 `GeometryEntity.id`。
- 若 incoming edge source 是 `stepOutput`，該 field 的 `FieldValue.value` 保存 `null`，且 upstream step 必須 complete。
- 此頁不支援沒有 incoming edge 的 template geometryRef field；若 template 中存在這種情況，視為 template validation error，Save disabled。

## Status Strip

Header 或 graph 上方需要提供 status strip，讓使用者知道目前 draft 狀態。

Status strip 至少顯示：

- selected template 狀態。
- `flow steps` count。
- `initial geometries` count。
- completion summary，例如 `8 / 12 steps complete`。
- 主要 validation message，或 `Ready to save`。

Validation message 優先順序：

1. Template 尚未選擇。
2. Product / instance name required。
3. Template resolve / schema error。
4. Initial geometry 尚未選取。
5. Step required field 尚未完成。
6. 全部檢查通過時顯示 `Ready to save`。

## Save And Abort

Save button：

- 固定放在右下角。
- 所有 validation 通過後變亮 / enabled。
- 點擊後 append 新 `ProcessFlowInstance` 到 `localStorage.processFlowInstances`。
- Save 成功後留在目前頁面。
- Save 不下載 process JSON。

Abort button：

- 固定放在右下角，與 Save button 相鄰。
- 表示放棄本次編輯。
- 點擊後留在目前頁面，清空所有 draft content。
- 清空內容包含 selected template、product / instance name、geometry selections、step field values、open dialogs 與 validation state。
- Abort 不寫入 localStorage。

## Responsive Behavior

桌面版以 header + large graph workspace 為主。

窄螢幕時：

- Header controls 可換行。
- Template selector 與 product / instance name 欄位保持可操作。
- Graph 區保留 pan / zoom。
- Dialog width 使用 viewport-relative constraint，避免欄位被裁切。
- Save / Abort 保持在可見位置或固定於 bottom action bar。

## Implementation Notes

此文件只定義 from-template instance editor UI。實作時可以重用 custom editor 中的以下能力：

- `@xyflow/react` graph rendering。
- Process step node styling。
- Edge geometry preview button。
- Step instance dialog primitive field controls。
- Field completion / validation helper。
- localStorage array read/write helper。

但此頁需要與 custom editor 區分：

- 不提供 geometry palette drag/drop。
- 不提供 process step template palette。
- 不提供 node movement。
- 不提供 edge connect / reconnect / delete。
- 不新增 process flow template。
- 不 export process JSON。
