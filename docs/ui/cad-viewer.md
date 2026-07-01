# CAD Viewer UI Specification

## 1. Purpose

CAD Viewer 是封裝幾何的共用 3D inspection surface。它有兩個 user-facing
surface：

| Surface | Location | Purpose |
| --- | --- | --- |
| Standalone CAD Viewer | `/cad-viewer` | 檢視本機 STL、GLB、GLTF 檔案，或內建 demo package。 |
| Geometry Preview Viewer | `/flow-instance-editor` overlay | 在 flow editor 中檢視 process-flow geometry preview。 |

兩個 surface 共用同一個 React Three Fiber scene component，並使用相同的 Z-up
camera convention。Standalone viewer 偏向檔案檢視，提供 import、view control
與 model stats。Preview viewer 偏向 flow inspection，提供剖面、axis view，以及
針對 geometry JSON 中存在但沒有輸出成 CAD body 的 `bump`、`via`、`circuit`
feature density overlay。

CAD Viewer 是 engineering workbench。第一畫面必須直接進入檢視體驗，不提供
landing page、marketing hero 或功能介紹頁。

## 2. Shared 3D Scene

共用 3D scene 由 `ViewerScene` 實作。

Scene behavior：

- 使用 React Three Fiber 與透明 WebGL canvas。
- 使用 Z axis 作為垂直方向。
- 設定 `camera.up` 為 `[0, 0, 1]`。
- 使用 field of view 42 degree 的 perspective camera。
- 當 `cameraResetKey`、`cameraView` 或 active bounds 改變時，camera 依據
  active scene bounds 重新 fit。
- 支援四種 camera view：
  - `iso`：isometric inspection view。
  - `x`：從 +X 方向看。
  - `y`：從 +Y 方向看。
  - `z`：從 +Z 方向看。
- 使用 OrbitControls：
  - Left mouse：rotate。
  - Middle mouse：dolly。
  - Right mouse：pan。
  - Damping enabled。
- 使用 hemisphere light 與 directional lights。
- 同一時間支援一個 section plane。
- Parent surface 啟用時顯示 grid helper 與 axes helper。
- 可以 render loaded model，也可以 render 內建 demo package。
- 接受 optional children，讓 preview-specific overlay 可以被 render 在與 CAD
  model 相同的座標系。

Shared scene 不提供 measurement、annotation、body selection 或 body-level editing。

## 3. Coordinate And Bounds Semantics

所有 viewer controls 都由 scene bounds 驅動：

- Camera fitting 使用 active bounds center 與最大尺寸。
- Grid size 由 XY span 的較大值推導。
- Axes helper size 由 scene 最大尺寸推導。
- Section slider range 由 active X 或 Y bounds 推導。
- Preview mode 會把從 geometry JSON 抽出的 non-CAD feature envelopes 納入
  active bounds。

Section controls 的語意：

| Plane | Visual plane | Clipping normal | Slider axis |
| --- | --- | --- | --- |
| `XZ` | XZ plane | Y axis | Y |
| `YZ` | YZ plane | X axis | X |

Section plane visual 是半透明藍色平面，並略大於 active bounds。`Flip side` 會反轉
clipping plane 保留的那一側。

## 4. Standalone CAD Viewer

### 4.1 Route

`/cad-viewer`

### 4.2 Layout

Desktop layout：

- Full-height page。
- 56px top bar。
- Main content 使用兩欄：viewport 加上固定 360px right panel。
- Right panel 在內容超出時垂直捲動。

Mobile layout：

- Top bar 保持在最上方。
- Viewport 優先顯示。
- Controls 堆疊在 viewport 下方。
- 頁面不得產生 horizontal overflow。

### 4.3 Top Bar

左側內容：

- Square app icon，使用 package/cube icon。
- Title：`Process Flow CAD Viewer`。
- Subtitle：
  - 未載入檔案時顯示 `Demo package`。
  - 已載入檔案時顯示 imported file name。

