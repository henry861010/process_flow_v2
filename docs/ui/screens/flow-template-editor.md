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
2. 等待 bootstrap 完成，確認 header commands/status、Geometry library、Process step templates 與 `Empty flow`。
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
3. `Save` + `Save Template`
4. `GitBranch` + `Save Template & Instance`；保存 template 後變 `Save Instance`

### Save information dialog

Template 與 Instance identity 不在 Editor header 常駐顯示，只在使用者執行 save action 時
由共用 dialog 收集。Dialog width 是 `min(680px,100vw-32px)`，body是唯一 vertical scroll
owner；Close、Cancel、Escape、backdrop皆可關閉，submitting期間禁止關閉或重複送出。

| Action | Dialog fields |
| --- | --- |
| `Save Template` | Template name、id、version、owner、optional description。 |
| `Save Template & Instance` | 上述 Template fields，加 Instance name、id。 |
| saved template後的`Save Instance` | Instance name、id。 |

Start from template仍在client draft預填name、version、owner、description並清空template id；
使用者開啟save dialog時才看到預填值。Header下只保留高度至少`36px`的full-width status strip。

## Library 與 graph

兩側 pane header高度 `48px`、horizontal padding `12px`：

- 左：`Boxes` + `Geometry library`
- 右：`FileJson` + `Process step templates`

內容 padding `12px`，使用 [Category Library](../components/category-library.md)。Geometry
card 是 drag-only；Step card可 click-add或drag。Topology locked 時兩側 disabled、opacity
`0.5`，Step title 變 `Topology is locked`。

Geometry library header下方固定顯示由共用generator registry提供的`HBM generator`與
`DRAM generator`。Topology unlocked時click開啟flow-input mode generator；此模式不顯示
`Generate JSON`或`Save to DB`，合法參數只能以`Define`完成。`Define`建立新的flow input、
embedded geometry與embedded binding，不寫入geometry catalog。Topology locked時library
generator入口disabled。

Graph 使用 [Process Flow Graph](../components/process-flow-graph.md)；fresh state中央顯示
`Workflow` 28px + `Empty flow`。單擊 node MUST 開 Node Editor。

### Topology actions

| Action | Rule |
| --- | --- |
| Drop Geometry | 新增 `flowInput` definition；working config 同時綁該 catalog geometry。 |
| Define generated Geometry | 新增`flowInput`與draft-local embedded geometry；暫存metadata使用`hbm_generator`／`dram_generator`、`v0.0.0`與null owner。 |
| Add/Drop Step | 新增 `stepRef`、default step config；ID由 template name slug後去重。 |
| Connect | target是step input、非self/cycle；source output或target input已有edge時，由新edge原子式取代舊edge。 |
| Reconnect edge target | 拖曳既有edge的target箭頭到另一step input；source與edge ID保持不變，occupied target依Connect規則自動取代。 |
| Delete node | 刪 node、相關 edges與對應 configuration entry。 |
| Delete edge | 只在edit mode顯示；不改 parameter values。 |

Geometry Input node在catalog binding可解析時 MUST 以 `geometry.name` 作為primary label，並以
Flow Input name作為secondary label。binding未設定或無法解析時，primary label回退到 Flow Input
name，secondary label維持readiness提示。拖入、重新選擇或清除geometry後 MUST 即時更新。

## Node Editor dialogs

共用 shell：fixed `z=50`、16px page margin、max height `100vh-32px`、width
`min(920px,100vw-32px)`；body是唯一 vertical scroll owner。Close、Escape、backdrop都關閉。

### Geometry Input inspector

| Section | Controls/copy | Topology locked |
| --- | --- | --- |
| Header metadata | `Name` 與系統建立的 monospace input ID；ID 只以 read-only text 顯示，不是 form control | 保持 read-only |
| Instance Binding | 未綁定顯示 `Add geometry`；已綁定顯示 geometry name/ID、`Preview` icon與`Change geometry` icon | 保持可用 |
| `Advanced settings` expansion | 預設收合；borderless、靠右、使用小字；展開後顯示 `Name`、`Description`、`Required`、`Allowed entity types`、`Allowed categories`與唯讀input ID | 全部改為唯讀文字 |
| Header action | delete icon | hidden |

Input ID MUST 在建立 flow input 時由系統產生且保持穩定；使用者不能輸入或修改，變更
`Name` 也不得重算 ID、搬移 binding key 或改變既有 edge。`Structure formats` 不顯示於
inspector；既有值 MUST 在編輯與保存後原樣保留，並維持原有 constraint/filtering 語意。

Instance Binding 是 inspector 的主要區塊，不放入 `Advanced settings`。Binding不存在時
`Add geometry`開啟selector；binding存在時`Change geometry`取代現值，沒有清除單一binding的
action。若不再需要該input，topology unlocked時刪除整個Flow Input。`Preview`只在geometry
resolved時出現。Binding selector dialog width
`min(820px,100vw-32px)`；頂部顯示同一份generator registry入口，下方matching geometries依
constraints過濾並在desktop顯示兩欄。click catalog card後立即選定並關閉picker；click
generator後開啟flow-input mode generator，Cancel回到picker，Define後套用結果並關閉picker。
Geometry Input inspector本身不直接顯示generator入口。

