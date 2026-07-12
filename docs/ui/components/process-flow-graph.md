---
title: Process Flow Graph
status: normative
owner: Process Flow UI
audience:
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - apps/viewer/components/process-flow-graph/process-flow-graph.tsx
  - apps/viewer/lib/process-flow/template-layout.ts
  - apps/viewer/lib/process-flow/readiness-presentation.ts
---

# Process Flow Graph

## 元件契約

`ProcessFlowGraph` 是基於 React Flow 的 shared topology surface。

```ts
type ProcessFlowGraphMode = "edit" | "view";
type ProcessFlowGraphStatus = "neutral" | "ready" | "incomplete" | "error";
```

- `edit`：node draggable/connectable，edge/node delete controls可用。
- `view`：topology read-only，但 screen-level單擊 node仍開啟 binding/parameter dialog。

Template Editor在保存前用 edit、保存後用 view；Instance Editor永遠 view。

## Canvas 規格

| Property | Default |
| --- | --- |
| Surface | flex fill、`min-height:0`、relative |
| Grid | 32px square、teal low-opacity lines |
| React Flow Background | color `rgba(15,118,110,.18)`、gap `32` |
| Zoom | min `0.35`、max `1.4`；Instance覆寫 `0.28/1.45` |
| Controls | bottom-left |
| MiniMap | bottom-right、pannable、zoomable；default visible |
| Edge | Bezier、2.5px stroke、arrow marker由screen傳入 |

MiniMap node color：ready `#10b981`、incomplete `#f59e0b`、error `#dc2626`、neutral
`#94a3b8`。

## Geometry Input node 規格

代表 `flowInputs[]`，只有右側 source handle `out`，handle `16×16px`、2px white border、
primary fill。

| Variant | Edit | View |
| --- | --- | --- |
| Icon available | `132×132px` mask container | `138×138px`、pointer、hover shadow |
| Icon missing | same size round card、4px status border | `138×138px` round card |
| Label width | `132px` | `138px` |
| Status badge | hidden | `Bound/Unbound/...` visible |

Node能解析到已綁定的geometry時，primary label MUST 顯示 `geometry.name`，secondary label
顯示 Flow Input name。未綁定或binding指向無法解析的geometry時，primary label MUST 回退顯示
Flow Input name，secondary label顯示目前的readiness提示。Template與Instance graph MUST 使用相同規則。

Icon path由 dotted key轉成 `/resources/icons/<encoded segments>.svg`；default `iconScale=0.8`，
合法範圍 `(0,1]`。load失敗回退 round `CircleDot` card，不留破圖。

Status：ready emerald、incomplete amber、error destructive、neutral muted。Edit mode hover右上顯示
28px delete circle；view mode不顯示delete。

## Process Step node 規格

代表 resolved `stepRef + ProcessStepTemplate`。

| Property | Edit | View |
| --- | --- | --- |
| Width | `248px` | `252px` |
| Border | 2px status color | 同左 + pointer/hover shadow |
| Header | muted/40、padding `12px 8px` | 同左 |
| Footer | padding `12px 8px`、version + status badge | 同左 |
| Hover actions | Edit 28px、Delete 28px | none |

每個 input port在左上 `12px` 起垂直排列、gap `8px`；target handle 16px、cyan-600、white
border。Hover/focus/active connection時顯示 max-width `150px` port tooltip，z `20`。右側source
handle ID是 `result_geometry`。

Terminal step可在右側用 20px connector接 32px Eye button，z `20`。Disabled仍顯示但muted；
title/aria-label是第一個 blocking reason。

## Data Flow edge 規格

Label在Bezier midpoint，內容依序：optional 32px Preview、slot label、edit-only 24px Delete。
Label max-width edit `120px`、view `132px`。Edge interaction width edit 18px、view 16px。

| Status | Stroke | Label border |
| --- | --- | --- |
| ready | emerald-500 | emerald-200 |
| incomplete | amber-500 | amber-300 + amber text |
| error | destructive | destructive/30 + destructive text |
| neutral | muted-foreground/45 | muted-foreground/20 |

