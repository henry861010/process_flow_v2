---
title: Service 使用紀錄
status: descriptive
owner: integration.platform
audience:
  - operators
  - backend engineers
last_verified: 2026-10-07
last_verified_commit: 7308bb19
source_of_truth:
  - apps/api/src/process_flow_api/analytics.py
  - apps/api/src/process_flow_api/analytics_http.py
  - apps/api/src/process_flow_api/analytics_cli.py
---

# Service 使用紀錄

API 將 request 摘要與後端操作事件存入独立的 `analytics.sqlite3`。沒有登入時，
`request_owner` 固定為 `unknown`；不使用 flow owner、export clientId、IP、Cookie 或
前端傳入的身分。未來可信任的認證 middleware 可設定
`scope['state']['authenticated_user_id']`，不需修改 schema，也不回填舊紀錄。

## 設定與保存

| 環境變數 | 預設 |
| --- | --- |
| `PROCESS_FLOW_API_ANALYTICS_DB_PATH` | 業務 DB 同目錄的 `analytics.sqlite3`；標準為 `apps/api` 下的 `.data/analytics.sqlite3` |
| `PROCESS_FLOW_API_ANALYTICS_BACKUP_DIR` | 分析 DB 同目錄的 `analytics-backups` |
| `PROCESS_FLOW_API_ENVIRONMENT` | `development`；正式部署應設為 `production` |
| `PROCESS_FLOW_API_VERSION` | `unknown`；建議設為部署 commit SHA |

`create_app` 支援 `analytics_db_path`；測試使用各自暫存資料夾。分析 DB 不得與業務 DB
共用檔案。所有事件長期保存，不自動清除；reset、ZIP 匯入、fixture 匯出均不包含分析 DB。

SQLite 使用 WAL、FULL synchronous 與單一背景 writer。佇列上限 4,096 筆，每批最多
100 筆、最長等候 100 ms。正常關閉會嘗試在 5 秒內排空。寫入失敗不改變業務操作結果，
遺失數可由 `app.state.analytics.dropped_records` 查看，錯誤日誌限頻 60 秒；恢復寫入後
保存 `analytics.gap`。程序突然終止、佇列尚未落盤的紀錄可能遺失，無法推算精確缺口。
分析 schema 不支援未知版本時停止寫入並保留既有檔案，不清空重建。

API process 啟動及跨 UTC 日期時自動產生每日一致性備份，保留最近 30 份；同一天重啟
不覆寫備份。API 未運作的日期不產生備份。備份與主檔預設在同一主機；災難復原需由部署
環境另行複製至獨立儲存。

## 格式與隱私邊界

兩張主要資料表為 `api_requests`、`usage_events`；內部 `analytics_metadata` 保存
schema version `1`。每筆含 `request_owner`、`occurred_at`、`environment`、`app_version`、
`server_instance_id`、`dataset_id`、`record_version`。UTC 時間固定為 ISO 8601 毫秒 `Z` 格式，
耗時用 monotonic clock 計算並存為整數毫秒。

Requests 保存 server 產生的 UUID、開始時間、HTTP method、路由樣板、狀態碼、耗時、
可取得的輸入輸出 bytes、traffic kind、completion state、穩定錯誤分類。
Traffic kinds 為 `operation`、`polling`、`asset`、`system`；未知路由保存 `__unmatched__`。
輸入大小若只讀得到 Content-Length，為宣告大小；未取得時為 NULL。

Events 保存 UUID、觸發 request ID、operation ID、event name、phase、outcome、資源 IDs、
source kind、耗時、錯誤分類及 `properties_json`。同步操作為 `finished`；export 用同一 job ID
保存 `accepted`、`started`、`finished`。Outcome 為 success/failure/cancelled/unknown，未完成時
為 NULL。欄位沒有跨 DB 外鍵，避免 reset 與歷史保留衝突。operation/name/phase 唯一。

