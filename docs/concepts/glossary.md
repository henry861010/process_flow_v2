---
title: Process Flow 術語表
status: normative
owner: integration.platform
audience:
  - 所有專案成員
  - 自動化 agent
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - docs/data-model.md
  - docs/reference/geometry-structure.md
---

# Process Flow 術語表

本表統一產品與工程文件用語。完整 field 與 invariant 仍以
[data-model.md](../data-model.md) 為準。

| Term | 中文說明 |
| --- | --- |
| `ProcessStepTemplate` | 可重用的單一製程步驟定義，擁有 geometry ports、parameter definitions 與 process program。 |
| `ProcessFlowTemplate` | 可重用的 flow topology snapshot，擁有 flow inputs、step references 與 edges。 |
| `FlowInputDefinition` | Flow 對外宣告的 geometry input interface，不是實際 geometry binding。 |
| `StepRef` | Flow 內一次 process-step template 的使用；同一 template 可以被多次引用。 |
| `FlowEdge` | Geometry dataflow connection，source 是 flow input 或 step output，target 是 step input port。 |
| `FlowConfiguration` | `inputBindings`、`stepConfigurations` 與 `embeddedGeometries` 的共用 configuration shape。 |
| `ProcessFlowWorkspace` | Mutable、可不完整、具 optimistic revision 的研究中 configuration。 |
| `ProcessFlowInstance` | Complete、immutable、只使用 catalog bindings 的產品 configuration snapshot。 |
| `GeometryEntity` | Geometry catalog record；metadata 與完整 `GeometryStructure` 的封裝。 |
| `EmbeddedGeometry` | Workspace 內尚未 materialize 到 catalog 的 geometry record。 |
| `GeometryStructure` | Kernel、CAD、mesher 與 viewer 交換的 geometry tree document。 |
| Catalog binding | `{ "kind": "catalog", "geometryId": "..." }`；指向已保存的 `GeometryEntity`。 |
| Embedded binding | `{ "kind": "embedded", "localId": "..." }`；只在 workspace/draft configuration 中使用。 |
| Primary input | 每個 process step 唯一且 required 的 `main_geometry`。 |
| Auxiliary input | 除 `main_geometry` 外的 typed geometry input，例如 PnP 的 `die_geometry`。 |
| Terminal step | 沒有 outgoing step-output edge 的 step。本 contract 必須恰好有一個 terminal。 |
| Preview closure | 為產生指定 step output 而必須執行的所有 upstream steps 與 inputs。 |
| `ExecutionPlan` | Compiler 產生的 runtime-only、已排序且已解析外部 geometry 的執行計畫。 |
| `program` | `process_flow_steps` package 下不含副檔名的 Python module path。 |
| Resource `version` | Template 或 catalog record 的 opaque metadata label；正式發行前新 resource 固定使用 `current`，不代表 release，也不驅動行為差異。 |
| `schemaVersion` | Payload 或 geometry document 的固定格式標記；不同 domain 不可混用，也不是產品版本。 |
| Workspace `revision` | Optimistic concurrency counter；不是 template business version。 |
| Density | Feature coverage 百分比，target contract 為 `0..100`，含兩端點。 |
| Unit | 所有 geometry coordinates、thickness 與空間參數固定使用 `um`。 |
| `materialRef` | 現行名稱；runtime 實際以 string material key/name 處理，並非 database foreign key。 |
| `workingTemp` | 已棄用且非 requirement 的 legacy parameter；未來將從 fixtures 與 UI 移除。 |
| `templateFamilyId` | 未採用的早期 proposal 概念；現行 data model 不包含此欄位。 |
