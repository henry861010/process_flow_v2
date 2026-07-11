---
title: 本機開發與操作
status: descriptive
owner: integration.platform
audience:
  - developers
  - operators
last_verified: 2026-07-11
last_verified_commit: b01b1e70
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

Viewer 由 committed `package-lock.json` 鎖定，fresh install MUST 使用 `npm ci`。Python
目前只有 `pyproject.toml` version ranges，沒有 committed lock/constraints file，因此安裝
不是 bit-for-bit reproducible；release 前應補 dependency lock 與驗證平台矩陣。

## Python 環境設定

在 repository root：

```bash
python3 -m venv venv
venv/bin/pip install --upgrade pip
venv/bin/pip install \
  -e packages/kernel-py \
  -e packages/process-step-py \
  -e packages/cad-py \
  -e packages/mesher-py \
  -e 'apps/api[test]'
```

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

## 環境設定

| Variable | Component | Default | Notes |
| --- | --- | --- | --- |
| `PROCESS_FLOW_API_DB_PATH` | API | `apps/api/.data/process-flow.sqlite3` | SQLite path；parent 自動建立 |
| `PROCESS_FLOW_API_CORS_ORIGINS` | API | localhost/127.0.0.1 ports 3000/3001 | Comma-separated exact origins |
| `GEOMETRY_PREVIEW_EXPORT_TIMEOUT_SECONDS` | API sync preview | `30` | 只適用 synchronous CAD preview helper |
| `EXPORT_MAX_CONCURRENT_JOBS` | API export jobs | `1` | Preferred queue concurrency variable |
| `CDB_EXPORT_MAX_CONCURRENT_JOBS` | API export jobs | `1` | Legacy fallback；preferred variable 有設定時忽略 |
| `NEXT_PUBLIC_PROCESS_FLOW_API_BASE_URL` | Viewer build | `http://localhost:8000` | Frontend-only；API 不讀取 |
| `MPLCONFIGDIR` | CDB worker | system/default | 未設定時 API bridge 指向 temp directory |

## 資料生命週期

Startup 會 create schema 並在所有 resource tables 都 empty 時 load fixtures。Database internal
marker 不是 `2` 時，目前 implementation 會清空 resource tables；這個 PoC 不提供早期草案
資料轉換。

`POST /api/reset` 會清空所有 resources 並 reload fixtures。它沒有 authentication 或 environment guard；只可在確認資料可丟棄時使用。需要保留 local study 時，先停止 API 並備份 SQLite file 及其 WAL files。

## 驗證

從 root 執行：

```bash
venv/bin/python -m unittest packages/kernel-py/tests/test_kernel.py
venv/bin/python -m unittest discover apps/api/tests
venv/bin/python -m unittest packages/mesher-py/tests/test_dragger_write.py
cd apps/viewer && npm run build
```

CAD tests 位於 `apps/api/tests/test_cad_exporter.py`，由 API test discovery 執行。Process-step modules 的 current integration coverage 位於 kernel tests。

目前沒有 committed CI workflow、browser E2E test 或 standalone process-step test suite；在建立 release gate 前，以上 commands 是最低 handoff checks。

## Export 操作

Background export output path 是 API host 的 absolute path，不是 browser download path。Parent folder 必須存在；existing target 會被 replace。Job queue/history process-local，restart 後消失；background workers目前無 hard timeout。

完整狀態與 security caveats 見 [preview-export-pipeline.md](../architecture/preview-export-pipeline.md)。

## 開發者 scripts

`script/geometry_viewer.py` 是 optional desktop mesh visualization utility，需要 `pyvista`，但 `pyvista` 目前不是 `process-flow-mesher` dependency。`script/test1.py` 與 `script/test2.py` 含 developer-specific absolute import paths，屬 legacy experiments，不是 supported verification commands。

## 疑難排解

| Symptom | Check |
| --- | --- |
| `Unable to load process step module` | `packages/process-step-py` 是否安裝在 API venv；template `program` 是否存在 |
| Viewer network error | Build-time API base URL、API process、CORS origin 是否一致 |
| CAD worker import error | API 是否由安裝 `process-flow-cad`/CadQuery 的同一 Python executable 啟動 |
| CDB `ConeGeometry` error | Current 2.5D translator 不支援 Cone；改用 supported primitive 或先實作 support |
| Export job看不到 | Polling 使用的 `clientId` 是否和 create request 相同；API 是否重啟 |
| Local data突然回到 fixtures | 檢查 database path 與 `schema_metadata.databaseSchemaVersion` |
