---
title: UI Implementation Review Checklist
status: normative
owner: Process Flow UI
audience:
  - product
  - design
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - docs/ui/reconstruction-guide.md
  - docs/ui/acceptance/README.md
  - docs/conformance.md
---

# UI Implementation Review Checklist

本文件用於 project implementation review 與實際畫面檢閱。Reviewer 必須把「target 是否
清楚」與「current 是否符合」分開記錄；發現落差時引用 `docs/conformance.md` 的 gap ID，
不得直接修改 normative 規格來消除差異。

## Review 前置條件

- [ ] API 與 Viewer 已啟動，瀏覽器使用 Chromium。
- [ ] 已呼叫 POC reset，bootstrap data 已完成載入。
- [ ] browser zoom `100%`、light scheme、locale `en-US`、timezone `Asia/Taipei`。
- [ ] 已檢查 `1440×900`、`1024×768`、`390×844`。
- [ ] 已確認 screenshot 不包含 browser chrome，且動態 job/timestamp 已固定或不列入 pixel baseline。
- [ ] WebGL / font / icon 載入完成後才進行視覺判定。

## Screen review

### Home

- [ ] Header counts 與 bootstrap 一致。
- [ ] instance rows 與 template-only rows 同時顯示。
- [ ] filter、`shown`、table horizontal scroll owner 正確。
- [ ] 390px 時 document 無 horizontal overflow，只有 table wrapper 可水平捲動。
- [ ] `cmd: reset-poc-data` 的 icon、title、aria-label 與 fixed position 正確。

### Flow Template Editor

- [ ] fresh state 顯示空 graph、兩側 library 與 disabled save commands。
- [ ] Step item 可 click-add；Geometry item 的 drag-only 行為若仍存在，標記 `UI-GAP-DRAG-001`。
- [ ] node 單擊開啟 inspector；double-click 不得是唯一路徑。
- [ ] valid topology + incomplete configuration 可 Save Template 並鎖 topology。
- [ ] `1024×768` 明確檢查 right pane 是否裁切，引用 `UI-GAP-RESP-001`。

### Flow Instance Editor

- [ ] 選擇 CoWoS-L 後 default configuration、workspace name、dirty status 正確。
- [ ] graph 是 view-only；single-click node 開啟 inspector。
- [ ] ready target 可 Preview；unrelated incomplete branch 不阻擋。
- [ ] Save Draft、Reload、409 stale revision、Commit 的 status/copy 正確。
- [ ] committed 後 configuration read-only，但 ready Preview 仍可用。

### Process Step Template Editor

- [ ] fresh library、search、identity、ports、parameters、JSON payload 順序正確。
- [ ] clone 是 deep clone 並清空 id；既有 template 不可 in-place update。
- [ ] primary input/output invariant、auxiliary port add/remove、parameter reorder 正確。
- [ ] schema generation badge 與 release-like version label 若仍存在，引用 `DM-020` / `UI-GAP-VERSION-LABEL-001`。

### CAD Viewer / Geometry Preview

- [ ] viewport / right pane 順序、min-height、scroll owner 與 breakpoint 正確。
- [ ] Section、Axis、Grid、Axes、Camera 的 default 與 disabled state 正確。
- [ ] CAD Reset 保留 current camera view；import error 保留原 model。
- [ ] Preview 狀態完整覆蓋 Loading、Ready、Error、GLB loading/error。
- [ ] Preview footer 與 Export form z-index、backdrop、close path 正確。

## Interaction and accessibility review

- [ ] 不使用 mouse 仍可完成 navigation、form、save/commit、Preview close、Export form、jobs panel。
- [ ] native button、link、input、select、summary、tabs、switch 都能 Tab 到達。
- [ ] icon-only command 有 title 與 accessible name。
- [ ] disabled command 的第一個 blocking reason 不只存在 hover tooltip。
- [ ] modal 有 `role="dialog"`、`aria-modal`、label、initial focus、focus trap、focus restore。
- [ ] Escape 只關閉最上層 overlay；Export form 不得關閉 Preview 或 underlying inspector。
- [ ] status、error、job state 不只靠顏色或 animation 傳達。

## Evidence recording

每個 review result 使用下列格式：

```text
Route/state:
Viewport:
Acceptance ID:
Result: aligned | gap | pending
Observed:
Expected:
Evidence: screenshot path / DOM assertion / code path
Gap ID:
```

Current implementation screenshot 放在 `docs/ui/evidence/` 或 review artifact；只有 accepted
target screenshot 才能放入 `docs/ui/assets/reference/`。

## Review completion

- [ ] 所有 screen/component acceptance 已有 pass/fail/pending 結果。
- [ ] 每個 gap 都有 conformance ID，且沒有在 screen 文件重複維護狀態。
- [ ] reference screenshot 的 fixture、viewport、copy、icon、scroll owner 已核對。
- [ ] `venv/bin/python scripts/check_docs.py` 通過。
- [ ] 若 UI code 同時變更，screen/component spec、acceptance、reference 與 conformance 已在同一 change set 更新。

