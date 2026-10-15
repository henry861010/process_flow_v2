---
title: Geometry Kernel runtime API
status: descriptive
owner: integration.platform
audience:
  - process-step authors
  - kernel consumers
last_verified: 2026-10-12
last_verified_commit: d245f9117808730f6460ad885cfc96bbb22bc1d1
source_of_truth:
  - packages/kernel-py/src/process_flow_kernel/__init__.py
  - packages/kernel-py/src/process_flow_kernel/domain/process_geometry_state.py
  - packages/kernel-py/src/process_flow_kernel/application
---

# Geometry Kernel runtime API

本頁是目前 Python package 已 export 且 production path 使用的 API map。Method signature
的最終 source of truth 仍是 code；這是 internal API，正式發行前仍可協調調整。

## Application API

### `FlowCompiler`

- `FlowCompiler(geometry_catalog, geometry_generator_resolver=None)`：catalog 必須提供
  `get_geometry(id)`；解析 generator binding 時，resolver 必須提供
  `generate(generator_id, generator_version, parameters)` 並回傳完整 geometry entity。
- `validate_configuration(..., require_complete, included_step_ref_ids=None, resolve_resources=False)`：draft 或 complete validation。
- `compile(..., output_step_ref_id=None) -> ExecutionPlan`：validate、resolve、normalize 並建立 ordered plan；指定 output 時只包含 upstream closure。
- `resolve_flow_input(..., flow_input_id)`：不執行 step，直接 resolve/normalize binding。

### `GeometryKernel`

`GeometryKernel(module_resolver=None).execute(execution_plan, options=None)` 只接受 `ExecutionPlan`。`ExecuteOptions.output_step_ref_id` 可選擇 output；否則使用 terminal list 最後一個。沒有 executable terminal step 時會 raise `ValueError`。

Result `GeometryKernelExecutionResult` 提供：

- `geometry()`
- `step_output(step_ref_id)`
- `step_outputs()`
- `terminal_step_ref_ids()`

所有 getter 回傳 copy，避免 caller 修改 kernel result cache。

### Plan types

`ExecutionPlan` 包含 `steps`、fully resolved `external_geometries` 與 `terminal_step_ref_ids`。Catalog、embedded、generator bindings 都在編譯時轉成 geometry artifact；`PlannedGeometryInput.kind` 為 `external` 或 `stepOutput`，plan 不帶 repository handle。

## `ProcessGeometryState`

### 生命週期

| API | Purpose |
| --- | --- |
| `create(options=None)` | 建立 empty root state |
| `from_structure(payload, options=None)` | Hydrate standard structure |
| `clone()` | Deep copy state 與 scope tree |
| `to_geometry_structure(...)` | Serialize/normalize structure |

`from_structure` 預設從 largest direct root body derive process footprint，並將 cursor 初始化到 geometry top。若 consumer 需要不同策略，應顯式提供 options。

### Cursor 與 bounds

- `cursor_z()`、`set_cursor_z(z)`、`advance_cursor_by(thickness)`、`advance_cursor_to(z)`
- `geometry_z_min()`、`geometry_z_max()`、`root_body_z_max()`、`z_bounds()`、`bounds(scope="root")`

Cursor 是 process operation reference，不是 geometry bounds 的 alias。

### Process footprint

- `set_process_footprint(spec)`
- `set_box_footprint(...)`、`set_cylinder_footprint(...)`、`set_polygon_footprint(...)`
- `process_footprint()`、`require_process_footprint()`
- `derive_process_footprint(from_="largestRootBody", scope="root")`

### 初始化與 deposition

- `initialize_layer(...)` 及 box/cylinder/polygon/cone convenience variants
- `deposit_layer(material, thickness, z=None, advance_cursor=True, scope="root", xy_inset=0, key=None)`
- `fill_to(material, z, scope="root", key=None)`
- `deposit_geometry(...)` 及 box/cylinder/polygon/cone variants

Initialization 建立第一層並可設定 footprint；所有 body-producing APIs 接受 optional registered
`key`，copy、clip、resize 與 serialization 會保留。未指定時 serialization 省略欄位。Deposit
預設使用 current process footprint。Positive thickness 與 non-empty footprint 由 runtime
validation enforce。

### Feature

- `add_via(...)`、`add_via_below_cursor(...)`、`add_via_above_cursor(...)`
- `add_circuit(...)`、`add_circuit_at_cursor(...)`
- `add_bump(...)`、`add_bump_above_cursor(...)`

Via/bump require direction；feature methods保存 0–100 density 與 non-negative `koz`。

