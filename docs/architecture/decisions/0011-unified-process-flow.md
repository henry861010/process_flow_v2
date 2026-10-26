---
title: ADR-0011 Unified ProcessFlow
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - docs/data-model.md
  - apps/api/src/process_flow_api/models.py
---

# ADR-0011: Unified ProcessFlow

## Decision

採用 schema 3 ProcessFlow，自有 definition 與 configuration；不再以 template 引用承載 instance。每站保存獨立 recipeCandidates 與 selectedRecipeId。FlowDraft 統一為 schema 2；embedded geometry binding 移除。

正式 flow 要求合法拓樸但允許設定未完成。新增站點 snapshot step defaults；讀取／保存／執行不補 defaults。Recipe 查看和採用分開；selectedRecipeId=null 時不得自動回退。

Flow 支援 CAS 更新；revision 為並行控制，version 為標籤，既有 origin 為歷史來源識別。來源不成為 runtime 依賴。編輯器不提供複製與另存，draft 限於尚未正式建立的 flow。此版不加入 lifecycle、分類、flow status 或歷史還原。

SQLite 8–13 轉為 schema 16 時保留正式資料與新 flow 草稿；14→16 使用一致性備份與單一交易，刪除指向既有 flow 的草稿。舊格式只在 migration 讀取。未知版本／schema 15 拒絕。完整契約見 [資料模型](../../data-model.md)、[API](../../reference/process-flow-api.md) 和 [Persistence](../../reference/persistence.md)。

## Consequences

流程變形不需要新 template 類型；既有 flow 的修改只更新原 flow。需要比較或回復來源歷史時須另立功能。StepTemplate 仍是共用定義，其既有管理範圍不因 flow 自有結構而改變。

本決策取代 ADR-0010 中受限 flow-template update 與 label 跨 instance 傳播的設計；flow-local label 語義保留。
