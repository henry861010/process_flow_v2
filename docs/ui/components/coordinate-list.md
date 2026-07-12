---
title: Coordinate List
status: normative
owner: Process Flow UI
audience:
  - process-engineering
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-07-11
last_verified_commit: b01b1e702c0e08c73d0ad7f13b7c1e32f38d7ce4
source_of_truth:
  - apps/viewer/components/process-flow-fields/coordinate-list-control.tsx
  - apps/viewer/components/process-flow-fields/coordinate-list-value.ts
  - apps/viewer/components/process-flow-fields/gds-coordinate-geometry.ts
  - apps/viewer/components/process-flow-fields/gds-coordinate-import.worker.ts
---

# Coordinate List

## Value 契約

Canonical editable value是：

```ts
type CoordinatePair = [number, number];
type CoordinateBounds = [CoordinatePair, CoordinatePair];
type CoordinateList = CoordinateBounds[];
```

每列依序保存 lower-left 與 upper-right。Draft cell可暫時是empty string。Complete條件：value
是array、每列四值皆finite、`xMax > xMin`、`yMax > yMin`，且無duplicate。四個對應值都在
absolute tolerance `1e-6 um` 內時視為duplicate；只有後出現的row標duplicate。Empty list本
component視為shape complete，required/min count由parameter validator決定。

## Tabs 與版面配置

Default tab `Manual`，另一tab `GDS`；Radix tabs高度36px，content上margin8px。

### 手動輸入

White bordered card。Header padding12px/8px，左顯示
`<n> coordinate/coordinates`，右 primary small `Plus + Add die`。

Rows column gap8、padding12。Coordinate parameter 使用完整 parameter row 寬度，不與左側
parameter description 分欄。每個 die row header 以 compact muted badge 顯示 `Die <n>`，右側
是 compact remove button；下方是
Lower-left／Upper-right 兩個 bordered point groups。寬螢幕兩個 point groups並排，
窄螢幕垂直堆疊；每個 group 內 X/Y 在 `sm` 以上兩欄，更窄時各自占滿一列。

每個 point group 以 legend 顯示 point 名稱，X/Y input 使用完整可用寬度。Unit若存在顯示在
input右側，accessible name 保留完整 `Lower-left X` 等語意。
Empty state exact copy `No coordinates`。Invalid/duplicate row改 destructive border/surface，依序顯示：

- `Duplicate coordinate`
- `All lower-left and upper-right values must be finite numbers`
- `Upper-right must be greater than lower-left on both axes`

Card下方聚合 diagnostics依情況顯示 `Invalid rows: ...`、`Invalid bounds rows: ...`、
`Duplicate rows: ...`。

### GDS

White card padding12。Grid在`md`以上為 `1.4fr 110px 110px`：

| Field | Rule |
| --- | --- |
| `GDS file` | accept `.gds,.gdsii,.strm,.stream` + octet-stream。 |
| `Layer` | integer `>=0`。 |
| `Datatype` | integer `>=0`。 |

Footer左顯示 filename或 `No file selected`；右是 `Import and replace`。缺file/layer/datatype或
importing時disabled；importing icon是 spinning `Loader2`，否則 `FileUp`。

## GDS 語意

Parse在dedicated Web Worker執行；新import會terminate previous worker。只把指定layer/datatype的
`BOUNDARY`/`BOX`轉成其所有transform後的 axis-aligned bounds
`[[minX,minY],[maxX,maxY]]`；遞迴展開`SREF/AREF`並套translation、rotation、magnification、
reflection。其他matching element計入unsupported summary。

Unit由GDS meters/database-unit換成definition unit；canonical專案unit是 `um`。Worker另支援
m/mm/nm 保留為 legacy aliases；未知／空 unit scale 1。

Import success**整批取代**manual coordinates並顯示：

```text
Imported <n> coordinates from <m> matching elements.
Top cells: ...
```

視情況追加duplicates removed、unsupported elements、unresolved/cyclic references。Error保留原
coordinates，顯示worker message或 `GDS import failed.`。

## Action 與狀態矩陣

| State/action | Result |
| --- | --- |
| Add die | append `[["",""],["",""]]`；清import summary。 |
| Edit bounds | parse finite float或empty；清import summary。 |
| Remove | 刪該row。 |
| Importing | button disabled，舊coordinates保留。 |
| Import success | replace全部rows，green feedback。 |
| Import error | rows不變，destructive feedback。 |
| Component unmount | worker terminate。 |

## 鍵盤、focus 與 ARIA

- Tabs使用Radix keyboard semantics。
- Remove accessible name exact `Remove coordinate <n>`。
- 四個bounds native labels可讀；file/layer/datatype均以label包覆。
- Diagnostics需加入live-region是target gap；現行為普通text。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-COORD-001` | invalid/duplicate rows | row + aggregate diagnostics都列1-based index。 |
| `UI-COORD-002` | 四個對應values差都小於或等於duplicate tolerance | 後一列被判duplicate。 |
| `UI-COORD-003` | valid GDS/layer/datatype | transformed axis-aligned bounds以um取代原list。 |
| `UI-COORD-006` | upper-right任一axis不大於lower-left | row顯示invalid bounds且configuration incomplete。 |
| `UI-COORD-004` | second import starts | first worker terminated，stale response不覆蓋值。 |
| `UI-COORD-005` | 390px | row controls可用，無horizontal overflow。 |
