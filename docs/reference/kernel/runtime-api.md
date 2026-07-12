---
title: Geometry Kernel runtime API
status: descriptive
owner: integration.platform
audience:
  - process-step authors
  - kernel consumers
last_verified: 2026-07-11
last_verified_commit: b01b1e70
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

- `FlowCompiler(geometry_catalog)`：catalog 必須提供 `get_geometry(id)`。
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

`ExecutionPlan` 包含 `steps`、fully resolved `external_geometries` 與 `terminal_step_ref_ids`。`PlannedGeometryInput.kind` 為 `external` 或 `stepOutput`；plan 不帶 repository handle。

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
- `deposit_layer(material, thickness, z=None, advance_cursor=True, scope="root", xy_inset=0)`
- `fill_to(material, z, scope="root")`
- `deposit_geometry(...)` 及 box/cylinder/polygon/cone variants

Initialization 建立第一層並可設定 footprint；deposit 預設使用 current process footprint。Positive thickness 與 non-empty footprint 由 runtime validation enforce。

### Feature

- `add_via(...)`、`add_via_below_cursor(...)`、`add_via_above_cursor(...)`
- `add_circuit(...)`、`add_circuit_at_cursor(...)`
- `add_bump(...)`、`add_bump_above_cursor(...)`

Via/bump require direction；feature methods保存 0–100 density 與 non-negative `koz`。

### Process operation

- `apply_under_fill(material, thickness=None, thk=None, gap, scope="root")`
- `move(...)`
- `flip_around_z(...)`
- `grind_to(...)`
- `saw_to_box(...)`
- `remove_top_root_bodies(...)`
- `bond_carrier_geometry(source, ...)`
- `place_geometry_state(source, ...)` / `place_geometry_states(source, placements)`

`place_geometry_state` 可同時提供 `top_right_x` / `top_right_y`。提供時 runtime 以 source
subtree aggregate XY bounds 計算 target/source size delta，對 clone 中每個 BoxGeometry 固定
lower-left 並將 upper-right 加上 delta，再執行 anchor placement。Resize 允許縮小，但任何
primitive collapse 或非 BoxGeometry 都會在 attach 前 reject。

### Scope 與 inspection

- `root_scope_ref()`
- `find_scopes(key=None, id=None, recursive=True)`
- `scope_summary(scope="root")`
- `inspect()`

Scope argument 接受 root marker 或 kernel scope ref。Process-step author不應依賴 underscore-prefixed state/container methods。

## Geometry/domain types

Package export `Container`、`Body`、`Via`、`Circuit`、`Bump` 以及 `BoxGeometry`、`PolygonGeometry`、`CylinderGeometry`、`ConeGeometry`。它們主要支援 hydration 與 kernel implementation；step authoring 的首選 surface 是 `ProcessGeometryState`。

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
