# Process Flow API

`apps/api` is the FastAPI backend for process-flow templates, instances, geometry library records, saved execution, and preview export.

The service owns the SQLite database and seed fixtures. The viewer reads and writes through HTTP API calls.

## Runtime

Start from the repository root:

```bash
venv/bin/uvicorn process_flow_api.main:app --host 127.0.0.1 --port 8000
```

Important environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROCESS_FLOW_API_DB_PATH` | `apps/api/.data/process-flow.sqlite3` | SQLite file path. |
| `PROCESS_FLOW_API_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001` | Comma-separated browser origins allowed by CORS. |
| `GEOMETRY_PREVIEW_EXPORT_TIMEOUT_SECONDS` | `30` | Timeout for each GLB or STEP Python CAD worker export. |
| `EXPORT_MAX_CONCURRENT_JOBS` | `1` | Maximum number of in-memory export jobs running at once. Falls back to `CDB_EXPORT_MAX_CONCURRENT_JOBS` when unset. |
| `NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL` | `http://localhost:8000` | Viewer-side API base URL. |

The OpenAPI UI is available at `/docs` when the service is running.

## Storage

The SQLite database contains four resource tables:

| Table | Resource |
| --- | --- |
| `process_step_templates` | Immutable `ProcessStepTemplate` snapshots. |
| `process_flow_templates` | Immutable `ProcessFlowTemplate` topology snapshots. |
| `process_flow_instances` | `ProcessFlowInstance` values bound to a flow template. |
| `geometries` | Immutable `GeometryEntity` records. |

Each table stores the canonical JSON payload in `payload` and also keeps metadata columns for search/filter/indexing. There are no update endpoints in the service contract; changed templates and geometries are represented by new ids.

## Resource Shapes

The API accepts and returns camelCase JSON.

### ProcessStepTemplate

```json
{
  "id": "step_tpl_molding_1_0_0",
  "version": "V1.0.0",
  "name": "molding",
  "category": "layer",
  "program": "layer/molding",
  "description": "",
  "owner": "process-flow",
  "fieldDefinitions": [
    {
      "id": "main_geometry",
      "name": "main_geometry",
      "scope": "inputState",
      "valueType": "geometryRef",
      "controlType": null,
      "selectionMode": null,
      "unit": null
    }
  ]
}
```

`program` is an extensionless Python process-step module path resolved under `process_flow_steps`, for example `layer/molding`.

### ProcessFlowTemplate

```json
{
  "id": "flow_tpl_cowosl_demo_1_0_0",
  "name": "CoWoS-L Demo",
  "version": "V1.0.0",
  "description": "",
  "owner": "process-flow",
  "stepRefs": [
    {
      "stepRefId": "pnp_hbm",
      "stepLabel": "PnP",
      "processStepTemplateId": "step_tpl_pnp_1_0_0"
    }
  ],
  "flowEdges": [
    {
      "edgeId": "edge_initial_panel_to_pnp",
      "source": { "sourceType": "geometryRef" },
      "target": {
        "stepRefId": "pnp_hbm",
        "targetFieldId": "main_geometry"
      }
    }
  ]
}
```

`flowEdges[]` is the topology source of truth. `stepRefs[]` order is not runtime order.
`stepRefId` is the flow-local stable reference used by edges and instances;
`stepLabel` is the user-facing name shown for that step in this flow template.

### ProcessFlowInstance

```json
{
  "id": "flow_inst_cowosl_demo_hbm4_alpha",
  "name": "HBM4 Alpha Build",
  "processFlowTemplateId": "flow_tpl_cowosl_demo_1_0_0",
  "stepValueSets": [
    {
      "stepRefId": "pnp_hbm",
      "processStepTemplateId": "step_tpl_pnp_1_0_0",
      "fieldValues": [
        {
          "fieldId": "main_geometry",
          "value": "geom_example_panel"
        }
      ]
    }
  ]
}
```

Geometry fields supplied by a `geometryRef` edge store a `GeometryEntity.id`. Geometry fields supplied by an upstream `stepOutput` edge store `null`.

### GeometryEntity

```json
{
  "id": "geom_example_panel",
  "category": "initial.panel",
  "entityType": "panel",
  "name": "Panel",
  "version": "V1.0.0",
  "owner": "process-flow",
  "description": "Centered square panel geometry.",
  "structureFormat": "standard",
  "structure": {}
}
```

Selection UI should treat `structure` as opaque. Kernel, viewer, and exporter code are responsible for reading the geometry document.

## Endpoints

### System

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Returns `{ "status": "ok" }`. |
| `GET` | `/api/bootstrap` | Returns all step templates, flow templates, flow instances, and geometries. |
| `POST` | `/api/reset` | Clears resource tables, reloads fixture data, and returns the bootstrap payload. |

The API initializes the SQLite database with fixture data on startup when all
resource tables are empty. Frontend bootstrap reads data through
`GET /api/bootstrap` and does not trigger database writes.

Bootstrap response:

```json
{
  "processStepTemplates": [],
  "processFlowTemplates": [],
  "processFlowInstances": [],
  "geometries": []
}
```

### Process Step Templates

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/process-step-templates?search=&category=` | Lists step templates. |
| `GET` | `/api/process-step-templates/{id}` | Reads one step template. |
| `POST` | `/api/process-step-templates` | Creates a new immutable step template. |
| `DELETE` | `/api/process-step-templates/{id}` | Deletes the template without cascading to existing flows. |

`POST` body is a `ProcessStepTemplate`. Response is the created `ProcessStepTemplate`.

### Geometries

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/geometries?search=&category=&entityType=` | Lists geometry records. |
| `GET` | `/api/geometries/{id}` | Reads one geometry record. |
| `POST` | `/api/geometries` | Creates a new immutable geometry record. |

