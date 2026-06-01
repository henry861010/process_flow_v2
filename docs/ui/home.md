# Home UI Design

## Route

`/`

## Purpose

Home page 是 process flow tools 的入口頁。此頁不承擔 editor workflow，也不顯示 template list；只提供進入下列頁面的 buttons：

- Flow Template Editor：`/flow-template-editor`
- CAD Viewer：`/cad-viewer`
- Flow Instance Editor：`/flow-instance-editor`

## localStorage Bootstrap

Home page 是 browser `localStorage` seed 的唯一 UI 入口。進入 home 時，頁面會檢查下列 keys；只有 key 不存在時才寫入 seed。若 key 已存在，即使值是空陣列 `[]`，home 也不可覆寫，避免使用者刪除資料後被重新 seed。

| localStorage key | Value shape | Seed | Owner |
|---|---|---|---|
| `processStepTemplates` | `ProcessStepTemplate[]` | 3 sample process step templates | Home initializes; admin editor reads/writes. |
| `processFlowTemplates` | `ProcessFlowTemplate[]` | `[]` | Home initializes; flow template editor appends on custom flow save. |
| `processFlowInstances` | `ProcessFlowInstance[]` | `[]` | Home initializes; flow template editor and flow instance editor append instances. |
| `GeometryEntity` | `GeometryEntity[]` | 6 sample geometry entities | Home initializes; flow template editor and flow instance editor read. |

### Seed Policy

- Home must not modify existing arrays.
- Home must not validate or repair malformed JSON; editor pages still assume existing localStorage values are valid JSON arrays.
- Empty arrays are user intent and must be preserved.
- Seed data lives in `apps/viewer/lib/home-local-storage.ts`.

### `processStepTemplates` Seed

| id | name | category | field ids |
|---|---|---|---|
| `step_tpl_bonding_micro_bump` | Micro bump bonding | `bonding.micro_bump` | `main_geometry`, `incoming_pad_finish`, `bonding_profile`, `bump_pitch` |
| `step_tpl_molding_encapsulation` | Molding encapsulation | `encapsulation.molding` | `main_geometry`, `mold_compound`, `mold_thickness`, `cure_required` |
| `step_tpl_rdl_build_up` | RDL build up | `interconnect.rdl` | `main_geometry`, `rdl_layers` |

### Geometry Seed

| id | name | category | entityType |
|---|---|---|---|
| `geom_wafer_aaatv_rev_a` | SKH HBM4 incoming wafer | `carrier.wafer.glass` | `wafer` |
| `geom_die_hbm4_logic_rev_b` | HBM4 logic die | `die.silicon.logic` | `die` |
| `geom_die_hbm4_memory_rev_c` | HBM4 memory die | `die.silicon.memory` | `die` |
| `geom_substrate_abf_55x55_rev_a` | 55x55 ABF substrate | `substrate.organic.abf` | `substrate` |
| `geom_interposer_silicon_bridge_rev_a` | Silicon bridge interposer | `interposer.silicon.bridge` | `interposer` |
| `geom_panel_temp_carrier_rev_a` | Temporary process panel | `carrier.panel.temporary` | `panel` |

## Page Behavior

Home layout is intentionally minimal:

- Centered navigation region.
- Three buttons only.
- No editor state, no template browsing, no marketing content.
- The page can be visited repeatedly without changing existing localStorage values.
