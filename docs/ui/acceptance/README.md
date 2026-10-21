---
title: UI Acceptance 與 Visual Regression
status: normative
owner: Process Flow UI
audience:
  - QA
  - frontend
  - reconstruction-agent
last_verified: 2026-10-21
last_verified_commit: 5e9dd07d
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
`PLACE`、`PREVIEW`、`EXPORT`、`HBM`、`GEN`、`MGMT`。Case ID 不因 test framework 或檔名改變。

## 環境契約

Visual capture MUST：

1. 啟動 API 與 Viewer，確認 network idle。
2. 在隔離 fixture database 呼叫 POC reset，或啟動全新 seeded database，等待 bootstrap reload 完成；不得清除開發者的工作資料。
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
| Home ready | [home-1440x900.png](../assets/reference/home-1440x900.png) | [home-1024x768.png](../assets/reference/home-1024x768.png) | [home-390x844.png](../assets/reference/home-390x844.png) |
| HBM Editor default | `hbm-editor-1440x900.png` pending | `hbm-editor-1024x768.png` pending | `hbm-editor-390x844.png` pending |
| Management ready | `management-1440x900.png` pending | `management-1024x768.png` pending | `management-390x844.png` pending |
| Flow Template fresh | `flow-template-editor-1440x900.png` pending | `flow-template-editor-1024x768.png` pending | `flow-template-editor-390x844.png` pending |
| Flow Instance / AAA selected | `flow-instance-editor-1440x900.png` pending | `flow-instance-editor-1024x768.png` pending | `flow-instance-editor-390x844.png` pending |
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
| `UI-HOME-001` | isolated fixtures、disabled／empty／missing template | open `/` | 每個template一區，顯示版本及instance數量；空區No instances yet，disabled保留歷史，缺失來源集中Unavailable template。 |
| `UI-HOME-002` | 特殊字元ID與長名稱 | inspect／activate instance rows | 每列單一可存取link，instanceId編碼正確，metadata及Open instance完整；分區與區內保留API順序。 |
| `UI-HOME-003` | home／非home generator manifests | activate resource tools and Management | 頁首Create Template緊鄰Create Instance左側且只有一個入口；底部home generators、Geometry順序及導頁正確，工具預設展開且使用outline樣式。 |
| `UI-HOME-004` | delayed／failed／empty bootstrap及已知資料 | load、Retry、simulate refresh failure | skeleton、錯誤、Retrying停用與成功empty state明確區分；已知groups/counts/generators保留，static links可用；無enabled template時停用建立並說明原因。 |
| `UI-HOME-005` | canonical／long names | inspect 1440×900、1024×768、390×844 | 所有寬度單欄分區；長名稱不造成水平溢出；手機彈窗表單可捲動且footer可操作。 |
| `UI-HOME-006` | Home ready／loading／dialog open | Tab、Shift+Tab、Enter、Escape | focus依visual order且有ring；row可用Enter；dialog focus限制與返回正確；decorative icons隱藏；skeleton動畫只在no-preference media內。 |
| `UI-HOME-007` | enabled template、creation error／delay | open、validate、cancel、submit、reopen saved instance | template未預選、version預填V0.0.0；required欄位驗證；失敗保留輸入、pending防重複；成功導向editor，每站一組active Initial recipe且參數套用defaults，geometry為空。 |
| `UI-GEN-001` | Home ready | click `Create HBM`或`Create DRAM` | navigate至專用editor並載入正確generator definition。 |
| `UI-HBM-004` | valid HBM parameters | click Generate JSON | 下載合法純GeometryStructure，root molding與child dies符合HBM mapping。 |
| `UI-HBM-007` | valid HBM parameters與metadata | click Save to DB | catalog建立`die.hbm` immutable geometry並回報server id。 |
| `UI-FTE-001` | fresh Template draft | add step by click | step出現在 graph，Node Editor以單擊可開啟。 |
| `UI-FTE-002` | topology valid、configuration incomplete | Save… → Template only → complete save dialog | metadata不在editor常駐顯示；template保存成功後返回Home，來源草稿僅在成功時消耗。 |
| `UI-FTE-010` | fresh editor | inspect toolbar、expand issues | 四個入口與獨立進度／缺項狀態；只有Save為實心主操作。 |
| `UI-FTE-011` | unsaved working contents | select template/draft、cancel/confirm、simulate missing dependency | 列選取不替換；確認才載入；取消與失敗保留原畫布。 |
| `UI-FTE-012` | valid topology、incomplete configuration | Save…、switch mode、cancel/reopen、load new source | combined預設且提交停用；template-only可提交；切換／重開保留欄位，新來源重設combined與instance overrides。 |
| `UI-FTE-013` | saved/loaded draft | quick update、edit details、new copy、simulate stale revision、edit during save | quick update不開彈窗且沿用identity；copy建立新記錄；衝突不覆寫；送出後的新修改仍dirty。 |
| `UI-FTE-014` | save/source dialog | submit blank metadata、Tab/Shift+Tab、Escape、nested confirmation | 行內錯誤與首個錯誤焦點；最上層modal鎖定焦點，關閉還原trigger。 |
| `UI-FTE-015` | editor and dialogs | inspect 1440×900、1024×768、390×844 | 操作列／modal不溢出；頁尾可見，body捲動；工作區沿用原minimum width。 |
| `UI-FIE-001` | enabled template | Home Use template → Create | 顯示基本 metadata 表單；geometry／recipes 可留空。 |
| `UI-FIE-002` | 同 template sources | 選擇初始來源並 Create | 只列同 template，僅複製 active 設定，recipes 取得新 ID。 |
| `UI-FIE-003` | empty tracking instance | Create without source | 每站 recipes 為空、activeRecipeId 為 null，bindings 為空；不預建 recipes。 |
| `UI-FIE-015` | fixed template loaded | inspect toolbar、status、expand issues | 四個入口、template副標題與進度／缺項／錯誤分區呈現；只有Save為實心主操作。 |
| `UI-FIE-016` | dirty instance editor | select blank／instance／draft；Keep editing／Discard changes；simulate load failure | row只選取；footer才載入；保留或替換符合確認結果，失敗不改原內容。 |
| `UI-FIE-017` | incomplete or disabled configuration | open Save… | modal顯示完整原因與metadata；可開啟但最後提交停用，完整enabled配置可提交。 |
| `UI-FIE-018` | source/save/draft modal | required-field submit、Tab/Shift+Tab、Escape、nested confirmation | inline錯誤與首錯焦點；topmost modal鎖焦點並關閉後還原trigger。 |
| `UI-FIE-019` | editor and dialogs | inspect 1440×900、1024×768、390×844 | 操作列與modal不溢出；footer可見且內容區獨立捲動。 |
| `UI-FIE-020` | candidate inspection | Select/expand another recipe | 上方 active 參數不變，單列展開且選取與 Active 標記不同。 |
| `UI-FIE-021` | required active | One or more recipes | 只能切換 active，不能清空；空站點仍可建立。 |
| `UI-FIE-022` | recipe source protection | Edit then change source/close | 確認捨棄或保留；成功新增後選取並展開新列。 |
| `UI-MGMT-001` | bootstrap 與 draft summaries ready | open Management tabs | 六類 resource count 與 rows 符合 bootstrap 及兩種草稿摘要。 |
| `UI-MGMT-002` | Process steps tab | click row Edit、change allowed fields/default、Save | 頁內modal只暴露允許欄位；成功後row即時更新且不導頁。 |
| `UI-MGMT-009` | Process step input ports | Move up/down with mouse or keyboard、Cancel／Save and reopen | 順序可修改且首尾與saving按鈕停用；Cancel丟棄排序，Save保留排序，port definitions與output ports仍鎖定。 |
| `UI-MGMT-005` | Templates tab，含重複 step template 引用及既有 instances | Edit → change metadata/per-step labels/scalar defaults → Save；清空 label；Cancel；模擬儲存失敗；重新開啟 editor | id/version/step identity/order/topology保持鎖定；label/default依stepRefId獨立更新且允許重複label；label即時更新標題，空白回到process-step名稱；Save後重開保留label，共用template的instances重新載入顯示新label且配置不變；defaults只影響未來blank instances；Cancel不寫入；saving停用輸入及重送；失敗保留草稿並顯示錯誤。 |
| `UI-MGMT-006` | templates、instances、引用資料 | Open instance；cancel/confirm Delete；檢查引用衝突 | Instance 可重新開啟；引用中的 template 不能刪除；衝突或失敗不留下部分刪除；不再清理 Instance Draft。 |
| `UI-MGMT-007` | Geometries 含未引用與被 instance、兩種 editor draft 引用的 geometry | cancel/confirm Delete；解除引用後再刪除；模擬 404／409／500 與刷新失敗 | 每列有 Delete；確認顯示名稱、ID 與永久刪除說明；取消無請求；busy 顯示 Deleting…、防重送並停用其他異動；未引用項目成功移除 row、更新 count 並顯示成功訊息；catalog 精確引用回傳 409 並指出資源類型與 ID，embedded／generator 不誤擋；404／409 刷新 bootstrap，一般錯誤保留資料，刷新失敗提示重新載入；不連帶刪除其他資源。 |
| `UI-MGMT-008` | Template Draft 與無正式 template 的情境 | list、sort、revision-checked Delete、Reset／ZIP reset | Template Draft 行為保留；不存在 Instance Draft 分頁或 API；stale conflict 要求重新確認。 |
| `UI-GRAPH-001` | node in view mode | single-click node | screen-level dialog開啟；不要求 double-click。 |
| `UI-GRAPH-012` | inputPorts reordered around primary | reload Template／Instance editor；Template Arrange | 接口依宣告順序；primary同排，前置auxiliary在上、後置在下；未接primary、巢狀與disconnected區塊不重疊，portId接線維持原語意。 |
| `UI-PREVIEW-001` | ready target in Template Editor | click Preview | 共用 Geometry Preview loading後 ready。 |
| `UI-PREVIEW-002` | ready target in Instance Editor | click Preview | 行為與 Template Editor相同。 |
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
| `UI-PLACE-027` | editor記住GDS | load template/source/draft/blank, cancel switch, or reload | 成功替換/reload清除，取消切換保留，獨立editor session不共用。 |

完整的 screen/component cases 分散在各規格的「Acceptance」段落。中央 suite 只列跨元件
或 release-blocking path。

## Cross-screen journey review

Review 不只驗證單一 component，還 MUST 依下列順序走完跨 screen journey：

| Journey | Entry | Required transition | Completion evidence |
| --- | --- | --- | --- |
| Template topology | fresh `/flow-template-editor` | Step add → Geometry add → valid connect → Save Template → save dialog | metadata只在dialog顯示、topology locked、configuration仍可編 |
| Instance configuration | Home AAA Demo / Use template | Create → add recipes／geometry → Preview | metadata建立追蹤instance並留在該instance管理畫面 |
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

Template Editor verifies Save Draft, From Draft, revision-checked update/delete and atomic commit. Instance Editor has no drafts: Create first, then append immutable recipes, switch active and apply shared geometry with revision checks. Failed operations retain pending forms.
