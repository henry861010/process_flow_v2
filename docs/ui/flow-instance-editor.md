# Flow Instance Workspace UI

Route：`/flow-instance-editor`

## Purpose

從既有 immutable `ProcessFlowTemplate` 建立 mutable
`ProcessFlowWorkspace`，完成 geometry bindings 與 process parameters 後 commit 成新
immutable `ProcessFlowInstance`。

此頁不支援：

- 修改 topology；
- 從既有 instance clone；
- overwrite instance；
- draft list；
- embedded geometry creation tools。

## Entry States

### New workspace

1. 使用者從 header 選擇 flow template。
2. UI 以 template 的 `flowInputs`、`stepRefs`、`flowEdges` 建立 read-only graph。
3. UI 以 step template definitions 建立 default `FlowConfiguration`。
4. Workspace 尚未 POST 前沒有 workspace id。

### Reload workspace

URL：

```text
/flow-instance-editor?workspaceId=workspace_123
```

UI 同時讀取 bootstrap 與 workspace，依 `processFlowTemplateId` resolve template，並
merge 缺少的 default step configurations。Workspace 不保存 topology。

Committed workspace reload 後所有 configuration controls read-only。

## Layout

- Header：workspace / template / instance identity fields、New、Reload、Save Draft、
  Commit Instance。
- Main area：full-width read-only process flow graph。
- Node dialog：點擊 Geometry Input 或 process step 後編輯 binding 或 parameter values。
- Modal：catalog geometry picker。
- Overlay：geometry preview 與 export jobs。

Desktop 與 mobile 都讓 graph 保留 pan / zoom controls；mobile 將 header fields 依序換行。

## Geometry Inputs

每個 `flowInputs[]` 在 UI 顯示為 Geometry Input node。點擊 node 後 dialog 提供：

- catalog geometry selection；
- clear binding；
- preview selected input；
- Geometry Input description 與 required status。

Required Geometry Input 未綁定時顯示橘色 `Unbound`，並讓 downstream path 維持橘色。
Optional unbound input 顯示灰色；只有 binding 可 resolve 且符合 constraints 時轉為綠色。

Geometry picker 依 `geometryConstraints` 過濾：

- `entityTypes`
- category exact / descendant match
- `structureFormats`

目前 UI 只建立 `{ kind: "catalog", geometryId }` binding。Backend 可讀取已存在的
embedded binding，並能在 commit 時 materialize。

## Step Parameters

點擊 process step 後，dialog 依
`ProcessStepTemplate.parameterDefinitions[]` render controls：

- string / material ref；
- integer / float；
- boolean；
- static single / multiple options；
- arrays；
- coordinate list；
- recursive repeatable groups。

Repeater values 保存為：

```json
{
  "items": [
    {
      "itemId": "stable-id",
      "index": 1,
      "values": {}
    }
  ]
}
```

## Save Draft

第一次 Save Draft：

```http
POST /api/process-flow-workspaces
```

成功後 URL 以 `router.replace` 加入 `workspaceId`。後續 Save Draft：

```http
PUT /api/process-flow-workspaces/{workspaceId}
```

Request 帶目前 revision；成功後 revision 加一。UI 只有 dirty state 才啟用 Save
Draft。Draft 可以缺少 required bindings / parameters，但已存在的 value shape 必須合法。

頁面在 dirty state 註冊 `beforeunload` protection。Reload button 從 API 重新讀取最後
saved revision；stale update 顯示 `409` error，再由使用者 reload。

## Commit Instance

Commit button 只有在以下條件成立時啟用：

- workspace 已保存；
- 沒有 unsaved changes；
- bindings 與 parameter values complete；
- values 通過 type、numeric、string、coordinate 與 repeater validation；
- instance id / name 已填；
- instance id 未存在。

```http
POST /api/process-flow-workspaces/{workspaceId}/commit
```

Commit 成功後：

- workspace status 顯示 `committed`；
- revision 加一；
- graph configuration controls 鎖定；
- Save Draft / Commit disabled；
- immutable instance id / name 保留並可在 refresh 後 resolve。

## Preview

Geometry Input preview target：

```json
{ "type": "flowInput", "flowInputId": "incoming_panel" }
```

Step output preview target：

```json
{
  "type": "stepOutput",
  "stepRefId": "molding",
  "outputPortId": "result_geometry"
}
```

Step preview button 只有在該 target 的 upstream closure complete 時啟用；其他 branch
不會阻擋 preview。
