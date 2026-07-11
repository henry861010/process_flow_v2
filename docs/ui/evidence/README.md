---
title: UI Evidence
status: descriptive
owner: Process Flow UI
audience:
  - product
  - design
  - frontend
  - QA
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - docs/ui/README.md
  - docs/ui/review-checklist.md
  - docs/conformance.md
---

# UI Evidence

本目錄保存 implementation review 的 current observation 與測試產物索引。它不取代
`docs/ui/assets/reference/`，也不定義新的 target behavior。

## Artifact 分層

| 位置 | 意義 | 是否可作 normative baseline |
| --- | --- | --- |
| `docs/ui/assets/reference/` | 已接受 target state 的固定 screenshot | 可以 |
| `docs/ui/evidence/` | current browser observation、gap reproduction、review notes | 不可以 |
| `docs/conformance.md` | gap ID、current/target、狀態與 executable evidence 索引 | 狀態唯一來源 |

## Current browser observation

2026-07-11 的檢閱確認：

- Home desktop composition 與資料列結構符合 screen spec；初次 hydration 的 transient empty state 仍是現況限制。
- CAD Viewer 的 `1440×900` desktop reference 與目前 demo workbench 對齊；`390×844` viewport-first 且無整頁 horizontal overflow。
- Flow Template Editor 在 `1024×768` 裁切 right pane，引用 `UI-GAP-RESP-001`。
- Flow Template Editor 的 Geometry palette 仍是 drag-only，引用 `UI-GAP-DRAG-001`。
- Step Template Editor 仍顯示 `schema v2`，引用 `UI-GAP-VERSION-LABEL-001`。
- 自製 modal 缺少完整 dialog semantics/focus lifecycle，引用 `UI-GAP-A11Y-001`。
- Export form 的 Escape 會穿透多層 overlay；引用 `UI-GAP-MODAL-STACK-001`。

若要新增 observation，必須記錄 route、entry state、viewport、操作、expected、observed、
evidence path 與 gap ID；不要只提交未帶 context 的 screenshot。
