---
title: Standalone CAD Viewer
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
  - apps/viewer/components/viewer/cad-viewer-workbench.tsx
  - apps/viewer/components/viewer/viewer-scene.tsx
  - apps/viewer/components/viewer/model-loader.ts
  - apps/viewer/app/cad-viewer/page.tsx
---

# Standalone CAD Viewer

Route：`/cad-viewer`

## 目的

用於檢視本機 STL、GLB、GLTF，或無 import時的內建 package demo。第一畫面直接是
engineering workbench；不得加 landing page、hero、marketing copy。Preview內的 CAD surface
是共用 [CAD Scene](../components/cad-scene.md)，但其 shell規格在
[Geometry Preview](../components/geometry-preview.md)。

## 版面配置

| Area | Exact specification |
| --- | --- |
| Page | `min-height:100vh`；gradient `#f5f8f9 -> #e7eef1`。 |
| Top bar | height `56px`、white/88、backdrop blur、padding x `16px` / md `24px`。 |
| Desktop body (`>=1024px`) | `minmax(0,1fr) 360px`，overflow hidden。 |
| Mobile body | one column，viewport先、controls後。 |
| Viewport cell | min-height `560px`、padding `12px` / md `16px`。 |
| Viewer surface | height 100%、min-height `540px`、radius `8px`、border、viewport shadow。 |
| Right pane | white/92、padding `16px`、vertical scroll；desktop left border、mobile top border。 |

## Top bar

左側：36px primary square內 `Box` 20px；title `Process Flow CAD Viewer`；subtitle是
`Demo package` 或 imported filename。title/subtitle都truncate。

右側依序：

1. tool small button `FileUp` + `Import`
2. ghost 32px `RotateCcw`，title `Reset to demo`
3. hidden file input，accept `.stl,.glb,.gltf` + MIME variants

Import loading時 Import disabled；Reset仍可用。

## Viewport

使用 [CAD Scene](../components/cad-scene.md)。viewport本身與 Model card都接受 file drop。
Drag-over 使用 primary border及 `2px primary/30` ring。

左上 overlay：

- signal badge：`Scissors` + active `XZ`/`YZ`；section off為 `Full`。
- parsing時追加 secondary `Loading` badge。

底部 summary bar：absolute 12px四周、white/86、border、backdrop blur；左顯示
`Bounds <X> x <Y> x <Z>`，右顯示 `<mesh> meshes / <triangle> triangles`。

## Right panel control 矩陣

Controls由上而下，不可重排：`Section`、separator、`View`、separator、`Model`。各 control
row最小高度36px，label左、control右。

### Section 預設值

| Control | Default | Behavior |
| --- | --- | --- |
| `Enabled` | on | toggle clipping + translucent visual plane。 |
| `Plane` | `XZ` | two tabs `XZ/YZ`；變更時position回新axis bounds center。 |
| `Position` | bounds center | range沿 Y（XZ）或 X（YZ）；step `max(span/400,.001)`。 |
| `Flip side` | off | 32px `FlipHorizontal2`；on使用primary variant。 |

Model/bounds或plane變更時 position重設center。Disabled section時slider/flip disabled，plane仍可選。

### View 預設值

| Control | Default | Behavior |
| --- | --- | --- |
| `Grid` | on | show/hide grid。 |
| `Axes` | on | show/hide axes。 |
| `Camera` | ISO initial | `Maximize2` fit並切到 ISO。 |
| `Axis view` | ISO initial | X/Y/Z buttons看向positive axis，active button primary。 |

### Model 區塊

Dashed card顯示 filename或 `Demo package`，次行 `<KIND> / <size>` 或
`Generated preview`；右側 import icon。Parsing failure在card內用 destructive message。

Info table rows固定：`Meshes`、`Materials`、`Vertices`、`Triangles`、`X`、`Y`、`Z`。
Value是right-aligned monospace；demo stats固定 39 meshes、7 materials、12960 vertices、
6480 triangles。

## Import 與 Reset

| Action | Result |
| --- | --- |
| Import/file drop | clear old error、Loading；parse；dispose previous model；update stats/bounds；fit current camera view。 |
| Unsupported/failed file | current model保留，Model card顯示 error，Loading清除。 |
| Reset | dispose imported model、clear error、回 demo、increment camera reset。 |

Reset的 normative baseline是**保留目前 `cameraView`**並重新 fit。它不自動切 ISO；使用
`Camera` button才切 ISO。這解決舊文件與現行實作衝突 `UI-CONFLICT-003`。

## 支援狀態

| State | Viewport | Model panel |
| --- | --- | --- |
| Demo | generated package | `Demo package / Generated preview` + demo stats |
| Drag-over | primary outline | 同一highlight state |
| Loading | existing/demo仍可見 + `Loading` | import disabled |
| Imported | loaded object、new bounds/stats | filename、kind、size |
| Error | existing/demo仍可inspect | destructive error copy |

本 viewer不提供 measurement、annotation、body selection/edit、STEP import、geometry JSON edit。

## 響應式、鍵盤與 ARIA

- `<1024px` viewport先、pane後；不得整頁 horizontal overflow。
- Header identity可truncate，不得把 Import/Reset擠出畫面。
- 3D canvas目前沒有 keyboard camera control；所有設定與import/reset仍須keyboard可達。
- Switch必須有 `aria-label`：`Toggle section`、`Toggle grid`、`Toggle axes`。
- Axis/icon buttons保留 `title`並依 Design System補 `aria-label` target。
- File import不能只有drag，因此 keyboard user使用 Import。

## 測試 fixture 與 reference 圖片

Fresh capture：未import、demo、Section on/XZ/center/not flipped、Grid/Axes on、camera ISO。

| Viewport | Asset |
| --- | --- |
| `1440×900` | [cad-viewer-1440x900.png](../assets/reference/cad-viewer-1440x900.png) |
| `1024×768` | `../assets/reference/cad-viewer-1024x768.png`（pending） |
| `390×844` | `../assets/reference/cad-viewer-390x844.png`（pending） |

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-CAD-001` | camera X + imported file，Reset | demo/error清除，camera仍X並fit。 |
| `UI-CAD-002` | drop valid GLB | Loading可見，舊model disposed，stats/bounds更新。 |
| `UI-CAD-003` | select YZ + move + flip | range沿X，plane/clip normal同步。 |
| `UI-CAD-004` | failed import | current inspectable model保留，error只在Model panel。 |
| `UI-CAD-005` | keyboard only | Import、section、view、reset都可操作。 |
| `UI-CAD-006` | 390px | viewport在controls前，無horizontal overflow。 |
