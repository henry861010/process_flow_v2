---
title: Flow Instance Editor
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
  - apps/viewer/components/process-flow-instance-editor/process-flow-instance-editor.tsx
  - apps/viewer/lib/process-flow/configuration.ts
  - apps/viewer/lib/process-flow-api.ts
---

# Flow Instance Editor

Route：`/flow-instance-editor`

## 目的與邊界

從 immutable `ProcessFlowTemplate` 建立 mutable `ProcessFlowWorkspace`，填完 Geometry
bindings與 Process Step parameters後 commit成 immutable `ProcessFlowInstance`。本頁不修改
topology、不 overwrite instance、不列 draft清單、不 clone existing instance，也不建立新的
embedded geometry。

## 進入狀態

| Entry | Data behavior |
| --- | --- |
| `/flow-instance-editor` | load bootstrap；尚無 selected template/workspace。 |
| `?workspaceId=<id>` | bootstrap + workspace平行讀取；resolve template；把缺少的 default step configs merge進來。 |
| Committed workspace URL | resolve committed instance name；configuration與identity read-only。 |
| Unknown/missing reference | 保留 app shell，在 status strip顯示 API/error message。 |

Workspace不保存 topology；graph永遠由 referenced template + current configuration重建。

## Reconstruction entry

1. reset API data 後開 `/flow-instance-editor`，先確認 `Select a flow template` empty state。
2. 選擇 `CoWoS-L Demo / V2.0.0`，等待 graph、default step configurations 與
   `CoWoS-L Demo study` 完成 hydration。
3. 單擊 `Incoming panel` node，開 Geometry inspector；選擇 `Panel1` 後確認 status 變成 `Bound`。
4. 從 inspector 開 Geometry Preview，驗證 `Loading` → `Ready`，再檢查 footer export actions。
5. 需要檢查 workspace lifecycle 時，再執行 Save Draft → edit → Reload 或 Commit；visual baseline 不應依賴已保存 workspace。

Current modal observation：Node Editor、Geometry Catalog、Geometry Preview 都能以 close/backdrop/Escape
關閉，但尚未完整提供 dialog semantics 與 focus lifecycle，引用 `UI-GAP-A11Y-001`。

## 版面配置

Main fixed `height:100vh`、`min-height:720px`、overflow hidden。Header white、bottom border、
padding `20px 12px`（horizontal/vertical在CSS為 `px-5 py-3`），其餘高度給 full-width graph。

第一列左側：`GitBranch`、`Process Flow Instance Editor`、subtitle
`Create a product instance from an immutable flow template.`。右側 command依序：

1. `Home`
2. `New`
3. `Reload`（僅已有 workspace 且未 committed時 render）
4. `Save Draft`
5. `Commit Instance`

Field grid：base一欄、`md`兩欄、`2xl` 才是五欄
`1fr 1.2fr 1fr 1fr 1fr`：

| Field | Enabled | Notes |
| --- | --- | --- |
| `Workspace name`* | selected template且未 committed | select template時default `<template.name> study`。 |
| `Process flow template`* | 尚未建立 workspace、未 committed、非 busy | option `<name> / <version>`。 |
| `Instance name` | workspace已保存且未 committed | commit required，不保存於 draft update。 |
| `Instance id` | workspace已保存且未 committed | commit required、unique、ID regex由 API/contract驗證。 |
| Status box | read-only | badge `draft/committed` + `<workspaceId> / r<revision>` 或 `Unsaved workspace`。 |

Header下方 status strip min-height `36px`；graph是剩餘空間，沒有 document scroll。

## Graph 與 node 編輯

Graph固定 `mode="view"`、nodes不可拖、topology不可連線，`panOnScroll=true`、min zoom
`0.28`、max zoom `1.45`；有 nodes才顯示 MiniMap。單擊 node選取並開 dialog。

沒有 template時 graph中央顯示 dashed white card：`Layers3`、`Select a flow template`、
`The graph appears here after a process flow template is selected.`。

Node Editor shell width `min(920px,100vw-32px)`，max-height `100vh-32px`，body scroll。

### Geometry Input inspector

- 顯示 `Geometry Input`、`flowInputId`、badge `Bound` 或 readiness label。
- geometry card顯示 name與 ID；未綁定顯示 `No geometry`。
- actions依序 `Select`、`Preview`、`Clear`。
- committed時 Select/Clear disabled；已有 geometry時 Preview仍 enabled。
- description存在時顯示；definition本身不可編。

Geometry Catalog dialog width `min(820px,100vw-32px)`，只列符合 `entityTypes`、category
exact/descendant、`structureFormats` constraints 的 records。Desktop items兩欄；選中 card有
primary border + ring。

### Process Step inspector

顯示 step label、`<stepRefId> / <templateId>`，下方使用
[Parameter Editor](../components/parameter-editor.md)。Committed時所有 values read-only。

## Readiness 呈現