Selected edge stroke primary。Preview按鈕只對 step output source render；flow input preview由
inspector啟動。

Edit mode從已有consumer的source handle開始拖曳時，既有edge stroke暫時改為muted灰色；
若新連線成功落在另一個input，既有edge由screen state移除。拉回原target或取消拖曳不新增、
不刪除edge，原有status stroke恢復。

## 互動優先順序

1. Screen傳入的 `onNodeClick` 是 primary：**單擊**選取並開 editor。
2. View node 內部 `onDoubleClick` 仍呼叫 `onPick/onEdit`，只作 legacy fallback。
3. 單擊pane清 selection。
4. Node內 command先 `stopPropagation`，不得同時觸發screen node click。

Shared component不得把 double-click變成唯一操作。Geometry/step card本體目前不是 native button；
target rebuild SHOULD 讓view node keyboard focusable並以 Enter觸發同一 single-click action，且不得
破壞React Flow drag semantics。

## 連線規則（edit）

Connection validator MUST 在client先拒絕：

- target不是 Process Step input handle；
- self-loop；
- 新edge形成cycle；
- handle ID不在 resolved `inputPorts`。

Connection commit MUST 保持每個source output與target input各最多一條edge。若source output已有
outgoing edge，或target input已有incoming edge，新edge成功commit時 MUST 原子式移除衝突edge
再新增新edge；使用者不需先手動刪除。Cycle validation MUST 以移除這些衝突edge後的候選graph
計算。此source規則同時適用flow input的`out`與process step output handle。

API/compiler仍是authoritative。Persist時不得保存 React Flow internal node ID/coordinates；轉成
`FlowEdge` discriminated source/target。

## 自動版面配置

Immutable template重新開啟時用 `computeTemplateLayout()`：rank依 step-output edges、longest path
作main lane、branches上下分配、flow inputs放第一個target左側、最後normalize正座標。新增/拖動
期間使用local position；不把position存進domain model。

## 狀態矩陣

| Node/edge status | Meaning | Copy fallback |
| --- | --- | --- |
| `ready` | target upstream closure可執行 | `Ready` / geometry `Bound` |
| `incomplete` | required binding/parameter/upstream未完成 | `Incomplete` / `Unbound` |
| `error` | topology/reference/value invalid | `Invalid` |
| `neutral` | optional且未參與 | `Optional` |

Screen提供的 `statusLabel`優先於fallback。Status不可只靠border color。

## 響應式與 accessibility

- Node/font尺寸固定；小viewport靠 fitView、zoom、pan，不縮字。
- React Flow Controls與MiniMap保留。
- Port tooltip同時支援 hover與focus-within；handle本身的keyboard可達性依React Flow。
- Eye/Delete/Edit icon command MUST 有 accessible name；edge Preview現行只有title，target補
  `aria-label`。

## 測試 fixture

使用 `flow_tpl_cowosl_demo_2_0_0`；至少涵蓋一個ready、一個incomplete、一個error、一個
neutral node/edge的isolated component fixture。這是既有 fixture 的 opaque id；數字尾碼
不表示產品版本，也不能用來切換行為。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-GRAPH-001` | view node single-click | screen editor開啟。 |
| `UI-GRAPH-002` | view node double-click | 相同action最多執行一次有效結果，不成為primary requirement。 |
| `UI-GRAPH-003` | icon URL 404 | round fallback render，console warning每URL最多一次。 |
| `UI-GRAPH-004` | 已有consumer的source連到另一input | 拖曳時原edge變灰；commit後原edge由新edge取代。 |
| `UI-GRAPH-005` | terminal incomplete/ready | Eye同位置，disabled reason或Preview action正確。 |
| `UI-GRAPH-006` | 390px container | labels保持字級，可pan/zoom，canvas不擴張document。 |
| `UI-GRAPH-007` | 新edge接到occupied target | 原incoming edge由新edge取代，不需先delete。 |
| `UI-GRAPH-008` | replacement會形成cycle | rejected，graph state不變。 |
