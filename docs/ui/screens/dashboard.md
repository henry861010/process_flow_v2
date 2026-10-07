---
title: Job Dashboard
status: normative
owner: Process Flow UI
audience:
  - operators
  - frontend
  - QA
last_verified: 2026-10-07
last_verified_commit: 7308bb19
source_of_truth:
  - apps/viewer/app/dashboard/page.tsx
  - apps/viewer/components/dashboard
  - apps/api/src/process_flow_api/file_export_jobs.py
---

# Job Dashboard

Route: `/dashboard`. Dashboard 是公開唯讀的即時 export 監控頁，資料來自
`GET /api/dashboard/jobs`，涵蓋所有 client 的 CDB、STEP、JSON。沿用
[Design System](../design-system.md) 的淺色 tokens、字體與 Lucide icons。

## 畫面與資料

Header 顯示 `Job dashboard`、`Live export activity across the service.`、Back to home、
connection badge 與 `Refresh`。總覽 cards 是 `Running`（數量／並行上限）、`Queued` 與
`Last updated`。時間用使用者的本地時區顯示。首次載入以 `—` 表示未知數量，不先顯示零。

`Running jobs` 包含 running/canceling，依接受順序排列；`Waiting queue` 依全域 FIFO 排列。
桌面從 md (768px) 起使用 semantic tables，窄螢幕改為 cards。Job ID 全文可換行。
Running row 顯示格式、ID、status、目前 stage、細部動作說明、stage progress 與 elapsed；queued row 顯示
格式、ID、status、1-based queue position 與 waiting duration。Canceling 仍占執行額度。
終態 job 從下一次成功快照消失；不提供歷史、取消或輸入／輸出下載。

只有 current/total 皆 finite，且 `0 <= current <= total`、`total > 0` 時顯示 stage 百分比、
計數與 progressbar；否則顯示 `In progress`。沒有 progress 時顯示 `Starting export`。
不估算整體百分比或 ETA。各 stage 名稱與既有
[Export Jobs](../components/export-jobs.md) 相同。

Stage 下方顯示與使用者 export drawer 相同的細部進度說明，例如
`Imprinting feature 3 of 10.`、`Assigning feature 2 of 5 in layer 3 of 12.`、
`Converted body 3 of 10.` 或 `Writing CDB nodes.`。只有 API allowlist 的固定文案與
純數字模板會公開；未知訊息為 null，介面保留 stage 與 progress。桌面與手機皆顯示，
沒有可靠 total 時也保留動作說明。

公開回應與畫面不包含 clientId、sourceLabel、主機 paths、meshControl、任意 worker
message/warning 或 geometry。Stage 名稱由既定 enum 對應介面文字。

## 更新與錯誤

- 開頁立即載入；有工作時在請求完成後 2 秒再 poll，閒置或錯誤時 5 秒。
- 每秒以 server elapsed 加 client monotonic clock 差值更新顯示，不使用 client wall clock
  減去 server timestamp。失敗或成功快照超過 10 秒時凍結計時。
- 請求最多 10 秒，不重疊；Refresh 在請求期間停用。隱藏分頁取消請求、停止 polling 與
  clock；回前景立即載入。離頁清除 timers、listener 與 request，忽略過期回應。
- Loading 顯示 `Loading export jobs…`。零工作時各 section 顯示 `No jobs running` 或
  `No jobs waiting`。
- 失敗保留已知資料，badge 改為 `Updates paused`，顯示 `Showing last known status` 與
  `Elapsed times are paused until a fresh update arrives.`；首次失敗顯示 `Unable to connect`。
  錯誤訊息使用固定文案，恢復後清除並以最新快照校正。

Status 與計數更新由 polite live region 宣告，每秒耗時不朗讀。Progressbar 有 accessible
name、min/max/now。Icon 為 decorative；狀態不單靠顏色。Refresh spinner 尊重 reduced motion。

## 驗收

| ID | 情境 | 結果 |
| --- | --- | --- |
| `UI-DASH-001` | 多個 client 提交三種格式 | 全域 running/queued 計數與 rows 一致。 |
| `UI-DASH-002` | queued → running → terminal | 順位更新、計時切換、終態移除；canceling 仍計入 running。 |
| `UI-DASH-003` | stage 有／無可靠 total | 僅可靠值顯示 stage 百分比，無假整體進度。 |
| `UI-DASH-004` | refresh 失敗／超時／恢復 | 保留舊資料、標示 stale、凍結 timer，成功後校正。 |
| `UI-DASH-005` | 隱藏、回前景、離頁、手動 refresh | 正確暫停／恢復，不重疊或留下 timers。 |
| `UI-DASH-006` | 390px 與 1440px | cards/table 切換，無 document horizontal overflow。 |
| `UI-DASH-007` | 首次 loading／失敗、零工作 | 未知值不顯示零，錯誤與 empty 明確區分。 |
| `UI-DASH-008` | worker 的細部動作更新 | 桌面／手機在 stage 下顯示最新允許的動作；未知訊息不公開。 |

Queue 是單一 API process 的記憶體狀態；restart 清空，不跨多個 process 彙總。
