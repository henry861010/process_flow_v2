---
title: UI Acceptance 與 Visual Regression
status: normative
owner: Process Flow UI
audience:
  - QA
  - frontend
  - reconstruction-agent
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
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

`AREA` 只使用 `HOME`、`FLOW`、`PSTE`、`CAD`、`GRAPH`、`LIB`、`PARAM`、
`PLACE`、`PREVIEW`、`EXPORT`、`HBM`、`GEN`、`MGMT`。Case ID 不因 test framework 或檔名改變。

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
| HBM Editor default | `hbm-editor-1440x900.png` pending | `hbm-editor-1024x768.png` pending | `hbm-editor-390x844.png` pending |
| Management ready | `management-1440x900.png` pending | `management-1024x768.png` pending | `management-390x844.png` pending |
| Flow fresh | `flow-editor-fresh-1440x900.png` pending | `flow-editor-fresh-1024x768.png` pending | `flow-editor-fresh-390x844.png` pending |
| Flow / Alpha selected | `flow-editor-saved-1440x900.png` pending | `flow-editor-saved-1024x768.png` pending | `flow-editor-saved-390x844.png` pending |
| CAD demo | [cad-viewer-1440x900.png](../assets/reference/cad-viewer-1440x900.png) | `cad-viewer-1024x768.png` pending | `cad-viewer-390x844.png` pending |
| Geometry Preview ready | `geometry-preview-1440x900.png` pending | `geometry-preview-1024x768.png` pending | `geometry-preview-390x844.png` pending |

實際相對路徑一律是 `../assets/reference/<filename>`（由本文件所在目錄計算）。Pending
asset 不得造成 semantic test 被跳過。

`assets/reference/` 只存已接受 target state。Browser 檢閱中擷取的 current implementation
screenshot、gap reproduction 或尚未決定的畫面，必須存於
[../evidence/README.md](../evidence/README.md) 所定義的 evidence 層，不得直接升格為
normative reference。

