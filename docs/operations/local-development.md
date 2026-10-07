---
title: 本機開發與操作
status: descriptive
owner: integration.platform
audience:
  - developers
  - operators
last_verified: 2026-08-29
last_verified_commit: 013fba726b811c8acfbc5d928463a15baa67a9e3
source_of_truth:
  - README.md
  - apps/api/pyproject.toml
  - apps/viewer/package.json
  - apps/api/src/process_flow_api/main.py
  - apps/api/src/process_flow_api/file_export_jobs.py
---

# 本機開發與操作

本頁是 fresh checkout 的 canonical local runbook。Current application 是受信任環境使用的 PoC，不應直接公開到 untrusted network。

## 前置需求

- Python 3.11+
- Node.js `>=18.17.0`（目前驗證環境為 Node `24.3.0`、npm `11.4.2`）
- macOS/Linux environment capable of installing CadQuery/OCP
- `mesher` repository checkout commit
  `302ebe36663b727669901cbc766ccc0a2ae6f221`；它提供2D／3D mesh、Standard V1 translation、
  CDB export與optional visualization

Viewer 由 committed `package-lock.json` 鎖定，fresh install MUST 使用 `npm ci`。Python
目前只有 `pyproject.toml` version ranges，沒有 committed lock/constraints file，因此安裝
不是 bit-for-bit reproducible；release 前應補 dependency lock 與驗證平台矩陣。

## Python 環境設定

在 repository root：

```bash
python3 -m venv venv
venv/bin/pip install --upgrade pip
git -C /absolute/path/to/mesher checkout 302ebe36663b727669901cbc766ccc0a2ae6f221
venv/bin/pip install -e packages/kernel-py
venv/bin/pip install -e '/absolute/path/to/mesher[process-flow,visualization]'
venv/bin/pip install \
  -e packages/process-step-py \
  -e packages/geometry_generators \
  -e packages/mesh-control-py \
  -e packages/cad-py \
  -e 'apps/api[test]'
```

需要同步修改 `mesher` 時，維持 editable install。必須先安裝指定的local checkout，
不可執行沒有path的`pip install mesher`，因為PyPI上的同名package與本專案無關。

所有 local packages 必須安裝在啟動 API 的同一 Python environment。Kernel 會在 execution time import `process_flow_steps`；CAD/CDB workers也使用 `sys.executable` 啟動。

## 啟動 API

```bash
PROCESS_FLOW_API_CORS_ORIGINS=http://localhost:3001 \
venv/bin/uvicorn process_flow_api.main:app --host 127.0.0.1 --port 8000
```

Checks：

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/bootstrap
```

OpenAPI UI：`http://127.0.0.1:8000/docs`。

## 啟動 viewer

```bash
cd apps/viewer
npm ci
NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL=http://localhost:8000 npm run dev -- -p 3001
```

Open `http://localhost:3001`。

Production-style static build：

```bash
cd apps/viewer
NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL=http://localhost:8000 npm run build
npm run start
```

`NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL` 在 build time bake into output；API host 改變後必須 rebuild。`npm run start` 只用 Python static server serve `apps/viewer/out`。

### 即時 job dashboard

開啟 `http://localhost:3001/dashboard`，或部署後的 viewer 網址 `/dashboard`。
這是任何持有網址的人都可查看的唯讀頁面，顯示所有 client 的 CDB/STEP/JSON active exports：
執行中數量／並行上限、等待數量、stage、細部動作說明、耗時與全域 FIFO 順位。細部說明與
使用者 export drawer 同源，只公開固定文案或純數字進度；終態不保留在畫面。

有工作時每 2 秒更新，閒置時每 5 秒；頁面隱藏時暫停，回前景立即更新。
失敗或超過 10 秒沒有成功快照會標示 stale 並凍結耗時，不代表 job 已失敗。可手動 Refresh。
API 的 `GET /api/dashboard/jobs` 不需 clientId，僅回傳公開監控欄位。

正式 viewer build 的 API base URL 必須是瀏覽器可連到的 API 位址，CORS 必須包含 viewer
origin；不可把正式 build 指向訪客電腦的 localhost。沿用 static export 的
`dashboard/index.html`，不需要新增 port 80 proxy。Queue 限單一 API process，restart 後清空；
不要用多個 API workers 分攤同一 dashboard。

