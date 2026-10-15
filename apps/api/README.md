---
title: Process Flow API
status: descriptive
owner: integration.platform
audience:
  - API consumers
  - backend engineers
  - operators
last_verified: 2026-10-13
last_verified_commit: 990aaf71
source_of_truth:
  - apps/api/src/process_flow_api/main.py
  - apps/api/src/process_flow_api/models.py
  - apps/api/src/process_flow_api/repository.py
---

# Process Flow API

`apps/api` 是 FastAPI composition root，負責 HTTP validation、SQLite persistence/transactions、kernel orchestration，以及 preview/export worker lifecycle。Geometry generator engine 由 `packages/geometry_generators` 維護；`create_app` 預設明確註冊四個內建 generator，也可透過 `generator_registry` 注入自訂註冊結果。

Canonical model/invariants 見 [`docs/data-model.md`](../../docs/data-model.md)，system flow 見 [System Architecture](../../docs/architecture/system-overview.md)。FastAPI 在 runtime 產生 OpenAPI，local UI 位於 `/docs`；本 README 不重複 schema examples。

Request 與後端操作摘要保存於獨立 analytics SQLite；目前 request owner 為 `unknown`。
設定、事件格式、SQL 查詢、備份與還原見 [Service 使用紀錄](../../docs/reference/analytics.md)。

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
| `GET` | `/api/dashboard/jobs` | Public read-only active export snapshot across all clients; no clientId required |
| `GET` | `/api/bootstrap` | Templates、instances、geometry catalog bootstrap |
| `GET` | `/api/fixture-export` | Current step/template/instance/geometry fixture ZIP snapshot |
| `POST` | `/api/reset` | Destructive fixture reset |
| `POST` | `/api/reset-from-zip` | Replace database from an exported fixture ZIP (`Content-Type: application/zip`) |

### Process step template

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/process-step-templates` | List；支援 `search`、`category` |
| `GET` | `/api/process-step-templates/{id}` | Detail |
| `POST` | `/api/process-step-templates` | Validate and insert template |
| `PUT` | `/api/process-step-templates/{id}` | Update owner、category、program 與 parameter defaults |

Process-step template deletion is not supported. `DELETE /api/process-step-templates/{id}` returns
`405 Method Not Allowed`; existing templates remain available for reading and editing.

### Geometry catalog

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/geometries` | List；支援 `search`、`category`、`entityType` |
| `GET` | `/api/geometries/{id}` | Detail |
| `POST` | `/api/geometries` | Validate standard structure, normalize IDs/collections, insert；missing/empty id 由 API generate |

Geometry creation accepts a complete GeometryStructure wrapper (`schemaVersion: "1.0.0"`,
`unitSystem: "um"`, `root`). Invalid structures return a `400` message with a field path before
any insert; malformed metadata returns `422`. Valid explicit structure IDs are preserved, while
omitted IDs and empty collections are filled deterministically. Catalog owner remains optional.

### Geometry generator

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/geometry-generators` | List backend generator manifests |
| `GET` | `/api/geometry-generators/{id}/versions/{version}` | Get the exact versioned manifest used by an instance recipe |
| `POST` | `/api/geometry-generators/{id}/preview` | Validate parameters、build geometry 與通用2D engineering preview |
| `POST` | `/api/geometry-materializations` | Materialize exact preview snapshot by opaque token |

Preview token是process-local bounded cache entry；restart、reset或eviction後可能失效。Client遇到
missing token必須重新preview，不可在前端自行重建geometry。

### Flow template 與 immutable instance

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`/`POST` | `/api/process-flow-templates` | List or validate/insert template |
| `GET` | `/api/process-flow-templates/{id}` | Template detail |
| `PUT` | `/api/process-flow-templates/{id}` | Restricted metadata and scalar flow-default update |
| `DELETE` | `/api/process-flow-templates/{id}` | Delete unused template and its instance drafts; `409` if any instance references it |
| `POST` | `/api/process-flow-template-instances` | Atomic template + first instance insert |
| `GET`/`POST` | `/api/process-flow-instances` | List or compile/insert complete instance |
| `GET` | `/api/process-flow-instances/{id}` | Instance detail |
| `DELETE` | `/api/process-flow-instances/{id}` | Delete instance |
| `POST` | `/api/process-flow-instances/{id}/execute` | Compile and execute saved instance |

Flow template／instance create requests 不接受 `id`；server 在儲存時產生
32 字元小寫 UUID4 hex（不帶前綴），response 回傳完整 record 與 ID。
Combined create 的 instance 同時不傳 `processFlowTemplateId`，由 server 建立引用。
Draft commit 的正式 create payload 同樣不接受 `id`；成功後草稿刪除。
呼叫端傳入上述 server-owned fields 回傳 `422`；既有 record、update 與 fixture import
保留原 ID。

Deletion returns `204` with no body, or `404` for an absent resource. Reference checks and related
instance draft deletion run in one transaction; failures roll back all deletions. Process-step templates
are retained when their flow templates are deleted.
Geometry catalog entries are retained. Deletion uses the existing trusted-local API access model;
there is no new login or role enforcement. Flow and instance deletion record `flow_template.delete`
and `flow_instance.delete` analytics events with their resource context before deletion.

### Editor drafts

Two independent snapshot types use separate tables in the business SQLite DB:

| Path prefix | Kind |
| --- | --- |
| `/api/process-flow-template-drafts` | Template metadata, graph, viewport and complete working configuration |
| `/api/process-flow-instance-drafts` | Instance metadata and complete configuration for one fixed template |

