---
title: Geometry entity 與 structure
status: normative
owner: integration.platform
audience:
  - geometry-kernel 與 API 開發者
  - process-step、CAD、mesher 與 viewer 開發者
  - QA 與 coding agent
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - docs/data-model.md
verified_against:
  - packages/kernel-py/src/process_flow_kernel/serialization
  - packages/kernel-py/src/process_flow_kernel/domain
  - apps/api/src/process_flow_api/models.py
---

# Geometry entity 與 structure

本文件是 [Process Flow 資料模型](../data-model.md) 的 normative geometry
reference，定義 catalog envelope、embedded geometry 與 `standard` GeometryStructure
`1.0.0`。Container scope、overlap priority 與 feature interpretation 的概念說明另見
[Geometry 解讀語意](../concepts/geometry-semantics.md)。

## 1. Version 與 unit

Canonical structure wrapper：

```json
{
  "schemaVersion": "1.0.0",
  "unitSystem": "um",
  "root": {
    "id": "container:root:empty",
    "key": "root",
    "bodies": [],
    "vias": [],
    "circuits": [],
    "bumps": [],
    "children": []
  }
}
```

- `schemaVersion` MUST 是 string `"1.0.0"`；它與 Process resource numeric
  `schemaVersion: 2` 無關。
- `unitSystem` MUST 明確為 `"um"`。目前 contract 不支援 implicit conversion。
- 所有 X/Y/Z coordinates、radius、thickness 與 `koz` MUST 以 micrometres 解讀。
- 所有數字 MUST finite。Geometry thickness/radius MUST positive；`koz` MUST
  non-negative。
- Feature `density` MUST 是 inclusive `0..100` percentage：`0` 表示 0%，`100`
  表示 100%。Renderer 需要 normalized fraction 時 MUST 一律除以 100。

完整決策見 [ADR-0003](../architecture/decisions/0003-geometry-units-and-density.md)。

## 2. `GeometryEntity` 外層結構

`GeometryEntity` 是 immutable catalog snapshot。外層沒有 Process resource
`schemaVersion: 2`；geometry format marker 位於 `structure`。

| Field | Type | Persisted requirement | Contract |
| --- | --- | --- | --- |
| `id` | Process Flow identifier | required | Catalog identity。Create/import request MAY omit或使用 `null`，server then generates id。 |
| `name` | non-empty string | required | Human-facing name。 |
| `entityType` | non-empty string | required | Exact-match semantic type，例如 `panel`、`wafer`、`die`。 |
| `category` | string or omitted | optional | Dot-delimited classification，例如 `die.hbm`。 |
| `version` | non-empty string or omitted | optional | Opaque metadata label；未正式發行前若提供，MUST 是 `current`，不得 parse、sort 或驅動行為。 |
| `owner` | string or omitted | optional | Owning team/domain。 |
| `description` | string or omitted | optional | Description。 |
| `icon` | string or omitted | optional | Viewer icon key；不是 geometry semantics。 |
| `iconScale` | positive finite number or omitted | optional | Viewer scale；不是 geometry semantics。 |
| `structureFormat` | literal `"standard"` | required | 目前唯一 supported format。 |
| `structure` | `GeometryStructure` | required | Complete, deeply valid structure。 |

Persisted catalog id MUST non-null。Preview download MAY 使用 `id: null`，但在匯入 catalog
時 server MUST 生成符合 Process Flow identifier grammar 的新 id。

## 3. EmbeddedGeometry

`EmbeddedGeometry` 只存在於 `FlowConfiguration.embeddedGeometries`，shape 等同
`GeometryEntity` metadata + structure，但 MUST NOT 有 catalog `id`。Map key 是
`localId` identity。

Commit MUST：

1. materialize only referenced local ids；
2. 每個 referenced local id 建立 exactly one immutable `GeometryEntity`；
3. 將所有該 local id bindings 改寫成同一 catalog id；
4. 清空 committed workspace 的 embedded map。

## 4. GeometryStructure

| Field | Type | Required | Contract |
| --- | --- | --- | --- |
| `schemaVersion` | literal string `"1.0.0"` | yes | Geometry schema version。 |
| `unitSystem` | literal string `"um"` | yes | Canonical unit。 |
| `root` | `Container` | yes | Root geometry scope。 |

Coordinates are global。Container parent/child relation MUST NOT imply local translation、
rotation、scale 或 transform；move/flip operation 必須直接改寫 primitives 的 global
coordinates。

Runtime-only `cursorZ`、process footprint、scope handles 與 parent object references MUST
NOT serialize into GeometryStructure。

## 5. Container

```json
{
  "id": "container:root:example",
  "key": "package-root",
  "bodies": [],
  "vias": [],
  "circuits": [],
  "bumps": [],
  "children": []
}
```

| Field | Type | Required in normalized output | Contract |
| --- | --- | --- | --- |
| `id` | opaque string | yes | Structure-local derived identity；MUST unique within structure。 |
| `key` | string | yes | Human-readable scope key；不保證唯一。 |
| `bodies` | `Body[]` | yes | Direct physical-volume owners。 |
| `vias` | `Via[]` | yes | Direct via features。 |
| `circuits` | `Circuit[]` | yes | Direct routing features。 |
| `bumps` | `Bump[]` | yes | Direct bump/contact features。 |
| `children` | `Container[]` | yes | Child semantic scopes。 |

Imported/authoring payload MAY omit `id` 或 empty arrays；normalization MUST deterministically
fill them before compiler output、execution result、preview download 或 new catalog persistence。

Container 是 scope，不直接擁有 material/physical volume。Body 才是完整 solid volume；
Via/Circuit/Bump 是 owner container 內的 density features。Feature 不因 spatial overlap
自動跨 parent、child 或 sibling scope。

