---
title: process-flow-kernel
status: descriptive
owner: integration.platform
audience:
  - Python consumers
  - kernel maintainers
  - process-step authors
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - packages/kernel-py/src/process_flow_kernel
---

# process-flow-kernel

Pure-Python geometry domain、flow compiler 與 execution runtime。Package 不讀 SQLite、不發 HTTP，也不依賴 CadQuery。

## 安裝

```bash
venv/bin/pip install -e packages/kernel-py
```

Python 3.11+；目前沒有 third-party runtime dependencies。

## 主要 entry point

- `ProcessGeometryState`：process-oriented geometry operations。
- `FlowCompiler`：graph/configuration validation、resource resolution、`ExecutionPlan` build。
- `GeometryKernel`：ordered process-module execution。
- `ProcessStepContext`：step module runtime contract。
- Geometry/serialization helpers：normalization、hydration、stable ids、polygon classification。

Current API map 見 [Runtime API](../../docs/reference/kernel/runtime-api.md)，implementation
boundaries 見 [Internals](../../docs/reference/kernel/internals.md)。`__init__.py` export surface
目前是 internal API，正式發行前仍可協調調整。

## Dependency contract

Caller為 `FlowCompiler` 提供 `GeometryCatalogResolver`；kernel不持有 repository。Default module resolver 在 execute time import `process_flow_steps.<program>`，因此要執行 real steps 需另安裝 `process-flow-steps`。

## 測試

```bash
venv/bin/python -m unittest packages/kernel-py/tests/test_kernel.py
```

新增 domain collection/primitive時，至少更新 clone、move、flip、clip、hydrate、serialize 與 consumer tests。
