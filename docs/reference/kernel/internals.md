---
title: Geometry Kernel 內部架構
status: descriptive
owner: integration.platform
audience:
  - kernel maintainers
  - backend engineers
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - packages/kernel-py/src/process_flow_kernel/application
  - packages/kernel-py/src/process_flow_kernel/domain
  - packages/kernel-py/src/process_flow_kernel/infrastructure
  - packages/kernel-py/src/process_flow_kernel/serialization
---

# Geometry Kernel 內部架構

Kernel 採用 domain/application/infrastructure/serialization 分層。這是 code organization，不是 network service boundary。

## 分層

| Layer | Responsibility |
| --- | --- |
| `domain` | Geometry primitives、features、container tree、`ProcessGeometryState` operations |
| `application` | Graph validation、configuration normalization、resource-to-plan compilation、plan execution、material instance preparation |
| `infrastructure` | 將 template `program` 解析為 Python module |
| `serialization` | Structure normalization、stable ids、hydrate/serialize bridge |
| `utils` | Polygon classification/validation 與 math helpers |

Kernel 不 import FastAPI、SQLite 或 API Pydantic models。

## Graph 分析

`analyze_flow_graph` 建立 id maps、incoming-edge map、topological order 與 terminal ids。Validation enforce：

- unique flow input、step ref、edge、port 與 parameter ids；
- referenced template/port 存在且 data type 相符；
- required input port exactly one incoming edge；
- no multiple incoming edges、self edge、cycle；
- every declared flow input connected；
- current step output fan-out limit 是 one consumer。

Topological queue 初始順序來自 `stepRefs` insertion order；只有 dependency order 是 contract，independent nodes 的 relative order不應被 consumer 當成 semantic guarantee。

## Compiler

`FlowCompiler` 先 analyze graph，再依 draft/complete mode normalize values。Complete compile 會 resolve resources，檢查 geometry constraints，並把每個 input route 轉成 `PlannedGeometryInput`。

Preview output 指定時，compiler 計算 upstream step closure，只要求該 closure 使用到的 bindings/parameters。External structure 在 plan 建立前 normalize，因此 kernel execution 不需 id resolution。

## 執行流程

Kernel 依 plan order：

1. Resolve external structure 或已完成 step output。
2. Clone/hydrate runtime geometry inputs。
3. 準備 material instance names。
4. Resolve process module。
5. 建立 `ProcessStepContext`。
6. 呼叫 `execute(context)`，normalize returned/fallback state。

Upstream `ProcessGeometryState` 在下游取得時 clone，避免一個 consumer mutation 回寫已保存 output。Current graph雖禁止 output fan-out，clone boundary仍是重要 invariant。

## Material instance 準備

Runtime 會 strip terminal `_dup<number>`、計算 primary state 中每個 base material 的最大 instance index，然後對本 step 新 material 配置 next name。Auxiliary geometry 與 nested `fieldGroupArray` 中的 `materialRef` 也會重寫。

這個流程發生在 module 執行前，但 `raw_parameter_values` 仍保留原始 configuration。

## Hydration 與 serialization

`normalize_geometry_structure` deep-copy input，補 schema/unit/container collections，並為缺少 id 的 container/features建立 SHA-1 based deterministic ids。Hydration 建立 parent pointers 與 scope cache；serialization輸出 plain JSON，不保存 Python parent reference。

Clone 必須重建 parent/cache，不共享 mutable geometry objects。若新增 domain collection，需同步更新 clone、move、flip、clip、serialize、hydrate 與 traversal tests。

## Geometry operation

Domain geometry classes負責 primitive-level move/clip/flip/copy。`Container` 負責 subtree traversal。`ProcessGeometryState` 提供 process-oriented facade、cursor、footprint 與 scope resolution。

Process module不應直接依賴 `Container` internal arrays；否則 cursor/footprint/cache invariant 可能失效。

## 已知內部限制

- Exception types/messages 尚未形成 versioned public hierarchy。
- Module resolution 是 in-process dynamic import，沒有 isolation。
- `process_flow_kernel.__init__` export surface 偏大；「exported」不等於 long-term stable。
- Geometry schema validation 分散在 hydration/domain/consumer，尚無單一 machine-readable schema gate。

過去 aspirational API 設計已移至 [geometry-kernel-target-api.md](../../archive/rfcs/geometry-kernel-target-api.md)，不得用它判斷 current behavior。
