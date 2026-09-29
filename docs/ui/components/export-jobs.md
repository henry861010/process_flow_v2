---
title: Export Jobs
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-08-29
last_verified_commit: 013fba726b811c8acfbc5d928463a15baa67a9e3
source_of_truth:
  - apps/viewer/components/geometry-preview/file-export-client.ts
  - apps/viewer/components/geometry-preview/file-export-dialog.tsx
  - apps/viewer/components/geometry-preview/file-export-mesh-control.ts
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
`min(760px,100vw-32px)`、max-height `min(92vh,900px)`、radius6、border、shadow。Header依kind顯示icon、`Export JSON/STEP/CDB`、
source label、Close；footer `Cancel`、primary `Export`。

| Kind | Fields | Placeholder | Payload snapshot |
| --- | --- | --- | --- |
| JSON | Output path | `/Users/henry/Desktop/geometry-preview.json` | `geometryEntityJson` |
| STEP | Output path | `/Users/henry/Desktop/geometry-preview.step` | `geometryStructure` |
| CDB | Mesher + Global element size + Symmetry + Controls + Output path | `/Users/henry/Desktop/model.cdb` | `geometryStructure` + `meshControl` |

CDB mesher固定顯示`process_flow_2_5d`，global element size default `500`。Symmetry以緊湊的單欄radio list依序顯示`Full`、
`Upper Half`、`Right Half`、`Upper-right Quarter`，每次開啟預設`full`。
`Apply` 與 mesh control set 選項同列，位於 `Mesh controls` 標題與 `Expand` 按鈕之間，預設為 `Manual / custom`；選擇已登錄 set 會將目前 preview structure 送到
`POST /api/mesh-control-sets/{id}/apply`，把回傳的 global size、symmetry 與 controls 展開為可編輯欄位，
並顯示每條規則的解析區間。修改展開結果後標示 `Customized after applying`；套用失敗保留原草稿。
HBM example 只適用於單一 root HBM generator v2 geometry，其尺寸是示範值而非部門標準。
Controls區塊預設收合；`Mesh controls` heading與description下方依序是set選項和`Expand` +
chevron text control。展開時只有`Collapse`按鈕、規則說明與local controls以border包住，
heading與set選項位於border上方；下方顯示empty state或control cards與`Add control`。
收合不得清空draft。Controls初始為空，可新增/刪除；`Add control`固定放在empty
state或既有control cards的下方並靠右。
Method下拉直接使用`Z_SECTION_AVG`、`Z_SECTION_TOP`、
`Z_SECTION_BOT`、`Z_SECTION_CENTER`、`Z_POINT`；reference的kind、key、id皆為互相獨立的text input，
不因kind清空、停用或篩選其他欄位，也不提供geometry picker。每個control是獨立bordered card：header顯示
1-based編號、constraint type與delete；body的第一列並排Method與Element size，desktop欄寬分別為
220px與140px，後續是Geometry reference
(kind/key/id)與Z range；`Z_POINT`沒有Element size，Method維持單欄。Start與End各自使用sub-card並以arrow連接。Relative location依序顯示mode、
`z_min|z_max` anchor與offset；absolute location保留相同三欄寬度，anchor位置顯示停用的`—`，最後一欄為全域Z value。
`Z_SECTION_*`顯示local element size、startZ與endZ；`Z_POINT`只顯示z。Geometry reference label旁顯示
info control；展開後以floating block從當前preview
structure遞迴列出所有有non-empty key的container/body kind + key組合，以trim後的kind/key去重並依
kind、key排序。每列一筆，清單有固定max-height與vertical scrollbar，並可用text input對kind或key做
case-insensitive contains search；點外部或按Escape關閉。清單只供查閱，不會修改draft。

Client只做基本輸入檢查：global/local size必須finite且`>0`、location數值必須finite。Reference、
method欄位組合及其他mesh-control contract規則由mesher validator負責；frontend不複製這些規則，也
不檢查reference是否存在、resolved Z、bounds、start/end順序或overlap。接著檢查path required、path以
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

Lifecycle status與執行stage是兩個不同軸。既有六種status維持相容；`running` job另帶：

```ts
type FileExportProgress = {
  stage:
    | "preparing" | "validating" | "analyzing_geometry"
    | "building_2d_mesh" | "building_3d_mesh"
    | "building_cad_model" | "writing_output" | "finalizing";
  current: number | null;
  total: number | null;
  unit: "features" | "layers" | "bodies" | "records" | null;
  message: string | null;
  stageStartedAt: string;
  updatedAt: string;
};
```

| Kind | Stage順序 |
| --- | --- |
| JSON | preparing → writing_output → finalizing |
| STEP | preparing → validating → analyzing_geometry → building_cad_model → writing_output → finalizing |
| CDB | preparing → validating → analyzing_geometry → building_2d_mesh → building_3d_mesh → writing_output → finalizing |

Circle imprint/extension及所有2D feature meshing都屬於`building_2d_mesh`；不存在獨立的
`processing_features` stage。只有`current/total`皆可靠且`total > 0`時才顯示determinate progress；
stage沒有可靠total時使用activity bar，不推算整體百分比或ETA。Queued job另顯示1-based
`queuePosition`，running/terminal job提供`runElapsedSeconds`。

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
Kind、CDB mesher/global size/symmetry/control count/mesh、Queue position、Stage/progress/elapsed/last activity、Duration、
Created/Started/Finished、Job ID、Log path、Message、Warning。

Popover top依row rect計算，至少16px且不超viewport。CDB detail顯示建立job時使用的完整mesh-control
摘要；實際的worker diagnostics或cleanup warning仍顯示在job row。
它是pointer-events none，不能承載command。

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
- Job status/stage updates透過polite live region宣告；determinate progress bar提供
  `aria-valuemin/max/now`。
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
| `UI-EXPORT-008` | running job stage更新 | row顯示stage/message/live elapsed，mobile不依賴popover。 |
| `UI-EXPORT-009` | reliable current/total | 顯示stage progress與可存取value；無total時不顯示假百分比。 |
| `UI-EXPORT-010` | queued job | 顯示queue position；開始執行後position消失。 |
