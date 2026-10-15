---
title: Placement List
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-15
last_verified_commit: 5f262e1a
source_of_truth:
  - apps/viewer/components/process-flow-fields/placement-list-control.tsx
  - apps/viewer/components/process-flow-fields/placement-preview.tsx
  - apps/viewer/components/process-flow-fields/placement-preview-geometry.ts
  - apps/viewer/components/process-flow-fields/placement-preview.test.tsx
  - apps/viewer/components/process-flow-fields/gds-placement-import.tsx
  - apps/viewer/components/process-flow-fields/gds-import-criteria.ts
  - apps/viewer/components/process-flow-fields/gds-import-criteria.test.ts
  - apps/viewer/components/process-flow-fields/gds-coordinate-geometry.ts
  - apps/viewer/components/process-flow-fields/gds-coordinate-geometry.test.ts
  - apps/viewer/components/process-flow-fields/gds-coordinate-import.worker.ts
---

# Placement List

## Value契約

`placements` 是 ordered array。每筆保存 rectangle 或 simple polygon `targetRegion`，使用
absolute XY coordinates；`pose` 固定為 `{x: 0, y: 0, rotationZ: 0}`，`anchor` 固定為 `center`，
作為 compatibility fields，不另套用位移或旋轉。Rectangle 使用 bottom-left/top-right 座標；polygon
使用 absolute vertices。Array order 就是 runtime execution 與 serialized child order。

Rectangle top-right X/Y 必須分別大於 bottom-left X/Y，所有座標必須 finite。Polygon 至少三個
unique finite points，不得有 zero-length edge、zero area 或 self-intersection；normalizer 移除
first/last closing duplicate。Draft numeric cell 可暫時是 empty string，configuration complete
時所有欄位都必須合法。

## Placement cards

每筆使用一張 ordered card。Header 顯示 index 與 compact summary，提供 Move up、Move down、
Remove；body 顯示 Shape 及 rectangle 座標或 polygon vertex table。Pose/anchor 不提供編輯。

Add placement 建立四個座標為 empty string 的 rectangle draft，固定 zero pose 與 center anchor。
Rectangle→Polygon：合法 bounds 轉成四個 absolute corners；incomplete/invalid bounds 轉成三個
empty point rows。Polygon→Rectangle：完整 finite points 轉成 absolute AABB；incomplete points
轉成 empty bounds。轉換保持 array position。

Readonly mode 顯示 ordered summary 及既有 validation diagnostic，不 render mutating actions。

## Shared placement layout preview

在 GDS success/warning 與 placement validation 摘要之後、cards 之前，直接顯示預覽圖，不顯示 `Placement layout` 標題列。
此共用 SVG 直接由目前正規化 placements、validation 與 unit 推導；manual edit、GDS import、
existing source/draft 與 readonly mode 都顯示，不保存圖片或另一份 placements。

圖區固定 300px 高、隨容器寬度調整；X 向右、Y 向上，XY 等比例，保留 origin axes。
Rectangle 與 polygon 使用 exact absolute coordinates，不壓縮長寬比、不抽樣或截斷。
圖內右下角浮放 zoom/Fit all controls，右上角顯示 help；預設只顯示 controls 與圖形；不顯示數量統計、XY bounds、方向/單位文字、
selected index 標記或下方 selected details，也不提供 `Placement number` / `Locate card`。
完整 finite 但 invalid 的形狀用 dashed unfilled outline；缺少 finite coordinates 或 polygon
無點時不繪製，既有清單層級及卡片 validation 保留。
空陣列顯示 `No placements`；無可畫形狀時顯示 `Enter complete coordinates to preview placements.`。

操作說明預設隱藏在右上角驚嘆號 `Placement layout help` disclosure，使用者點擊或以鍵盤開啟；
內容浮在圖區上方，不推動 cards，包含 pan/zoom、keyboard shortcuts、點圖定位、XY 方向及
invalid/incomplete outlines 的說明。再次點擊收起；Escape 只收起 help 並聚焦 trigger，不關閉 editor。