JSON 摘要僅包含 flow 名稱/版本、step/input/edge 數、step template IDs、設定 step 數、
binding 類型數量、generator IDs/版本、workspace revision/status、preview target/cache hit、
export format/queue wait/output bytes/node/element 數。名稱與識別文字上限 256 字元；
step/generator 清單最多 256 項，總數欄位不截斷。名稱與 ID 是使用者提供的領域資料，
請勿在名稱中放秘密。不保存完整 bodies、headers、query、參數值、geometry、mesh、
輸出路徑、clientId、preview token、錯誤原文。

## 歸因與相容性

所有回應新增 `X-Request-Id` 並由 CORS expose。Preview、單步 preview 及兩個 export 建立
端點接受選填的 `analyticsContext`：

```json
{"flowTemplateId":"my-flow","flowInstanceId":"my-instance","sourceKind":"instance"}
```

可用欄位為 flowTemplateId/flowInstanceId/workspaceId/sourceKind；sourceKind 為
template/instance/workspace/inline_draft/geometry。沒有 context 的舊 client 可繼續使用。
後端只保留存在且關聯一致的引用，無法確認時標記 `context_confirmed=false`。
Context 是「來源歸因」，不證明本次設定或輸出的 geometry 與保存資源完全相同，也不提供
身分或授權。Inline template 不依其 id 當成已保存 topology；確認的來源只存
`base_flow_template_id`。匯出背景工作保留提交時的 owner/request/dataset，而非輪詢者身分。

dataset UUID 存在業務 schema_metadata，reset/ZIP 匯入在同一 transaction 更換；失敗時不更換。
重啟保留 dataset UUID。每次操作仍使用開始時的 dataset；reset/import 事件另含 new_dataset_id。
Server 啟動時，舊 process 已接受但沒有完成事件的 export 產生 unknown/SERVER_RESTART 結果。
此設計限單一 API process，不能同時啟動多個 process 共用此 DB。

建立事件只在業務成功後保存；commit 重試不產生新的 instance.create，workspace.commit
摘要的 created_instance 為 false。Fixtures 與 ZIP 匯入不偽造逐筆建立事件。
Generator preview 即使 HTTP 200，若 valid=false，其事件 outcome 仍為 failure。
Validation 在 endpoint 前失敗時，只保存最小失敗事件，不保留無效輸入。

## 查詢與維護

[SQL 查詢範例](analytics-queries.sql) 提供流量、建立數、flow 使用、step/generator 引用、
錯誤率、版本比較、延遲分位數與資料缺口。使用 events 計算操作，requests 計算流量，
不把兩者相加；輪詢與 mesh/section 下載不算 flow 操作。
Step/generator 指標是被操作引用的次数，不代表每個 step 實際執行次數。
目前無法計算使用人數、活躍度或回訪率；未来 user count 排除 unknown。
沒有前端點擊事件、分析 dashboard 或啟用前的歷史回填。公開的
[Job Dashboard](../ui/screens/dashboard.md) 只讀取記憶體中的 active export jobs，
不是 analytics 報表；其 `GET /api/dashboard/jobs` requests 分類為 polling。

在專案根目錄執行：

```sh
venv/bin/python -m process_flow_api.analytics_cli --db apps/api/.data/analytics.sqlite3 inspect
venv/bin/python -m process_flow_api.analytics_cli --db apps/api/.data/analytics.sqlite3 backup --output /absolute/backup/analytics.sqlite3
```

Restore 必須先停止 API，確保目標檔案沒有 WAL/SHM/journal sidecars；若 crash 留下 sidecars，
先以 SQLite checkpoint 完成原檔 recovery，不能直接刪除 WAL。再執行：

```sh
venv/bin/python -m process_flow_api.analytics_cli --db apps/api/.data/analytics.sqlite3 restore --source /absolute/backup/analytics.sqlite3 --offline --replace
```

工具使用 SQLite backup API 與 quick_check，暫存完成後才替換目的檔案。`inspect` 為唯讀，
顯示主檔/WAL bytes、筆數與時間範圍。用實際每日筆數及 bytes 增量估算長期容量，勿只依
現有 flow 數估算。備份還原到較舊快照會失去快照之後的分析紀錄。
