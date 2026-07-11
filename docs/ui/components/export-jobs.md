---
title: Export Jobs
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
  - apps/viewer/components/geometry-preview/file-export-client.ts
  - apps/viewer/components/geometry-preview/file-export-dialog.tsx
  - apps/viewer/components/geometry-preview/file-export-jobs-panel.tsx
---

# Export Jobs

## 範圍

Ready Geometry Preview可建立`json`、`step`、`cdb` background jobs。Job屬於browser client，
關閉Preview不取消job；Template與Instance Editor各自常駐同一drawer component。

Browser client ID存在localStorage `process-flow:export-client-id`；若只有legacy
`process-flow:cdb-export-client-id` 則一次性 copy 到新 key，兩者皆無才產生 UUID。

## Export 表單

點Preview footer action開 portal modal：fixed z `100`、16px margin；form width
`min(520px,100vw-32px)`、radius6、border、shadow。Header依kind顯示icon、`Export JSON/STEP/CDB`、
source label、Close；footer `Cancel`、primary `Export`。

| Kind | Fields | Placeholder | Payload snapshot |
| --- | --- | --- | --- |
| JSON | Output path | `/Users/henry/Desktop/geometry-preview.json` | `geometryEntityJson` |
| STEP | Output path | `/Users/henry/Desktop/geometry-preview.step` | `geometryStructure` |
| CDB | Element size + Output path | `/Users/henry/Desktop/model.cdb` | `geometryStructure` |

CDB element size default `500`。Client validation順序：CDB size finite且`>0`、path required、path以
`/`開頭、extension case-insensitive符合`.json/.step/.cdb`。錯誤顯示form內 destructive block。

Submitting時fields、Close、Cancel與backdrop close disabled；primary顯示spinner。成功後seed job到
drawer、自動expand、關form；失敗保留form/value。

Hard-coded user-specific placeholders是現行copy；portable產品化時應改environment-neutral example並
更新references，重建agent不得自行改字。

## 六種 job 狀態

```ts
type FileExportStatus =
  | "queued" | "running" | "success" | "failed"
  | "canceling" | "canceled";
```

| Status | Active | Cancelable | Icon | Badge/row behavior |
| --- | --- | --- | --- | --- |
| queued | yes | yes | spinning `Loader2` | `Queued` outline |
| running | yes | yes | spinning `Loader2` | `Running` outline |
| success | no | no | emerald `CheckCircle2` | `Success` signal + stats/duration |
| failed | no | no | destructive `XCircle` | `Failed` destructive outline + message |
| canceling | yes | no | spinning `Loader2` | `Canceling` + `Cancel requested.` |
| canceled | no | no | muted `CircleStop` | `Canceled` secondary |

Client cancel是optimistic：queued/running row先改`canceling`，再POST cancel並merge response；failure
顯示drawer error並立即reload authoritative jobs。

## Polling 規則

1. Client ID建立後立即list。
2. `refreshKey`改變（新job）立即list。
3. 任一job為queued/running/canceling時每 `1800ms` poll。
4. 無active jobs時每 `5000ms` poll。
5. 每次成功replace完整jobs list並清load error；失敗保留舊jobs並顯示error。

UI最多merge/show最新20筆；footer exact copy `Showing the latest 20 requests for this browser.`。

## Drawer 版面

Collapsed：fixed right0/top50%、z80、`40×64px`、左radius、ChevronLeft + Download；有active job
左上顯示primary dot。Accessible name/title `Open export requests`。

Expanded：fixed right0/top50%、z80、width `min(420px,100vw-16px)`、max-height
`min(78vh,640px)`、左radius/border、shadow。Header顯示Download icon、`Export requests`、
`<n> active`或`<n> recent requests`、badge `Running/Idle`、Collapse。Body是唯一vertical scroll。

Empty exact copy：`No export requests` / `Exports created from preview will appear here.`。

## Job row 與詳細資料

每row border card、padding12px/8px。第一行：status icon、kind icon、source label fallback
`<KIND> export`、status badge；次行monospace output path。Success CDB顯示elements/nodes/comps +
duration；其他success顯示kind/duration。Non-success message、warning各自顯示。Cancel 32px在右。

Hover、pointer或focus-within顯示detail popover；desktop only (`md:block`)，fixed
`right:432px`、z90、width `min(520px,100vw-464px)`、max-height `min(70vh,420px)`。Popover fields：
Kind、CDB size/mesh、Duration、Created/Started/Finished、Job ID、Message、Warning。

Popover top依row rect計算，至少16px且不超viewport。它是pointer-events none，不能承載command。

## 狀態與 action 矩陣

| Context | Action | Result |
| --- | --- | --- |
| New job seed | component收到seedJob | merge到首列、slice20、drawer expand。 |
| Collapse/expand | chevron command | jobs/polling不變。 |
| Cancel queued/running | Cancel | optimistic canceling -> server state。 |
| Cancel terminal/canceling | disabled | no request。 |
| Poll error | none | error block + stale rows保留。 |

## 鍵盤、focus 與 ARIA

- Collapsed/Collapse/Cancel是native buttons。
- Row透過focus capture顯示details，但row本身非focusable；Cancel取得focus即可觸發。
- Status text與icon並存，不能只靠animation/color。
- Job updates SHOULD 透過polite live region宣告是target gap；目前普通DOM更新。
- Mobile不顯示detail popover，關鍵message/stats仍必須在row本體可見。

Export form 是 jobs drawer 之外的更高層 modal；提交或關閉 form 不得關閉 Preview，也不得中斷
已建立的 job。最上層 Escape 行為見 [Geometry Preview](geometry-preview.md) 與
[Interaction Patterns](../interaction-patterns.md)；現行穿透行為引用 `UI-GAP-MODAL-STACK-001`。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-EXPORT-001` | submit valid JSON path | form關閉、drawer展開、job出現在首列。 |
| `UI-EXPORT-002` | queued/running job，Cancel | 即時canceling、button disabled，後續authoritative terminal。 |
| `UI-EXPORT-003` | active jobs存在/消失 | polling由1800ms切5000ms。 |
| `UI-EXPORT-004` | each six status | icon、label、cancelability、details精確符合matrix。 |
| `UI-EXPORT-005` | list request fails | error顯示且既有rows不消失。 |
| `UI-EXPORT-006` | 390px | drawer寬`100vw-16px`內，popover隱藏，所有row copy可讀。 |
| `UI-EXPORT-007` | invalid size/path/extension | 不發POST，對應first validation error可見。 |
