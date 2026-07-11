# Process Flow API

FastAPI backend for V2 process templates, flow topology, workspaces, immutable
instances, geometry catalog records, execution, preview, and export.

The API owns SQLite persistence. `FlowCompiler` resolves repository resources
into an `ExecutionPlan`; `GeometryKernel` never reads the database.

## Runtime

From the repository root:

```bash
venv/bin/uvicorn process_flow_api.main:app --host 127.0.0.1 --port 8000
```

OpenAPI: `http://127.0.0.1:8000/docs`

| Environment variable | Default |
| --- | --- |
| `PROCESS_FLOW_API_DB_PATH` | `apps/api/.data/process-flow.sqlite3` |
| `PROCESS_FLOW_API_CORS_ORIGINS` | localhost / 127.0.0.1 ports 3000 and 3001 |
| `GEOMETRY_PREVIEW_EXPORT_TIMEOUT_SECONDS` | `30` |
| `EXPORT_MAX_CONCURRENT_JOBS` | `1` |
| `NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL` | `http://localhost:8000` |

## Storage

| Table | Resource |
| --- | --- |
| `process_step_templates` | Immutable `ProcessStepTemplate` snapshots |
| `process_flow_templates` | Immutable `ProcessFlowTemplate` topology snapshots |
| `process_flow_instances` | Complete immutable product configurations |
| `process_flow_workspaces` | Mutable, revisioned instance drafts |
| `geometries` | Immutable `GeometryEntity` records |
| `schema_metadata` | Database schema marker |

Canonical camelCase JSON is stored in each resource table's `payload` column.
Metadata columns support indexes and list queries.

`databaseSchemaVersion` is `2`. This unreleased product intentionally has no V1
migration: an unversioned or non-V2 local database is cleared and reseeded from
V2 fixtures at startup.

## V2 Shapes

### ProcessStepTemplate

```json
{
  "schemaVersion": 2,
  "id": "step_tpl_molding_2_0_0",
  "version": "V2.0.0",
  "name": "molding",
  "category": "layer",
  "program": "layer/molding",
  "description": "",
  "owner": "integration.platform",
  "inputPorts": [
    {
      "portId": "main_geometry",
      "name": "Main geometry",
      "dataType": "geometry",
      "role": "primary",
      "required": true
    }
  ],
  "outputPorts": [
    {
      "portId": "result_geometry",
      "name": "Result geometry",
      "dataType": "geometry"
    }
  ],
  "parameterDefinitions": []
}
```

`program` is an extensionless module path under `process_flow_steps`.

### ProcessFlowTemplate

```json
{
  "schemaVersion": 2,
  "id": "flow_tpl_cowosl_2_0_0",
  "name": "CoWoS-L",
  "version": "V2.0.0",
  "description": "",
  "owner": "integration.platform",
  "flowInputs": [
    {
      "flowInputId": "incoming_panel",
      "name": "Incoming panel",
      "dataType": "geometry",
      "required": true
    }
  ],
  "stepRefs": [
    {
      "stepRefId": "molding",
      "stepLabel": "molding",
      "processStepTemplateId": "step_tpl_molding_2_0_0"
    }
  ],
  "flowEdges": [
    {
      "edgeId": "edge_panel_molding",
      "source": { "kind": "flowInput", "flowInputId": "incoming_panel" },
      "target": { "stepRefId": "molding", "inputPortId": "main_geometry" }
    }
  ]
}
```

Topology order is derived from step-output edges, not `stepRefs[]` array order.

### ProcessFlowWorkspace

```json
{
  "schemaVersion": 2,
  "id": "workspace_123",
  "name": "Customer study",
  "processFlowTemplateId": "flow_tpl_cowosl_2_0_0",
  "revision": 1,
  "status": "draft",
  "inputBindings": {
    "incoming_panel": { "kind": "catalog", "geometryId": "panel_v1_0_0" }
  },
  "stepConfigurations": {
    "molding": { "parameterValues": {} }
  },
  "embeddedGeometries": {},
  "createdAt": "2026-07-10T00:00:00Z",
  "updatedAt": "2026-07-10T00:00:00Z"
}
```

Drafts may be incomplete. Updates require the current revision and return 409
when stale. Committed workspaces are read-only.

### ProcessFlowInstance