在picker選擇與目前geometry相同的generator且
`generation` metadata存在時，dialog MUST 回填原始參數；不同generator或legacy geometry沒有
generation metadata時從該generator defaults開始。`Define`只替換binding：不得改動
`flowInputId`、definition、position或edges。Catalog geometry不可in-place修改，因此任何
generator結果都先成為embedded geometry。Topology locked後這些入口仍可用，因為它們修改的
是working configuration而非topology。

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
| Start from template | topology unlocked、非 busy | clone topology、identity copied後 `id` empty、default configuration、computed layout。 |
| `Save Template` | hydrated、unlocked、非 busy、topology valid | 開dialog；資訊valid且ID unique後保存，copy為`Template <id> saved. Topology is now locked.` |
| `Save Template & Instance` | 上述 topology條件 + configuration complete | 開合併dialog；資訊valid且IDs unique後保存，copy為`Template <id> and instance <id> saved.` |
| `Save Instance` | template已保存 + configuration complete | 開instance dialog；identity valid且unique後保存，copy為`Instance <id> saved.` |
| Preview input/step | resolved input或ready closure | 共用 Geometry Preview。 |

Topology validity MUST 包含：至少一個 flow input與step、graph IDs唯一合法、
所有 flow input有 outgoing edge、所有 required input port有source、每target單一source、每個
source output（flow input與step output）只有一個consumer、無cycle，且 process step template可resolve。Working configuration不完整不阻止
`Save Template`。Template/Instance save information不參與toolbar enabled條件，只在dialog submit時驗證。

## 狀態矩陣

| Condition precedence | Exact copy |
| --- | --- |
| topology error | validator第一個 message |
| config incomplete | `Template topology can be saved; instance configuration is incomplete.` |
| ready | `Template and instance configuration are ready to save.` |

Save information缺漏、duplicate ID與save API error在dialog內呈現；success用emerald strip，
neutral用muted。Busy action時save commands disabled，但draft不清空。

若configuration引用embedded geometries，instance save dialog MUST 依unique `localId`增加
Generated geometry information區塊，要求使用者確認非空Name、Version、Owner，Description
選填。Save Template不處理這些metadata，也不materialize geometry。Save Instance與
Save Template & Instance則在同一backend transaction內建立catalog geometry、將binding改寫成
catalog binding並建立instance；任一步驟失敗必須全部rollback。

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
| `UI-FTE-003` | valid topology、incomplete config，Save Template | dialog顯示template fields；完成資訊後成功保存並鎖 topology，binding/parameters仍可編。 |
| `UI-FTE-004` | unsaved template、ready step，Preview | request帶 inline template，panel可到 Ready。 |
| `UI-FTE-005` | saved template、complete config，Save Instance | 開instance-only dialog；完成identity後只新增instance，不重建template。 |
| `UI-FTE-006` | 從已有edge的source output連到另一input | 新edge接上後舊source edge自動消失；拖曳期間舊edge顯示灰色；拉回原target則topology不變。 |
| `UI-FTE-007` | 390px touch-only | Step可click-add；Geometry無fallback的已知 gap可重現。 |
| `UI-FTE-008` | 1024px | test明確偵測右pane是否被裁切，對應 `UI-GAP-RESP-001`。 |
| `UI-FTE-009` | 建立多個 flow inputs，開啟 inspector後修改其中一個 `Name` | 每個 input ID由系統建立且唯一，只以read-only text顯示；改名後ID、binding key與edges不變。 |
| `UI-FTE-010` | 開啟 Geometry Input inspector | Binding直接顯示；`Advanced settings`是靠右、無邊框的小字且預設收合，展開後可編輯definition欄位但不顯示`Structure formats`。 |
| `UI-FTE-011` | 載入含既有`structureFormats`的template，修改其他可見欄位後保存 | hidden `structureFormats`值原樣保留，且matching geometry仍套用其constraint語意。 |
| `UI-FTE-012` | 已綁定Geometry Input | 顯示geometry name、Preview與Change geometry；沒有Clear binding action。 |
| `UI-FTE-013` | 新edge接到已有incoming edge的input | 新edge接上後舊target edge自動消失，不要求使用者先手動刪除。 |
| `UI-FTE-014` | replacement edge會形成cycle | connection rejected且persisted topology不變。 |
| `UI-FTE-015` | 拖曳既有edge的target箭頭到另一step input | edge直接改接，source與edge ID不變；新target原有incoming edge自動消失。 |
| `UI-FTE-016` | target reconnect形成cycle或放開在無效位置 | reconnect取消，原edge與topology保持不變。 |
| `UI-FTE-017` | click Geometry library的HBM/DRAM generator，完成合法參數後Define | graph新增flow input且binding為embedded；沒有geometry create request。 |
| `UI-FTE-018` | 開啟Flow Input inspector並click Change geometry | inspector本身沒有generator入口；picker頂部顯示HBM/DRAM generator，Cancel generator後回到picker。 |
| `UI-FTE-019` | generated geometry尚為embedded時Save Instance | dialog要求正式geometry metadata；成功後geometry寫入catalog且working binding同步為catalog。 |
| `UI-FTE-020` | 由generator建立input後，從Change geometry picker重開相同generator | 所有原始參數回填；Define後picker關閉，input ID、position與edges不變。 |
