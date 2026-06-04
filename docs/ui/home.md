# Home UI Design

## Route

`/`

## Purpose

Home page 是 process flow tools 的入口頁。此頁不承擔 editor workflow，也不顯示 template list；只提供進入下列頁面的 buttons：

- Flow Template Editor：`/flow-template-editor`
- Flow Instance Editor：`/flow-instance-editor`
- Process Step Editor：`/admin/processstepeditor`
- `cmd: reset-poc-data`：POC-only system command，清除整個 origin 的 browser `localStorage`，再寫回 default JSON seed。

## localStorage Bootstrap

Home page 是 browser `localStorage` seed 的唯一 UI 入口。進入 home 時，頁面會檢查下列 keys；只有 key 不存在時才寫入 seed。若 key 已存在，即使值是空陣列 `[]`，home 也不可覆寫，避免使用者刪除資料後被重新 seed。

| localStorage key | Value shape | Seed | Owner |
|---|---|---|---|
| `processStepTemplates` | `ProcessStepTemplate[]` | 4 sample process step templates | Home initializes; admin editor reads/writes. |
| `processFlowTemplates` | `ProcessFlowTemplate[]` | `[]` | Home initializes; flow template editor appends on custom flow save. |
| `processFlowInstances` | `ProcessFlowInstance[]` | `[]` | Home initializes; flow template editor and flow instance editor append instances. |
| `GeometryEntity` | `GeometryEntity[]` | 4 sample geometry entities | Home initializes; flow template editor and flow instance editor read. |

### Seed Policy

- Home must not modify existing arrays.
- Home must not validate or repair malformed JSON; editor pages still assume existing localStorage values are valid JSON arrays.
- Empty arrays are user intent and must be preserved.
- `cmd: reset-poc-data` is an explicit POC-only destructive action. It clears all `localStorage` entries for the current origin, then restores the default seed arrays.
- Seed data lives in `apps/viewer/lib/home-local-storage.ts`.

### `processStepTemplates` Seed

| id | name | category | program | field ids |
|---|---|---|---|---|
| `molding1` | Molding 1 | `example` | `example/molding1` | `main_geometry`, `density`, `material` |
| `molding2` | Molding 2 | `example` | `example/molding2` | `main_geometry`, `density`, `material` |
| `bump` | Bump | `example` | `example/bump` | `main_geometry`, `density`, `thk`, `material` |
| `pnp` | PnP | `example` | `example/pnp` | `main_geometry`, `die_geometry`, `coordinates` |

### Geometry Seed

| id | name | category | entityType |
|---|---|---|---|
| `geom_example_wafer` | Wafer | `initial.wafer` | `wafer` |
| `geom_example_panel` | Panel | `initial.panel` | `panel` |
| `geom_example_hbm` | HBM die | `initial.die.hbm` | `die` |
| `geom_example_soc` | SoC die | `initial.die.soc` | `die` |

## Page Behavior

Home layout is intentionally minimal:

- Centered navigation region.
- Three navigation buttons only in the primary action region.
- POC reset appears as a small monospace system command pinned to the bottom-left corner.
- No editor state, no template browsing, no marketing content.
- The page can be visited repeatedly without changing existing localStorage values.
- Clicking `cmd: reset-poc-data` intentionally changes localStorage by replacing it with the default JSON seed.