Home 與 editor reference 必須使用歸零後 fixtures 重拍；仍含舊版 label 的 screenshot
不得當成 normative baseline。

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
| `UI-HOME-001` | reset fixtures loaded | open `/` | 每個 flow 顯示一張 card，metadata 與 flow count 正確，Open／Copy 進入統一編輯器。 |
| `UI-GEN-001` | Home ready | click `Create HBM`或`Create DRAM` | navigate至專用editor並載入正確generator definition。 |
| `UI-HBM-004` | valid HBM parameters | click Generate JSON | 下載合法純GeometryStructure，root molding與child dies符合HBM mapping。 |
| `UI-HBM-007` | valid HBM parameters與metadata | click Save to DB | catalog建立`die.hbm` immutable geometry並回報server id。 |
| `UI-MGMT-001` | bootstrap 與 draft summaries ready | open Management tabs | Flows、Geometries、Process steps、Drafts 四類 count 與 rows 符合 bootstrap 及統一草稿摘要。 |
| `UI-MGMT-002` | Process steps tab | click row Edit、change allowed fields/default、Save | 頁內modal只暴露允許欄位；成功後row即時更新且不導頁。 |
| `UI-MGMT-009` | Process step input ports | Move up/down with mouse or keyboard、Cancel／Save and reopen | 順序可修改且首尾與saving按鈕停用；Cancel丟棄排序，Save保留排序，port definitions與output ports仍鎖定。 |
| `UI-MGMT-005` | Flows tab | Edit → modify topology/metadata/recipes → Save or Save as | 進入統一編輯器；更新遞增 revision，另存獨立 configuration 並記錄直接 origin，來源不連動。 |
| `UI-MGMT-006` | Flows 與來源副本 | cancel/confirm Delete；模擬 stale revision | 取消無請求，DELETE 帶 revision，成功只移除目標 flow，副本／草稿／geometry／step 保留；409 不自動重試。Process steps 保留 Edit，沒有 Delete。 |
| `UI-MGMT-007` | Geometries 含被 flow／draft 引用的 geometry | cancel/confirm Delete；解除引用後再刪除 | catalog 引用回傳 409 並指出來源；generator binding 不誤擋；成功更新 row/count，不連帶刪除其他資源，失敗保留資料。 |
| `UI-MGMT-008` | 跨多個 users 的 FlowDrafts，包含 target flow 已刪除 | 查看 Drafts、Resume、cancel/confirm Delete；模擬 stale revision | 單一列表、更新時間由新到舊；不依附 flow scope；刪除帶 revision，409 保留資料並要求重新確認；草稿仍可恢復並另存，Reset／ZIP reset 清空草稿。 |
| `UI-GRAPH-001` | node in view mode | single-click node | screen-level dialog開啟；不要求 double-click。 |
| `UI-GRAPH-012` | inputPorts reordered around primary | reload Flow Editor；Arrange | 接口依宣告順序；primary 同排，前置 auxiliary 在上、後置在下；未接 primary、巢狀與 disconnected 區塊不重疊，portId 接線維持原語意。 |
| `UI-PREVIEW-001` | ready step target in Flow Editor | click Preview | 依採用 recipe 與 upstream closure，Geometry Preview loading 後 ready。 |
| `UI-PREVIEW-002` | ready geometry input、其他站點不完整 | click Preview | input 可預覽，不要求無關站點選 recipe 或填完值。 |
| `UI-PREVIEW-017` | feature view on + section plane inside feature envelope | drag/settle | 3D cross-section與2D顯示同一Estimated pattern，不依glyph row。 |
| `UI-PREVIEW-018` | exact body empty/loading + feature non-empty | open/drag section | Estimated layer仍立即顯示，Exact狀態獨立。 |
| `UI-PREVIEW-019` | embedded/partial/gap feature fixture | orbit full view | embedded不可見，partial與die-gap feature可見。 |
| `UI-PREVIEW-020` | 雙側 bump seed flow 完成 Joint | select child bump | Stage 顯示 joined，die 側 material/density/direction 保留。 |
| `UI-PREVIEW-021` | lower reflowed + descendant joined bump | inspect envelope/detail/section | 遮蔽 lower 的接合 XY columns；非接合區與 holes 保留，GeometryStructure 不變。 |
| `UI-EXPORT-001` | ready preview | submit valid JSON path | job加入 drawer，狀態從 queued/running到 terminal。 |
| `UI-EXPORT-002` | running job | cancel | 先顯示 canceling，再顯示 canceled或 server terminal result。 |
| `UI-EXPORT-008` | ready preview，Export form open | press Escape while idle | 只關閉 Export form，Geometry Preview 保持開啟；submitting 時 Escape 不關閉。 |
| `UI-CAD-001` | axis view X、imported model | Reset | demo回復且 camera仍為 X view並重新 fit。 |
| `UI-PARAM-020` | scalar fieldGroupArray、同名或自訂 CSV 表頭 | 選檔並將 pm 對應 Dielectric | 同名自動預填、確認前不改值，確認後以系統 key 一次取代；額外欄位明示忽略。 |
| `UI-PARAM-023` | 後列值不合法或待確認期間群組改變 | 確認匯入、修正 mapping、手動 edit、disable | 失敗保留原值與 mapping 並指出行號/來源欄位/target key；群組異動取消待處理匯入。 |
| `UI-PARAM-024` | mapping 區塊 | 檢查 1440×900／390×844 與鍵盤操作 | 對應表不溢出，label/error/focus 與確認/取消可用。 |
| `UI-PLACE-001` | placement cards | add/remove/reorder | persisted array與execution order一致。 |
| `UI-PLACE-003` | invalid polygon points/edges/area | edit vertex | inline diagnostics顯示且configuration不算complete。 |
| `UI-PLACE-004` | GDS rotated/reflected polygon | import | exact absolute polygon與fixed zero pose/center anchor取代原placements。 |
| `UI-PLACE-009` | open placement editor | click optional `Import from GDS` input | placement list不位移，portal modal顯示fields。 |
| `UI-PLACE-010` | placement editor/readonly | inspect coordinates | absolute target region、fixed zero pose/center anchor，不提供pose/anchor編輯。 |
| `UI-PLACE-011` | GDS含non-orthogonal polygon | import with Defeature off | exact polygon匯入並顯示non-blocking mesher warning。 |
| `UI-PLACE-012` | 大型外框含圓角、圓形凹槽或凸起 | import with Defeature | 凹口保留為矩形凹口，階梯外框與元件間隔保留，摘要顯示repair數。 |
| `UI-PLACE-013` | GDS含純圓形或無法安全局部修復的polygon | import with Defeature | 保留原形，amber摘要顯示未修復數、placement編號與原因，並顯示mesher warning。 |
| `UI-PLACE-028` | 四象限鏡射、SREF/AREF與巢狀旋轉縮放GDS含平底圓弧凹口 | import with Defeature | 修復與鏡射交換後得到相同輪廓，階梯與凹口深度保留，不新增鄰近元件重疊。 |
| `UI-PLACE-029` | 負座標、半格座標與nm／µm／mm | import in each unit | 換算後對應同一物理輪廓，小數頂點不被固定單位量化抹除。 |
| `UI-PLACE-014` | GDS patterns含多組layer/datatype與不同cell filter | import | exact pair以OR合併，共用Defeature並整批取代placements。 |
| `UI-PLACE-015` | GDS pattern incomplete、invalid或pair重複 | inspect import action | 列級diagnostic顯示且Import and replace停用。 |
| `UI-PLACE-016` | 手動新增或修改出不合法placement | inspect placement list | 清單上方紅色摘要即時顯示不合法數量；修正或移除後更新，且step readiness與個別紅框一致。 |
| `UI-PLACE-017` | GDS匯入結果包含不合法placement | import and replace | 仍整批匯入；完成摘要改為紅色並顯示fail數，提醒使用者向下檢查紅框項目。 |
| `UI-PLACE-018` | GDS import modal open, idle or import succeeds | tab through controls; close with Cancel/Close/backdrop/Escape, or complete import | focus保持在modal內；idle close只關閉GDS modal並保留draft、focus回trigger；success自動關閉且摘要留在placement list上方。 |

