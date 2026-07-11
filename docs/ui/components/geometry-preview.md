---
title: Geometry Preview
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
  - apps/viewer/components/geometry-preview/geometry-preview-panel.tsx
  - apps/viewer/components/geometry-preview/geometry-preview-client.ts
  - apps/viewer/components/geometry-preview/geometry-feature-overlay.tsx
  - apps/viewer/components/viewer/viewer-scene.tsx
---

# Geometry Preview

## 可用範圍與 context

`GeometryPreviewPanel` 是 Flow Template Editor與 Flow Instance Editor共用的 full-page overlay；
兩頁都 MUST 可開啟，不能只實作 Instance surface。

```ts
type GeometryPreviewContext = {
  previewId: string;
  sourceLabel: string;
  slotLabel: string;
  sourceKind: "flowInput" | "stepOutput";
  request: GeometryPreviewRequest;
};
```

Template draft request可帶inline `flowTemplate`；saved Template/Instance request帶
`processFlowTemplateId`。Target是`flowInput`或`stepOutput`。UI在request前依target upstream
closure檢查readiness；disabled control顯示第一個 blocking reason。

## Overlay shell 規格

Outer fixed inset、z `50`、padding base `12px` / `sm` `24px`。Backdrop
`foreground/45`；panel fill remaining width/height、radius6、border、viewport shadow、column flex。

| Area | Specification |
| --- | --- |
| Header | white、padding x16/md20 y12、bottom border。 |
| Body | flex fill、`min-height:0`。 |
| Footer | white、padding x16 y12、top border、right aligned、wrap。 |

Header：`Geometry Preview`、request badge `Loading/Ready/Error`、source badge
`Geometry Input/Step output`；次行 `<sourceLabel> -> <slotLabel>`；右側 Close。

Footer actions order固定：`Export JSON`、`Export STEP AP242`、`Export CDB`。非Ready全部disabled。
Backdrop、Close、Escape關閉；unmount abort進行中的preview request。關閉不改editor draft，也不取消
已建立的export jobs。

### Overlay review contract

Geometry Preview 可以承載 Export form。當 Export form 開啟時，Preview 必須保持 mounted，且
最上層 form 的 `Close`、`Cancel`、idle `Escape` 與 backdrop 只關閉 form；submitting 時不可關閉。
這是 target behavior，與 [Interaction Patterns](../interaction-patterns.md) 的 modal stack contract
一致。現行 Escape 會被 Preview／underlying Node Editor 的 document listener 同時處理，引用
`UI-GAP-MODAL-STACK-001`。

## Panel 狀態機

```text
open/context change -> loading -> ready
                          \----> error
close/context change -> abort prior request
```

| State | Body | Header badge | Export |
| --- | --- | --- | --- |
| loading | spinner + `Generating geometry preview...` | `Loading` signal | disabled |
| error | icon + API/fallback message | `Error` outline | disabled |
| ready, GLB loading | workbench先以fallback bounds初始化 | `Ready` | enabled |
| ready, GLB error | workbench + right-pane destructive GLB error | `Ready` | enabled（JSON snapshot仍存在） |
| ready | CAD + feature controls | `Ready` | enabled |

Preview API response的`geometryEntityJson`與decoded GLB只留memory，不寫catalog。三種export都使用
同一次preview snapshot。

## Ready 狀態版面

Body grid `<1024px` one column；`>=1024px` 是 `minmax(0,1fr) 340px`，overflow hidden。

| Area | Exact size |
| --- | --- |
| Viewport cell | min-height `420px`、background `#f5f8f9`、padding12 |
| Viewer surface | height100%、min-height400、radius6、border、shadow |
| Right pane | min-height0、vertical scroll、white/92、padding16 |

Viewport使用 [CAD Scene](cad-scene.md)，Grid/Axes永遠on。左上badge顯示 Full/XZ/YZ，features
enabled且total>0時追加 `<n> features`。底部只顯示 Bounds，不顯示mesh stats。

## Right pane 順序與預設值

### Axis view（固定展開）

Emerald 2px settings card。Header `Eye`、`Axis view`與summary；body四等欄buttons
`ISO/X/Y/Z`。Default `ISO`；active primary。每次選擇同時更新view與reset key。

