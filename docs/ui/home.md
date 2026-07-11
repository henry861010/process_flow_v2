# Home / Process Flows

Route：`/`

## Purpose

Home 顯示所有 immutable `ProcessFlowTemplate`，以及已 commit 的 immutable
`ProcessFlowInstance`。尚未建立 instance 的 template 仍會以 `Template only` row
顯示。Draft workspaces 不出現在本版 home；使用者以已知 `workspaceId` URL 繼續
draft。

## Data Source

```http
GET /api/bootstrap
```

```json
{
  "processStepTemplates": [],
  "processFlowTemplates": [],
  "processFlowInstances": [],
  "geometries": []
}
```

UI 以 maps resolve：

```text
instance.processFlowTemplateId -> flow template
flowTemplate.stepRefs[].processStepTemplateId -> step template
```

## Header

- Immutable flow instance count。
- Immutable flow template count，包含尚未建立 instance 的 templates。
- Navigation：Flow Template、Flow Instance、Process Step editors。

## Table

| Column | Source |
| --- | --- |
| Template type | `ProcessFlowTemplate.name` and version |
| Flow instance | `ProcessFlowInstance.name` and id；沒有 instance 時顯示 `No instance` |
| Values | Populated input bindings and top-level parameter values / expected count；template-only row 顯示 `-` |
| Status | Template and step-template references resolve or are missing |

Template filter is built from resolved template names. Missing references remain visible and use
an explicit status instead of being dropped silently。沒有任何 instance reference 的 template
會補成 `Template only` row，因此 Save Template 後可立即在 Home 看見。

## Create Instance

`Flow Instance` navigation opens `/flow-instance-editor`。使用者先選既有 flow template，
再建立 workspace；Home 不提供 clone existing instance action。

## Reset Control

Bottom-left POC command：

```http
POST /api/reset
```

Reset clears all five resource tables, reloads V2 fixtures, and returns a fresh bootstrap payload。
`schema_metadata` remains at database schema version 2。

## Persistence

Default local database：

```text
apps/api/.data/process-flow.sqlite3
```

The database file is ignored by git。On startup：

- empty V2 resource tables are seeded；
- an unversioned or non-V2 local DB is cleared and reseeded；
- an existing V2 DB is left unchanged。

Current fixtures contain V2 step templates、two reusable flow templates、three immutable flow
instances、and the geometry catalog。Fixture details should be read from
`apps/api/src/process_flow_api/fixtures` rather than duplicated in UI code or documentation。
