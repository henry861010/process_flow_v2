---
title: Flow Template Editor
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx
  - apps/viewer/components/process-flow-graph/process-flow-graph.tsx
  - apps/viewer/lib/process-flow/configuration.ts
---

# Flow Template Editor

Route：`/flow-template-editor`

## 目的與 state ownership

本頁同時維護兩個清楚分離的 draft：

1. `ProcessFlowTemplate` topology：identity、`flowInputs`、`stepRefs`、`flowEdges`。
2. Working `FlowConfiguration`：catalog bindings、step parameter values、embedded map。

`Save Template` 只保存 1；`Save Template & Instance` 同 transaction 保存 template 與
configuration產生的 immutable instance。Template 保存後 topology locked，但 working
configuration MUST 繼續可編輯與 Preview。

## Reconstruction entry

1. reset API data 後直接開 `/flow-template-editor`，不選 template、不新增 node。
2. 等待 bootstrap 完成，確認 header fields、Geometry library、Process step templates 與 `Empty flow`。
3. 用 Step palette click-add 一個 step；再用 Geometry palette drag 建立 flow input。
4. 建立 valid topology 後開 node inspector，確認單擊即可進入 editor。
5. 以 incomplete configuration 執行 Save Template，確認 topology locked 但 binding/parameters 仍可編。

Compact review 必須額外在 `1024×768` 檢查 right pane 是否裁切，並標記
`UI-GAP-RESP-001`；`390×844` 的 Geometry touch/keyboard add 必須標記
`UI-GAP-DRAG-001`，不可用 Step click-add 取代該 failure path。

## App shell 與尺寸

| Area | `<1024px` | `>=1024px` |
| --- | --- | --- |
| Main | document flow、`min-height:100vh` | `height:100vh`、`min-height:760px`、overflow hidden |
| Header | natural wrapped height | fixed content height、不可捲動 |
| Main grid | one column | `280px minmax(540px,1fr) 320px` |
| Geometry pane | min-height / internal list `240px` | 280px wide，list `calc(100%-49px)` vertical scroll |
| Graph | min-height `560px` | flex fill、min-height 0 |
| Step pane | min-height / internal list `280px` | 320px wide，list `calc(100%-49px)` vertical scroll |

`1024px` 正好進入三欄，但最小總欄寬是 `1140px`；現況 shell會裁切 overflow，這是
`UI-GAP-RESP-001`，不是可任意忽略的設計自由度。

Header white、bottom border、`20px` horizontal/`12px` vertical。第一列左側：
`GitBranch`、`Process Flow Template Editor`、subtitle
`Create a process topology and its initial instance configuration.`；右側 command可 wrap。

### Header command 順序

1. `ArrowLeft` + `Home`（small outline）
2. `Start from template...` select，width `220px`
3. `Plus` + `New`
4. `Save` + `Save Template`
5. `GitBranch` + `Save Template & Instance`；保存 template 後變 `Save Instance`

### Field grids 規格

第一組在 `xl` 以上為 `minmax(180px,1.1fr) minmax(180px,1fr) 110px
minmax(150px,.8fr) minmax(220px,1.4fr)`；`<1280px` 是兩欄：

| Field | Required | Default | Locked after template save |
| --- | --- | --- | --- |
| `Template name` | yes | empty | yes |
| `Template id` | yes，ID regex | empty | yes |
| `Version` | yes | `current`；只是 opaque metadata label | yes |
| `Owner` | yes | empty | yes |
| `Description` | no | empty | yes |

第二組在 `xl` 以上是 `1fr 1fr 1.4fr`，否則兩欄：`Instance name`、`Instance id`、
inline status box。Instance fields在 topology locked 後仍可編輯。

Header下另有高度至少 `36px` 的 full-width status strip；這會與 inline status box重複，
重建 baseline MUST 保留兩處，除非另案簡化。

## Library 與 graph

兩側 pane header高度 `48px`、horizontal padding `12px`：

- 左：`Boxes` + `Geometry library`
- 右：`FileJson` + `Process step templates`

內容 padding `12px`，使用 [Category Library](../components/category-library.md)。Geometry
card 是 drag-only；Step card可 click-add或drag。Topology locked 時兩側 disabled、opacity
`0.5`，Step title 變 `Topology is locked`。

Graph 使用 [Process Flow Graph](../components/process-flow-graph.md)；fresh state中央顯示
`Workflow` 28px + `Empty flow`。單擊 node MUST 開 Node Editor。

### Topology actions

| Action | Rule |
| --- | --- |
| Drop Geometry | 新增 `flowInput` definition；working config 同時綁該 catalog geometry。 |
| Add/Drop Step | 新增 `stepRef`、default step config；ID由 template name slug後去重。 |
| Connect | target是step input、target未占用、step output未被消費、非self/cycle。 |
| Delete node | 刪 node、相關 edges與對應 configuration entry。 |
| Delete edge | 只在edit mode顯示；不改 parameter values。 |

## Node Editor dialogs

共用 shell：fixed `z=50`、16px page margin、max height `100vh-32px`、width
`min(920px,100vw-32px)`；body是唯一 vertical scroll owner。Close、Escape、backdrop都關閉。

### Geometry Input inspector