## 6. Body 與 feature

### 6.1 共用欄位

| Field | Body | Via | Circuit | Bump |
| --- | --- | --- | --- | --- |
| `id` | required normalized | required normalized | required normalized | required normalized |
| `geometry` | required | required | required | required |
| `material` | non-empty string | non-empty string | non-empty string | non-empty string |
| `density` | not allowed | `0..100` | `0..100` | `0..100` |
| `direction` | not allowed | `+z \| -z` | not allowed | `+z \| -z` |
| `koz` | not allowed | non-negative `um` | non-negative `um` | non-negative `um` |

Canonical feature examples：

```json
{
  "id": "via:root:example",
  "geometry": {
    "type": "CylinderGeometry",
    "center": [0, 0, 0],
    "bottom_radius": 5,
    "thk": 20
  },
  "material": "Cu",
  "density": 55,
  "direction": "+z",
  "koz": 2
}
```

Rules：

- Via/Bump `direction` MUST always be present；不得從 geometry Z location 推論。
- Z-axis flip MUST reverse `+z <-> -z` for every via/bump in flipped scope。
- `koz` 不預先改寫 geometry envelope。Downstream materialization MAY 對 XY footprint
  做 inward inset。
- Runtime material-instance suffix MAY 改寫 `material`，但不得改變 feature type/scope。

## 7. Geometry primitive union

Primitive 使用 exact type discriminator 與 field casing。

### 7.1 BoxGeometry

```json
{
  "type": "BoxGeometry",
  "bottom_left": [-10, -10, 0],
  "top_right": [10, 10, 0],
  "thk": 5
}
```

- `bottom_left`、`top_right` MUST 是 exactly three finite numbers `[x, y, z]`。
- 兩點 Z MUST equal；XY bounds MUST non-empty。
- `thk` MUST positive。

### 7.2 CylinderGeometry

```json
{
  "type": "CylinderGeometry",
  "center": [0, 0, 0],
  "bottom_radius": 10,
  "thk": 5
}
```

- `center` MUST 是 `[x, y, z]`。
- `bottom_radius` 與 `thk` MUST positive。

### 7.3 ConeGeometry

```json
{
  "type": "ConeGeometry",
  "center": [0, 0, 0],
  "bottom_radius": 10,
  "top_radius": 8,
  "thk": 5
}
```

- `center` MUST 是 `[x, y, z]`。
- Both radii 與 `thk` MUST positive。
- Z flip MUST swap bottom/top radii。

### 7.4 PolygonGeometry

```json
{
  "type": "PolygonGeometry",
  "polys": [
    [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]
  ],
  "thk": 5
}
```

- `polys` MUST 至少一個 loop；每個 loop MUST 至少三個 unique `[x, y, z]` points。
- 所有 loops/points MUST 位於同一 Z plane。
- Loop MUST non-zero area、不得 self-intersect；不同 loop boundaries 不得交叉或不合法
  touch。
- First/last duplicate closing point MAY 輸入，但 normalized output SHOULD 移除。
- `thk` MUST positive。

## 8. Structure-local id

Structure ids 是 opaque、derived diagnostic handles，不是 catalog/resource identity：

- Normalizer MUST 保留合法 explicit id，或從 kind、container path、array index 與 payload
  deterministic derive。
- Normalized structure 內 ids MUST unique。
- Reorder array、move item to different scope 或改變 payload MAY 改變 derived id。
- Consumer MUST NOT 把 derived id 當成跨 structure revision 的 durable reference。
- Process Flow identifier regex 不適用於 structure-local ids。

## 9. Scope 與 overlap 語意

- Body physical volume ownership 屬於 containing container。
- Via/Circuit/Bump effect 只屬於 containing container，不向 parent/child 傳播。
- Descendant item 與 ancestor item overlap 時，materialized view 中 descendant 具有 higher
  spatial priority；overlap 不表示 double volume。
- Sibling/otherwise unrelated scopes 沒有通用 priority；producers SHOULD avoid ambiguous
  overlap。
- CAD、viewer、mesh、cross-section consumers MUST preserve these scope semantics。

## 10. Geometry constraint 比對

Compiler resolve `FlowInputDefinition.geometryConstraints` 時：

- `entityTypes` 對 envelope `entityType` 做 exact case-sensitive match；
- `categories` 接受 exact category 或 dot-delimited descendant；
- `structureFormats` 對 `structureFormat` exact match；
- 不論 constraints 是否指定，used structure 都 MUST 是 schema `1.0.0`、unit `um` 並通過
  deep validation。

## 11. 完整 `GeometryEntity` 範例

```json
{
  "id": "panel_reference_1",
  "category": "carrier.panel",
  "entityType": "panel",
  "name": "Reference Panel",
  "version": "current",
  "owner": "integration.platform",
  "description": "20 x 20 x 5 um reference panel.",
  "structureFormat": "standard",
  "structure": {
    "schemaVersion": "1.0.0",
    "unitSystem": "um",
    "root": {
      "id": "container:panel-root:example",
      "key": "panel-root",
      "bodies": [
        {
          "id": "body:panel-root:example",
          "geometry": {
            "type": "BoxGeometry",
            "bottom_left": [-10, -10, 0],
            "top_right": [10, 10, 0],
            "thk": 5
          },
          "material": "Si"
        }
      ],
      "vias": [],
      "circuits": [],
      "bumps": [],
      "children": []
    }
  }
}
```

## 12. 已知實作差異

Geometry implementation gaps 的唯一追蹤來源是
[Target contract 實作對照](../conformance.md)：`DM-002`、`DM-003`、`DM-007`、`DM-011`、
`DM-018`、`DM-019` 與 `DM-020`。Consumers MUST 實作 target contract，不得依賴 current
寬鬆行為。
