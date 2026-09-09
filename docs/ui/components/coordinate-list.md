---
title: Placement List
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-09-06
last_verified_commit: 5f262e1a
source_of_truth:
  - apps/viewer/components/process-flow-fields/placement-list-control.tsx
  - apps/viewer/components/process-flow-fields/gds-placement-import.tsx
  - apps/viewer/components/process-flow-fields/gds-import-criteria.ts
  - apps/viewer/components/process-flow-fields/gds-import-criteria.test.ts
  - apps/viewer/components/process-flow-fields/gds-coordinate-geometry.ts
  - apps/viewer/components/process-flow-fields/gds-coordinate-geometry.test.ts
  - apps/viewer/components/process-flow-fields/gds-coordinate-import.worker.ts
---

# Placement List

## Value契約

`placements`是ordered array。每筆同時保存rectangle或simple polygon `targetRegion`、required
`pose.x/y/rotationZ`與required `anchor`。Target region使用local XY，pose表示anchor的global XY。

Rectangle width/height必須positive finite。Polygon至少三個unique finite points，不得有
zero-length edge、zero area或self-intersection；first/last closing duplicate由normalizer移除。
Draft numeric cell可暫時是empty string，但configuration complete時所有欄位都必須合法。

## Placement cards

每筆資料使用一張ordered card。Header顯示index與compact summary，並提供Move up、Move down與
Remove。Body依序顯示shape、pose X/Y、rotation Z與anchor；rectangle另顯示width/height，polygon
顯示local X/Y vertex table。Array order就是runtime execution與serialized child order。

Add placement建立rectangle draft：pose `(0,0)`、rotation `0`、anchor `bottomLeft`，width/height
保持empty。Shape轉換規則：

- Rectangle→Polygon：合法尺寸轉成四角；incomplete尺寸轉成三個empty point rows。
- Polygon→Rectangle：合法points轉成AABB width/height；invalid points轉成empty尺寸。
- Pose、rotation、anchor與array position保持不變。

Polygon preview使用SVG顯示外框、vertex order、rotation與黃色anchor marker。Preview不得修改值；
invalid draft顯示fallback copy且不得throw。Readonly mode顯示summary與polygon preview，不顯示操作。

## GDS import

GDS不是required input。Editor初始只顯示小型`Import from GDS`button；button以`aria-expanded`
控制import panel。使用者展開後選擇一個file，並維護至少一組pattern。每組pattern各自包含
layer、datatype與optional cell name filter；`Defeature`是default-off且由所有pattern共用。

Pattern以exact layer/datatype pair做OR比對，不產生layer與datatype的cross product。同一pair不得
重複；任一pair incomplete、不是non-negative safe integer或重複時，顯示inline diagnostic並停用
import。Add pattern新增include、empty cell filter的空白列；remove不得刪除最後一列。Pattern order
不影響結果。

Import在dedicated Web Worker執行；新import terminate previous worker。Worker只解析、遍歷GDS一次，
把符合任一pattern的`BOUNDARY`/`BOX`遞迴展開`SREF/AREF`，套用translation、rotation、
magnification、reflection與該pattern的optional cell name filter。Cell name來自每個shape所屬
structure的`STRNAME`，比對不區分大小寫，並支援include/exclude substring。

- Axis-aligned transformed boundary canonicalize為rectangle。
- 其他boundary保留exact transformed polygon points。
- Rectangle bounds與polygon points都保存absolute coordinates；reference transform已烘焙在shape。
- Imported placement使用fixed zero pose與`center` anchor compatibility fields。
- 所有pattern結果使用同一accumulator，Shape signature duplicate跨pattern移除，摘要統計彙總。
- Success整批取代placements；error保留原值。

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

Card-level inline error依序報告pose、rectangle size、finite point、minimum point count、unique
point、zero-length edge、self-intersection與zero area。Status不得只靠border color。

Pose與anchor欄位共用一個小型驚嘆號help control。Mouse hover或keyboard focus時顯示tooltip，說明
Pose X/Y是selected anchor的global位置、Rotation Z繞anchor逆時針旋轉，以及三種anchor定義。

所有reorder/remove/add controls必須有包含1-based index的accessible name。Vertex與pose inputs使用
完整native label。Desktop、compact與390px不得造成page-level horizontal overflow。

## Acceptance

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-PLACE-001` | add/remove/reorder cards | persisted array與畫面order一致。 |
| `UI-PLACE-002` | rectangle與polygon互相切換 | deterministic conversion且pose/anchor不變。 |
| `UI-PLACE-003` | duplicate point、zero edge、zero area或self-intersection | inline diagnostic顯示且configuration incomplete。 |
| `UI-PLACE-004` | GDS含rotated/reflected non-rectangle boundary | 保存exact absolute polygon與fixed zero pose／center anchor。 |
| `UI-PLACE-005` | second import starts before first completes | first worker terminated，stale response不覆蓋值。 |
| `UI-PLACE-006` | polygon rotation或anchor改變 | SVG preview以selected anchor為pivot更新。 |
| `UI-PLACE-007` | committed/disabled configuration | summary可讀，所有mutating actions不render。 |
| `UI-PLACE-008` | viewport 390px | cards與vertex editor可操作，無page-level horizontal overflow。 |
| `UI-PLACE-009` | editor初次開啟 | 只顯示`Import from GDS`button；GDS fields保持收合且不暗示required。 |
| `UI-PLACE-010` | hover或focus pose help驚嘆號 | tooltip完整解釋Pose X/Y、Rotation Z與Anchor。 |
| `UI-PLACE-011` | Defeature關閉且GDS含非正交polygon | exact polygon匯入並顯示mesher compatibility warning。 |
| `UI-PLACE-012` | 大型外框含圓角、圓形凹槽或凸起 | 只修復局部特徵，外框保留且success摘要顯示repair數。 |
| `UI-PLACE-013` | 純圓形或無法安全局部修復的polygon | 以AABB匯入，摘要顯示bounding-box fallback數且輸出完全正交。 |
| `UI-PLACE-014` | 新增多組GDS pattern並匯入 | exact pair以OR合併、各組cell filter獨立、Defeature共用且結果整批取代placements。 |
| `UI-PLACE-015` | GDS pattern incomplete、invalid或pair重複 | 對應列顯示diagnostic且Import and replace停用。 |
