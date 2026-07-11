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
  - apps/viewer/components/process-flow-fields/gds-coordinate-import.worker.ts
---

# Coordinate List

## Value 契約

Canonical editable value是：

```ts
type CoordinatePair = [number, number];
type CoordinateList = CoordinatePair[];
```

Draft cell可暫時是empty string。Complete條件：value是array、每列X/Y皆finite、無duplicate。
Duplicate key以 tolerance `1e-6`量化；只有後出現的row標duplicate。Empty list本component視為shape
complete，required/min count由parameter validator決定。

## Tabs 與版面配置

Default tab `Manual`，另一tab `GDS`；Radix tabs高度36px，content上margin8px。

### 手動輸入

White bordered card。Header padding12px/8px，左顯示
`<n> coordinate/coordinates`，右 primary small `Plus + Add die`。

Rows column gap8、padding12。每row desktop grid
`52px minmax(0,1fr) minmax(0,1fr) 36px`；`<640px` 是
`44px minmax(0,1fr) 36px`，Y field依CSS flow換至下一行。Row padding8、background muted/10。

每列：`#<1-based>`、X number、Y number、36px Trash button。Unit若存在顯示在input右側。
Empty state exact copy `No coordinates`。Invalid/duplicate row改 destructive border/surface，依序顯示：

- `Duplicate coordinate`
- `X and Y must both be finite numbers`

Card下方聚合 diagnostics依情況顯示 `Invalid rows: ...`、`Duplicate rows: ...`。

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
`BOUNDARY`/`BOX`轉成其所有transform後bounds左下角；遞迴展開`SREF/AREF`並套translation、
rotation、magnification、reflection。其他matching element計入unsupported summary。

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
| Add die | append `["",""]`；清import summary。 |
| Edit X/Y | parse finite float或empty；清import summary。 |
| Remove | 刪該row。 |
| Importing | button disabled，舊coordinates保留。 |
| Import success | replace全部rows，green feedback。 |
| Import error | rows不變，destructive feedback。 |
| Component unmount | worker terminate。 |

## 鍵盤、focus 與 ARIA

- Tabs使用Radix keyboard semantics。
- Remove accessible name exact `Remove coordinate <n>`。
- X/Y native labels可讀；file/layer/datatype均以label包覆。
- Diagnostics需加入live-region是target gap；現行為普通text。

## 驗收案例

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-COORD-001` | invalid/duplicate rows | row + aggregate diagnostics都列1-based index。 |
| `UI-COORD-002` | values差小於duplicate tolerance | 後一列被判duplicate。 |
| `UI-COORD-003` | valid GDS/layer/datatype | transformed bottom-left coordinates以um取代原list。 |
| `UI-COORD-004` | second import starts | first worker terminated，stale response不覆蓋值。 |
| `UI-COORD-005` | 390px | row controls可用，無horizontal overflow。 |