右側內容：

- 帶 icon 與文字的 `Import` button。
- Reset icon button。
- Hidden file input，接受 `.stl`、`.glb`、`.gltf`。

Reset behavior：

- Dispose active loaded model。
- 清除 load errors。
- 回到內建 demo package。
- Camera 回到 isometric view。

### 4.4 Viewport

Viewport 是主要工作區：

- 使用 light、low-contrast surface。
- 有 rounded border 與 viewport shadow。
- 支援 drag-and-drop import。
- 左上角顯示 primary status badge：
  - Section enabled 時顯示 `XZ` 或 `YZ`。
  - Section disabled 時顯示 `Full`。
- File parsing 時顯示 `Loading` badge。
- 底部顯示 summary bar：
  - Bounds：`X x Y x Z`。
  - Mesh count 與 triangle count。

未匯入檔案時顯示內建 demo package。Demo package 使用 package-oriented
materials：

- Green substrate。
- Grey silicon、logic die、HBM 與 mold-like solids。
- Yellow RDL / interconnect features。
- Cyan translucent dielectric / interface material。
- Light metallic solder spheres。

### 4.5 Right Panel

Standalone right panel 由上而下有三個 section：

1. `Section`
2. `View`
3. `Model`

#### Section

Default state：

- Enabled。
- Plane：`XZ`。
- Position：selected plane 對應 active bounds 的 center。
- Flip side：off。

Controls：

| Control | UI | Behavior |
| --- | --- | --- |
| Enabled | Switch | 啟用或停用 clipping 與 section-plane visual。 |
| Plane | Two-tab segmented control | 在 `XZ` 與 `YZ` 之間切換。 |
| Position | Slider with numeric readout | 沿 active bounds 移動 clipping plane。 |
| Flip side | Icon button | 反轉 retained side。 |

當 model 或 section plane 改變時，position 會重設為該 plane 的 active bounds center。

#### View

Controls：

| Control | UI | Behavior |
| --- | --- | --- |
| Grid | Switch | 顯示或隱藏 grid helper。 |
| Axes | Switch | 顯示或隱藏 axes helper。 |
| Camera | Icon button | Fit camera 並回到 isometric view。 |
| Axis view | `X`、`Y`、`Z` icon-sized buttons | Camera 移到對應 positive axis view。 |

Grid 與 axes 預設 enabled。

#### Model

Model section 同時是 information panel 與 secondary import target。

Content：

- Current model name。
- Imported file kind 與 file size。
- 顯示內建 demo package 時，subtitle 為 `Generated preview`。
- Import icon button。
- Load error message，如有錯誤。
- Model stats table：
  - Meshes。
  - Materials。
  - Vertices。
  - Triangles。
  - X bounds。
  - Y bounds。
  - Z bounds。

Model panel 支援 drag-and-drop import。Drag-over 時使用與 main viewport 相同的
highlight state。

## 5. CAD Import

Supported formats：

- `.stl`
- `.glb`
- `.gltf`

Import entry points：

- Top bar `Import`。
- Model panel import icon。
- Drag-and-drop 到 viewport。
- Drag-and-drop 到 model panel。

Loader behavior：

- GLB 與 GLTF 使用 Three.js `GLTFLoader`。
- STL 使用 Three.js `STLLoader`。
- Missing normals 會在 render 前補算。
- Imported meshes 會 cast shadow 與 receive shadow。
- Imported objects 會在 load 後 standardized。
- Load 後會收集 model bounds、mesh count、material count、vertex count 與
  triangle count。
- 載入新 model 時會 dispose previous model。
- Loading failure 會顯示在 model panel。

STL 不帶可靠 material metadata，因此 STL import 使用 neutral physical material。

## 6. Geometry Preview Viewer

### 6.1 Location And Shell

Geometry Preview Viewer 從 flow instance editor 開啟，不是一個 route。

Overlay shell：

