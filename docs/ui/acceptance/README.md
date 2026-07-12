---
title: UI Acceptance 與 Visual Regression
status: normative
owner: Process Flow UI
audience:
  - QA
  - frontend
  - reconstruction-agent
last_verified: 2026-07-12
last_verified_commit: 2b9cad3675483da156a92d0a08ec12671f4f1b62
source_of_truth:
  - docs/ui/screens
  - docs/ui/components
  - apps/api/src/process_flow_api/fixtures
---

# UI 驗收與 Visual Regression

## 測試識別碼

每個 case 使用穩定 ID：

```text
UI-<AREA>-<三位數>
```

`AREA` 只使用 `HOME`、`FTE`、`FIE`、`PSTE`、`CAD`、`GRAPH`、`LIB`、`PARAM`、
`COORD`、`PREVIEW`、`EXPORT`。Case ID 不因 test framework 或檔名改變。

## 環境契約

Visual capture MUST：

1. 啟動 API 與 Viewer，確認 network idle。
2. 呼叫 POC reset，等待 bootstrap reload 完成。
3. 使用 Chromium、browser zoom `100%`、device scale factor `1`、light scheme、
   reduced motion、locale `en-US`、timezone `Asia/Taipei`。
4. viewport 使用 `1440×900`、`1024×768`、`390×844`，不可包含 browser chrome。
5. 等待 fonts、icons、React Flow fitView、GLB load 與必要 API requests 完成。
6. 動態值（job UUID、timestamp）在 fixture/test adapter 固定；不得以大區塊遮罩掩蓋 layout。
7. screenshot 寫入 `docs/ui/assets/reference/`，檔名完全依下表。
8. Asset MUST 是真正的 PNG data，pixel dimensions 必須和檔名一致；
   `venv/bin/python scripts/check_docs.py` 會拒絕 MIME/extension 或尺寸不一致。

Animation screenshot 在 reduced-motion 下擷取穩定 frame；spinner acceptance 以 semantic/state
assertion為主。

## Reference 圖片矩陣

`present` 表示 repository 內應存在；`pending` 表示已保留固定路徑，尚待補圖。

| Screen/state | 1440×900 | 1024×768 | 390×844 |
| --- | --- | --- | --- |
| Home ready | `home-1440x900.png` pending | `home-1024x768.png` pending | `home-390x844.png` pending |
| Flow Template fresh | `flow-template-editor-1440x900.png` pending | `flow-template-editor-1024x768.png` pending | `flow-template-editor-390x844.png` pending |
| Flow Instance / CoWoS-L selected | `flow-instance-editor-1440x900.png` pending | `flow-instance-editor-1024x768.png` pending | `flow-instance-editor-390x844.png` pending |
| Step Template fresh | `step-template-editor-1440x900.png` pending | `step-template-editor-1024x768.png` pending | `step-template-editor-390x844.png` pending |
| CAD demo | [cad-viewer-1440x900.png](../assets/reference/cad-viewer-1440x900.png) | `cad-viewer-1024x768.png` pending | `cad-viewer-390x844.png` pending |
| Geometry Preview ready | `geometry-preview-1440x900.png` pending | `geometry-preview-1024x768.png` pending | `geometry-preview-390x844.png` pending |

實際相對路徑一律是 `../assets/reference/<filename>`（由本文件所在目錄計算）。Pending
asset 不得造成 semantic test 被跳過。

`assets/reference/` 只存已接受 target state。Browser 檢閱中擷取的 current implementation
screenshot、gap reproduction 或尚未決定的畫面，必須存於
[../evidence/README.md](../evidence/README.md) 所定義的 evidence 層，不得直接升格為
normative reference。

Home 與 editor reference 必須等 `DM-020`／`UI-GAP-VERSION-LABEL-001` 關閉後重拍；不得把
仍含 release-like label 的 current screenshot 當成 normative baseline。

## 圖片比較門檻

- Canvas/WebGL 與 font antialiasing 可用 per-pixel threshold `0.12`，全圖 differing pixels
  不得超過 `0.5%`。
- 非 Canvas UI differing pixels 不得超過 `0.1%`。
- 禁止用 threshold 接受 pane 消失、copy 改變、button order 改變、scrollbar owner 改變。
- 3D demo 的 camera、bounds 與 section state必須固定；WebGL renderer差異應裁切到 viewport
  另比對，不影響 surrounding UI。

## 必要語意測試套件

