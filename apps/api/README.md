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

`apps/api` 是 FastAPI composition root，負責 HTTP validation、SQLite persistence/transactions、kernel orchestration，以及 preview/export worker lifecycle。Geometry generator engine 由 `packages/geometry_generators` 維護；`create_app` 預設明確註冊內建 generators，也可透過 `generator_registry` 注入自訂註冊結果。

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

Application shutdown 會 cancel queued exports、terminate running worker processes。Export history 不 persistence。SQLite default path 是 設定的 process-flow.sqlite3（可用 PROCESS_FLOW_API_DB_PATH 指定）。

## Endpoint 群組

### 系統

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Process health |
| `GET` | `/api/dashboard/jobs` | Public read-only active export snapshot across all clients; no clientId required |
| `GET` | `/api/bootstrap` | Process flows、step templates、geometry catalog bootstrap |
| `GET` | `/api/fixture-export` | Current steps/flows/geometries three-file fixture ZIP |
| `POST` | `/api/reset` | Destructive fixture reset |
| `POST` | `/api/reset-from-zip` | Replace database from an exported fixture ZIP (`Content-Type: application/zip`) |

### Process step template

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/process-step-templates` | List；支援 `search`、`category` |
| `GET` | `/api/process-step-templates/export` | Download all step templates as a UTF-8 JSON array, including disabled steps |
| `POST` | `/api/process-step-templates/import` | Merge a JSON array by ID (`application/json`, max 25 MiB); return templates and created/updated counts |
| `GET` | `/api/process-step-templates/{id}` | Detail |
| `POST` | `/api/process-step-templates` | Validate and insert template |
| `PUT` | `/api/process-step-templates/{id}` | Update owner、category、program 與 parameter defaults |

Process-step template deletion is not supported. `DELETE /api/process-step-templates/{id}` returns
`405 Method Not Allowed`; existing templates remain available for reading and editing.

JSON import replaces complete records with matching IDs and inserts new IDs; omitted IDs remain.
Templates referenced by saved flows or any user's flow drafts only allow changes to status,
owner, category, program, descriptions at every level (including ports, nested parameters and
static options), input-port order, and recursive parameter defaults. Other
changes return `409` with the referenced step and resource ID. Validation and writes are atomic;
other resources, drafts, and the analytics dataset ID are preserved. Description changes through
JSON import do not change the existing single-template PUT restrictions.

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
| `GET` | `/api/geometry-generators/{id}/versions/{version}` | Get the exact versioned manifest used by a flow binding |
| `POST` | `/api/geometry-generators/{id}/preview` | Validate parameters、build geometry 與通用2D engineering preview |
| `POST` | `/api/geometry-materializations` | Materialize exact preview snapshot by opaque token |

Preview token是process-local bounded cache entry；restart、reset或eviction後可能失效。Client遇到
missing token必須重新preview，不可在前端自行重建geometry。

### Process flows 與 Flow drafts

統一 schema 3 ProcessFlow CRUD、execute 和 schema 2 FlowDraft CRUD／atomic commit；完整路由與錯誤契約見 [Process Flow API](../../docs/reference/process-flow-api.md)。更新／刪除要求 revision，409 保留原資料。正式儲存允許缺少 geometry／required recipe 值，但必須拓樸合法且已提供值有效。

舊 template／instance／dual draft／combined create API 已移除。Bootstrap 使用 processFlows，ZIP 僅三檔。SQLite schema 16 migration 先備份，支援已知 8–13 路徑與 14 版草稿清理，拒絕未知版本與實驗 schema 15，不自動 reset。

### Preview 與 export

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/preview-sessions` | Resolve/execute selected upstream closure once; return only the selected target snapshot and its SVG schematic document |
| `GET` | `/api/preview-sessions/{sessionId}/snapshots/{snapshotId}/mesh` | Retained lazy binary GLB route for CAD clients |
| `GET` | `/api/preview-sessions/{sessionId}/snapshots/{snapshotId}/section` | Retained exact body section route for engineering clients |
| `POST` | `/api/geometry-preview` | Resolve/execute target and return geometry JSON + GLB |
| `GET` | `/api/mesh-control-sets` | List registered Python mesh control sets |
| `POST` | `/api/mesh-control-sets/{setId}/apply` | Resolve a set against `geometryStructure` and return a complete `meshControl` plus rule details |
| `POST` | `/api/geometry-preview/export-jobs` | Create JSON/CDB file job |
| `POST` | `/api/geometry-preview/cdb-jobs` | CDB-only compatibility route using the same `geometryStructure` + `meshControl` body |
| `GET` | `/api/export-jobs?clientId=...` | Client-filtered in-memory job list |
| `GET` | `/api/export-jobs/{jobId}?clientId=...` | Job detail |
| `POST` | `/api/export-jobs/{jobId}/cancel` | Request cancellation |

Exact preview request shape、worker paths、timeouts 與 file replacement semantics 見 [Preview and Export Pipeline](../../docs/architecture/preview-export-pipeline.md)。