- Fixed full-page overlay，顯示在 flow editor 上方。
- 背景 dimmed。
- Click outside 關閉 panel。
- Escape 關閉 panel。
- Header close icon button 關閉 panel。
- 關閉 preview 不會變更 draft flow instance。

Panel structure：

| Area | Content |
| --- | --- |
| Header | `Geometry Preview`、status badges、source-to-slot context、close button。 |
| Body | Shared 3D scene 與 preview-specific right panel。 |
| Footer | `Save JSON`、`Save STEP AP242`、`Export CDB` actions。 |

Header badges：

- Request state：`Loading`、`Ready` 或 `Error`。
- Source kind：`Initial geometry` 或 `Step output`。

Loading state：

- Body 中央顯示 spinner 與 `Generating geometry preview...`。
- Download actions disabled。
- 關閉 panel 時可以 abort request。

Error state：

- Body 顯示簡短 error message。
- Download actions disabled。
- Draft flow 不會被變更。

Ready state：

- Generated GLB 被載入 shared scene。
- Generated geometry JSON 保留在 memory 中供 download。
- STEP AP242 download 使用同一份 preview geometry snapshot，可能由背景 prefetch 先完成。
- `Save JSON`、`Save STEP AP242` 與 `Export CDB` enabled。
- `Export CDB` 開啟 CDB export dialog，送出後建立 server-side export job，不透過 browser download 傳輸 CDB。

### 6.2 Preview Layout

Desktop layout：

- Body 使用兩欄：viewport 加上固定 340px right panel。
- Right panel 垂直捲動。

Mobile layout：

- Body 堆疊成單欄。
- Viewport 優先顯示。
- Viewport minimum height 必須足以進行 inspection。

Preview viewport：

- 使用 shared scene。
- Grid 與 axes 永遠顯示。
- 使用 generated GLB 作為 CAD body source。
- 使用 geometry JSON 作為 non-CAD feature overlays source。
- 左上角 status badges 顯示 section state 與 feature count。
- 底部 summary bar 只顯示 scene bounds。
- Preview mode 不顯示 mesh、material、vertex、triangle stats。

### 6.3 Preview Right Panel

Preview controls 由上而下排列：

1. `Axis view`
2. `Section`
3. `Bump/Via/Circuit View Setting`

#### Axis view

`Axis view` 永遠顯示，不是 collapsible block。

Controls：

- `ISO`
- `X`
- `Y`
- `Z`

Active view 使用 primary button style。選擇 view 會更新 `cameraView` 並 increment
`cameraResetKey`。

#### Section

`Section` 是 collapsible settings block。

Default state：

- Collapsed。
- Disabled。
- Plane：`XZ`。
- Position：active bounds center。
- Flip side：off。

Collapsed header：

- Title：`Section`。
- Summary：enabled state、plane 與 position。
- Status badge：
  - Enabled 時顯示 `On`。
  - Disabled 時顯示 `Off`。

Expanded controls：

| Control | UI | Behavior |
| --- | --- | --- |
| Enabled | Switch | 啟用或停用 section clipping。 |
| Plane | Two-tab segmented control | 在 `XZ` 與 `YZ` 之間切換。 |
| Position | Slider with numeric readout | 移動 section plane。 |
| Flip side | Icon button | 反轉 retained side。 |

#### Bump/Via/Circuit View Setting

`Bump/Via/Circuit View Setting` 是 collapsible settings block，用於 geometry JSON
中存在但沒有被生成為 CAD body 的 features。

Default state：

- Collapsed。
- Enabled。
- Bumps、vias、circuits 在存在時 visible。
- Mode：`Auto`。
- Density scale：`1.00x`。
- Glyph size：`1.00x`。
- Opacity：`42%`。
- Max instances：`2,000`。

Collapsed header：

- Title：`Bump/Via/Circuit View Setting`。
- Summary：total feature count 與 per-kind counts。
- Status badge：
  - Overlay enabled 且至少有一個 feature 時顯示 `On`。
  - Overlay disabled 或沒有 features 時顯示 `Off`。

