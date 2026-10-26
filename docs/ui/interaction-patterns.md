---
title: Interaction Patterns
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-13
last_verified_commit: 2b9cad3675483da156a92d0a08ec12671f4f1b62
source_of_truth:
  - apps/viewer/components/process-flow-editor/process-flow-editor.tsx
  - apps/viewer/components/process-step-edit/process-step-edit-dialog.tsx
  - apps/viewer/components/geometry-preview
---

# 互動規格

## Pointer 與選取

| Context | Primary gesture | Result |
| --- | --- | --- |
| Process step，edit mode | 單擊 | 選取並從 output 開始預覽拉線；點 target input handle 完成。 |
| Process step，view mode | 單擊 | 只選取，不開 editor、不改 topology。 |
| Process step，兩種 mode | 雙擊或右上角鉛筆按鈕 | 取消暫存拉線並開啟既有 Node Editor dialog。 |
| Geometry input | 單擊 | 選取並開啟既有 Node Editor dialog；source handle 可單擊或拖曳拉線。 |
| Graph pane | 單擊空白 | 清除 selection，不關閉已開啟的 modal。 |
| Step palette item | 單擊或拖放 | 加入 Flow graph。 |
| Geometry palette item | 拖放 | 建立 Geometry Input 並建立 working catalog binding。 |
| Edge/terminal Eye button | 單擊 | upstream closure ready 時開 Preview。 |
| Feature envelope | 單擊 | 選取 feature；glyph 不是 selection authority。 |

Flow Editor MUST 綁 `onNodeClick` 作選取行為，step 編輯使用 `onNodeDoubleClick`
與常駐鉛筆按鈕。鉛筆按鈕 MUST 可用 Tab 到達並以 Enter/Space 啟動。Geometry input 維持
既有單擊行為。拉線中點另一個 step 切換來源，點同一來源、pane 空白或按 Escape 取消；
點無效 target 保留拉線狀態且不更動 edge。開啟編輯、開始拖曳、切換來源流程、刪除來源或
進入 saving 狀態 MUST 清除暫存拉線。

## 拖放

- Graph drop 必須把 `clientX/clientY` 轉成 React Flow coordinates。
- Step item 同時有 click-add fallback；Geometry item 現況沒有 fallback。
- Desktop drag 使用 `copy` effect；saving 時 item 是 `aria-disabled`/disabled 且不可拖。
- Touch-only mobile 無法新增 Geometry Input 是 `UI-GAP-DRAG-001`；不得在文件或測試中
  假裝此路徑已可用。
- CAD file drop 與 file input 都可用；drag-over 以 primary border + ring 顯示。

## 鍵盤與 focus

### 全域最低要求

- 所有 native button、link、input、select、summary、tabs 與 switch MUST 可用 `Tab` 到達。
- `Enter`/`Space` 啟動 button；native select/input 依平台慣例。
- focus indicator MUST 使用 [Design System](design-system.md) 的 `--ring`，不得以
  `outline: none` 後沒有替代 indicator。
- icon-only command MUST 同時有 visible tooltip/title 與 accessible name。
- disabled reason 不能只放在 disabled button 的 hover；相鄰 wrapper/title 或 status strip
  MUST 可讓 keyboard user 得知第一個 blocking reason。

### Dialog 契約（target）

Node Editor、Geometry Catalog、Geometry Preview、Process Step Edit、Export form 都是 modal dialog，MUST：

1. 開啟後把 focus 放在 dialog heading 或第一個可操作 control。
2. 設定 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`。
3. `Tab`/`Shift+Tab` 留在 dialog 內。
4. `Escape` 關閉；submitting 且不可中斷的 Export form 除外。
5. 點 backdrop 關閉；submitting Export form 的 backdrop 不關閉。
6. 關閉後把 focus 還給觸發 control。
7. background content 使用 `inert` 或等效機制。

Flow editor／Preview／Export 已整合共用 focus lifecycle；其他 overlay 與 background inert 尚需完整檢閱，仍列為
`UI-GAP-A11Y-001`。Reference screenshot 依現況；semantic acceptance 依本 target。

### Modal stack target

Overlay 可以巢狀，但任一時間只有最上層 modal 接收 close command：

```text
screen
  -> Node Editor
      -> Geometry Catalog
  -> Geometry Preview
      -> Export form
