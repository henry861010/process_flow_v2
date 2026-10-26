---
title: SQLite Persistence
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - apps/api/src/process_flow_api/repository.py
  - apps/api/src/process_flow_api/flow_migration.py
  - apps/api/tests/test_flow_migration.py
---

# SQLite Persistence

業務 schema version 為 **16**。Canonical camelCase JSON 存在 payload column，查詢欄位另存並同步更新。

| Table | 主要欄位與約束 |
| --- | --- |
| process_step_templates | 既有 step ID、metadata、payload |
| geometries | 既有 catalog ID、metadata、payload |
| process_flows | id、name、version、owner、revision、payload；全域 UNIQUE(name, version) |
| process_flow_drafts | id、user、name、revision、created_at、updated_at、payload |
| schema_metadata | databaseSchemaVersion、analyticsDatasetId |

## 交易與並行修改

Flow create revision=1；update/delete 要求呼叫端 revision。更新 SQL 在交易內檢查現況並遞增 revision。Origin 更新時保留舊值，沒有來源外鍵。既有 origin 歷史資料不在此次清理範圍。

Draft create/update/delete 使用獨立 revision。Draft 只保存尚未建立的 flow；commit 在同一 transaction 建立正式 flow 並刪草稿。過期 draft revision、唯一性衝突或 SQL 失敗全部 rollback。既有 flow 由 PUT 使用 CAS revision 更新。正式保存不呼叫 kernel 或 generator。

Geometry 刪除檢查所有 flows 與 drafts 的 catalog bindings，引用中回 409。Step structural import 保護正式 flow／草稿中的既有引用。Step status 僅限制新增引用。

## 可保留資料的升級

對 schema 8–13 執行既有格式轉換；對 schema 14 執行草稿清理。拒絕未知、未標記的既有資料庫及已捨棄的 schema 15；**不自動 reset**。

1. 先使用 SQLite backup API 建立同目錄 `.pre-v16-<uuid>.bak` 一致性備份，包含 WAL 中已提交資料。
2. Schema 8–13 在 `BEGIN IMMEDIATE` transaction 中讀取、轉換、驗證全部正式資料與草稿。
3. Schema 8–13 驗證跨舊集合 ID 與 (name, version) 唯一性、必要 template 引用、參數與 embedded geometry。失敗報告來源，原資料和 marker 保持不變。
4. Schema 8–13 寫入新 tables、驗證內容、刪除舊 flow/draft/workspace tables，更新 marker=16。
5. Schema 14 在單一交易中刪除 payload 中 `target` 非 null 的草稿，移除其餘草稿的 null `target`，並更新 marker=16；包含指向已刪 flow 的草稿。保留正式 flows、其餘草稿、step、geometry 與 analyticsDatasetId；失敗回滾資料與 marker。
6. 再次啟動 schema 16 不重複轉換或清理。

## 轉換規則

- 舊 template 保留 ID 和 metadata，複製完整 definition。每站 defaults 變為一組已採用 `Recipe 1`；明確空 defaults 保持空值。只有舊格式沒有 snapshot 欄位時才按該舊版規則取得 scalar defaults。
- 舊 instance 保留 ID、metadata、完整實際參數和 bindings，複製所引用 template 的 definition。Origin 指向來源 flow revision 1，不補 defaults。
- Template draft 保留畫布和 working configuration；instance draft／workspace draft 補入來源 template 的拓樸。保留草稿 revision、時間與未完成設定。已完成的舊 workspace 不當成新草稿。
- Embedded geometry 僅在 migration 轉為 catalog 記錄並重寫 bindings；未綁定項目也保留。無法驗證或缺失引用則整批中止，不自行刪除、改名或猜測來源。
- 前置舊 geometry metadata 升級沿用可保留資料規則；舊格式處理集中在 flow_migration 模組，runtime 無相容轉接。

## Fixtures 與 ZIP

僅接受三檔：`process-step-templates.json`、`process-flows.json`、`geometries.json`。全部先驗證再 reset；舊四檔 ZIP 拒絕。Export 保留 flow ID、revision、origin、全部候選與選擇。草稿與 analytics 不包含在 fixture ZIP。

Reset／ZIP import 仍為明確破壞性操作，會清空草稿並更新 dataset UUID；一般啟動與 migration 不改 dataset 身分。Analytics DB 的獨立 schema 升為 3，保留全部歷史事件與舊歸因欄位。

## 升級驗證

先用 SQLite backup API 複製真實 schema 11／13／14 資料庫，在副本啟動新程式並驗證 flows、草稿、catalog 和 execution。不要直接使用原檔開發測試。遇到 schema 15 必須停止，不能只修改版本 marker 假裝是 13。測試涵蓋碰撞、缺來源、無效 embedded、中途 SQL 失敗、14 版草稿清理與回滾、重啟及已選參數一致性。