Expanded controls：

| Control | UI | Behavior |
| --- | --- | --- |
| Enabled | Switch | 顯示或隱藏所有 feature overlays。 |
| Bumps | Switch | 顯示或隱藏 bump features；沒有 bumps 時 disabled。 |
| Vias | Switch | 顯示或隱藏 via features；沒有 vias 時 disabled。 |
| Circuits | Switch | 顯示或隱藏 circuit features；沒有 circuits 時 disabled。 |
| Mode | `Auto`、`Summary`、`Detail` tabs | 控制 detail glyph rendering。 |
| Density scale | Slider | 放大或縮小 normalized density sampling。 |
| Glyph size | Slider | 調整 detail glyph radius / size。 |
| Opacity | Slider | 控制 overlay opacity。 |
| Max instances | `500`、`2,000`、`10,000` buttons | 限制 detail glyph count。 |

Panel 同時顯示：

- Total feature counts。
- Density range。
- Selected feature details：
  - Material。
  - Density。
  - Direction。
  - Container path。
  - Bounds。

Feature picking 選取的是 transparent feature envelope，不是 individual detail glyph。

### 6.4 Preview Settings Block Style

Preview settings blocks 使用與 flow editor process-step cards 相同的 visual language：

- Rounded card with `border-2`。
- White body。
- Subtle shadow。
- Muted header background。
- Circular icon badge。
- 右側 status badge。
- 右側 chevron。
- Active / on state 使用 emerald border 與 icon。
- Inactive / off state 使用 amber border 與 icon。

Block body 只在 expanded 時 render。

## 7. Feature Overlay Semantics

Feature overlays 由 geometry JSON 產生，不由 GLB 產生。

Supported feature kinds：

- `bump`
- `via`
- `circuit`

Extraction behavior：

- Recursively walk geometry root container 與所有 child containers。
- 讀取 `vias`、`circuits`、`bumps` arrays。
- 保留 feature id、material、density、direction、container id、container key 與
  container path。
- 支援 feature geometry types：
  - `BoxGeometry`
  - `CylinderGeometry`
  - `ConeGeometry`
  - `PolygonGeometry`

Density normalization：

- 大於 `1` 的 values 視為 percentage，除以 `100`。
- `0` 到 `1` 的 values 視為 ratio。
- Normalized values clamp 到 `0..1`。

Feature rendering：

| Layer | Purpose |
| --- | --- |
| Transparent envelope mesh | 顯示 feature 的 authoritative spatial extent。 |
| Circuit hatch overlay | 提供 circuit-specific density visual。 |
| Instanced glyphs | 提供 density-scaled detail markers，避免一個 physical object 建一個 React node。 |

Feature colors：

| Kind | Color |
| --- | --- |
| Via | `#12a8c6` |
| Circuit | `#2ea85d` |
| Bump | `#d8ad2f` |

Rendering modes：

| Mode | Behavior |
| --- | --- |
| `Summary` | 只顯示 envelope 與 circuit hatch。 |
| `Detail` | 強制顯示 detail glyphs，並受 max instances 限制。 |
| `Auto` | 只有在 estimated instance count 與 feature count 足夠小時顯示 detail glyphs。 |

Detail glyph rendering 使用 Three.js `InstancedMesh`。Bumps 使用 sphere glyphs，
vias 使用 cylinder glyphs，circuits 使用 thin box glyphs。這可以讓 density features
代表大量 physical objects 時仍維持 preview responsive。

Transparent envelope 是 coverage authority。Hatch lines 與 glyphs 是 visual density
cues，不能被解讀為精確 physical placement。

## 8. Visual Language

Viewer 的視覺語氣是安靜、密集、偏 inspection-oriented：