`Bump(..., *, stage: BumpStage)`、`add_bump(..., stage=...)` 與
`add_bump_above_cursor(..., stage=...)` 都要求明確提供 `stage`。`BumpStage` 是
`Literal["deposited", "reflowed", "joined"]`；package 同時 export `BUMP_STAGES` 與
`validate_bump_stage(value, path="bump.stage")` 供 consumers 共用 runtime validation。
`Bump.stage()` 讀取目前值，`Bump.json()` 固定輸出 `stage`。Copy、厚度調整、幾何變換與
placement 保留此欄位，不推進製程階段。JSON 缺少或含非法值時 normalization／hydration
會以 `ValueError` 指出 `structure.root...bumps[index].stage`。
階段語意見 [Bump stage](../geometry-structure.md#62-bump-stage)。
`Bump.copy_with_stage(stage)` 回傳 stage 經驗證的新 bump，保留 geometry 與其他 metadata。

### Process operation

- `apply_under_fill(material, thickness=None, thk=None, gap, scope="root", key=None)`
- `move(...)`
- `flip_around_z(...)`
- `grind_to(...)`
- `saw_to_box(...)`
- `remove_top_root_bodies(...)`
- `remove_bonded_carrier_stack(carrier_key="carrier", daf_key="daf", ...)`
- `bond_carrier_geometry(source, ...)`
- `place_geometry_state(source, ...)` / `place_geometry_states(source, placements)`
- `bump_placement_bottom_z(source, *, x, y, anchor="origin", main_z=None)`
- `join_bumps(*, joined_height)`

`bump_placement_bottom_z` 是不修改 source/main 的高度查詢。Source 最底部 direct bump
為 deposited/reflowed 時，尋找 main root 中底面位於 main_z、實際 XY footprint 與該 bump
具有正重疊面積的 deposited/reflowed envelope；回傳 main_z 加下側厚度，無配對則回傳 main_z。
main_z 預設 current cursor；同一 source 有多個下側配對或不同支撐高度時報錯。
供 adaptive PnP 整批 materialize 後驗證使用，不改變底層一般 placement 的契約。

`join_bumps` 要求正的 joined_height，僅接合 root 直屬 child 最底部 direct reflowed bumps
與 root reflowed bumps。完整 batch 先驗證唯一配對、XY footprint 正重疊面積、Z 接觸，以及共同下側
底面／接觸面（1e-5 um tolerance），再更新上側 bump stage、厚度、底面並平移整個 child。
Joined height 是完整間距，上側 metadata／identity 保留，下側 bump、cursor、footprint
不變。部分重疊即可讓整片上側 bump 成為 joined，包含超出下側 footprint 的區域，
不裁切或拆分；只在邊線或單點接觸不算配對。圓形使用實際圓周，polygon 孔洞不算重疊。
未配對 child 略過；零配對時正常完成且不修改 state。同一 child 僅部分底部 bumps
有配對、歧義或跨層皆原子性失敗。

`remove_bonded_carrier_stack` 遞迴要求唯一 key=`carrier` body 位於 full geometry top，並移除該
carrier 與零或一個緊貼其底面、primitive type 和 XY footprint 相同的 key=`daf` body。非相連
DAF 與較低 carrier 保留；matching bodies 可位於不同 containers。失敗時 state 與 cursor 不變。

`saw_to_box` recursively保留指定 XY rectangle 並把 process footprint 更新成 box。Cylinder 完整落在保留框內時維持 Cylinder；保留框四角都在圓內時會精確轉成 Box。其他穿越圓周的部分 Cylinder 裁切，以及 Cone 的部分裁切，仍會 reject。

`place_geometry_state` 可同時提供 `top_right_x` / `top_right_y`。提供時 runtime 以 source
subtree aggregate XY bounds 計算 target/source size delta，對 clone 中每個 BoxGeometry 固定
lower-left 並將 upper-right 加上 delta，再執行 anchor placement。Resize 允許縮小，但任何
primitive collapse 或非 BoxGeometry 都會在 attach 前 reject。

### Scope 與 inspection

- `root_scope_ref()`
- `find_scopes(key=None, id=None, recursive=True, match="exact")`
- `scope_summary(scope="root")`
- `inspect()`

`find_scopes` 的 `match="family"` 允許 `carrier` 匹配 `carrier.panel`／`carrier.wafer`；預設
`exact`。Scope argument 接受 root marker 或 kernel scope ref。Process-step author不應依賴
underscore-prefixed state/container methods。

## Geometry/domain types

Package export `Container`、`Body`、`Via`、`Circuit`、`Bump` 以及 `BoxGeometry`、
`PolygonGeometry`、`CylinderGeometry`、`ConeGeometry`。`Container(key=None)` 與
`Body(geometry, material, key=None)` 接受 optional registered semantic role；`key()` 回傳
string 或 `None`，copy family 會保留。這些 domain types 主要支援 hydration 與 kernel
implementation；step authoring 的首選 surface 是 `ProcessGeometryState`。

## Serialization helper

- `normalize_geometry_structure`
- `geometry_structure_to_process_geometry_state`
- `process_geometry_state_to_geometry_structure`
- `stable_id`
- `classify_polygon_loops` / `validate_polygon_loops`
- `GEOMETRY_SCHEMA_VERSION` / `DEFAULT_UNIT_SYSTEM`

Normalization 會 deep-copy input，不應用來 in-place 修補 caller document。

## 錯誤模型

目前使用 built-in `ValueError`、`TypeError`、`KeyError`，沒有 stable exception hierarchy。Caller 應在 API boundary 轉譯錯誤，而非依賴完整 message text。
