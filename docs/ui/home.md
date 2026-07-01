# Home UI Design

## Route

`/`

## Purpose

Home page is the operational entry point for the process-flow tools. It shows saved process flow instances and lets users navigate to:

- Flow Template Editor: `/flow-template-editor`
- Flow Instance Editor: `/flow-instance-editor`
- Process Step Template Editor: `/admin/processstepeditor`
- POC reset command: `cmd: reset-poc-data`

The first screen is a compact dashboard, not a landing page.

## Data Source

Home reads from the FastAPI backend through `apps/viewer/lib/process-flow-api.ts`.

On page load, Home calls:

```http
GET /api/bootstrap
```

The response is the bootstrap payload:

```json
{
  "processStepTemplates": [],
  "processFlowTemplates": [],
  "processFlowInstances": [],
  "geometries": []
}
```

Home uses the payload as follows:

| Field | Shape | Home usage |
| --- | --- | --- |
| `processStepTemplates` | `ProcessStepTemplate[]` | Resolve expected field count and missing-step status. |
| `processFlowTemplates` | `ProcessFlowTemplate[]` | Resolve template type, template version, and stepRef binding. |
| `processFlowInstances` | `ProcessFlowInstance[]` | Main table source. Each instance becomes one table row. |
| `geometries` | `GeometryEntity[]` | Loaded for editor bootstrap consistency; not shown in the Home table. |

## Seed And Reset

The backend owns seed data. Fixtures live under:

```text
apps/api/src/process_flow_api/fixtures
```

The SQLite database lives at:

```text
apps/api/.data/process-flow.sqlite3
```

The database file is local runtime state and is ignored by git.

Seed behavior:

- API startup writes fixtures only when all resource tables are empty.
- `POST /api/reset` clears the four resource tables and reloads fixtures.
- Reset returns the fresh bootstrap payload and Home refreshes its table from that response.

## Seed Data

### Process Step Templates

Seeded step templates are backed by Python modules under `packages/process-step-py/src/process_flow_steps`.

| id | name | category | program |
| --- | --- | --- | --- |
| `step_tpl_molding_1_0_0` | molding | `layer` | `layer/molding` |
| `step_tpl_rdl_1_0_0` | RDL layer | `layer` | `layer/rdl` |
| `step_tpl_grinding_1_0_0` | Grinding | `grinding` | `grinding/grinding` |
| `step_tpl_flip_1_0_0` | Flip | `carrier` | `flip/flip` |
| `step_tpl_ubump_formation_1_0_0` | Micro Bump | `bump` | `bump/uBump_formation` |
| `step_tpl_bga_bump_formation_1_0_0` | BGA Bump | `bump` | `bump/bga_bump_formation` |
| `step_tpl_c4_bump_formation_1_0_0` | C4 Bump | `bump` | `bump/c4_bump_formation` |
| `step_tpl_pnp_1_0_0` | PnP | `PnP` | `pnp/pnp` |

### Process Flow Templates

| id | Template type | version | Step refs |
| --- | --- | --- | --- |
| `flow_tpl_cowosl_demo_1_0_0` | CoWoS-L Demo | `V1.0.0` | `pnp_hbm`, `mold_cap`, `rdl_build`, `c4_bump` |
| `flow_tpl_fanout_demo_1_0_0` | Fan-Out Demo | `V1.0.0` | `pnp_soc`, `micro_bump`, `flip_package`, `bga_array` |

### Process Flow Instances

| id | Instance name | Template type | Value set count |
| --- | --- | --- | --- |
| `flow_inst_cowosl_demo_hbm4_alpha` | HBM4 Alpha Build | CoWoS-L Demo | 4 |
| `flow_inst_cowosl_demo_hbm4_beta` | HBM4 Beta Reliability | CoWoS-L Demo | 4 |
| `flow_inst_fanout_demo_soc_ev1` | SoC EV1 | Fan-Out Demo | 4 |

Geometry inputs that come directly from a geometry library record store a `GeometryEntity.id`. Geometry inputs provided by an upstream step output store `null`.

### Geometry Records

| id | name | category | entityType |
| --- | --- | --- | --- |
| `geom_example_wafer` | Wafer | `initial.wafer` | `wafer` |
| `geom_example_panel` | Panel | `initial.panel` | `panel` |
| `geom_example_hbm` | HBM die | `initial.die.hbm` | `die` |
| `geom_example_soc` | SoC die | `initial.die.soc` | `die` |
| `geom_example_carrier` | carrier | `initial.test.carrier` | `carrier` |

## Page Layout

Home layout is an operational dashboard:

- Header contains the page title, summary badges, and editor navigation actions.
- Primary content is a bordered flow instance table.
- Filter bar sits directly above the table.
- POC reset appears as a small monospace system command pinned to the bottom-left corner.

## Tool Navigation

The header tool actions navigate to editor routes:

- `Flow Template` links to `/flow-template-editor` with `prefetch={false}`.
- `Flow Instance` links to `/flow-instance-editor`.
- `Process Step` links to `/admin/processstepeditor`.

The home page does not contain development-only route warmup logic. Cold-start route compilation in `next dev` is a development-server concern.

## Filter Bar

The filter bar has one select control:

| Control | Options | Behavior |
| --- | --- | --- |
| Template type | `All template types` plus unique `ProcessFlowTemplate.name` values from visible rows | Filters rows by resolved template type. |

If an instance references a missing flow template, the row remains visible with template type `Unknown template`.

## Process Flow Instance Table

Row granularity:

- One row per `ProcessFlowInstance`.
- Row key is `ProcessFlowInstance.id`.
- The table includes seeded instances and instances created by editor pages.

Columns:

| Column | Source |
| --- | --- |
| Template type | `ProcessFlowTemplate.name`, or `Unknown template` if unresolved. |
| Flow instance | `ProcessFlowInstance.name` and `ProcessFlowInstance.id`. |
| Values | Meaningful values over expected field count resolved from each referenced `ProcessStepTemplate.fieldDefinitions.length`. |
| Status | `Resolved`, `Missing template`, or `Missing step`. |

Meaningful value count rules:

- Non-empty strings count as meaningful.
- Finite numbers and booleans count as meaningful.
- `null` counts as meaningful when it represents an upstream step output.
- Arrays and repeat groups count as meaningful when they contain at least one item.
- Empty strings and `undefined` do not count.

## Empty State

If there are no flow instance rows after bootstrap, the table body shows an empty state with a `Create instance` action linking to `/flow-instance-editor`.