初次有 drawable shape、GDS 整批替換、external source/draft replacement 與圖區寬度改變時 fit all，
保留 top/left/right 至少 24px、bottom 至少 64px 邊距，避免形狀被右下 controls 遮住。
新增 placement 立即 fit all；新 draft 填寫期間隨座標更新持續 fit，直到使用者操作 camera、
切換其他 card 或進行 structural/source change。其他既有 placement 的一般編輯維持 camera；
所有形狀變成 incomplete 時清除舊圖。
提供 Zoom in、Zoom out、`Fit all`、primary pointer drag pan 與 Ctrl/⌘ + wheel zoom，
一般 wheel 保留表單捲動。圖區可聚焦，方向鍵 pan，+/− zoom，Home fit all。

點圖形後高亮圖形與對應 card，將 card heading 捲入可見範圍、聚焦；重疊時較後 array item
優先。Card focus/pointer 操作同步高亮；新增、刪除、reorder 與整批替換時清除 selection。
Readonly 仍可 pan、zoom、fit 與點圖定位，不觸發 onChange 或 dirty state。

## GDS import

GDS不是required input。Editor初始只顯示小型`Import from GDS`button；button以
`aria-haspopup="dialog"`開啟portal modal，不得在placement list內展開或推動既有cards。Modal包含
固定header/footer與可捲動body；使用者選擇一個file，並維護至少一組pattern。每組pattern各自包含
layer、datatype與optional cell name filter；`Defeature`是default-off且由所有pattern共用。關閉再開啟
modal時，file、patterns與Defeature在目前editor生命週期內保持不變。

Pattern以exact layer/datatype pair做OR比對，不產生layer與datatype的cross product。同一pair不得
重複；任一pair incomplete、不是non-negative safe integer或重複時，顯示inline diagnostic並停用
import。Add pattern新增include、empty cell filter的空白列；remove不得刪除最後一列。Pattern order
不影響結果。

Import在dedicated Web Worker執行；新import terminate previous worker。Import執行中不得以Close、
Cancel、backdrop或Escape意外關閉modal，但使用者仍可修改條件並重新啟動import。Worker只解析、遍歷GDS一次，
把符合任一pattern的`BOUNDARY`/`BOX`遞迴展開`SREF/AREF`，套用translation、rotation、
magnification、reflection與該pattern的optional cell name filter。Cell name來自每個shape所屬
structure的`STRNAME`，比對不區分大小寫，並支援include/exclude substring。

- Axis-aligned transformed boundary canonicalize為rectangle。
- 其他boundary保留exact transformed polygon points。
- Rectangle bounds與polygon points都保存absolute coordinates；reference transform已烘焙在shape。
- Imported placement使用fixed zero pose與`center` anchor compatibility fields。
- 所有pattern結果使用同一accumulator，Shape signature duplicate跨pattern移除，摘要統計彙總。
- Success整批取代placements；error保留原值。

Success先整批取代placements，再自動關閉modal並將success、repair、fallback、non-orthogonal與
placement validation摘要顯示在placement list上方。Error留在modal內且不得關閉或修改placements。
Close、Cancel、backdrop與Escape在idle時只關閉GDS modal、把focus還給trigger，不得連帶關閉外層
Node Editor；modal開啟期間Tab focus必須留在modal內。修改任何GDS import設定會清除上一筆摘要。

Defeature是無尺寸參數的import-time-only設定，不寫入placement payload。Worker在unit scaling後、
duplicate removal前修復每個含非X/Y軸向edge的polygon。連續非正交edge兩側若為互相垂直的
水平／垂直edge，會將兩側直線延伸到交點；若兩側平行且共線，則直接連接以填平凹洞或削除凸起。
修復後會移除重複與共線點，並驗證輪廓必須為finite、non-zero area、non-self-intersecting及完全正交。
無足夠正交edge、兩側平行但不共線或修復後無效時，該polygon改用axis-aligned bounding box。
既有rectangle與Manhattan polygon保持不變。成功摘要顯示repaired matching element數量與其中使用
bounding-box fallback的數量，duplicate signature以修復後的region計算。

Defeature關閉時保留exact transformed polygon；若最終unique regions仍有非正交edge，UI顯示
non-blocking mesher compatibility warning。Axis alignment共用`1e-6` coordinate tolerance。

