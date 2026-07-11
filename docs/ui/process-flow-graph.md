# Process Flow Graph

Shared component：

```text
apps/viewer/components/process-flow-graph/process-flow-graph.tsx
```

## Modes

```ts
type ProcessFlowGraphMode = "edit" | "view";
```

- `edit`：nodes draggable/connectable，edge / node delete controls 可見。
- `view`：topology read-only；double click input 選 geometry、double click step 開 values。

Flow Template Editor 使用 edit mode，template 保存後切到 view mode。Flow Instance
Workspace 永遠使用 view mode。

## Node Types

### flowInput (UI: Geometry Input)

代表 `ProcessFlowTemplate.flowInputs[]`，只有 source handle：`out`。

Node data 可包含：

```ts
{
  nodeKind: "flowInput";
  displayLabel: string;
  displaySublabel?: string;
  icon?: string;
  iconScale?: number;
  status: "neutral" | "ready" | "incomplete" | "error";
}
```

Template edit mode 顯示 definition identity 與 working binding status。Instance view mode 顯示
resolved catalog / embedded geometry 與 binding status。Required input 未綁定時是橘色
`Unbound`，optional unbound 是灰色，binding 無法 resolve 或不符合 constraints 時是紅色。

### processStep

代表 `stepRefs[]` 與 resolved `ProcessStepTemplate`。Target handles 直接以
`inputPorts[].portId` 建立；source handle 使用 `result_geometry`。

```ts
{
  nodeKind: "processStep";
  stepRefId: string;
  geometryInputPorts: Array<{ id: string; name: string }>;
  outputPortId: "result_geometry";
}
```

Node status：

- `error`：topology、reference 或 geometry constraint 無效。
- `incomplete`：required geometry binding、upstream step 或 parameters 尚未 complete。
- `ready`：完整 upstream closure 可執行與 preview。
- `neutral`：optional 且未參與 execution readiness。

Step status 使用完整 upstream closure，不只檢查自己的 parameters。缺少的 Geometry Input
或 upstream parameter 會讓所有受影響的 downstream steps 維持橘色。

## Edge Type

所有 edges 使用 `dataFlow`：

```ts
{
  sourceKind: "flowInput" | "stepOutput";
  targetStepRefId: string;
  targetInputPortId: string;
  slotLabel: string;
  sourceLabel: string;
  status: "neutral" | "ready" | "incomplete" | "error";
}
```

Edge 顏色和 source execution readiness 一致：灰色 neutral、橘色 incomplete、綠色
ready、紅色 error。

React Flow internal node ids / handle ids 只用於畫面。Persist 時 editor 依 source / target
node data 建立 V2 `FlowEdge` discriminated union。

## Connection Rules

Editor 在建立 edge 前檢查：

- target 必須是 process step input handle；
- target port 尚未有 source；
- source step 不可等於 target step；
- step output 不可 fan-out；
- 新 edge 不可形成 cycle。

API / compiler 會重做 authoritative validation。

## Preview Controls

- Step-output edge label 可顯示 preview icon。
- Terminal step output 右側可顯示 final preview icon。
- Geometry Input preview 從 selected node dialog 啟動。
- Preview disabled reason 來自 upstream configuration completeness。

Preview step 只要求 target upstream closure complete，不要求不相關 branch complete。

## Layout

Persisted template 不保存 UI coordinates。`computeTemplateLayout()`：

1. 以 step-output edges 計算 rank。
2. 找 longest path 作為 main lane。
3. 其他 branches 分配上下 lanes。
4. Geometry Inputs 放在第一個 target 左側。
5. Normalize min X / Y，避免 node 超出 viewport。

Template Editor 新增 / drag nodes 時保留 local position；重新開啟 immutable template 時
重新計算 layout。

## Responsive Behavior

Graph 本身維持固定 interaction dimensions，並提供 pan、zoom、fit view 與 minimap。
Mobile 不縮放 font-size；由 fit view 顯示 topology，使用者可放大與平移。
