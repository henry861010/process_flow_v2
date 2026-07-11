---
title: Process Flow API
status: descriptive
owner: integration.platform
audience:
  - API consumers
  - backend engineers
  - operators
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - apps/api/src/process_flow_api/main.py
  - apps/api/src/process_flow_api/models.py
  - apps/api/src/process_flow_api/repository.py
---

# Process Flow API

`apps/api` 是 FastAPI composition root，負責 HTTP validation、SQLite persistence/transactions、kernel orchestration，以及 preview/export worker lifecycle。它不定義 geometry domain operation。

Canonical model/invariants 見 [`docs/data-model.md`](../../docs/data-model.md)，system flow 見 [System Architecture](../../docs/architecture/system-overview.md)。FastAPI 在 runtime 產生 OpenAPI，local UI 位於 `/docs`；本 README 不重複 schema examples。

## 啟動方式

在 repository root 完成 Python packages 安裝後：

```bash
PROCESS_FLOW_API_CORS_ORIGINS=http://localhost:3001 \
venv/bin/uvicorn process_flow_api.main:app --host 127.0.0.1 --port 8000
```

```bash
curl http://127.0.0.1:8000/api/health
```

完整 fresh setup、environment variables、reset/backup caveats 與 verification commands 見 [Local Development](../../docs/operations/local-development.md)。

## Runtime 生命週期

Application startup：

1. Construct `SQLiteStore` 與 in-memory `FileExportJobManager`。
2. Create/check SQLite schema。
3. 若所有 resource tables empty，load packaged fixtures。

Application shutdown 會 cancel queued exports、terminate running worker processes。Export history 不 persistence。SQLite default path 是 `apps/api/.data/process-flow.sqlite3`。

## Endpoint 群組

### 系統

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Process health |
| `GET` | `/api/bootstrap` | Templates、instances、geometry catalog bootstrap |
| `POST` | `/api/reset` | Destructive fixture reset |

### Process step template

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/process-step-templates` | List；支援 `search`、`category` |
| `GET` | `/api/process-step-templates/{id}` | Detail |
| `POST` | `/api/process-step-templates` | Validate and insert immutable template |
| `DELETE` | `/api/process-step-templates/{id}` | Delete only when no flow template references it |

### Geometry catalog

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/geometries` | List；支援 `search`、`category`、`entityType` |
| `GET` | `/api/geometries/{id}` | Detail |
| `POST` | `/api/geometries` | Insert；missing/empty id 由 API generate |

### Flow template 與 immutable instance

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST` | `/api/process-flow-templates` | List or validate/insert template |
| `GET` | `/api/process-flow-templates/{id}` | Template detail |
| `POST` | `/api/process-flow-template-instances` | Atomic template + first instance insert |
| `GET`/`POST` | `/api/process-flow-instances` | List or compile/insert complete instance |
| `GET` | `/api/process-flow-instances/{id}` | Instance detail |
| `POST` | `/api/process-flow-instances/{id}/execute` | Compile and execute saved instance |

### Workspace

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST` | `/api/process-flow-workspaces` | List or create incomplete draft |
| `GET` | `/api/process-flow-workspaces/{id}` | Reload draft/committed workspace |
| `PUT` | `/api/process-flow-workspaces/{id}` | Revision-checked draft update |
| `POST` | `/api/process-flow-workspaces/{id}/commit` | Complete compile + atomic materialization/instance commit |

### Preview 與 export

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/geometry-preview` | Resolve/execute target and return geometry JSON + GLB |
| `POST` | `/api/geometry-preview/step` | Convert supplied structure to base64 STEP |
| `POST` | `/api/geometry-preview/export-jobs` | Create JSON/STEP/CDB file job |
| `POST` | `/api/geometry-preview/cdb-jobs` | CDB-only legacy alias create path |
| `GET` | `/api/export-jobs?clientId=...` | Client-filtered in-memory job list |
| `GET` | `/api/export-jobs/{jobId}?clientId=...` | Job detail |
| `POST` | `/api/export-jobs/{jobId}/cancel` | Request cancellation |

Exact preview request shape、worker paths、timeouts 與 file replacement semantics 見 [Preview and Export Pipeline](../../docs/architecture/preview-export-pipeline.md)。

## 驗證與錯誤

Request models使用 `extra="forbid"`。Graph/template/configuration validation 由 kernel執行。Draft workspace 可以 incomplete；instance create、execute、preview step output 與 commit要求 complete compile。

API maps repository errors to：

- `404` missing resource；
- `409` duplicate id、referential conflict 或 stale workspace revision；
- `400` domain/compiler `ValueError`；
- `422` Pydantic request shape error。

Message text 不是 stable contract；client 應以 HTTP status + user-facing message 處理，不應
parse 完整字串。

## Security 邊界

Current API 沒有 authentication/authorization。Reset endpoint 可刪除資料；export endpoint 可寫入/replace API host absolute path；`clientId` 不是 identity。只可部署在受信任 local environment。

## 測試

```bash
venv/bin/python -m unittest discover apps/api/tests
```

Tests涵蓋 startup/seed、CRUD/conflicts、compile/execute、workspace transaction、preview/CAD 與 export jobs。
