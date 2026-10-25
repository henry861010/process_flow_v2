---
title: Process Flow API
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - apps/api/src/process_flow_api/main.py
  - apps/api/src/process_flow_api/models.py
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
| GET | /api/process-flow-drafts | 全域草稿摘要，可依 user 篩選 |
| POST | /api/process-flow-drafts | schemaVersion 2、user、name、state、可選 target/origin；201 |
| GET | /api/process-flow-drafts/{draft_id} | 完整草稿 |
| PUT | /api/process-flow-drafts/{draft_id} | 完整草稿輸入加 revision |
| DELETE | /api/process-flow-drafts/{draft_id}?revision=N | CAS 刪除；204 |
| POST | /api/process-flow-drafts/{draft_id}/commit | {revision, flow: ProcessFlowCreate, target?: {flowId, revision}} |

不存在為 404；revision 或唯一性衝突為 409；domain validation 為 400；payload schema 無效為 422。409 不會清掉草稿或改動正式資料。另存走 create，送出完整內容與直接來源 origin；更新忽略客戶端嘗試改寫的 origin 並保留原值。

## Preview 與 export

`POST /api/preview-sessions` 及既有 geometry preview／export 端點的 flow context 只接受以下其中一種：

```json
{"flowId":"flow_pnp_golden","target":{"type":"stepOutput","stepRefId":"pnp","outputPortId":"result_geometry"}}
```

Inline 形式為 `{flow: {definition, configuration}, target}`。不接受 flowTemplate、flowInstanceId 或另外分離的 configuration。Input target 使用 `{type: 'flowInput', flowInputId}`；只需該 input 有效。

可選 analyticsContext 為 `{flowId, flowRevision, sourceKind}`，sourceKind 為 flow／inline_draft／geometry。完整 preview/export session、worker 與 queue 行為仍見 [pipeline](../architecture/preview-export-pipeline.md)。

## 退場 API

舊 process-flow-templates、process-flow-instances、兩種 editor draft 路由及 template-instance 聯合建立 API 均移除，不提供轉接層。Bootstrap 不再有 processFlowTemplates 或 processFlowInstances。Step templates、geometry catalog、generator、job 和匯出管理 API 保留。
