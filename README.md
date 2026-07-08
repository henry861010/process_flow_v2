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
| `packages/cad-py` | Python CadQuery/OCP CAD export package for GLB and STEP AP242. |
| `packages/kernel-py` | Python geometry kernel, flow validation, geometry hydration, repositories, and preview execution. |
| `packages/mesher-py` | Python 2.5D mesh generation and text CDB export worker package. |
| `packages/process-step-py` | Python process step implementations resolved by `ProcessStepTemplate.program`. |
| `docs` | Product, data-model, UI, and runtime notes. |

## Local Startup

From a fresh environment, clone the repository and enter the workspace:

```bash
git clone <repo-url>
cd process_flow_v2
```

Create a Python virtual environment and install the backend plus all local
Python packages:

```bash
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install -e packages/kernel-py -e packages/process-step-py -e packages/cad-py -e packages/mesher-py -e 'apps/api[test]'
```

Start the API:

```bash
PROCESS_FLOW_API_CORS_ORIGINS=http://localhost:3001 \
venv/bin/uvicorn process_flow_api.main:app --host 0.0.0.0 --port 8000
```

The API initializes the local SQLite database with demo fixtures on startup
when all resource tables are empty.

Install frontend dependencies and start the viewer in development mode:

```bash
cd apps/viewer
npm install
NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL=http://localhost:8000 npm run dev -- -p 3001
```

Open the viewer at `http://localhost:3001`.

Open FastAPI's generated API docs at `http://127.0.0.1:8000/docs`.

For a production viewer build:

```bash
cd apps/viewer
NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL=http://<api-host>:8000 npm run build
npm run start
```

The production viewer is a static export. `npm run build` writes deployable
HTML, CSS, and JavaScript assets to `apps/viewer/out`, and `npm run start`
serves that directory locally on `http://localhost:3001`. In deployed
environments, serve `apps/viewer/out` from any static file host and include the
frontend origin in `PROCESS_FLOW_API_CORS_ORIGINS`.

`NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL` is baked into the static JavaScript at
build time. Rebuild the viewer when the API host changes.

Important environment variables:

| Variable | Example | Purpose |
| --- | --- | --- |
| `PROCESS_FLOW_API_DB_PATH` | `apps/api/.data/process-flow.sqlite3` | SQLite database path. |
| `PROCESS_FLOW_API_CORS_ORIGINS` | `http://localhost:3001,http://<frontend-host>:3001` | Browser origins allowed by FastAPI CORS. |
| `NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL` | `http://<api-host>:8000` | Viewer-side API base URL baked into the static export at build time. |
| `GEOMETRY_PREVIEW_EXPORT_TIMEOUT_SECONDS` | `30` | Timeout for each GLB or STEP CAD worker export. |
| `CDB_EXPORT_MAX_CONCURRENT_JOBS` | `1` | Maximum number of in-memory CDB export jobs running at once. |

`apps/api` depends on the repository-local packages
`packages/kernel-py`, `packages/process-step-py`, `packages/cad-py`, and
`packages/mesher-py`; install
them together in every new environment.

## Data And Seed

The default SQLite database path is:

```text
apps/api/.data/process-flow.sqlite3
```

The database is ignored by git. Demo data is stored as JSON fixtures under:

```text
apps/api/src/process_flow_api/fixtures
```

On startup, the API creates the database file if needed and loads demo fixtures
when all resource tables are empty. `POST /api/reset` clears the SQLite tables
and reloads the fixtures for POC reset workflows.

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
