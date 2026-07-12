---
title: Geometry Preview
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-12
last_verified_commit: bdf2338e402dbd6e88a5dc494c874969d3be19b0
source_of_truth:
  - docs/architecture/decisions/0004-semantic-preview-sessions.md
  - docs/conformance.md
  - apps/viewer/components/geometry-preview/geometry-preview-panel.tsx
  - apps/viewer/components/geometry-preview/geometry-preview-client.ts
  - apps/viewer/components/geometry-preview/geometry-feature-overlay.tsx
  - apps/viewer/components/geometry-preview/geometry-section-caps.tsx
  - apps/viewer/components/geometry-preview/geometry-section-view.tsx
  - apps/viewer/components/viewer/section-display.ts
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

## Session path 與legacy compatibility

[ADR-0004](../../architecture/decisions/0004-semantic-preview-sessions.md) 核准UI以
`POST /api/preview-sessions`建立session：step target一次執行upstream closure，manifest仍包含所有已執行
upstream snapshots，但panel只呈現`initialSnapshotId`指定的target snapshot，不提供process timeline或
snapshot切換控制。Mesh由geometryHash-cached binary endpoint載入，section settle後使用OCC exact body
contours/caps。

現行component已使用session path。Legacy `POST /api/geometry-preview`與
`geometryEntityJson + glbBase64`暫時保留供compatibility，但Geometry Preview UI不得依賴。尚缺的自動化
驗收或target差異以[PV-001..PV-005](../../conformance.md)為唯一gap ledger。

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
open/context change -> session loading -> target mesh loading -> ready
                          \----------------------------> error
close/context change -> abort session / mesh / section requests
```

| State | Body | Header badge | Export |
| --- | --- | --- | --- |
| session loading | spinner + `Generating geometry preview...` | `Loading` signal | disabled |
| target mesh loading | workbench先以target snapshot bounds初始化，顯示mesh loading | `Ready` | enabled |
| error | icon + API/fallback message | `Error` outline | disabled |
| ready, mesh error | workbench + right-pane destructive mesh error | `Ready` | enabled（target semantic snapshot仍存在） |
| ready | CAD + feature controls | `Ready` | enabled |

Session manifest、decoded binary mesh與section responses只作interaction/cache，不寫catalog。三種export
都必須使用`initialSnapshotId`指定的immutable target snapshot。現行transition
compatibility endpoint仍只把`geometryEntityJson`與decoded base64 GLB留memory。

## Ready 狀態版面

Body grid `<1024px` one column；`>=1024px` 是 `minmax(0,1fr) 340px`，overflow hidden。

| Area | Exact size |
| --- | --- |
| Viewport cell | min-height `420px`、background `#f5f8f9`、padding12 |
| Viewer surface | height100%、min-height400、radius6、border、shadow |
| Right pane | min-height0、vertical scroll、white/92、padding16 |

Viewport使用 [CAD Scene](cad-scene.md)，Grid/Axes永遠on。左上badge顯示 Full/XZ/YZ，features
enabled且total>0時追加 `<n> features`。底部只顯示 Bounds，不顯示mesh stats。

Right pane MUST直接從Axis view開始，不得顯示`Process timeline`或其他upstream snapshot按鈕。即使
session manifest包含多個snapshots，viewport、mesh、section與三種export也只能使用
`initialSnapshotId`指定的target snapshot；使用者在哪一個input／step output開啟preview，就只看到該階段。

## Right pane 順序與預設值

### Axis view（固定展開）

Emerald 2px settings card。Header `Eye`、`Axis view`與summary；body四等欄buttons
`ISO/X/Y/Z`。Default `ISO`；active primary。每次選擇同時更新view與reset key。

### Section（預設收合）

Default：expanded false、enabled false、plane XZ、position merged bounds center、flip off。
Card active時emerald + `On`，inactive amber + `Off`。Controls與Standalone相同。

Section interaction有三個authority states：

| State | Required presentation |
| --- | --- |
| off | Full body scene；無stale cap/contour。 |
| drag/debounce | shader clipping即時回饋；exact section區顯示`Computing`，表示cap尚未ready。 |
| exact ready | settle後target snapshot response ready；badge顯示`Exact`，以material-aware cap與2D contours呈現。 |

Exact ready MUST顯示非空materialized body的closed cap，而不是透明plane；cap outer／hole與相鄰材料
邊界必須使用depth-tested engineering outline保持可辨識。3D cap、2D orthographic section與legend使用
相同body/material identities。Flip只控制保留側。Snapshot／plane change必須取消或
忽略舊response，empty exact cut必須清掉前一個cap。當section的水平／Z aspect ratio大於4時，2D view
可以只對顯示Z軸做non-uniform exaggeration，避免薄層縮成一條pixel line；UI MUST明示`Display Z ×N`，
且不得修改response coordinates、CAD area、3D cap或export data。

若requested plane恰好與display mesh cavity wall共面，shader clipping plane MUST以同一model-bounds
epsilon小幅內縮到retained side，exact cap再放在其retained side；這只排除會遮住cap的共面tessellated
wall，不得改變CAD section request、2D coordinates、area或export geometry。Epsilon不得由estimated
feature bounds放大。