Both support GET list, POST create, GET/PUT/DELETE `/{id}`, and POST `/{id}/commit`. Lists omit state and accept user/search; instance lists, detail and deletion require `processFlowTemplateId`. Update/delete/commit require revision. Create starts at 1, updates increment it, and conflicts return 409. Draft user/name are nonblank and separate from formal metadata. Drafts permit incomplete topology and parameter values; format validation still applies.

Commit accepts `{revision, processFlowTemplate}` or `{revision, processFlowInstance}` using the editor's current formal create payload. Shared validation precedes atomic materialization/resource insert/draft deletion. Failures preserve the draft and roll back writes. A consumed draft returns 404. Disabled flows permit draft editing but reject new instances/instance commit.

Business schema marker remains 13. Canonical fixtures provide MR joint / TCB joint in the
`joint` category; startup and fixture ZIP imports do not convert legacy Joint references.
Schema 12 converts legacy workspace drafts,
then removes the old table; legacy workspace APIs are removed. Analytics schema 2 preserves historical workspace IDs inside properties JSON. Reset/import clears drafts; fixture ZIP continues exporting only the four formal resource files.

### Preview 與 export

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/geometry-preview` | Resolve/execute target and return geometry JSON + GLB |
| `POST` | `/api/geometry-preview/step` | Convert supplied structure to base64 STEP |
| `GET` | `/api/mesh-control-sets` | List registered Python mesh control sets |
| `POST` | `/api/mesh-control-sets/{setId}/apply` | Resolve a set against `geometryStructure` and return a complete `meshControl` plus rule details |
| `POST` | `/api/geometry-preview/export-jobs` | Create JSON/STEP/CDB file job |
| `POST` | `/api/geometry-preview/cdb-jobs` | CDB-only compatibility route using the same `geometryStructure` + `meshControl` body |
| `GET` | `/api/export-jobs?clientId=...` | Client-filtered in-memory job list |
| `GET` | `/api/export-jobs/{jobId}?clientId=...` | Job detail |
| `POST` | `/api/export-jobs/{jobId}/cancel` | Request cancellation |

Exact preview request shape、worker paths、timeouts 與 file replacement semantics 見 [Preview and Export Pipeline](../../docs/architecture/preview-export-pipeline.md)。

### 公開 job dashboard

`GET /api/dashboard/jobs` 回傳 `generatedAt`、`maxConcurrentJobs`、`runningCount`（包含
canceling）、`queuedCount` 與 `jobs`。僅列 queued/running/canceling；running/canceling 在前，
queued 依 FIFO 排列。Snapshot 在同一 manager lock 內產生，不套用每 client 20 筆限制，
以 `Cache-Control: no-store` 回應，analytics traffic kind 為 polling。

Job 欄位為 `jobId`、`targetFolderPath`、`kind`、`status`、`createdAt`、`startedAt`、`queuePosition`、
`runElapsedSeconds`、`queueElapsedSeconds`、`progress`。Queued 的 run elapsed 為 null；
其他 active status 的 queue elapsed 為 null。耗時以 monotonic clock 計算。Progress 僅包含
`stage`、`message`、`current`、`total`、`unit`、`stageStartedAt`、`updatedAt`。
`message` 僅公開內建 worker 的固定文案與純數字進度模板，例如
`Imprinting feature 3 of 10.`、`Built layer 3 of 12.`；未知訊息回 null。

`targetFolderPath` 為 API 主機上輸出檔案的 parent directory，沿用已保存的路徑、不解析
symlink；該資料夾包含 `<jobId>.log`。三種格式與所有 active status 均提供完整資料夾路徑。

此端點不要求 authentication，所有可存取 dashboard 的人皆可看到 target folder。
除 `targetFolderPath` 外，不回傳其他 paths、clientId、sourceLabel、meshControl、worker
任意 message/warning 或完整輸入。現有 client-filtered export API 不變。資料限單一 API process，
restart 清空；這不是歷史、preview 或 analytics dashboard。

## 驗證與錯誤

Request models使用 `extra="forbid"`。Graph/template/configuration validation 由 kernel執行。Editor drafts 可以 incomplete；instance create、execute、preview step output 與 commit要求 complete compile。

API maps repository errors to：

- `404` missing resource；
- `409` duplicate id、referential conflict 或 stale draft revision；
- `400` domain/compiler `ValueError`；
- `422` Pydantic request shape error，或mesher-owned `meshControl` contract validation error。

Mesh control set 的 apply route 對不適用或無法解析的 geometry 也回 `422`；未知 set 回 `404`。

Message text 不是 stable contract；client 應以 HTTP status + user-facing message 處理，不應
parse 完整字串。

## Security 邊界

Current API 沒有 authentication/authorization。Reset endpoint 可刪除資料；export endpoint 可寫入/replace API host absolute path；`clientId` 不是 identity。只可部署在受信任 local environment。

File export 的 JSON、CDB、STEP 主檔、CDB 附帶的 geometry／mesh-control JSON，以及每個
job 的 log，皆明確設定為 `0777`（所有使用者可讀、寫與執行）。主檔在發布至最終路徑前
設定權限；附帶 JSON 在寫入後、log 在建立後設定。權限設定失敗時工作不會回報成功；
log 權限設定失敗則拒絕建立工作並清除該 log。此設定只套用後續匯出（包含覆蓋匯出），
不修改輸出目錄、內部輸入暫存檔、全域 umask，也不批次修改既有檔案。

## 測試

```bash
venv/bin/python -m unittest discover apps/api/tests
```

Tests涵蓋 startup/seed、CRUD/conflicts、compile/execute、draft transaction、preview/CAD 與 export jobs。
