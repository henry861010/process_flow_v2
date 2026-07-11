---
title: UI 規格入口
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
  - apps/viewer/app
  - apps/viewer/components
  - apps/viewer/app/globals.css
  - apps/viewer/tailwind.config.ts
---

# UI 規格入口

本目錄是 Process Flow 的 UI canonical specification。目標是讓未讀過既有
component code 的實作者，仍能用相同 fixtures 重建出一致的畫面、狀態、文案與互動。
文件以繁體中文撰寫；畫面上的既有英文 copy、API、field name、class name 與其他專有
名詞保留原文，並視為需要逐字符合的規格。

## 規範強度與權威順序

關鍵字 `MUST`、`SHOULD`、`MAY` 分別表示必要、建議與可選。UI 發生矛盾時依序採用：

1. 本目錄中 `status: normative` 的 screen/component 規格。
2. [interaction-patterns.md](interaction-patterns.md) 與
   [design-system.md](design-system.md)。
3. `source_of_truth` 所列、於 `last_verified` 當日檢查過的現行實作。
4. reference screenshot；它用於像素與構圖確認，不取代可存取性及狀態規則。

文件描述 target behavior；尚未符合 target 的現行行為必須留在「已知落差」，不得把
落差靜默當成新規範。若程式與規格同時改變，兩者必須在同一個 change set 更新。

## 文件地圖

### 基礎規格

| 文件 | 使用時機 |
| --- | --- |
| [Design System](design-system.md) | color、type、spacing、radius、breakpoint、z-index、icons。 |
| [Interaction Patterns](interaction-patterns.md) | focus、keyboard、modal、async、validation、dirty state。 |
| [Acceptance](acceptance/README.md) | fixture、viewport、screenshot 與 acceptance ID 規則。 |

### Screens 規格

| Route | 規格 |
| --- | --- |
| `/` | [Home](screens/home.md) |
| `/flow-template-editor` | [Flow Template Editor](screens/flow-template-editor.md) |
| `/flow-instance-editor` | [Flow Instance Editor](screens/flow-instance-editor.md) |
| `/admin/processstepeditor` | [Process Step Template Editor](screens/step-template-editor.md) |
| `/cad-viewer` | [CAD Viewer](screens/cad-viewer.md) |

### 共用 components

| Component | 規格 |
| --- | --- |
| `ProcessFlowGraph` | [Process Flow Graph](components/process-flow-graph.md) |
| `CategoryLibraryBrowser` | [Category Library](components/category-library.md) |
| `ParameterValueEditor` | [Parameter Editor](components/parameter-editor.md) |
| `CoordinateListControl` | [Coordinate List](components/coordinate-list.md) |
| `ViewerScene` | [CAD Scene](components/cad-scene.md) |
| `GeometryPreviewPanel` | [Geometry Preview](components/geometry-preview.md) |
| `FileExportJobsPanel` | [Export Jobs](components/export-jobs.md) |

## 共用重建契約

所有 screen MUST：

- 使用 [Design System](design-system.md) 的 tokens，不以「相近」顏色或尺寸替換。
- 以 Lucide icon 的具名 glyph 實作，不使用 emoji 或自製相近圖示。
- 實作 loading、empty、error、success、disabled 與 locked/committed 等文件列出的狀態。
- 讓 mouse、keyboard 與 focus 行為符合
  [Interaction Patterns](interaction-patterns.md)。
- 不把 Geometry、Process Step、Template 或 Workspace 的可見 identity 只存在 client state。
- 不自行增加 landing hero、onboarding carousel、decorative illustration 或未列出的 command。
- 以 API fixtures 產生畫面；不得在 UI 複製一份 catalog hard-code。

## Canonical fixture 設定

Visual regression 的預設資料狀態稱為 `ui-golden`：

| 資料 | Canonical record |
| --- | --- |
| Flow template | `flow_tpl_cowosl_demo_2_0_0` / `CoWoS-L Demo` |
| Immutable instance | `flow_inst_cowosl_demo_hbm4_alpha` / `HBM4 Alpha Build` |
| Geometry | `panel_v1_0_0`、`hbm_v1_3_1` |
| Process step | `step_tpl_molding_2_0_0`，以及 fixture 中其餘 current templates |
| Workspace | 每個 test 自行建立；不得依賴上一個 test 留下的 draft |

