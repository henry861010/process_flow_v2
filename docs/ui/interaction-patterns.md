---
title: Interaction Patterns
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
  - apps/viewer/components/process-flow-template-editor/process-flow-template-editor.tsx
  - apps/viewer/components/process-flow-instance-editor/process-flow-instance-editor.tsx
  - apps/viewer/components/process-step-template-editor/process-step-template-editor.tsx
  - apps/viewer/components/geometry-preview
---

# 互動規格

## Pointer 與選取

| Context | Primary gesture | Result |
| --- | --- | --- |
| Flow graph node | 單擊 | 選取 node 並開啟對應 Node Editor dialog。 |
| View-mode shared node legacy handler | 雙擊 | 呼叫 `onPick` 或 `onEdit`；不得成為唯一可達路徑。 |
| Graph pane | 單擊空白 | 清除 selection，不關閉已開啟的 modal。 |
| Step palette item | 單擊或拖放 | 加入 Template graph。 |
| Geometry palette item | 拖放 | 建立 Geometry Input 並建立 working catalog binding。 |
| Edge/terminal Eye button | 單擊 | upstream closure ready 時開 Preview。 |
| Feature envelope | 單擊 | 選取 feature；glyph 不是 selection authority。 |

Template/Instance screen MUST 綁 `onNodeClick` 作 primary behavior。Shared graph 內現有
`onDoubleClick` 是 legacy fallback；重建不得要求使用者雙擊才看見 editor。

## 拖放

- Graph drop 必須把 `clientX/clientY` 轉成 React Flow coordinates。
- Step item 同時有 click-add fallback；Geometry item 現況沒有 fallback。
- Desktop drag 使用 `copy` effect；topology locked 時 item 是 `aria-disabled`/disabled 且不可拖。
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

Node Editor、Geometry Catalog、Geometry Preview、Export form 都是 modal dialog，MUST：

1. 開啟後把 focus 放在 dialog heading 或第一個可操作 control。
2. 設定 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`。
3. `Tab`/`Shift+Tab` 留在 dialog 內。
4. `Escape` 關閉；submitting 且不可中斷的 Export form 除外。
5. 點 backdrop 關閉；submitting Export form 的 backdrop 不關閉。
6. 關閉後把 focus 還給觸發 control。
7. background content 使用 `inert` 或等效機制。

現行自製 dialogs 已有 Escape/backdrop/close button，但未完整符合 1–3、6–7，列為
`UI-GAP-A11Y-001`。Reference screenshot 依現況；semantic acceptance 依本 target。

## 表單與 validation

| Rule | Behavior |
| --- | --- |
| Required field | label 後顯示 destructive `*`；empty 時 blocking message 出現在 status strip。 |
| Identifier | `^[A-Za-z][A-Za-z0-9_.-]*$`；invalid 或 duplicate 阻止 save/commit。 |
| Numeric | input `type=number`；integer step `1`，float step `any`；尊重 min/max。 |
| Option enum | `optionSource.options` 是合法值集合；UI 不可送集合外值。 |
| Array text fallback | comma split、trim、移除 empty，再依 value type coercion。 |
| Coordinate | 每列 X/Y 都須 finite，duplicate/invalid 顯示 row error；完整規則見 component spec。 |
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

## Dirty、save、reload、commit 流程

Flow Instance Workspace 的狀態轉移：

```text
template selected -> unsaved workspace -> saved clean draft
       ^                    |                     |
       |                    v                     v
      New              Save Draft           dirty draft
                                               |
                                      Save Draft / Reload
                                               |
                                  complete + clean + identity
                                               v
                                      committed (read-only)
```

- `dirty` 時註冊 `beforeunload` protection。
- `Save Draft` 只在有 selected template、非 committed、dirty、非 busy 時 enabled。
- `Reload` 丟棄 local dirty data，載入 server revision；現況沒有額外 confirm。
- stale revision 的 `409` 保留 local draft並顯示 error，使用者再選 Reload。
- `Commit Instance` 必須是 saved、clean、complete、identity valid、ID unique。
- committed 後 configuration controls read-only；Preview 仍可由已綁定 geometry/ready output 開啟。

## Modal 與 overlay 層級

| Surface | Close paths | Backdrop | z-index |
| --- | --- | --- | --- |
| Node Editor | Close、Escape、outside | `foreground/40` | `50` |
| Geometry Catalog | Close、Escape、outside | `foreground/40` | `50` |
| Geometry Preview | Close、Escape、outside | `foreground/45` | `50` |
| Export requests | collapse button | none | `80` |
| Export form | Cancel、Close、outside when idle | `foreground/35` | `100` |

開啟 Export form 時不得讓 Preview backdrop click 同時關閉 Preview；form 以 portal + higher
z-index 隔離。

## Loading、empty、error 文案

Visible copy 逐字固定；重建 agent 不可自行翻譯：

| Context | Copy |
| --- | --- |
| Home no rows | `No process flows` / `Create instance` |
| Template empty graph | `Empty flow` |
| Instance no template | `Select a flow template` |
| Parameter empty | `No parameters` |
| Coordinate empty | `No coordinates` |
| Preview loading | `Generating geometry preview...` |
| Export empty | `No export requests` / `Exports created from preview will appear here.` |

API error 顯示 server message；只有無法取得 message 時才使用 component 中的英文 fallback。

## 響應式互動

- Mobile 不縮小 graph font；以 fit view、pan 與 zoom 檢視。
- Scroll 與 graph pan 衝突時，Instance Graph 使用 `panOnScroll`；page 本身鎖定 overflow。
- Dialog 寬度皆為 `calc(100vw - 32px)` 上限，四周至少 `16px`。
- Preview body 在 `<1024px` 單欄；viewport先、controls後，footer 保留可見。
- Hover-only secondary controls MUST 另有 focus-visible path；現行 Template card clone/delete 與
  graph hover delete 需要以 acceptance test 持續檢查。