| `UI-PLACE-019` | shared placement layout | edit, zoom/pan, Fit all, import/source replacement | edit保留視角，替換重新fit；一般wheel捲動表單，鍵盤arrows/+/-/Home可用。 |
| `UI-PLACE-020` | overlapping shapes/cards | select shape、focus card，再add/remove/reorder | 較後shape優先，card heading取得focus並同步高亮；結構改變清除selection。 |
| `UI-PLACE-021` | incomplete/invalid placements | edit or clear | finite invalid虛線無填色，缺座標不畫，empty不殘留圖。 |
| `UI-PLACE-022` | 1,000 placements、readonly | inspect desktop/390px and navigate | 全數繪製且可互動；readonly不改值/dirty state，無page-level horizontal overflow。 |

| `UI-PLACE-023` | shared placement layout | inspect initial view; toggle help; Escape | 無統計/座標/編號定位/footer，右上驚嘆號按需顯示操作說明，不推動cards或關閉editor。 |

| `UI-PLACE-024` | placement preview after zoom/pan | Add placement and enter distant coordinates | 自動fit全部形狀；手動操作camera後保持視角；無標題列，controls在圖內右下。 |
| `UI-PLACE-025` | flow中step A成功匯入GDS | close A; open B GDS modal | 自動沿用檔案，body/footer完整顯示可選取換行的檔名、不顯示沿用提示，可換檔；各step的patterns與Defeature獨立。 |
| `UI-PLACE-026` | GDS已有共用預設 | choose replacement; cancel picker/modal, fail, or complete import | picker取消保留選檔，modal取消保留pending；僅成功套用才更新預設，不改其他step placements；stale response無效。 |
| `UI-PLACE-027` | editor記住GDS | load flow/source/draft/blank, cancel switch, or reload | 成功替換/reload清除，取消切換保留，獨立editor session不共用。 |

完整的 screen/component cases 分散在各規格的「Acceptance」段落。中央 suite 只列跨元件
或 release-blocking path。

## Cross-screen journey review

Review 不只驗證單一 component，還 MUST 依下列順序走完跨 screen journey：

| Journey | Entry | Required transition | Completion evidence |
| --- | --- | --- | --- |
| Flow topology | fresh `/flow-editor` | Step add → Geometry add → valid connect → Save Flow → save dialog | metadata只在dialog顯示、topology remains editable、configuration仍可編 |
| Flow recipes | Home Alpha flow card | 候選新增／複製／查看／採用 → Preview → 更新／另存 | 兩組值獨立，重載保留採用，409 保留內容 |
| Catalog geometry | Home Create HBM/DRAM | parameters → Preview → Save to DB | success留在editor並顯示new geometry id |
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

## Editor draft acceptance

統一編輯器驗證 Save Draft、Resume、user/name、搜尋、作者篩選、更新時間排序、revision 更新／刪除、另存草稿、失敗保留與 dirty confirmation。FlowDraft 保存 topology、positions、viewport、完整 configuration、目前查看 recipe 與 target revision。正式 commit 使用目前畫布內容，flow 寫入與草稿刪除為同一 transaction；重載不重新套用 defaults。

## Unified Flow acceptance

新增流程、候選 recipes、草稿、衝突與另存以 [Flow Editor cases](../screens/flow-editor.md) 為準；舊 FTE／FIE cases 已退場，歷史操作證據留在 evidence 目錄。新流程不鎖 topology，不要求完整設定才可保存。

本次操作紀錄見 [Unified editor evidence](../evidence/unified-flow-editor/README.md)。