## 環境設定

| Variable | Component | Default | Notes |
| --- | --- | --- | --- |
| `PROCESS_FLOW_API_DB_PATH` | API | `apps/api/.data/process-flow.sqlite3` | SQLite path；parent 自動建立 |
| `PROCESS_FLOW_API_CORS_ORIGINS` | API | localhost/127.0.0.1 ports 3000/3001 | Comma-separated exact origins |
| `GEOMETRY_PREVIEW_EXPORT_TIMEOUT_SECONDS` | API sync preview | `30` | 只適用 synchronous CAD preview helper |
| `EXPORT_MAX_CONCURRENT_JOBS` | API export jobs | `3` | Preferred queue concurrency variable |
| `CDB_EXPORT_MAX_CONCURRENT_JOBS` | API export jobs | `3` | Legacy fallback；preferred variable 有設定時忽略 |
| `NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL` | Viewer build | `http://localhost:8000` | Frontend-only；API 不讀取 |
| `MPLCONFIGDIR` | CDB worker | system/default | 未設定時 API bridge 指向 temp directory |

## 資料生命週期

Startup 會 create schema 並在所有 resource tables 都 empty 時 load fixtures。Database internal
marker 不是 `2` 時，目前 implementation 會清空 resource tables；這個 PoC 不提供早期草案
資料轉換。

`POST /api/reset` 會清空所有 resources 並 reload fixtures。它沒有 authentication 或 environment guard；只可在確認資料可丟棄時使用。需要保留 local study 時，先停止 API 並備份 SQLite file 及其 WAL files。

Management 右下角的 fixture 選單可匯出目前資料、從匯出的四檔 JSON ZIP 還原資料，或以 repo
fixtures 重設。`POST /api/reset-from-zip` 接受 `application/zip` 原始內容；匯入前會驗證檔案格式，
資料替換在單一 SQLite transaction 內完成。

## 驗證

從 root 執行：

```bash
venv/bin/python -m unittest discover -s /absolute/path/to/mesher/tests -v
venv/bin/python -m unittest packages/kernel-py/tests/test_kernel.py
venv/bin/python -m unittest discover -s packages/mesh-control-py/tests
venv/bin/python -m unittest discover -s packages/geometry_generators/tests
venv/bin/python -m unittest discover apps/api/tests
cd apps/viewer && npm run build
```

CAD tests 位於 `apps/api/tests/test_cad_exporter.py`，由 API test discovery 執行。Process-step modules 的 current integration coverage 位於 kernel tests。

Mesher integration workflow執行外部mesher、API、文件與viewer build；目前仍沒有browser E2E test或standalone process-step test suite。

## Export 操作

Background export output path 是 API host 的 absolute path，不是 browser download path。Parent folder 必須存在；existing target 會被 replace。Job queue/history process-local，restart 後消失；background workers目前無 hard timeout。

完整狀態與 security caveats 見 [preview-export-pipeline.md](../architecture/preview-export-pipeline.md)。

## 開發者 scripts

`script/geometry_viewer.py` 是optional desktop mesh visualization utility；前述mesher install已包含
`visualization` extra。`script/test1.py`與`script/test2.py`是legacy experiments，不是supported
verification commands，但都使用installed `mesher` package imports。

## 疑難排解

| Symptom | Check |
| --- | --- |
| `Unable to load process step module` | `packages/process-step-py` 是否安裝在 API venv；template `program` 是否存在 |
| Viewer network error | Build-time API base URL、API process、CORS origin 是否一致 |
| CAD worker import error | API 是否由安裝 `process-flow-cad`/CadQuery 的同一 Python executable 啟動 |
| CDB `ConeGeometry` error | Current 2.5D translator 不支援 Cone；改用 supported primitive 或先實作 support |
| Export job看不到 | Polling 使用的 `clientId` 是否和 create request 相同；API 是否重啟 |
| Local data突然回到 fixtures | 檢查 database path 與 `schema_metadata.databaseSchemaVersion` |
