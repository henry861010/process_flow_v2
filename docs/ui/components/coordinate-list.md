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
控制import panel，使用者展開後才顯示file、layer、datatype、cell name filter與default-off
`Defeature`選項。

Import在dedicated Web Worker執行；新import terminate previous worker。只把指定layer/datatype的
`BOUNDARY`/`BOX`遞迴展開`SREF/AREF`，套用translation、rotation、magnification、reflection與
optional cell name filter。Cell name來自每個shape所屬structure的`STRNAME`，比對不區分大小寫，
並支援include/exclude substring。

- Axis-aligned transformed boundary canonicalize為rectangle。
- 其他boundary保留exact transformed polygon points。
- Rectangle bounds與polygon points都保存absolute coordinates；reference transform已烘焙在shape。
- Imported placement使用fixed zero pose與`center` anchor compatibility fields。
- Success整批取代placements；error保留原值。Shape signature duplicate會移除。

Defeature是import-time-only設定，不寫入placement payload。啟用後，使用者必須輸入positive finite
`Minimum feature size`，單位與placement unit相同。Worker在unit scaling後、duplicate removal前，
使用每個獨立region的AABB判斷尺寸；含有非X/Y軸向edge，且AABB width與height都嚴格小於門檻的
region會被移除。Axis alignment使用`1e-6` coordinate tolerance，因此小型rectangle與Manhattan
polygon仍保留。達到門檻或較大的非正交polygon繼續匯入，UI以non-blocking warning顯示最終unique
non-orthogonal region數量，且不得將其改成AABB。成功摘要另顯示defeatured matching element數量；
若全部被移除，仍依replace semantics產生empty placements。

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
| `UI-PLACE-011` | Defeature開啟且門檻為空、零、負數或non-finite | Import disabled且顯示inline validation。 |
| `UI-PLACE-012` | 小型非正交boundary與小型Manhattan boundary同批匯入 | 前者移除、後者保留，success摘要顯示移除數。 |
| `UI-PLACE-013` | Defeature後仍有大型非正交polygon | exact polygon仍匯入，另顯示mesher compatibility warning。 |
