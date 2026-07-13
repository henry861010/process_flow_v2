---
title: Flow Instance Editor
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-12
last_verified_commit: 2b9cad3675483da156a92d0a08ec12671f4f1b62
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

目前 `SHOW_DRAFT_WORKSPACE_UI=false`。這是暫時的 UI visibility policy：`Save Draft`、
`Reload` 與 workspace status box 不 render；workspace create/read/update API、frontend API client、
save/reload handler 與 `workspaceId` entry仍保留，不代表 workspace lifecycle或API被移除。

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
2. 選擇 `AAA Demo / V3.0.0`，等待 graph、default step configurations 與
   `AAA Demo study` 完成 hydration。
3. 單擊 `Incoming panel` node，開 Geometry inspector；選擇 `Panel1` 後確認 status 變成 `Bound`。
4. 從 inspector 開 Geometry Preview，驗證 `Loading` → `Ready`，再檢查 footer export actions。
5. 確認header不出現`Save Draft`、`Reload`、`draft` badge或`Unsaved workspace` status box；
   visual baseline不應依賴已保存workspace。

Current modal observation：Node Editor、Geometry Catalog、Geometry Preview 都能以 close/backdrop/Escape
關閉，但尚未完整提供 dialog semantics 與 focus lifecycle，引用 `UI-GAP-A11Y-001`。

## 版面配置

Main fixed `height:100vh`、`min-height:720px`、overflow hidden。Header white、bottom border、
padding `20px 12px`（horizontal/vertical在CSS為 `px-5 py-3`），其餘高度給 full-width graph。

第一列左側：`GitBranch`、`Process Flow Instance Editor`、subtitle
`Create a product instance from an immutable flow template.`。右側 command依序：

1. `Home`
2. `Commit Instance`

`Reload`與`Save Draft`的實作保留在feature flag後方，目前不得render。

Field grid目前維持單欄：

| Field | Enabled | Notes |
| --- | --- | --- |
| `Process flow template`* | 尚未建立 workspace、未 committed、非 busy | option `<name> / <version>`。 |

Workspace status、Workspace name與Instance name/id不在Editor header常駐顯示。Workspace
save dialog的實作仍保留，但目前沒有可見入口。Commit Instance由instance dialog詢問name/id；
dialog在submitting期間鎖定close與重複submit。

Header下方 status strip min-height `36px`；graph是剩餘空間，沒有 document scroll。

## Graph 與 node 編輯

Graph固定 `mode="view"`、nodes不可拖、topology不可連線，`panOnScroll=true`、min zoom
`0.28`、max zoom `1.45`；有 nodes才顯示 MiniMap。單擊 node選取並開 dialog。

Geometry Input node在binding可解析時 MUST 以 `geometry.name` 作為primary label，並以 Flow
Input name作為secondary label。binding未設定或無法解析時，primary label回退到 Flow Input
name，secondary label維持readiness提示。選擇或清除geometry後 MUST 即時更新。

沒有 template時 graph中央顯示 dashed white card：`Layers3`、`Select a flow template`、
`The graph appears here after a process flow template is selected.`。

Node Editor shell width `min(920px,100vw-32px)`，max-height `100vh-32px`，body scroll。

### Geometry Input inspector

- 顯示badge `Bound`或readiness label；geometry binding是主要內容。
- 未綁定且workspace可編時顯示`Add geometry`；已綁定顯示name、ID、`Preview`與
  `Change geometry` icon，不提供Clear binding action。
- committed時不顯示Add/Change；已有geometry時Preview仍可用，未綁定則顯示
  `No geometry bound`。
- `Advanced settings`預設收合，使用靠右、borderless小字。展開後以唯讀文字顯示
  Name、Description、Required、Allowed entity types、Allowed categories與flow input ID；
  Instance Editor不得覆寫template definition。

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

目前可見UI action如下：

| Action | Preconditions | Result |
| --- | --- | --- |
| Select template | 無 workspace/dirty；否則先 confirm `Discard the current workspace draft?` | default config、name、dirty=true；URL清除 query。 |
| `Commit Instance` | saved、clean、complete、非 busy | 開instance dialog；ID/name valid且unique後POST commit，workspace/graph鎖定、revision更新。 |
| Preview | input resolved或step ready | 共用 Geometry Preview。 |

Draft persistence handler仍維持原先POST/PUT/GET與success/error copy，但
`SHOW_DRAFT_WORKSPACE_UI=false`時沒有可見的Save/Reload觸發入口。`Commit Instance`仍要求
saved、clean、complete workspace，因此fresh route目前無法只靠可見UI進入commit；可由既有
`?workspaceId=<id>` entry載入符合條件的workspace後commit。Commit success copy為
`Committed immutable instance <id>.`。

## 狀態矩陣

| State | Draft controls | Commit | Configuration | Status copy |
| --- | --- | --- | --- | --- |
| No template | not rendered | disabled | none | `Select a process flow template.` |
| New unsaved | not rendered | disabled | editable | incomplete/dirty precedence |
| Saved clean incomplete（URL載入） | not rendered | disabled | editable | `Draft saved; configuration is incomplete.` |
| Dirty | not rendered | disabled | editable | `Workspace has unsaved changes.` |
| Saved clean complete（URL載入） | not rendered | enabled | editable | `Workspace is ready to commit.` |
| Busy | not rendered | disabled | 保留 | strip顯示既有/fallback狀態 |
| Committed | not rendered | disabled | read-only | `Workspace committed as <id>.` |

Dirty state MUST 註冊 `beforeunload`。Stale revision的`409`處理仍保留在save handler內，
但目前不屬於可見UI acceptance path。

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

Reference capture：reset 後開 route，選擇 `AAA Demo`，等待 graph、default configuration
與 workspace name 完成 hydration；不儲存 workspace。

| Viewport | Asset |
| --- | --- |
| `1440×900` | `../assets/reference/flow-instance-editor-1440x900.png`（pending：等待 `DM-020`） |
| `1024×768` | `../assets/reference/flow-instance-editor-1024x768.png`（pending） |
| `390×844` | `../assets/reference/flow-instance-editor-390x844.png`（pending） |

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-FIE-001` | fresh page，select AAA | read-only graph/default config出現，workspace name在hidden state使用default，dirty。 |
| `UI-FIE-002` | fresh或draft workspace page，檢查header | 不render `Save Draft`、`Reload`、draft/committed badge與workspace ID/status box。 |
| `UI-FIE-003` | saved draft，edit field | dirty copy出現、Commit disabled、beforeunload active。 |
| `UI-FIE-004` | 以known `workspaceId`載入clean complete workspace，Commit | instance identity dialog出現；valid submit後controls locked、immutable ID保留。 |
| `UI-FIE-005` | 以known draft `workspaceId`進入 | workspace/configuration可載入，但header仍不render draft persistence controls或status box。 |
| `UI-FIE-006` | ready edge/final node，click Eye | Preview開啟；unrelated incomplete branch不阻擋。 |
| `UI-FIE-007` | committed workspace reload | identity resolve，Preview可用，editing controls disabled。 |
| `UI-FIE-008` | single-click geometry/step node | respective inspector開啟，不要求double-click。 |
| `UI-FIE-009` | 開啟Geometry Input inspector並展開`Advanced settings` | definition只以唯讀文字顯示；已綁定時可Preview或Change，但沒有Clear action。 |