| Section | Controls/copy | Topology locked |
| --- | --- | --- |
| Identity | `Input id`*、`Name`*、`Description`、`Required` | disabled |
| Constraints | `Entity types`、`Categories`、`Structure formats`；comma split/trim | disabled |
| Instance Binding | badge `Catalog`/`Missing`、selected geometry card、`Select`、`Preview`、`Clear` | 保持可用 |
| Header action | delete icon | hidden |

`Preview` 只在 geometry resolved 時 enabled。Binding selector dialog width
`min(820px,100vw-32px)`，matching geometries依 constraints過濾、desktop兩欄；click card後
立即選定並關閉 picker。

### Process Step inspector

顯示 `Process Step`、monospace `stepRefId`；右側 `Preview` 與 unlocked-only delete。

| Section | Behavior |
| --- | --- |
| `Step label` | topology unlocked可編，locked後disabled。 |
| Template card | name + template ID，read-only。 |
| `Input Ports` | 每列 `Mapped`、`Required` 或 `Optional` badge。 |
| `Parameters` | [Parameter Editor](../components/parameter-editor.md)，topology locked仍可編 working values。 |

Step Preview enabled 只依 target upstream closure readiness；不相關 branch不得阻擋。
Disabled wrapper title顯示第一個 reason。

## Save 與 action 矩陣

| Action | Enabled when | Success state/copy |
| --- | --- | --- |
| `New` | 非 busy | 清 metadata/config/nodes/edges/saved state。 |
| Start from template | topology unlocked、非 busy | clone topology、identity copied後 `id` empty、default configuration、computed layout。 |
| `Save Template` | hydrated、unlocked、非 busy、topology valid、template ID unique | `Template <id> saved. Topology is now locked.` |
| `Save Template & Instance` | 上述 topology條件 + configuration complete + instance identity + ID unique | `Template <id> and instance <id> saved.` |
| `Save Instance` | template已保存 + complete/unique identity | `Instance <id> saved.` |
| Preview input/step | resolved input或ready closure | 共用 Geometry Preview。 |

Topology validity MUST 包含：required identity、至少一個 flow input與step、IDs唯一合法、
所有 flow input有 outgoing edge、所有 required input port有source、每target單一source、step
output不fan-out、無cycle，且 process step template可resolve。Working configuration不完整不阻止
`Save Template`。

## 狀態矩陣

| Condition precedence | Exact copy |
| --- | --- |
| duplicate template ID | `Template id already exists.` |
| duplicate instance ID | `Instance id already exists.` |
| topology error | validator第一個 message |
| config incomplete | `Template topology can be saved; instance configuration is incomplete.` |
| instance identity missing | `Instance id and name are required for Save Instance.` |
| ready | `Template and instance configuration are ready.` |

API error用 destructive strip；success用 emerald strip；neutral用 muted。Busy action時 save commands
disabled，但 draft不清空。

## Preview 與 Export

Template Editor MUST 支援 Preview，包含 unsaved inline `flowTemplate` 與 saved
`processFlowTemplateId` 兩條 request path。它與 Instance Editor共用
[Geometry Preview](../components/geometry-preview.md) 及
[Export Jobs](../components/export-jobs.md)。關閉 Preview不取消已建立 export job。

## 響應式、鍵盤與 ARIA

- Mobile順序固定：header、Geometry library、graph、Process Step library。
- Header commands/fields wrap但順序不變；document是scroll owner。
- 390px touch-only目前無法用 Geometry drag 建立 flow input；case必須記為
  `UI-GAP-DRAG-001`，Step仍可click-add。
- 單擊 node 是 primary；double-click 只屬 shared legacy fallback。
- Node/Picker dialog target semantics見 [Interaction Patterns](../interaction-patterns.md)；現行缺
  focus trap/restore是 `UI-GAP-A11Y-001`。

## 測試 fixture 與 reference 圖片

Fresh capture：reset後開 route，不選 copy、不新增 node，等待 bootstrap完成。

| Viewport | Asset |
| --- | --- |
| `1440×900` | `../assets/reference/flow-template-editor-1440x900.png`（pending：等待 `DM-020`） |
| `1024×768` | `../assets/reference/flow-template-editor-1024x768.png`（pending） |
| `390×844` | `../assets/reference/flow-template-editor-390x844.png`（pending） |

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-FTE-001` | fresh draft，click Step card | step加入 graph；single-click開 inspector。 |
| `UI-FTE-002` | drag Geometry card到 graph | flow input與catalog binding同時建立。 |
| `UI-FTE-003` | valid topology、incomplete config，Save Template | 成功保存並鎖 topology；binding/parameters仍可編。 |
| `UI-FTE-004` | unsaved template、ready step，Preview | request帶 inline template，panel可到 Ready。 |
| `UI-FTE-005` | saved template、complete config、identity，Save Instance | 只新增 instance，不重建 template。 |
| `UI-FTE-006` | attempt cycle/fan-out/occupied target | connection rejected且persisted topology不變。 |
| `UI-FTE-007` | 390px touch-only | Step可click-add；Geometry無fallback的已知 gap可重現。 |
| `UI-FTE-008` | 1024px | test明確偵測右pane是否被裁切，對應 `UI-GAP-RESP-001`。 |