| Entity | Ready | Incomplete | Error | Neutral |
| --- | --- | --- | --- | --- |
| Required input | resolved且constraint match | unbound | missing/invalid/mismatch | n/a |
| Optional input | resolved且match | n/a | invalid supplied binding | unbound |
| Step | entire upstream closure complete | missing required binding/parameter/upstream | invalid topology/reference/value | optional path不參與 |
| Edge | source readiness | amber | red | grey |

Step-output edge有 Eye button；terminal step右側有 final Eye button。Ready才 enabled，disabled
title固定 `Complete upstream configuration to preview`。Preview只檢 target closure，不相關
branch不得阻擋。

## Workspace action 矩陣

| Action | Preconditions | Result |
| --- | --- | --- |
| Select template | 無 workspace/dirty；否則先 confirm `Discard the current workspace draft?` | default config、name、dirty=true；URL清除 query。 |
| `New` | dirty時confirm | 全部清空；URL回 route root。 |
| First `Save Draft` | hydrated、template、workspace name、dirty/unsaved、非 busy | POST workspace；URL replace加入 encoded `workspaceId`；dirty=false。 |
| Later `Save Draft` | 同上 | PUT含 current revision；success revision增加。 |
| `Reload` | workspace且未 committed | GET server revision並覆蓋 local；現況即使dirty也不另confirm。 |
| `Commit Instance` | saved、clean、complete、ID/name、unique、非 busy | POST commit；workspace/graph鎖定、revision更新。 |
| Preview | input resolved或step ready | 共用 Geometry Preview。 |

Save success copy：`Draft saved at revision <n>.`；commit success copy：
`Committed immutable instance <id>.`。Reload copy：
`Workspace <id> loaded at revision <n>.`。

## 狀態矩陣

| State | Save Draft | Commit | Configuration | Status copy |
| --- | --- | --- | --- | --- |
| No template | disabled | disabled | none | `Select a process flow template.` |
| New unsaved | enabled if name | disabled | editable | incomplete/dirty precedence |
| Saved clean incomplete | disabled | disabled | editable | `Draft saved; configuration is incomplete.` |
| Dirty | enabled | disabled | editable | `Workspace has unsaved changes.` |
| Clean complete, identity empty | disabled | disabled | editable | `Configuration is complete; enter immutable instance identity.` |
| Duplicate instance ID | disabled | disabled | editable | `Instance id already exists.` |
| Ready | disabled | enabled | editable | `Workspace is ready to commit.` |
| Busy | disabled | disabled | 保留 | strip顯示既有/fallback狀態 |
| Committed | disabled | disabled | read-only | `Workspace committed as <id>.` |

Dirty state MUST 註冊 `beforeunload`。Stale `409` 不自動 merge，保留 local並顯示 API
message；使用者選 Reload。

## Preview 與 Export

本頁與 Template Editor同樣 MUST 支援 input與step-output Preview。Requests使用 persisted
`processFlowTemplateId`；Preview/Export詳見
[Geometry Preview](../components/geometry-preview.md) 與
[Export Jobs](../components/export-jobs.md)。Jobs drawer固定在 page右側，不因 Preview關閉而消失。

## 響應式、鍵盤與 ARIA

- `<768px` fields單欄，commands wrap；header可能占較多高度，但graph保留剩餘區域。
- app固定height且 document不捲動；node dialog body自行捲動。
- graph font不縮小，以 fit/pan/zoom操作。
- 單擊 node 是 primary，double-click legacy fallback 不得取代。
- modal target需符合 [Interaction Patterns](../interaction-patterns.md)；現行 focus trap/restore是
  gap。

## 測試 fixture 與 reference 圖片

Reference capture：reset 後開 route，選擇 `CoWoS-L Demo`，等待 graph、default configuration
與 workspace name 完成 hydration；不儲存 workspace。

| Viewport | Asset |
| --- | --- |
| `1440×900` | `../assets/reference/flow-instance-editor-1440x900.png`（pending：等待 `DM-020`） |
| `1024×768` | `../assets/reference/flow-instance-editor-1024x768.png`（pending） |
| `390×844` | `../assets/reference/flow-instance-editor-390x844.png`（pending） |

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-FIE-001` | fresh page，select CoWoS-L | read-only graph/default config出現，workspace name default，dirty。 |
| `UI-FIE-002` | unsaved draft，Save Draft | URL加入 workspaceId、revision顯示、dirty清除。 |
| `UI-FIE-003` | saved draft，edit field | dirty copy出現、Commit disabled、beforeunload active。 |
| `UI-FIE-004` | clean complete + identity，Commit | committed badge、controls locked、immutable ID保留。 |
| `UI-FIE-005` | stale revision，Save Draft | local data保留、409 message可見、Reload可恢復server。 |
| `UI-FIE-006` | ready edge/final node，click Eye | Preview開啟；unrelated incomplete branch不阻擋。 |
| `UI-FIE-007` | committed workspace reload | identity resolve，Preview可用，editing controls disabled。 |
| `UI-FIE-008` | single-click geometry/step node | respective inspector開啟，不要求double-click。 |
