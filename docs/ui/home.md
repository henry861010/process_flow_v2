# Home UI Design

## Route

`/`

## Purpose

Home page 是 process flow tools 的入口與 overview 頁。此頁需要直接顯示目前 browser
`localStorage` 中所有 process flow instances，讓使用者不用進 editor 也能看見目前有哪些
TV/Product instance。

Home page 同時保留進入下列 tools 的 actions：

- Flow Template Editor：`/flow-template-editor`
- Flow Instance Editor：`/flow-instance-editor`
- Process Step Editor：`/admin/processstepeditor`
- `cmd: reset-poc-data`：POC-only system command，清除整個 origin 的 browser `localStorage`，再寫回 default JSON seed。

## Data Source

Home page 不連接 backend service。所有資料都從 browser `localStorage` 讀取：

| localStorage key | Value shape | Home usage |
|---|---|---|
| `processStepTemplates` | `ProcessStepTemplate[]` | Resolve expected field count and missing-step status. |
| `processFlowTemplates` | `ProcessFlowTemplate[]` | Resolve template type, template version, and stepRef binding. |
| `processFlowInstances` | `ProcessFlowInstance[]` | Main table source. Each instance becomes one table row. |
| `GeometryEntity` | `GeometryEntity[]` | Seeded by home for editor pages; not displayed in the home table. |

### Template Type Rule

Current `ProcessFlowTemplate` schema has no standalone `type` field. Home defines process flow
template type as `ProcessFlowTemplate.name`.

If a future schema adds a dedicated template type field, home should switch the filter and table
display to that field while preserving `name` as the human-readable technology name.

## localStorage Bootstrap

Home page is the browser `localStorage` seed bootstrap entry. On mount, the page checks the keys
below; it writes seed data only when the key does not exist. If a key already exists, even with an
empty array `[]`, home must not overwrite it.

| localStorage key | Value shape | Seed | Owner |
|---|---|---|---|
| `processStepTemplates` | `ProcessStepTemplate[]` | Built-in process step templates | Home initializes; admin editor reads/writes. |
| `processFlowTemplates` | `ProcessFlowTemplate[]` | Demo flow templates | Home initializes; flow template editor appends on custom flow save. |
| `processFlowInstances` | `ProcessFlowInstance[]` | Demo flow instances with step value sets | Home initializes; flow template editor and flow instance editor append instances. |
| `GeometryEntity` | `GeometryEntity[]` | 4 sample geometry entities | Home initializes; flow template editor and flow instance editor read. |

### Seed Policy

- Home must not modify existing arrays during normal page load.
- Home must not validate or repair malformed JSON; editor pages still assume existing localStorage values are valid JSON arrays.
- Empty arrays are user intent and must be preserved.
- `cmd: reset-poc-data` is an explicit POC-only destructive action. It clears all `localStorage` entries for the current origin, then restores the default seed arrays.
- Seed data lives in `apps/viewer/lib/home-local-storage.ts`.

## Seed Data

### `processStepTemplates` Seed

`processStepTemplates` currently seeds built-in templates backed by real modules under
`src/process/`:

| id | name | category | program |
|---|---|---|---|
| `step_tpl_molding_1_0_0` | molding | `layer` | `layer/molding` |
| `step_tpl_rdl_1_0_0` | RDL layer | `layer` | `layer/rdl` |
| `step_tpl_grinding_1_0_0` | Grinding | `grinding` | `grinding/grinding` |
| `step_tpl_flip_1_0_0` | Flip | `flip` | `flip/flip` |
| `step_tpl_ubump_formation_1_0_0` | Micro Bump | `bump` | `bump/uBump_formation` |
| `step_tpl_bga_bump_formation_1_0_0` | BGA Bump | `bump` | `bump/bga_bump_formation` |
| `step_tpl_c4_bump_formation_1_0_0` | C4 Bump | `bump` | `bump/c4_bump_formation` |
| `step_tpl_pnp_1_0_0` | PnP | `PnP` | `pnp/pnp` |

