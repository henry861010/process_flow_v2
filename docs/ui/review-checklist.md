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
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
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
- [ ] 單一 Flow 列表，不再分 template／instance。
- [ ] filter、`shown`、table horizontal scroll owner 正確。
- [ ] 390px 時 document 無 horizontal overflow，只有 table wrapper 可水平捲動。
- [ ] `cmd: reset-poc-data` 的 icon、title、aria-label 與 fixed position 正確。

### Flow Editor

- [ ] fresh state 顯示空 graph、兩側 library 與 disabled save command。
- [ ] Step item 可 click-add；Geometry drag-only gap 仍記錄為 `UI-GAP-DRAG-001`。
- [ ] Edit button／double-click 可開站點面板，單擊供接線使用。
- [ ] 正式 metadata 於 Save dialog 編輯；保存後仍可修改 topology。
- [ ] 合法拓樸、未完成 configuration 可正式保存；無效已提供值或拓樸時只有新 flow 能存草稿。
- [ ] Step details 置頂且直接顯示，不顯示內部 `stepRefId`；其後為 Active recipe 摘要與套用選單。卡片僅列名稱、ID、parameter 名稱，右側 Edit 與卡片本身皆可開編輯視窗，儲存／取消正確，description 不顯示。
- [ ] Add 位於卡片區右下；Delete 位於各卡片右側且需確認；刪除已套用者改採相鄰候選，最後一張刪除後為 null。
- [ ] 已套用 placements 只顯示 graph；編輯視窗仍能編輯每筆 placement。
- [ ] 新 flow 保存／恢復同一份草稿包含畫布、viewport、候選與採用狀態，讀取不套 defaults；正式 Save 後不再提供 Save Draft。
- [ ] 正式更新使用原 ID 與 revision；409 保留內容，提供取消與確認 Reload。
- [ ] 既有 flow 與管理頁沒有 Copy、Save As、Save Draft。
- [ ] ready target 可 Preview；無關 incomplete branch 不阻擋。
- [ ] commit 成功後才原子刪除來源草稿；失敗保留。
- [ ] `1024×768` 檢查 right pane 是否裁切，引用 `UI-GAP-RESP-001`。

### Management process-step editing

- [ ] 每個 process-step row 顯示 Edit，且沒有 standalone editor link。
- [ ] modal identity/contract read-only，只能改 owner、category、program 與 defaults。
- [ ] default enable/clear、Save error、Cancel/Escape/backdrop 與 focus restore 正確。
- [ ] 保存成功後同一個 Management row 即時更新，不切換 route。

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