`POST` body is a `GeometryEntity`. When `id` is `null` or empty, the server assigns a new id. Response is the created `GeometryEntity`.

### Process Flow Templates And Instances

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/process-flow-templates` | Lists flow templates. |
| `GET` | `/api/process-flow-templates/{id}` | Reads one flow template. |
| `POST` | `/api/process-flow-template-instances` | Transactionally creates a new flow template and its initial instance. |
| `GET` | `/api/process-flow-instances` | Lists flow instances. |
| `GET` | `/api/process-flow-instances/{id}` | Reads one flow instance. |
| `POST` | `/api/process-flow-instances` | Creates a new instance from an existing template. |

`POST /api/process-flow-template-instances` body:

```json
{
  "processFlowTemplate": {},
  "processFlowInstance": {}
}
```

Response:

```json
{
  "processFlowTemplate": {},
  "processFlowInstance": {}
}
```

`POST /api/process-flow-instances` body is a `ProcessFlowInstance`. Response is the created `ProcessFlowInstance`.

### Execution And Preview

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/process-flow-instances/{id}/execute` | Runs a saved instance through the Python kernel. |
| `POST` | `/api/geometry-preview` | Runs a draft preview and exports GLB. |
| `POST` | `/api/geometry-preview/step` | Exports a preview snapshot as STEP AP242. |
| `POST` | `/api/geometry-preview/export-jobs` | Starts a server-side JSON, STEP, or CDB export job from a preview snapshot. |
| `POST` | `/api/geometry-preview/cdb-jobs` | Starts a server-side text CDB export job from a preview snapshot. |
| `GET` | `/api/export-jobs?clientId=` | Lists recent export jobs for one client id. |
| `GET` | `/api/export-jobs/{jobId}?clientId=` | Reads one export job for one client id. |
| `POST` | `/api/export-jobs/{jobId}/cancel` | Requests cancellation for one export job. |

Execute response:

```json
{
  "geometryStructure": {},
  "stepOutputs": {},
  "terminalStepRefIds": []
}
```

Preview request:

```json
{
  "target": {
    "type": "edge",
    "previewEdgeId": "edge_initial_panel_to_pnp"
  },
  "sourceLabel": "Panel -> PnP",
  "flowTemplate": {},
  "draftInstance": {},
  "geometries": [],
  "processStepTemplates": []
}
```

For terminal step output preview:

```json
{
  "target": {
    "type": "stepOutput",
    "stepRefId": "pnp_hbm"
  },
  "flowTemplate": {},
  "draftInstance": {}
}
```

`geometries` and `processStepTemplates` are optional snapshots. When omitted, the API resolves them from SQLite.

Preview response:

```json
{
  "geometryEntityJson": {
    "id": null,
    "category": "preview.generated",
    "entityType": "preview",
    "name": "Preview - Panel -> PnP output",
    "structureFormat": "standard",
    "structure": {}
  },
  "glbBase64": "..."
}
```

STEP request:

```json
{
  "geometryStructure": {}
}
```

STEP response:

```json
{
  "stepBase64": "..."
}
```

Export job request:

```json
{
  "clientId": "browser-generated-client-token",
  "kind": "step",
  "geometryStructure": {},
  "geometryEntityJson": {},
  "elementSize": 500,
  "outputPath": "/absolute/path/model.step",
  "sourceLabel": "Panel -> main_geometry"
}
```

`kind` must be `json`, `step`, or `cdb`. JSON jobs write `geometryEntityJson`
as pretty JSON and require a `.json` suffix. STEP jobs write STEP AP242 from
`geometryStructure` and require a `.step` suffix. CDB jobs write text CDB from
`geometryStructure`, require `elementSize`, and require a `.cdb` suffix. Uppercase
suffixes such as `.JSON`, `.STEP`, and `.CDB` are accepted and normalized to
lowercase. The `outputPath` must be absolute and the parent folder must already
exist. Export job state is stored in memory for the current API process only,
and list responses are filtered by `clientId`.

`POST /api/geometry-preview/cdb-jobs` is retained as a compatibility alias for
creating `kind: "cdb"` jobs.

Export job response:

```json
{
  "job": {
    "jobId": "step_...",
    "clientId": "browser-generated-client-token",
    "kind": "step",
    "status": "queued",
    "outputPath": "/absolute/path/model.step"
  }
}
```

## Frontend Contract Guidance

The API returns complete resource payloads in v1, but UI code should not depend on arbitrary deep JSON paths for general selection workflows.

Use metadata fields for lists and selectors:

- `id`
- `name`
- `category`
- `version`
- `owner`
- `entityType`

Use dedicated endpoints for actions:

- Detail screens can call `GET /api/.../{id}`.
- Saving a custom template flow uses `POST /api/process-flow-template-instances`.
- Saving a from-template instance uses `POST /api/process-flow-instances`.
- Runtime geometry uses `POST /api/process-flow-instances/{id}/execute`.
- Draft preview uses `POST /api/geometry-preview`.
- Preview JSON, STEP, and CDB exports use `POST /api/geometry-preview/export-jobs`.

`GeometryEntity.structure`, step-specific field payloads, and CAD feature bodies are kernel/viewer/exporter concerns. General UI should pass those documents through rather than interpreting their internal shape.