```json
{
  "schemaVersion": 2,
  "id": "flow_inst_customer_a",
  "name": "Customer A",
  "processFlowTemplateId": "flow_tpl_cowosl_2_0_0",
  "inputBindings": {
    "incoming_panel": { "kind": "catalog", "geometryId": "panel_v1_0_0" }
  },
  "stepConfigurations": {
    "molding": { "parameterValues": {} }
  }
}
```

Instances are complete, immutable, and catalog-only.

## Endpoints

### System

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/bootstrap` | Templates, immutable instances, and geometry catalog |
| `POST` | `/api/reset` | Reset all resources to V2 fixtures |

### Process Step Templates

| Method | Path |
| --- | --- |
| `GET` | `/api/process-step-templates?search=&category=` |
| `GET` | `/api/process-step-templates/{id}` |
| `POST` | `/api/process-step-templates` |
| `DELETE` | `/api/process-step-templates/{id}` |

### Geometries

| Method | Path |
| --- | --- |
| `GET` | `/api/geometries?search=&category=&entityType=` |
| `GET` | `/api/geometries/{id}` |
| `POST` | `/api/geometries` |

When geometry `id` is null or empty, the API generates one.

### Flow Templates and Instances

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/process-flow-templates` | List templates |
| `GET` | `/api/process-flow-templates/{id}` | Read template |
| `POST` | `/api/process-flow-templates` | Create immutable template |
| `POST` | `/api/process-flow-template-instances` | Atomically create template and first instance |
| `GET` | `/api/process-flow-instances` | List immutable instances |
| `GET` | `/api/process-flow-instances/{id}` | Read immutable instance |
| `POST` | `/api/process-flow-instances` | Create instance from existing template |
| `POST` | `/api/process-flow-instances/{id}/execute` | Compile and execute saved instance |

### Workspaces

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/process-flow-workspaces` | Backend list support; no list UI yet |
| `POST` | `/api/process-flow-workspaces` | Create incomplete draft |
| `GET` | `/api/process-flow-workspaces/{id}` | Reload draft by URL |
| `PUT` | `/api/process-flow-workspaces/{id}` | Revision-checked update |
| `POST` | `/api/process-flow-workspaces/{id}/commit` | Atomic, idempotent commit |

Commit request:

```json
{
  "instanceId": "flow_inst_customer_a",
  "instanceName": "Customer A",
  "revision": 3
}
```

Commit materializes referenced embedded geometries, rewrites bindings to
catalog, inserts an immutable instance, and marks the workspace committed in one
transaction.

## Preview

```http
POST /api/geometry-preview
```

```json
{
  "target": {
    "type": "stepOutput",
    "stepRefId": "molding",
    "outputPortId": "result_geometry"
  },
  "sourceLabel": "molding",
  "processFlowTemplateId": "flow_tpl_cowosl_2_0_0",
  "configuration": {
    "inputBindings": {},
    "stepConfigurations": {},
    "embeddedGeometries": {}
  }
}
```

Use exactly one of `processFlowTemplateId` or inline `flowTemplate`. A flow-input
target uses `{ "type": "flowInput", "flowInputId": "..." }`.

Response:

```json
{
  "geometryEntityJson": {
    "id": null,
    "category": "preview.generated",
    "entityType": "preview",
    "name": "Preview - molding",
    "structureFormat": "standard",
    "structure": {}
  },
  "glbBase64": "..."
}
```

### Preview and Export Endpoints

| Method | Path |
| --- | --- |
| `POST` | `/api/geometry-preview/step` |
| `POST` | `/api/geometry-preview/export-jobs` |
| `POST` | `/api/geometry-preview/cdb-jobs` |
| `GET` | `/api/export-jobs?clientId=` |
| `GET` | `/api/export-jobs/{jobId}?clientId=` |
| `POST` | `/api/export-jobs/{jobId}/cancel` |

Export job `kind` is `json`, `step`, or `cdb`. Output paths must be absolute and
their parent directory must exist. JSON writes a geometry entity document, STEP
writes AP242, and CDB requires `elementSize`. Job state is process-local and list
responses are scoped by `clientId`.

## Validation Boundary

- Pydantic models reject unknown fields (`extra="forbid"`).
- Graph validation resolves every referenced step template and port.
- Draft workspace validation accepts missing required values but validates any
  supplied shape.
- Instance creation, execution, preview, and commit require a complete compile.
- Repository exceptions map to 404, 409, or 400 responses.

The full data contract is documented in `docs/data-model.md`.