| ID | Given | When | Then |
| --- | --- | --- | --- |
| `UI-HOME-001` | reset fixtures loaded | open `/` | table同時顯示 instances與 template-only rows，header counts正確。 |
| `UI-FTE-001` | fresh Template draft | add step by click | step出現在 graph，Node Editor以單擊可開啟。 |
| `UI-FTE-002` | topology valid、configuration incomplete | Save Template → complete save dialog | metadata不在editor常駐顯示；template保存、topology locked、configuration仍可編輯。 |
| `UI-FIE-001` | no selected template | select CoWoS-L | read-only topology出現、default configuration建立。 |
| `UI-FIE-002` | fresh或known workspace URL | inspect header | `Save Draft`、`Reload`與workspace badge/status box都不render。 |
| `UI-FIE-003` | known saved clean complete workspace | Commit Instance → enter identity | workspace成為committed，configuration controls locked。 |
| `UI-GRAPH-001` | node in view mode | single-click node | screen-level dialog開啟；不要求 double-click。 |
| `UI-PREVIEW-001` | ready target in Template Editor | click Preview | 共用 Geometry Preview loading後 ready。 |
| `UI-PREVIEW-002` | ready target in Instance Editor | click Preview | 行為與 Template Editor相同。 |
| `UI-PREVIEW-017` | feature view on + section plane inside feature envelope | drag/settle | 3D cross-section與2D顯示同一Estimated pattern，不依glyph row。 |
| `UI-PREVIEW-018` | exact body empty/loading + feature non-empty | open/drag section | Estimated layer仍立即顯示，Exact狀態獨立。 |
| `UI-PREVIEW-019` | embedded/partial/gap feature fixture | orbit full view | embedded不可見，partial與die-gap feature可見。 |
| `UI-EXPORT-001` | ready preview | submit valid JSON path | job加入 drawer，狀態從 queued/running到 terminal。 |
| `UI-EXPORT-002` | running job | cancel | 先顯示 canceling，再顯示 canceled或 server terminal result。 |
| `UI-EXPORT-008` | ready preview，Export form open | press Escape while idle | 只關閉 Export form，Geometry Preview 保持開啟；submitting 時 Escape 不關閉。 |
| `UI-CAD-001` | axis view X、imported model | Reset | demo回復且 camera仍為 X view並重新 fit。 |
| `UI-COORD-001` | duplicate/invalid/zero-area coordinate rectangle rows | edit row | inline diagnostics顯示且 configuration不算 complete。 |

完整的 screen/component cases 分散在各規格的「Acceptance」段落。中央 suite 只列跨元件
或 release-blocking path。

## Cross-screen journey review

Review 不只驗證單一 component，還 MUST 依下列順序走完跨 screen journey：

| Journey | Entry | Required transition | Completion evidence |
| --- | --- | --- | --- |
| Template topology | fresh `/flow-template-editor` | Step add → Geometry add → valid connect → Save Template → save dialog | metadata只在dialog顯示、topology locked、configuration仍可編 |
| Instance configuration | `/flow-instance-editor` + CoWoS-L；另備known clean workspace URL | bind → edit → Preview；known workspace → Commit dialog | draft UI保持隱藏、dirty與committed state正確 |
| Preview/export | ready input/step target | Loading → Ready → Export form → job terminal | Preview不被下層 overlay close path 誤關 |
| CAD workbench | `/cad-viewer` demo | import/section/camera → Reset | model/error清理且 camera view保留 |

Journey 中的 current gap 必須保留原操作路徑並標記 gap ID；不可用另一條操作路徑把 failure
隱藏。

## Accessibility 驗收門檻

- 無 mouse 可完成 Home navigation、forms、save/commit、Preview close、Export form與 jobs
  panel操作；Geometry drag-only gap除外且必須保留已知 failure test。
- 自製 modal 的 `role`、label、focus trap、focus restore 必須通過。
- status 不能只有顏色；graph status badge、job label、error copy都需可讀。
- 390px viewport 不得有整頁 horizontal scroll；若已知現況違反，測試標記對應 gap而非靜默
  調大 viewport。

## 審查清單

- [ ] Screenshot 使用 canonical fixture 與固定 viewport。
- [ ] Visible copy 與 icon mapping 完全一致。
- [ ] Loading/empty/error/disabled/locked states 都有 semantic case。
- [ ] Keyboard focus sequence與 Escape behavior已驗證。
- [ ] Nested modal 的最上層 close path 已驗證，Export form Escape 不會穿透到 Preview。
- [ ] Desktop、compact、mobile 的 scroll owner一致。
- [ ] 新增或變更的 acceptance ID 已回連對應規格。