```

- 開啟 Geometry Catalog 時，Node Editor 保持 mounted 但不得被 backdrop click 關閉。
- 開啟 Export form 時，Geometry Preview 保持 mounted；Export form 的 backdrop、Close、Cancel、
  `Escape` 只關閉 Export form。
- submitting 的 Export form 不接受 `Escape`、Cancel、Close 或 backdrop close。
- 關閉最上層 modal 後，focus 回到開啟它的 trigger；不得一次關閉整個 overlay stack。

Export form、Geometry Preview 與 Node Editor 使用共用 topmost dialog stack；Escape 隔離與 focus restore 已驗證，見
[UI-FLOW-008 操作紀錄](evidence/unified-flow-editor/README.md)。

## 表單與 validation

| Rule | Behavior |
| --- | --- |
| Required field | label 後顯示 destructive `*`；empty 時 blocking message 出現在 status strip。 |
| Identifier | `^[A-Za-z][A-Za-z0-9_.-]*$`；invalid 或 duplicate 阻止 save/commit。 |
| Numeric | input `type=number`；integer step `1`，float step `any`；尊重 min/max。 |
| Option enum | `optionSource.options` 是合法值集合；UI 不可送集合外值。 |
| Array text fallback | comma split、trim、移除 empty，再依 value type coercion。 |
| Coordinate | 每列 lower-left/upper-right 四值都須 finite 且形成 positive-area rectangle；duplicate tolerance 是 `1e-6 um`，invalid 顯示 row error。 |
| Repeat group | Add/Remove 受 min/maxItems 限制；`itemId` 必須穩定。 |

Validation 以 progressive disclosure 呈現：control 保留使用者輸入，status strip 顯示第一個
blocking reason；API error 不得清空 draft。

## 非同步狀態模式

| State | Command | Surface feedback |
| --- | --- | --- |
| Idle | enabled when preconditions pass | normal icon/copy |
| Submitting | repeated action disabled | spinner/pulse icon；identity inputs依 screen 規則鎖定 |
| Success | state/data 更新後 | emerald strip + exact success copy |
| Error | draft保留 | destructive/amber strip + API message |
| Reloading/preview loading | cancelable request | loading message；關閉 Preview aborts request |

使用者輸入造成 state 改變時，舊 success/error message SHOULD 清除，避免把過期結果顯示為
仍然有效。

## Flow、dirty 與 save 流程

Home flow card → 開啟完整 flow → 編輯拓樸／候選 → Save dialog → 更新原 flow，成功後保留在 editor。

- Source 對話框提供 Open 與新 flow 草稿恢復。
- 正式保存要求拓樸與已提供值有效；允許缺少 bindings／required 參數。
- Recipe 卡片開獨立編輯視窗，儲存才更新草稿；套用選單直接切換採用 recipe，預覽只使用已儲存的採用 recipe。
- 新 flow draft 保存完整 configuration 與畫布；載入不重套 defaults。既有 flow 不提供 Save Draft。
- 409 保留內容，提供取消與確認重新載入；成功 commit 才刪除來源草稿。
- Dirty 離頁與 source replacement 仍保護未儲存進度。

## Modal 與 overlay 層級

| Surface | Close paths | Backdrop | z-index |
| --- | --- | --- | --- |
| Node Editor | Close、Escape、outside | `foreground/40` | `50` |
| Recipe Edit／Delete | Save／Cancel、Close、Escape、outside | `foreground/40` | `95` |
| Geometry Catalog | Close、Escape、outside | `foreground/40` | `50` |
| Geometry Preview | Close、Escape、outside | `foreground/45` | `50` |
| Save Information | Close、Cancel、Escape、outside when idle | `foreground/40` | `90` |
| Process Step Edit | Close、Cancel、Escape、outside when idle | `foreground/45` | `90` |
| Export requests | collapse button、outside pointerdown | none | `80` |
| Export form | Cancel、Close、Escape、outside when idle | `foreground/35` | `100` |

開啟 Export form 時不得讓 Preview backdrop click 同時關閉 Preview；form 以 portal + higher
z-index 隔離。

Export requests在Root Layout常駐一份，所有頁面共用。展開時以capture-phase pointerdown處理外部點擊，
收回drawer及detail popover但不攔截原事件；清單內操作不收回。收回不取消job、不停止polling；一般polling
不重新展開，只有使用者開啟或本頁新job建立通知才展開。

## Loading、empty、error 文案

Visible copy 逐字固定；重建 agent 不可自行翻譯：

| Context | Copy |
| --- | --- |
| Home no rows | `No process flows` |
| Template empty graph | `Empty flow` |
| Parameter empty | `No parameters` |
| Placement empty | `No placements` |
| Preview loading | `Generating geometry preview...` |
| Export empty | `No export requests` / `Exports created from preview will appear here.` |

API error 顯示 server message；只有無法取得 message 時才使用 component 中的英文 fallback。

## 響應式互動

- Mobile 不縮小 graph font；以 fit view、pan 與 zoom 檢視。
- Scroll 與 graph pan 衝突時，Flow Graph 使用 `panOnScroll`；page 本身鎖定 overflow。
- Dialog 寬度皆為 `calc(100vw - 32px)` 上限，四周至少 `16px`。
- Preview body 在 `<1024px` 單欄；viewport先、controls後，footer 保留可見。
- Hover-only secondary controls MUST 另有 focus-visible path；現行 Template card clone/delete 與
  graph hover delete 需要以 acceptance test 持續檢查。

## End-to-end interaction journeys

跨 screen 的重建順序、entry state、fixture 與完成定義集中於
[UI Reconstruction Guide](reconstruction-guide.md)。以下四條 journey 是 review 時的最小
cross-screen contract：

1. Flow topology：click-add Step → drag Geometry → connect → edit-button editor → Save Flow → Preview。
2. Flow recipes：新增兩組候選、編輯儲存／取消、切換採用、刪除採用候選，保存重載、新 flow 草稿恢復與 revision conflict。
3. Preview/export：open ready target → Loading/Ready → Export form → jobs drawer → terminal state。
4. CAD workbench：demo/import → section/camera → error or imported state → Reset preserving camera view。

每條 journey 都 MUST 能回連至少一個 screen acceptance case；若中途遇到 current gap，記錄
gap ID，不得以替代操作改寫 journey。