Flow Editor 只使用 session 的 `initialSnapshotId` target。Target snapshot 新增 `schematic`
document；`snapshots` 固定一筆，不回傳上游 snapshots。`schematicWarnings` 提供非阻擋顯示錯誤，原始
`geometryEntityJson` 仍可匯出。Diagram 不載入 GLB／section；既有 endpoints 保留。
API 的 `schematic_builder` 明確註冊 step／generator presenters；presentation version 納入
session 與 snapshot identity，`geometryHash` 只取原始 geometry。安裝 API 前須 editable install
`packages/schematic-py`，完整命令見本機開發手冊。

Execute、preview session 的各 snapshot 與 legacy geometry-preview 回應另有 `executionWarnings`，
預設為空陣列，與 schematic presentation warnings 分開。每筆包含 `code`、`stepRefId`、
`stepLabel`、`message`、`details`。Joint 在既有實體填充支撐下保留高度時，使用
`joint_soh_preserved`；details 包含 `childId`、`requestedSoh`、`actualSoh`、`unit` 與
`supportMaterials`。Execute 回傳本次執行的警告；各 preview snapshot 只繼承實際幾何輸入的上游
警告並去重，因此後續 molding 仍可看到來源 joint 警告，無關分支不混入。
警告不寫入 GeometryStructure、不阻止匯出，亦不修改已保存的 recipe 參數。

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

File export 的 JSON、CDB 主檔、CDB 附帶的 geometry／mesh-control JSON，以及每個
job 的 log，皆明確設定為 `0777`（所有使用者可讀、寫與執行）。主檔在發布至最終路徑前
設定權限；附帶 JSON 在寫入後、log 在建立後設定。權限設定失敗時工作不會回報成功；
log 權限設定失敗則拒絕建立工作並清除該 log。此設定只套用後續匯出（包含覆蓋匯出），
不修改輸出目錄、內部輸入暫存檔、全域 umask，也不批次修改既有檔案。

## 測試

```bash
PROCESS_FLOW_API_DB_PATH=:memory: venv/bin/python -m pytest apps/api/tests -q
```

Tests涵蓋 startup/seed、CRUD/conflicts、compile/execute、draft transaction、preview/CAD 與 export jobs。
## Wafer arrangement

`POST /api/wafer-arrangement/preview` 計算 COW 與邊界 dummy 排列，不寫入 catalog 或 flow
records。`POST /api/wafer-arrangement/export-gds` 接收相同參數，加上 API host 的絕對
`outputPath` 與可選的 `dieJson`。die JSON 以單顆 COW 左下角為 `(0, 0)`，X 向右、Y 向上，遞迴讀取五種類型的 Info
並複製至完整 COW，寫入 `888:1`～`888:5`。`POST /api/wafer-arrangement/preview-dies`
接收 `dieJson` 與可選 `cowSize`，可在沒有 wafer 參數時預覽單顆 COW；越界回傳圖形與
錯誤清單，但匯出端會拒絕。匯出回應的 `dieCounts` 為整份 wafer 的各類型數量，
`totalRectangles` 包含 die。GDS 使用隨此 package 安裝的 `klayout>=0.30.5,<0.31`
（`klayout.db` Python API，不需要啟動 GUI），user unit 為 1 µm、database unit 為 1 nm。
先寫同目錄暫存檔，成功後才替換目標檔案。參數、間距、數量限制與 layer/datatype 對應見
[工具規格](../../docs/ui/screens/wafer-arrangement.md)。

## Geometry precision and CDB alignment

長度單位為 µm。GDS 匯入完整解碼 REAL8 的 UNITS/MAG/ANGLE，保留 56-bit mantissa；
PnP 將放置後的絕對座標量化至 `0.0001 µm`，並使用相同的 XY 座標判斷 bump 接觸。
PnP 執行快取版本為 2。Wafer arrangement 的正間距與 dummy 邊距至少 2 nm，
大於預設 CDB tolerance 1 nm；零 COW 間距仍表示共邊。

CDB 使用 `mesher==0.2.1`，在產生網格前，只對 X/Y 做 bounded XY equivalence，
將容差內的座標對齊至同一代表座標，XY mesh controls 同樣對齊材料座標。
Z 座標、原始厚度及 Z mesh controls 保留，不套用此 tolerance 合併或改寫。
正的薄 Z 層只檢查數值能否表示；底面固定點僅從精確的最低 Z 平面選取。
`meshControl.geometryTolerance` 可指定正的有限數值，預設為 `0.001 µm`（含等於門檻）。
容差內的跨材料接觸允許形成共邊，但整個材料尺寸消失、材料變成相同體積、
或連鎖合併範圍超過容差仍回報來源明確的錯誤。輸入 geometry sidecar 保留原始資料，
CDB 與 log 記錄實際 tolerance 及 XY alignment policy 3；這不保證所有網格的 aspect ratio。