## Validation與accessibility

Card-level inline error 依序報告 fixed pose/anchor、rectangle bounds、finite point、minimum
point count、unique point、zero-length edge、self-intersection 與 zero area。Status 不得只靠 color。
Preview buttons 有 accessible names 與 visible focus ring；card headings 可程式聚焦，定位不修改值。

所有reorder/remove/add controls必須有包含1-based index的accessible name。Vertex與pose inputs使用
完整native label。Desktop、compact與390px不得造成page-level horizontal overflow。

## Acceptance

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-PLACE-001` | add/remove/reorder cards | persisted array與畫面order一致。 |
| `UI-PLACE-002` | rectangle與polygon互相切換 | deterministic absolute-coordinate conversion，fixed zero pose/center anchor不變。 |
| `UI-PLACE-003` | duplicate point、zero edge、zero area或self-intersection | inline diagnostic顯示且configuration incomplete。 |
| `UI-PLACE-004` | GDS含rotated/reflected non-rectangle boundary | 保存exact absolute polygon與fixed zero pose／center anchor。 |
| `UI-PLACE-005` | second import starts before first completes | first worker terminated，stale response不覆蓋值。 |
| `UI-PLACE-006` | 手動修改rectangle/polygon或載入既有source | 共用XY preview即時更新，保持等比例與absolute coordinates。 |
| `UI-PLACE-007` | committed/disabled configuration | summary可讀，所有mutating actions不render。 |
| `UI-PLACE-008` | viewport 390px | cards與vertex editor可操作，無page-level horizontal overflow。 |
| `UI-PLACE-009` | editor初次開啟並點擊`Import from GDS` | placement list不位移；portal modal顯示GDS fields且不暗示required。 |
| `UI-PLACE-010` | placement editor或readonly summary | pose固定zero、anchor固定center，不提供pose/anchor編輯或舊版help control。 |
| `UI-PLACE-011` | Defeature關閉且GDS含非正交polygon | exact polygon匯入並顯示mesher compatibility warning。 |
| `UI-PLACE-012` | 大型外框含圓角、圓形凹槽或凸起 | 只修復局部特徵，外框保留且success摘要顯示repair數。 |
| `UI-PLACE-013` | 純圓形或無法安全局部修復的polygon | 以AABB匯入，摘要顯示bounding-box fallback數且輸出完全正交。 |
| `UI-PLACE-014` | 新增多組GDS pattern並匯入 | exact pair以OR合併、各組cell filter獨立、Defeature共用且結果整批取代placements。 |
| `UI-PLACE-015` | GDS pattern incomplete、invalid或pair重複 | 對應列顯示diagnostic且Import and replace停用。 |
| `UI-PLACE-018` | GDS modal開啟或idle時以Cancel、Close、backdrop、Escape關閉 | Tab focus保持在modal內；關閉只影響GDS modal、focus回到trigger且再次開啟仍保留draft；成功import則自動關閉並在placement list上方顯示摘要。 |
| `UI-PLACE-019` | zoom/pan後修改座標，再Fit all或成功GDS import | edit保留視角，Fit all/import顯示全部範圍；一般wheel捲動表單。 |
| `UI-PLACE-020` | 點選重疊shape或聚焦card | 較後shape優先，card/圖形同步高亮，heading取得focus；structural change清除selection。 |
| `UI-PLACE-021` | incomplete/invalid placements與清空清單 | finite invalid用無填色虛線，缺座標不畫、不殘留舊圖。 |
| `UI-PLACE-022` | 1,000 placements、readonly、390px及desktop | 全數繪製、可zoom/pan/定位，不改值或dirty state、無page-level horizontal overflow。 |
| `UI-PLACE-023` | 預覽初始畫面，點擊右上角驚嘆號或按Escape | 圖區只保留圖形及控制，不顯示統計/座標/編號定位/footer；說明預設隱藏、可開關且不推動cards。 |
| `UI-PLACE-024` | zoom/pan後Add placement並填寫遠處座標 | 新增及填寫時自動fit全部形狀；手動操作camera後恢復保持視角，controls浮在圖內右下、無標題列。 |