### Bump/Via/Circuit View Setting（預設收合）

Current normative defaults：

| Setting | Default | Range/options |
| --- | --- | --- |
| Enabled | false | total=0時switch disabled |
| Bumps/Vias/Circuits | true | kind count=0或master off時disabled |
| Mode | `Auto` | `Auto/Summary/Detail` |
| Density scale | `0.40x` | `.25..2` step `.05` |
| Glyph size | `1.00x` | `.5..3` step `.05` |
| Highlight opacity | `60%` | `.15.. .85` step `.01` |
| Max instances | `10,000` | `500/2,000/10,000` |

這組值取代舊文件的 `1.00x / 1.00x / 42% / 2,000`。

Expanded body另顯示Total/Bumps/Vias/Circuits/Density，以及selected feature的Material、Density、
Direction、Container、Bounds；沒有selection顯示 `Select a feature envelope`，無features顯示
`No density features`。`Clear`清selection。

Card header、legend與selected details MUST顯示`Estimated density`，並與
`Materialized body`區分。不得把glyph位置、hatch或envelope稱為exact feature、actual via/bump placement
或OCC body section。

## Feature 擷取與 rendering

從`structure.root` recursive走children，依序讀`vias/circuits/bumps`；保留feature ID、material、
density、direction、container identity/path。支援box、cylinder、cone、polygon geometry；invalid
geometry跳過。

| Layer | Authority |
| --- | --- |
| Estimated envelope | feature authoritative envelope extent與selection target；不是physical placement |
| Estimated circuit hatch | density cue，不代表physical placement |
| Estimated instanced glyphs | density cue；bump sphere、via cylinder、circuit thin box |

Colors：Via `#12a8c6`、Circuit `#2ea85d`、Bump `#d8ad2f`。Summary只render envelope+hatch；
Detail強制glyph；Auto只有estimated instances `<= maxInstances`且features `<=64`才render glyph。
Total glyphs不得超過max；每feature至少分配4的計算上限但仍受global remaining cap。

所有overlay MUST depth-test against materialized bodies；不得用`depthTest:false`讓circuit/glyph固定
穿透到scene最前方。Body materials default MUST opaque；透明只可作明確標示的estimated overlay或
temporary selection mode。

Canonical domain density是`0..100`。Renderer一律計算`density / 100` exactly once，不再對`<=1`
套用legacy ratio heuristic；新資料與fixtures MUST以percentage產生。

Feature bounds會merge進scene bounds，因此camera與grid可包含non-CAD envelopes；exact section slider
range只使用materialized model bounds，不把density envelope當成可section body。
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

## Renderer 與低規格fallback

Three.js/R3F scene MUST使用demand rendering。Idle panel不得持續animation loop；controls change、
resize、asset ready、selection與section result需explicit invalidate。Default engineering profile使用
bounded DPR、tight camera near/far、opaque bodies、無realtime shadow與display LOD；quality adjustment依
measured frame time，不依「CPU/GPU」label猜測。

WebGL2/context建立失敗或runtime落入不可操作quality時，panel MUST提供same target snapshot的exact
2D section fallback與可見error/retry；不得只顯示空白canvas。該fallback不使estimated density features
變成exact。

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
| `UI-PREVIEW-004` | ready feature fixture | master default off；其他defaults為`.40/1/.60/10000`且cards initially collapsed。 |
| `UI-PREVIEW-005` | Auto estimate超cap/64 features | 不renderdetail glyph，但envelope/hatch保留。 |
| `UI-PREVIEW-006` | select envelope | HTML details同步；Clear取消。 |
| `UI-PREVIEW-007` | open Export | export dialog高於preview且preview不被backdrop誤關。 |
| `UI-PREVIEW-008` | terminal step session含多個upstream snapshots | 只顯示`initialSnapshotId` target，沒有timeline或step切換按鈕。 |
| `UI-PREVIEW-009` | target session recovery／重新開啟 | 不載入非target mesh；相同geometry的已取得asset可依content identity reuse。 |
| `UI-PREVIEW-010` | drag section slider then settle | drag/debounce顯示Computing；settle顯示target snapshot的Exact cap與2D contours。 |
| `UI-PREVIEW-011` | multi-material body cut | 每個non-empty materialized body截面有closed material-aware cap，無空心或stale cap。 |
| `UI-PREVIEW-012` | density feature visible | UI明示Estimated density，且feature不出現在exact body section。 |
| `UI-PREVIEW-013` | ready panel idle | 沒有continuous render；interaction與async completion會invalidate並更新畫面。 |
| `UI-PREVIEW-014` | session mesh load | 以content-addressed binary response載入，session JSON沒有base64 mesh。 |
| `UI-PREVIEW-015` | accelerated 3D unavailable | exact 2D section fallback仍可操作且不顯示blank canvas。 |
| `UI-PREVIEW-016` | package section aspect ratio > 4 | 2D薄層可辨識，且顯示Z exaggeration倍率；exact coordinates/area不變。 |