### `processFlowTemplates` Seed

| id | Template type | version | Step refs |
|---|---|---|---|
| `flow_tpl_cowosl_demo_1_0_0` | CoWoS-L Demo | `V1.0.0` | `pnp_hbm`, `mold_cap`, `rdl_build`, `c4_bump` |
| `flow_tpl_fanout_demo_1_0_0` | Fan-Out Demo | `V1.0.0` | `pnp_soc`, `micro_bump`, `flip_package`, `bga_array` |

### `processFlowInstances` Seed

| id | Instance name | Template type | Value set count |
|---|---|---|---|
| `flow_inst_cowosl_demo_hbm4_alpha` | HBM4 Alpha Build | CoWoS-L Demo | 4 |
| `flow_inst_cowosl_demo_hbm4_beta` | HBM4 Beta Reliability | CoWoS-L Demo | 4 |
| `flow_inst_fanout_demo_soc_ev1` | SoC EV1 | Fan-Out Demo | 4 |

Each seed `ProcessFlowInstance.stepValueSets[]` item is a process step instance example. Geometry
inputs that come directly from geometry DB use a `GeometryEntity.id`; geometry inputs provided by an
upstream process step output use `null`, matching the flow edge resolve rule used by the editors.

### Geometry Seed

| id | name | category | entityType |
|---|---|---|---|
| `geom_example_wafer` | Wafer | `initial.wafer` | `wafer` |
| `geom_example_panel` | Panel | `initial.panel` | `panel` |
| `geom_example_hbm` | HBM die | `initial.die.hbm` | `die` |
| `geom_example_soc` | SoC die | `initial.die.soc` | `die` |

## Page Layout

Home layout is an operational dashboard:

- Header contains the page title, summary badges, and the three editor navigation actions.
- Primary content is a bordered flow instance table.
- Filter bar sits directly above the table.
- POC reset appears as a small monospace system command pinned to the bottom-left corner.
- No marketing content or editor canvas state appears on this page.

## Tool Navigation

The header tool actions navigate to the editor routes:

- `Flow Template` links to `/flow-template-editor` with `prefetch={false}` because the editor is a heavy client route and should load on explicit user intent.
- `Flow Instance` links to `/flow-instance-editor`.
- `Process Step` links to `/admin/processstepeditor`.

The home page does not contain dev-only route warmup logic. Cold-start route compilation behavior in
`next dev` is treated as a development-server concern rather than product behavior.

## Filter Bar

The filter bar has one select control:

| Control | Options | Behavior |
|---|---|---|
| Template type | `All template types` plus unique `ProcessFlowTemplate.name` values from visible rows | Filters table rows by the row's resolved template type. |

If an instance references a missing flow template, the row remains visible with template type
`Unknown template`. This value is also available in the filter options when such rows exist.

## Process Flow Instance Table

Row granularity:

- One row per `ProcessFlowInstance`.
- Row key is `ProcessFlowInstance.id`.
- The table must include process flow instances from seed data and any instances created by editor pages.

Columns:

| Column | Source |
|---|---|
| Template type | `ProcessFlowTemplate.name`, or `Unknown template` if unresolved. |
| Flow instance | `ProcessFlowInstance.name` and `ProcessFlowInstance.id`. |
| Values | Total meaningful values across all `stepValueSets[].fieldValues[]` over total expected fields resolved from each referenced `ProcessStepTemplate.fieldDefinitions.length`. |
| Status | `Resolved`, `Missing template`, or `Missing step`. |

Meaningful value count rules:

- Non-empty strings count as meaningful.
- Finite numbers and booleans count as meaningful.
- `null` counts as meaningful because it represents a geometry input resolved from an upstream step output.
- Arrays and repeat groups count as meaningful when they contain at least one item.
- Empty strings and `undefined` do not count.

## Empty State

If there are no flow instance rows after localStorage initialization, the table body shows an
empty state with a `Create instance` action linking to `/flow-instance-editor`.
