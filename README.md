# Process Flow

Process Flow is a local process-flow proof of concept for building and previewing semiconductor package geometry flows.

The project models two immutable resource families:

- Process templates: `ProcessStepTemplate` and `ProcessFlowTemplate` define reusable step programs and flow topology.
- Process instances: `ProcessFlowInstance` binds a template to concrete TV/Product geometry selections and field values.

The current service path is FastAPI + SQLite + Python kernel. CAD export is provided by a Python CadQuery/OCP exporter and is called from FastAPI through an isolated Python worker.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `apps/api` | FastAPI service, SQLite repository, API models, seed fixtures, preview/export bridge. |
| `apps/viewer` | Next.js viewer and flow editor UI. |
| `packages/kernel-py` | Python geometry kernel, flow validation, geometry hydration, repositories, and preview execution. |
| `packages/process-step-py` | Python process step implementations resolved by `ProcessStepTemplate.program`. |
| `docs` | Product, data-model, UI, and runtime notes. |

## Local Startup

Install Python packages into the project virtualenv:

```bash
venv/bin/pip install -e packages/kernel-py -e packages/process-step-py -e 'apps/api[test]'
```

Start the API:

```bash
venv/bin/uvicorn process_flow_api.main:app --host 127.0.0.1 --port 8000
```

Start the viewer:

```bash
cd apps/viewer
NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL=http://localhost:8000 npm run dev -- -p 3001
```

Open the viewer at `http://localhost:3001`.

Open FastAPI's generated API docs at `http://127.0.0.1:8000/docs`.

## Data And Seed

The default SQLite database path is:

```text
apps/api/.data/process-flow.sqlite3
```

The database is ignored by git. Demo data is stored as JSON fixtures under:

```text
apps/api/src/process_flow_api/fixtures
```

`POST /api/admin/seed` with `{ "mode": "ifEmpty" }` creates the demo dataset only when the database is empty. `{ "mode": "reset" }` clears the SQLite tables and reloads the fixtures.

All process step templates, flow templates, flow instances, and geometries are stored in the same SQLite database. Each resource family has its own table and keeps the canonical JSON payload in a JSON text column plus indexed metadata columns.

## API Contract

The API contract is documented in `apps/api/README.md`.

Frontend code should use the API client in `apps/viewer/lib/process-flow-api.ts`. General UI screens may use list/bootstrap payloads to show selectable resources, then use detail, create, execute, and preview endpoints for actions that need a specific resource state.

The `GeometryEntity.structure` payload is intentionally treated as an opaque geometry document outside kernel, viewer, and exporter code. Selection UI should rely on resource metadata such as `id`, `name`, `category`, `entityType`, and `version` instead of parsing deeply into geometry internals.

## Verification

Run the main checks from the repository root:

```bash
venv/bin/python -m unittest packages/kernel-py/tests/test_kernel.py
venv/bin/python -m unittest discover apps/api/tests
cd apps/viewer && npm run build
```
