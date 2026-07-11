# Geometry Preview

## Shared Contract

Template Editor 與 Instance Workspace 使用相同 preview API：

```http
POST /api/geometry-preview
```

Request：

```json
{
  "target": {
    "type": "stepOutput",
    "stepRefId": "molding",
    "outputPortId": "result_geometry"
  },
  "sourceLabel": "molding",
  "processFlowTemplateId": "flow_tpl_cowosl_2_0_0",
  "configuration": {
    "inputBindings": {},
    "stepConfigurations": {},
    "embeddedGeometries": {}
  }
}
```

Exactly one template source is required：

- persisted template：`processFlowTemplateId`
- unsaved Template Editor draft：inline `flowTemplate`

Inline draft 的 topology identifiers 必須有效，但尚未保存的 template identity 可以是
`id: ""`。這只適用於 preview request；`POST /api/process-flow-templates` 仍要求非空 id。

## Targets

Flow input：

```json
{ "type": "flowInput", "flowInputId": "incoming_panel" }
```

Step output：

```json
{
  "type": "stepOutput",
  "stepRefId": "molding",
  "outputPortId": "result_geometry"
}
```

## Runtime

### Flow input target

1. Resolve catalog or embedded binding。
2. Validate geometry constraints。
3. Normalize geometry structure。
4. Export GLB。

Kernel 不執行任何 step。

### Step output target

1. `FlowCompiler` 計算 target upstream closure。
2. Validate closure 需要的 bindings / parameters。
3. Resolve full external geometry structures。
4. Build partial `ExecutionPlan`。
5. `GeometryKernel` execute 到 target step。
6. Export target geometry as GLB。

## Response

```json
{
  "geometryEntityJson": {
    "id": null,
    "category": "preview.generated",
    "entityType": "preview",
    "name": "Preview - molding",
    "structureFormat": "standard",
    "structure": {}
  },
  "glbBase64": "..."
}
```

`GeometryPreviewPanel` 顯示 CAD scene、feature overlays、section controls 與 export
actions。Preview payload 不會寫入 geometry catalog。

## Availability

UI 在 request 前檢查 target closure：

- required flow input binding 已 resolve；
- supplied binding 符合 constraints；
- required step parameters type / validation complete；
- repeat item counts 與 nested values complete。

Disabled preview control 使用 title 顯示第一個 blocking reason。

## Export

Preview response 可建立 background export jobs：

- JSON geometry entity
- STEP
- CDB

Export job UI 與 flow editors 解耦；關閉 preview 不會取消既有 job。
