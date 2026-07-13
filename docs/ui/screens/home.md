---
title: Home / Process Flows
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-13
last_verified_commit: 7a94eded086c7a18bd082cf315e413cf97fc698c
source_of_truth:
  - apps/viewer/app/page.tsx
  - apps/viewer/lib/process-flow-api.ts
  - apps/api/src/process_flow_api/fixtures
---

# Home / Process Flows

Route：`/`

## 目的

Home 是 immutable `ProcessFlowTemplate` 與已 commit `ProcessFlowInstance` 的 index。
Draft `ProcessFlowWorkspace` 不顯示；使用者以已知 `workspaceId` URL 回到 draft。沒有任何
instance reference 的 template 仍 MUST 顯示一列 `No instance / Template saved`。

## Reconstruction entry

1. reset API data。
2. 開啟 `/`，等待 bootstrap 完成；不要以初次 `0 / 0` transient state 作 visual baseline。
3. 確認 3 個 flow instances、4 個 flow templates 與 5 個 rows。
4. 先驗證 instance rows 與 template-only rows，再測試 filter 與 reset。

Current observation：bootstrap 完成前會短暫顯示 disabled filter、`0 / 0` 與 `No process flows`；
這是現況限制，不是 ready screenshot 的 accepted state。

## 資料契約

初次 mount 呼叫 `GET /api/bootstrap`，使用下列 references resolve rows：

```text
instance.processFlowTemplateId -> ProcessFlowTemplate
template.stepRefs[].processStepTemplateId -> ProcessStepTemplate
```

Missing reference 不得被 filter 掉。`Values` 是已填 input bindings + top-level parameter
values / 預期 flow inputs + top-level parameter definitions；它不是深層完成度驗證。

## 版面配置

| Area | Exact specification |
| --- | --- |
| Page | `min-height: 100vh`；background token；content max-width `1280px`，置中。 |
| Content padding | base `20px`；`sm` `24px` horizontal；`lg` `32px` horizontal；vertical固定 `20px`。 |
| Content rhythm | column gap `20px`。 |
| Header | wrap flex、items center、space-between、gap `16px`、bottom border、padding-bottom `16px`。 |
| Table card | white、radius `6px`、1px border、small shadow、overflow hidden。 |
| Reset | fixed `left:12px; bottom:12px`，height `28px`，z 使用 normal fixed layer。 |

Header 左側是 `Table2` 20px、title `Process Flows`，下一列兩個 outline badges：
`<n> flow instances` 與 `<n> flow templates`。右側 `nav[aria-label="Process flow tools"]`
依序顯示：

1. `Boxes` + `HBM Generator`
2. `Workflow` + `Flow Template`
3. `GitBranch` + `Flow Instance`
4. `ListChecks` + `Process Step`

四者都是 32px outline button。後三者分別連到 Template、Instance、Process Step editors；
`HBM Generator` 不navigate，而是在Home上方開啟
[HBM Geometry Generator](../components/hbm-generator.md) modal。

## Filter 與 table 規格

Card toolbar 使用 white surface、horizontal `16px`、vertical `12px`。`Template type`
select 最小寬 `240px`、最大寬 `448px`、可伸展；右側顯示 `<n> shown`。

Table wrapper是唯一 horizontal scroll owner；table `min-width:680px`。

| Column | Width | Content |
| --- | --- | --- |
| `Template type` | `28%` | template name；次行 `version <version>`，無 version 才顯示 ID。 |
| `Flow instance` | `42%` | instance name + monospace ID；template-only 顯示 `No instance` / `Template saved`。 |
| `Values` | `15%` | monospace `<populated>/<expected>`；template-only 顯示 `-`。 |
| `Status` | `15%` | `Resolved`、`Template only`、`Missing template`、`Missing step`。 |

Header cells 使用 uppercase `12px/600`，row cell padding `16px 12px`（水平/垂直在
Tailwind 表示為 `px-4 py-3`）。長 identity 必須 truncate 並以 `title` 保留全文。

## 狀態矩陣

| State | Filter | Table/body | Header counts |
| --- | --- | --- | --- |
| Bootstrapping | disabled | 現行會短暫顯示 empty state | `0 / 0` |
| Ready + rows | enabled | resolved + template-only rows | bootstrap counts |
| Ready + no data | disabled | `No process flows` + primary `Create instance` | `0 / 0` |
| Filter no rows | enabled | 同一 empty row（現況 copy仍是 `No process flows`） | 不變 |
| API error | 視已載 options | toolbar上方 destructive strip 顯示 API message | 保留已知資料 |
| Resetting | 現況無 explicit busy lock | reset response回來後整批替換資料、filter回 All | reset counts |

Bootstrapping 使用 false empty、Reset 沒有 busy/error boundary 是現行限制；重建 screenshot
需符合 ready state，產品改善時應另增 loading/resetting acceptance。

## 操作

| Action | Preconditions | Result |
| --- | --- | --- |
| Change Template type | hydrated且至少一個 option | exact template name filter；失效選項自動回 `All template types`。 |
| `Create instance` | empty state | navigate `/flow-instance-editor`。 |
| `HBM Generator` | always visible | 不navigate；開啟獨立HBM geometry authoring modal。 |
| `cmd: reset-poc-data` | always visible | `POST /api/reset`，換成 response payload並清 filter。 |

Reset control exact attributes：visible text `cmd: reset-poc-data`、`RotateCcw` 12px、
`aria-label="Reset POC Data"`、title `Reset API data and restore default JSON`。

## 響應式規格

- `1440×900`：content實寬上限 1280px；header nav在同列，table完整顯示。
- `1024×768`：左右 padding 32px；table可在 960px content內完整顯示。
- `390×844`：header與 nav wrap；table仍是 680px，由 card內水平捲動，整頁不得水平捲動。
- Reset 固定在 viewport 左下，可能覆蓋長列表最後一列；頁面底部需保留可捲動空間是後續改善。

## 鍵盤、focus 與 ARIA

- Header nav 有 label；DOM/tab順序與視覺順序一致。
- Filter以 `<label>` 包住 native select，`Filter` icon decorative。
- Table保留 semantic `<table>/<thead>/<tbody>/<th>`。
- Reset有 accessible name；focus-visible是 1px ring（現行特例）。

## 測試 fixture 與 reference 圖片

Fixture：`ui-golden` reset 後的完整 bootstrap。Reference capture必須等 `hydrated=true`。

| Viewport | Asset |
| --- | --- |
| `1440×900` | `../assets/reference/home-1440x900.png`（pending：等待 `DM-020`） |
| `1024×768` | `../assets/reference/home-1024x768.png`（pending：等待 `DM-020`） |
| `390×844` | `../assets/reference/home-390x844.png`（pending） |

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-HOME-001` | reset後開 `/` | instance rows與 template-only rows都可見，counts等於 bootstrap。 |
| `UI-HOME-002` | 選擇 `CoWoS-L Demo` | 只顯示該 template rows，`shown`同步。 |
| `UI-HOME-003` | instance指向不存在 template | row保留並顯示 `Missing template`。 |
| `UI-HOME-004` | 390px寬 | document無 horizontal overflow，table wrapper可水平捲動。 |
| `UI-HOME-005` | click reset | filter回 All，資料回 canonical fixture。 |
| `UI-HOME-006` | click `HBM Generator` | URL保持`/`，HBM Generator dialog開啟。 |
