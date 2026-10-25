---
title: ADR-0010：Management 編輯 flow step labels
status: historical
decision_status: superseded
owner: integration.platform
audience:
  - API 與 viewer 開發者
  - 產品負責人與 QA
last_verified: 2026-10-11
last_verified_commit: 3c4a81a06e29288e9c911585ba0490da14659f21
verified_against:
  - apps/api/src/process_flow_api/services.py
  - apps/api/tests/test_api.py
  - apps/viewer/components/process-flow-editor/process-flow-editor.tsx
  - apps/api/tests/test_process_flows.py
---

# ADR-0010：Management 編輯 flow step labels

## 背景

Flow template 儲存後，Management 把 step label 視為 locked topology，使用者無法調整顯示
名稱。Label 是 flow-local 的顯示資訊，step identity 與 edges 已使用穩定的 `stepRefId`。

## 決策

1. Management 的既有 Edit 視窗及 `PUT /api/process-flow-templates/{template_id}` MUST 允許
   按 `stepRefId` 更新 `stepLabel`。Step identity、引用、順序、edges、flow inputs 及 version
   保持 locked；不得藉改 label 改變 topology。
2. 明確提供的字串 MUST trim 首尾空白；空白字串或 `null` MUST 儲存為空字串，使用既有
   step-template name fallback。Update 省略 `stepLabel` MUST 保留原值。
3. 同一 step template 的多次引用可獨立改名，並允許重複 label。Process-step template
   本身的 name MUST NOT 改變。
4. 所有共用 flow template 的 instances 重新載入後使用新 label；不新增 label snapshots、
   template version 或 migration。Instance 的配置資料保持 immutable，flow parameter defaults
   的 future-blank-instance-only 規則保持不變。

## 驗證

API 與 frontend tests MUST 覆蓋 flow-local isolation、重複 labels、trim、清空、省略及 locked
topology 保護。`UI-MGMT-005` 驗證 Save、Cancel、儲存失敗保留草稿及重新載入的顯示行為。

## Superseded by unified ProcessFlow

Flow labels remain flow-local; the restricted template update endpoint has been removed. See [ADR-0011](0011-unified-process-flow.md) and [the data contract](../../data-model.md) for full topology updates and recipes.
