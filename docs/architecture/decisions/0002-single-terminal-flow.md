---
title: ADR-0002：Process Flow 必須有唯一 terminal
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - 架構負責人
  - API、compiler、kernel 與 viewer 開發者
  - QA 與 coding agent
last_verified: 2026-07-11
last_verified_commit: b01b1e70
verified_against:
  - packages/kernel-py/src/process_flow_kernel/application/flow_validation.py
  - packages/kernel-py/src/process_flow_kernel/application/geometry_kernel.py
---

# ADR-0002：Process Flow 必須有唯一 terminal

## 背景

每個 `ProcessStepTemplate` 固定輸出 `result_geometry`，但 payload 沒有獨立
`flowOutputs` collection。既有 validator 可接受：

- empty `stepRefs`；
- 多個彼此未收斂的 branches；
- zero 或 multiple terminal steps。

Kernel execute 未指定 target 時，現行實作從 terminal list選最後一個。該行為使
`stepRefs[]` insertion order成為未記錄、可觀察的 output selection，且不同 agent可能用
不同 traversal/order 重建出不同結果。

Preview 與完整 flow execution 的需求不同：preview需要查看任意 intermediate output；
完整 instance execution需要一個 unambiguous product geometry。

## 決策

Process Flow target contract 採 **single-terminal flow**：

1. Persisted `ProcessFlowTemplate` MUST 至少有一個 `flowInput` 與一個 `stepRef`。
2. Graph MUST acyclic，且每個 required input port剛好有一個 source。
3. 每個 step output最多一個 consumer；flow input MAY fan-out。
4. 所有 step refs MUST 屬於同一個 execution graph，且 MUST 收斂至 exactly one terminal
   step。
5. Terminal step定義為其 `result_geometry` 沒有 outgoing `stepOutput` edge 的 step。
6. 完整 instance execution 的 flow-level geometry MUST 是唯一 terminal step的
   `result_geometry`。
7. `stepRefs[]`、`flowEdges[]` 或 topological tie order MUST NOT 用來選 flow output。
8. Step-output preview MAY 明確 target任意 existing `stepRefId`，compiler只執行其
   upstream closure；這不改變 persisted flow的唯一 terminal。
9. `outputPortId` 目前唯一合法值是 `result_geometry`，request 若提供其他值 MUST reject。

## 驗證位置

- Flow template create MUST reject zero/multiple terminal。
- Atomic template+instance create MUST執行相同 graph validation。
- Workspace create/update MAY assume referenced immutable template已 valid，但 preview/commit
  MUST revalidate stored graph以防 corrupted/imported data。
- Instance create、commit與 execute MUST reject invalid terminal count。
- Viewer readiness與 compiler MUST共用或等價實作同一 terminal algorithm。

## 影響

Positive：

- Execute response 的 `geometryStructure` 意義唯一。
- Agent不需猜 array order、main branch或 UI visual lane。
- Preview仍可選 intermediate step。
- 現有 payload shape不需加入新的 field。

Trade-offs：

- Independent multi-output workflows 必須增加明確 merge/finalization step，或等未來 schema
  提供 `flowOutputs`。
- Flow input fan-out branches 若不收斂將成為 invalid template。
- Existing zero/multi-terminal stored templates 需要一次性修正。

## 評估過的替代方案

### A. 採用最後一個 terminal

Rejected。Result依 array/traversal order，無 domain meaning且難以跨語言一致。

### B. 採用第一個 terminal

Rejected。只是換一個無語義 order convention。

### C. 回傳所有 terminal 的 map

Rejected for default execute。雖然 `stepOutputs` 可提供完整 map，但 flow-level
`geometryStructure`、preview/export default與 downstream consumers仍需 primary output。

### D. 立即加入 `flowOutputs`

Deferred。這是較完整的 future multi-output design，但會擴大目前 payload 與 UI scope。
若採用，必須先建立 ADR 並協調修改 contract、implementation 與 tests，明定 output id、
port reference、requiredness 與 primary selection。

## 現行實作差異

唯一狀態與完整 evidence 見 [DM-001](../../conformance.md)。在產品碼完成對齊前，文件、
fixtures 與新 templates MUST 依本 ADR 建立 single-terminal graph，不得依賴 current 寬鬆
行為。

## 驗證

Contract tests至少應包含：

- zero step rejected；
- zero terminal（cycle）rejected；
- two disconnected terminals rejected；
- fan-out branches converging to one terminal accepted；
- single-step flow accepted；
- intermediate preview只執行 upstream closure；
- full execute永遠選唯一 terminal，與 arrays order無關。