表中的 fixture id 是既有資料的 opaque identity；數字尾碼不表示產品版本，也不能用來
切換行為。

資料來源固定為：

- `apps/api/src/process_flow_api/fixtures/geometries.json`
- `apps/api/src/process_flow_api/fixtures/process-flow-templates.json`
- `apps/api/src/process_flow_api/fixtures/process-flow-instances.json`
- `apps/api/src/process_flow_api/fixtures/process-step-templates.json`

每次 visual run 開始前以 POC reset 還原資料；reset 完成後才開始 screenshot。

## Viewport 與 reference 圖片

所有 screen 至少在下列 viewport 驗證，browser zoom `100%`、device scale factor `1`、
color scheme `light`、locale `en-US`：

| Profile | CSS viewport | 目的 |
| --- | --- | --- |
| Desktop | `1440 × 900` | 主要 desktop composition。 |
| Compact | `1024 × 768` | `lg` 邊界、欄寬與 overflow。 |
| Mobile | `390 × 844` | 單欄、touch 可達性與 dialog margin。 |

檔名固定為 `docs/ui/assets/reference/<screen>-<width>x<height>.png`。缺圖須標示
`pending`，不得改用不同尺寸的圖充數。詳細 capture protocol 見
[acceptance/README.md](acceptance/README.md)。

## 現況衝突台帳

下表是本次重整後已定案的基線；舊文件不得再被解讀為另一種可接受行為。

| ID | 舊說法或模糊處 | Normative baseline | 實作狀態 |
| --- | --- | --- | --- |
| `UI-CONFLICT-001` | Preview 只由 Instance Editor 開啟。 | Template Editor 與 Instance Editor 都 MUST 支援 Geometry Preview。 | 已符合。 |
| `UI-CONFLICT-002` | View-mode node 必須雙擊。 | Screen-level primary behavior 是單擊 node 開啟 editor；shared node 的雙擊 handler 僅為 legacy fallback。 | 已符合。 |
| `UI-CONFLICT-003` | Standalone CAD Reset 一律切回 ISO。 | Reset 清除 imported model/error 並 fit camera，但保留目前 `cameraView`。 | 已符合現行；若要改 UX 需另立決策。 |
| `UI-CONFLICT-004` | Feature defaults 是 `1.00x / 1.00x / 42% / 2,000`。 | `Density scale 0.40x`、`Glyph size 1.00x`、`Opacity 60%`、`Max instances 10,000`。 | 已符合。 |
| `UI-CONFLICT-005` | Mobile 可完整建立 Template topology。 | Process Step 可 click-add；Geometry palette 現況只有 HTML drag，因此 touch-only mobile 無法新增 Geometry Input。 | 已知限制；見 `UI-GAP-DRAG-001`。 |
| `UI-CONFLICT-006` | Density 同時接受 ratio 與 percentage 是正式 contract。 | Canonical data contract 是 `0..100`；preview renderer 的 legacy normalization 只屬暫時 fallback。 | 有 legacy fallback 待後續清理。 |

## 已知落差

本節只提供索引，不追蹤 current/target 或狀態；差異的唯一狀態來源是
[Target contract 實作對照](../conformance.md)。

| ID | 一句摘要 |
| --- | --- |
| `UI-GAP-A11Y-001` | 自製 modal 的完整 dialog semantics 與 focus 管理落差；狀態見 [conformance](../conformance.md)。 |
| `UI-GAP-DRAG-001` | Template Editor 的 Geometry item 缺少 keyboard/touch add command；狀態見 [conformance](../conformance.md)。 |
| `UI-GAP-RESP-001` | Template Editor 在 `1024px` 的三欄最小寬度可能裁切 right pane；狀態見 [conformance](../conformance.md)。 |
| `UI-GAP-VERSION-LABEL-001` | Current UI 仍顯示 release-like label／schema generation badge；狀態見 [conformance](../conformance.md)。 |

產品 visible copy 目前以英文為 current baseline；localization 尚未形成 accepted target，
因此不是 conformance gap，重建 agent 不得自行翻譯產品 copy。

## 變更規則

以下任一項改變時，PR MUST 同步更新對應 screen/component spec、acceptance case 與
reference screenshot：

- token、breakpoint、欄寬、min-height、scroll owner、z-index；
- visible copy、icon、button order；
- field required/disabled/default；
- state transition、polling interval、preview/export behavior；
- fixture identity 或 default value。