- Light grey page background。
- White 或 off-white panels。
- Thin borders。
- Radius 不超過 8px。
- 不使用 hero section。
- 不使用 decorative gradient blobs 或 ornamental imagery。
- Tool buttons 使用 lucide icons。
- 只有明確 command 使用 icon + text，例如 Import 與 Save。
- Compact tools 使用 icon-only button，例如 reset、flip side、camera fit。
- Metadata 使用 muted text。
- Numeric readouts 使用 monospace text。

Demo scene material colors：

- Green：substrate。
- Grey：silicon、HBM、logic die、mold-like solids。
- Yellow：RDL 與 metal-like interconnect。
- Cyan：dielectric / interface 與 section plane。
- Light metallic grey：solder。

## 9. Responsive Requirements

Standalone viewer：

- Desktop：`1fr + 360px`。
- Mobile：single column，viewport first，controls after。
- Header title 與 subtitle 必須 truncate，不可 wrap 到 controls。
- Control panel 必須可垂直捲動。

Preview viewer：

- Desktop：`1fr + 340px`。
- Mobile：single column，viewport first，controls after。
- Overlay 在所有 viewport sizes 都保留小幅 page margin。
- Footer actions 保持在 overlay shell 底部可見。

所有 controls 必須可以在沒有 horizontal scrolling 的情況下使用。

## 10. Interaction Scope

Viewer supports：

- Orbit。
- Pan。
- Zoom。
- Camera reset / axis view。
- Section clipping。
- CAD import in standalone mode。
- Preview downloads in preview mode。
- Feature overlay selection in preview mode。

Viewer does not support：

- Measurement。
- Annotation。
- Body-level editing。
- Body-level selection。
- STEP import。
- Manifest-driven material/body mapping。
- Direct editing of geometry JSON。

## 11. Implementation Map

| File | Responsibility |
| --- | --- |
| `apps/viewer/app/cad-viewer/page.tsx` | Standalone viewer route entry。 |
| `apps/viewer/components/viewer/cad-viewer-workbench.tsx` | Standalone viewer layout、import state、controls 與 model stats。 |
| `apps/viewer/components/viewer/viewer-scene.tsx` | Shared React Three Fiber scene、camera、lights、orbit controls、section clipping、grid、axes 與 demo package。 |
| `apps/viewer/components/viewer/model-loader.ts` | STL / GLB / GLTF loading、model disposal helpers、bounds、stats 與 formatting helpers。 |
| `apps/viewer/components/geometry-preview/geometry-preview-panel.tsx` | Preview overlay shell、preview CAD workbench、download actions、section controls、axis view 與 feature overlay settings。 |
| `apps/viewer/components/geometry-preview/geometry-feature-overlay.tsx` | Geometry JSON feature extraction、summaries、feature envelopes、hatches 與 instanced density glyphs。 |
| `apps/viewer/components/geometry-preview/geometry-preview-client.ts` | Preview GLB 與 preview snapshot STEP API client helpers。 |
| `apps/viewer/components/geometry-preview/cdb-export-dialog.tsx` | CDB export element size 與 absolute output path modal。 |
| `apps/viewer/components/geometry-preview/cdb-export-jobs-panel.tsx` | Editor-level export request drawer、polling、cancel 與 hover detail。 |
| `apps/viewer/components/geometry-preview/cdb-export-client.ts` | Browser client id、CDB job create/list/cancel API helpers。 |
| `apps/api/src/process_flow_api/main.py` | FastAPI preview execution routes and response assembly。 |
| `apps/api/src/process_flow_api/exporter.py` | Preview GLB and STEP AP242 export bridge to the Python CAD worker。 |
| `packages/cad-py/src/process_flow_cad/worker.py` | Isolated Python CadQuery/OCP worker used by FastAPI。 |
| `packages/cad-py/src/process_flow_cad/exporter.py` | Python CAD conversion implementation。 |
| `apps/viewer/components/ui/*` | Shared UI primitives。 |
| `apps/viewer/app/globals.css` | Tailwind base styles 與 viewer surface styling。 |
