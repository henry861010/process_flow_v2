# CAD Viewer UI Design

## Route

`/cad-viewer`

## 1. 目標

CAD Viewer 是一個基於 Next.js、React、Tailwind、shadcn/ui style components 與 React Three Fiber 的封裝幾何檢視工具。第一版專注在本機 CAD 檔案顯示，不處理 process flow editor、geometry database 或 manifest metadata。

第一版支援：

- 匯入本機 `.stl`、`.glb`、`.gltf` CAD 檔案。
- 在 3D viewport 中旋轉、縮放、平移模型。
- 使用單一 clipping plane 顯示 cross section。
- 支援 XZ 與 YZ 剖面，也就是垂直 Z axis 的剖切視圖。
- 提供基礎 grid、axis、camera fit 與 model stats。

## 2. 使用者情境

主要使用者是 process integration 或 package geometry engineer。他們需要快速檢查由 geometry kernel 或其他 CAD 工具輸出的 package model，確認：

- 封裝堆疊的整體比例是否正確。
- substrate、die、HBM、RDL、bump 等主要結構是否位置合理。
- 透過 XZ / YZ 剖切檢查沿 Z axis 的層狀結構。
- STL / GLB 輸出是否能在前端環境正常顯示。

因此第一版 UI 不做 landing page，也不放產品介紹內容。第一畫面直接是工具型 workbench。

## 3. 頁面資訊架構

畫面分為三個主要區域：

| 區域 | 功能 |
| --- | --- |
| Top bar | 顯示 app identity、目前載入模型名稱、Import、Reset to demo |
| 3D viewport | 顯示 CAD model、demo package、section plane、grid、axes、bounds summary |
| Right control panel | 提供 section、view、model 三組控制 |

Desktop 使用兩欄 layout：

- 左側是主要 3D viewport。
- 右側是固定寬度控制面板。

Mobile 使用單欄 layout：

- Top bar 固定在上方。
- 3D viewport 在前。
- 控制面板堆疊在 viewport 下方。
- 不產生 horizontal overflow。

## 4. 視覺風格

整體風格參考使用者提供的 2D package cross-section 圖，但轉換為 3D engineering viewer：

- 綠色代表 substrate。
- 灰色代表 logic die、HBM、silicon 或 mold-like solids。
- 黃色代表 RDL、metal、via 或 interconnect。
- 藍色代表 dielectric、interface 或 section plane。
- 白灰色代表 solder balls。

視覺基調是工程工具，而不是行銷頁：

- 背景使用淺灰白 viewport surface，保留清楚的模型可讀性。
- 控制面板使用低對比白色面板與細 border。
- UI 元件使用 8px 以內 radius，避免過度裝飾。
- icon buttons 使用 lucide-react 圖示。
- 重要指令使用 icon + text，例如 Import。
- 工具型操作使用 icon button，例如 reset、camera fit、flip side。

## 5. Top Bar

Top bar 高度為 56px，左側顯示：

- App icon。
- `Process Flow CAD Viewer`。
- 目前模型名稱。未匯入時顯示 `Demo package`。

右側提供：

- `Import` button：開啟本機檔案選擇器。
- Reset button：回到 demo package 並清除目前模型。

## 6. 3D Viewport

Viewport 是主要工作區，包含：

- React Three Fiber canvas。
- Z-up camera 設定，符合目前 geometry kernel 沿 Z axis extrusion 的模型語意。
- Orbit control。
- Hemisphere light 與 directional lights。
- Grid helper。
- Axes helper。
- Section plane visual。
- 左上狀態 badge，顯示目前剖面模式，例如 `XZ` 或 `YZ`。
- 底部 summary bar，顯示 bounds 與 mesh / triangle 統計。

未匯入檔案時，畫面顯示 demo package。Demo package 以 3D 方式重現 reference image 的語意，包括 substrate、die、HBM、RDL、micro bump、solder ball 與 translucent mold/interface。

## 7. Section Controls

Section panel 是第一版的核心功能。

控制項：

| Control | UI | 行為 |
| --- | --- | --- |
| Enabled | Switch | 開啟或關閉 clipping plane |
| Plane | Segmented tabs | 在 `XZ` 與 `YZ` 剖面之間切換 |
| Position | Slider | 沿對應 axis 移動剖切平面 |
| Flip side | Icon button | 反轉保留側 |

剖切邏輯：

- `XZ` section 使用法向量沿 Y axis 的 clipping plane。
- `YZ` section 使用法向量沿 X axis 的 clipping plane。
- slider range 來自目前模型 bounds。
- section plane position 預設在目前 bounds center。

## 8. View Controls

View panel 提供輔助顯示與 camera 操作。

控制項：

| Control | UI | 行為 |
| --- | --- | --- |
| Grid | Switch | 顯示或隱藏 floor grid |
| Axes | Switch | 顯示或隱藏 axes helper |
| Camera | Icon button | fit camera 到目前模型 bounds |

Camera fit 使用目前模型 bounds 計算適合的 perspective camera distance。若尚未匯入模型，使用 demo package bounds。

## 9. Model Panel

Model panel 顯示目前模型資訊與匯入入口。

內容：

- 模型名稱。
- 檔案格式與大小。未匯入時顯示 `Generated preview`。
- Import icon button。
- 載入錯誤提示。
- Model stats。

Stats 包含：

- Meshes。
- Materials。
- Vertices。
- Triangles。
- X / Y / Z bounds。

## 10. CAD Import 行為

支援格式：

- `.stl`
- `.glb`
- `.gltf`

GLB / GLTF：

- 使用 Three.js `GLTFLoader`。
- 盡量保留檔案內的 mesh 與 material。
- 若 material 看起來未設定明確顏色，會使用 package-oriented fallback color。

STL：

- 使用 Three.js `STLLoader`。
- STL 通常沒有 material metadata，因此第一版以單一 neutral material 顯示。
- 第一版不支援 `.manifest.json`。

匯入方式：

- 點擊 Import button。
- 拖曳檔案到 viewport 或 model panel。

## 11. Responsive 設計

Desktop：

- 使用 `1fr + 360px` grid。
- Viewport 優先取得可用空間。
- Control panel 固定在右側並可垂直捲動。

Mobile：

- 使用單欄 layout。
- Header 內容保持單行 truncation。
- Viewport 保持最小高度。
- Control panel 移到 viewport 下方。
- 已驗證 `390 x 844` viewport 沒有 horizontal overflow。

## 12. 實作檔案

| File | 責任 |
| --- | --- |
| `apps/viewer/app/cad-viewer/page.tsx` | Viewer app entry |
| `apps/viewer/components/viewer/cad-viewer-workbench.tsx` | Workbench layout、UI state、controls |
| `apps/viewer/components/viewer/viewer-scene.tsx` | React Three Fiber scene、camera、lights、clipping、demo package |
| `apps/viewer/components/viewer/model-loader.ts` | STL / GLB / GLTF loading、model stats、bounds、material fallback |
| `apps/viewer/components/ui/*` | shadcn-style primitive components |
| `apps/viewer/app/globals.css` | Tailwind base styles 與 viewer surface |

## 13. 第一版限制

目前不支援：

- `.manifest.json` material/body mapping。
- STEP import。
- 直接讀取 geometry structure JSON。
- 從 process flow instance 直接生成 CAD。
- 多剖切平面或 slab slicing。
- Body-level selection、measurement、annotation。

這些功能應保留給後續與 process flow editor、geometry database、geometry kernel 串接時再設計。
