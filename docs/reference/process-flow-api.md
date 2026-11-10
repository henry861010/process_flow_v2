---
title: Process Flow API
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-11-11
last_verified_commit: b919038b
source_of_truth:
  - apps/api/src/process_flow_api/main.py
  - apps/api/src/process_flow_api/models.py
  - apps/api/src/process_flow_api/package_conversion_schema.py
---

# Process Flow API

所有 flow payload 採 [資料模型 schema 3](../data-model.md)。OpenAPI 可由執行中的 `/openapi.json` 查看完整格式。

| Method | Route | 行為 |
| --- | --- | --- |
| GET | /api/bootstrap | processStepTemplates、processFlows、geometries、geometryGenerators 等既有能力集合 |
| GET | /api/process-flows | 列出全部 flows |
| POST | /api/process-flows | 完整 create payload；不傳 id/revision；201，revision=1 |
| GET | /api/process-flows/{flow_id} | 正式 flow |
| PUT | /api/process-flows/{flow_id} | create 欄位加呼叫端 revision；200，新 revision |
| DELETE | /api/process-flows/{flow_id}?revision=N | CAS 刪除；204 |
| POST | /api/process-flows/{flow_id}/execute | 使用採用 recipe，回傳 geometryStructure 與 stepOutputs |
| POST | /api/package-conversions/preview | 依外部 profile、角色綁定與基準 flow 轉換、執行並驗證；200，不寫入 DB |
| POST | /api/package-conversions/import | 重新轉換並驗證，透過既有建立流程保存新 flow；201，附轉換報告 |
| GET | /api/process-flow-drafts | 全域草稿摘要，可依 user 篩選 |
| POST | /api/process-flow-drafts | schemaVersion 2、user、name、state、可選 origin；201；僅供尚未建立的 flow |
| GET | /api/process-flow-drafts/{draft_id} | 完整草稿 |
| PUT | /api/process-flow-drafts/{draft_id} | 完整草稿輸入加 revision |
| DELETE | /api/process-flow-drafts/{draft_id}?revision=N | CAS 刪除；204 |
| POST | /api/process-flow-drafts/{draft_id}/commit | `{revision, flow: ProcessFlowCreate}`；原子建立 flow 並刪除草稿 |

不存在為 404；revision 或唯一性衝突為 409；domain validation 為 400；payload schema 無效為 422。草稿建立、更新或 commit 若帶 `target` 均回 422。409 不會清掉草稿或改動正式資料。既有 flow 使用 PUT 更新；更新忽略客戶端嘗試改寫的 origin 並保留原值。

編輯器 Start from 使用既有 POST create 或草稿 commit：提交來源 definition／configuration 的獨立快照，origin 為直接來源的 flowId 與載入時 revision，不傳來源 id／revision 作為更新目標。第一次 Save 前不建立正式 flow；成功後取得新 ID、revision 1。此操作沿用既有 name＋version 唯一性及新 flow 驗證，不需要新的 API 或 DB schema。

Package converter 的 request、單位、厚度推導、CLI 與 report 見
[Package JSON 轉換為 Process Flow](package-conversion.md)。匯入在同一 SQL 寫入中比對執行所使用的
基準與依賴資源；資源變更回 409，不保存未驗證的 flow。Report 由呼叫端保留，不新增 DB 欄位。

## Preview 與 export

`POST /api/preview-sessions` 及既有 geometry preview／export 端點的 flow context 只接受以下其中一種：

```json
{"flowId":"flow_pnp_golden","target":{"type":"stepOutput","stepRefId":"pnp","outputPortId":"result_geometry"}}
```

Inline 形式為 `{flow: {definition, configuration}, target}`。不接受 flowTemplate、flowInstanceId 或另外分離的 configuration。Input target 使用 `{type: 'flowInput', flowInputId}`；只需該 input 有效。

可選 analyticsContext 為 `{flowId, flowRevision, sourceKind}`，sourceKind 為 flow／inline_draft／geometry。完整 preview/export session、worker 與 queue 行為仍見 [pipeline](../architecture/preview-export-pipeline.md)。

## 退場 API

舊 process-flow-templates、process-flow-instances、兩種 editor draft 路由及 template-instance 聯合建立 API 均移除，不提供轉接層。Bootstrap 不再有 processFlowTemplates 或 processFlowInstances。Step templates、geometry catalog、generator、job 和匯出管理 API 保留。
