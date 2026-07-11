# Flow Template Editor UI

Route：`/flow-template-editor`

## Purpose

建立 immutable `ProcessFlowTemplate` topology，並可在同一畫面準備一份 working
configuration 供 preview 或建立第一個 `ProcessFlowInstance`。

## Model Separation

Editor 同時維護兩份 state：

1. Template draft：metadata、Geometry Input (`flowInput`) definitions、step refs、edges。
2. Working `FlowConfiguration`：input bindings、step parameter values、embedded map。

Save Template 只送出第一份。Geometry selection 與 parameter values 不會被寫入 flow
template。

## Layout

- Header：template / instance identity fields、copy-existing selector、New、Save Template、
  Save Template & Instance。
- Left library：依 category drill-down 的 catalog geometries。
- Center：editable React Flow graph。
- Right library：依 category drill-down 的 process step templates。
- Node dialog：點擊 Geometry Input 或 process step 後編輯 definition、binding 或 parameters。

Mobile 依序排列 header、geometry library、graph、process step library，整頁可捲動。

## Topology Editing

### Add Geometry Input

- New Template 預設是空白 canvas，不會自動建立 Geometry Input。
- Drag catalog geometry 到 canvas，建立 `flowInput` definition，並只在 working configuration
  加入 catalog binding。

點擊 Geometry Input node 開啟 dialog，可編輯：

- `flowInputId`
- name / description
- required
- geometry constraints
- working catalog binding

### Add step

按或 drag process step template 到 canvas，建立；點擊已建立的 step node 會開啟
parameter dialog：

```json
{
  "stepRefId": "molding",
  "stepLabel": "molding",
  "processStepTemplateId": "step_tpl_molding_2_0_0"
}
```

Step input handles 直接來自 `inputPorts[]`，output handle 是
`result_geometry`。Geometry 不會出現在 parameter editor。

Step dialog 內提供 Preview action。只有 target upstream closure 的 geometry bindings 與
parameters complete 時啟用；disabled control 的 tooltip 顯示第一個 blocking reason。

### Connect edge

有效 connection：

- source 是 Geometry Input (`flowInput`) 或 process step output；
- target 是 process step input port；
- target port 尚未有 incoming edge；
- step output 尚未有 consumer；
- 不會形成 self-loop 或 cycle。

Delete node 同時刪除相關 edges 與 working configuration entry。

## Validation

Save Template 需要：

- template id / name / version / owner；
- 至少一個 Geometry Input 與 process step；
- unique identifiers；
- 所有 declared Geometry Inputs 被連接；
- 所有 required step input ports 被連接；
- graph acyclic；
- 每個 step output 最多一個 consumer。

Working configuration 不完整不會阻擋 Save Template。

## Save Paths

### Save Template

```http
POST /api/process-flow-templates
```

成功後：

- topology 與 template metadata 鎖定；
- 兩側 library 與 edge editing disabled；
- working geometry / parameters 保持可編輯；
- primary action 改為 `Save Instance`。

### Save Template & Instance

Template 尚未保存且 working configuration complete 時：

```http
POST /api/process-flow-template-instances
```

API 在同一 transaction insert template 與 instance。任一 insert / validation 失敗時
兩者都不保存。

### Save Instance after template save

```http
POST /api/process-flow-instances
```

Instance id 必須新且 configuration complete。此路徑不建立 workspace；一般後續產品
study 使用 Flow Instance Workspace。

## Copy Existing Template

Header selector 載入既有 immutable topology 作為 copy：

- 新 draft 的 template id 清空；
- metadata、Geometry Inputs、steps、edges 複製；
- graph 以 computed layout 建立；
- working configuration 使用 defaults；
- required Geometry Input 尚未 binding 時以橘色 `Unbound` 顯示；
- 原 template 不會被 update。

Selector 顯示 name、version 與 id，以區分同名 revisions。