### Section（預設收合）

Default：expanded false、enabled false、plane XZ、position merged bounds center、flip off。
Card active時emerald + `On`，inactive amber + `Off`。Controls與Standalone相同。

### Bump/Via/Circuit View Setting（預設收合）

Current normative defaults：

| Setting | Default | Range/options |
| --- | --- | --- |
| Enabled | true | total=0時switch disabled |
| Bumps/Vias/Circuits | true | kind count=0或master off時disabled |
| Mode | `Auto` | `Auto/Summary/Detail` |
| Density scale | `0.40x` | `.25..2` step `.05` |
| Glyph size | `1.00x` | `.5..3` step `.05` |
| Opacity | `60%` | `.15.. .85` step `.01` |
| Max instances | `10,000` | `500/2,000/10,000` |

這組值取代舊文件的 `1.00x / 1.00x / 42% / 2,000`。

Expanded body另顯示Total/Bumps/Vias/Circuits/Density，以及selected feature的Material、Density、
Direction、Container、Bounds；沒有selection顯示 `Select a feature envelope`，無features顯示
`No density features`。`Clear`清selection。

## Feature 擷取與 rendering

從`structure.root` recursive走children，依序讀`vias/circuits/bumps`；保留feature ID、material、
density、direction、container identity/path。支援box、cylinder、cone、polygon geometry；invalid
geometry跳過。

| Layer | Authority |
| --- | --- |
| Transparent envelope | feature authoritative spatial extent與selection target |
| Circuit hatch | density cue，不代表physical placement |
| Instanced glyphs | density cue；bump sphere、via cylinder、circuit thin box |

Colors：Via `#12a8c6`、Circuit `#2ea85d`、Bump `#d8ad2f`。Summary只render envelope+hatch；
Detail強制glyph；Auto只有estimated instances `<= maxInstances`且features `<=64`才render glyph。
Total glyphs不得超過max；每feature至少分配4的計算上限但仍受global remaining cap。

Canonical domain density是`0..100`。現行renderer仍將`<=1`解讀為ratio、`>1`除100，這只是
legacy fallback（`UI-CONFLICT-006`）；新資料與 fixtures MUST 以 percentage 產生。

Feature bounds會merge進GLB bounds，因此camera、section range、grid都包含non-CAD envelopes。
單擊envelope toggle selection；glyph不raycast。

## Settings card 視覺規格

Radius6、2px border、white、small shadow。Header muted/40、padding12；32px circular icon。Expandable
header是full-width button、`aria-expanded`，右側On/Off badge與Chevron；collapsed時Chevron
`-90°`。Body只在expanded時render，border-top、padding12、gap16。

## Accessibility 與響應式

- `<1024px` viewport先、right pane後；overlay footer固定在shell底部。
- 390px shell margin12，viewport min400，right controls由body scroll/stack呈現。
- Escape/backdrop/Close行為依 [Interaction Patterns](../interaction-patterns.md)；focus trap/restore仍是
  target gap。
- Feature canvas selection沒有keyboard parity；HTML details需可讀，未來需提供feature list focus path。

## 測試 fixture 與 reference 圖片

Fixture target：CoWoS-L ready step output，包含至少一種bump/via/circuit與nonzero density。預留asset
路徑為`../assets/reference/geometry-preview-<width>x<height>.png`；目前沒有 committed reference，
不得建立壞link或用其他畫面代替。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-PREVIEW-001` | Template Editor ready target | inline/saved request可由Loading到Ready。 |
| `UI-PREVIEW-002` | Instance Editor ready target | 共用panel與同一defaults。 |
| `UI-PREVIEW-003` | close during loading | request abort，不顯示late error、不改draft。 |
| `UI-PREVIEW-004` | ready feature fixture | defaults精確為`.40/1/.60/10000`且cards initially collapsed。 |
| `UI-PREVIEW-005` | Auto estimate超cap/64 features | 不renderdetail glyph，但envelope/hatch保留。 |
| `UI-PREVIEW-006` | select envelope | HTML details同步；Clear取消。 |
| `UI-PREVIEW-007` | open Export | export dialog高於preview且preview不被backdrop誤關。 |
