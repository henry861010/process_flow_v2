---
title: Process Flow 產品模型
status: descriptive
owner: integration.platform
audience:
  - product engineers
  - process developers
  - software engineers
last_verified: 2026-10-13
last_verified_commit: b01b1e70
source_of_truth:
  - apps/api/src/process_flow_api/models.py
  - apps/api/src/process_flow_api/draft_service.py
  - packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py
---

# Process Flow 產品模型

Process step 定義單站的 ports、parameter schema 與 program；flow template 決定固定 topology。
工程師先 Create instance 作為研發追蹤物件，再逐站新增不可變 recipes 並選擇 active recipe。

| Resource | 用途 | 可變性 |
| --- | --- | --- |
| `ProcessStepTemplate` | 可重用單站定義 | 維持既有受限更新規則 |
| `ProcessFlowTemplate` | Flow inputs、step refs、edges 與 scalar defaults | Identity/version/topology 固定，metadata/defaults 受限更新 |
| `TemplateEditorDraft` | 未完成拓樸、metadata、configuration 與畫布 | Revision-checked，正式儲存成功後刪除 |
| `ProcessFlowInstance` | 固定 template 的研發追蹤 | 共用 geometry 可改、recipe 可追加、active 可切換 |
| `StepRecipe` | 某站的參數快照 | 建立後不可改寫或刪除；變更時複製新增 |
| `GeometryEntity` | Catalog geometry | Immutable snapshot |

Create instance 只要求基本 metadata 與 enabled template；所有站點可先沒有 recipe，bindings
也可留空。新增 recipe 可以未完成；第一組自動 active，之後新增預設不切換。
只要已有 recipes 就必須有 active，只能更換而不能清空；只有空站點允許 active 為 null。
Instance Draft 已移除，Template Draft 保留。

使用時，active recipes 解析成 `FlowConfiguration`；compiler 檢查目標依賴的完整性、geometry
與參數，產生 `ExecutionPlan`。Kernel 只執行 plan，不查 repository。非 active recipe 或
unused branch 的未完成設定不阻擋可執行目標；缺少使用中站點的 active recipe 會明確失敗。

Instance 的 metadata、ID 與 template reference 建立後固定。Revision 是並行更新 token，
不是可還原的歷史版本。Recipe 不包含 geometry，所有 recipes 共用當前 inputBindings。
更換共用 geometry 可能改變後續結果；已建立的 preview/export snapshot 保持當時內容。

完整欄位與 API 見 [資料模型](../data-model.md#9-processflowinstance)。
