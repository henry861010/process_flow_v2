---
title: process-flow-steps
status: descriptive
owner: integration.platform
audience:
  - process-step authors
  - process developers
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - packages/process-step-py/src/process_flow_steps
  - apps/api/src/process_flow_api/fixtures/process-step-templates.json
---

# process-flow-steps

Concrete Python process operation modules。每個 module expose `execute(ProcessStepContext)`，由 kernel依 `ProcessStepTemplate.program` dynamic import。

## 安裝

```bash
venv/bin/pip install -e packages/kernel-py -e packages/process-step-py
```

Package runtime dependency只有 `process-flow-kernel`。

## 契約

Module path `process_flow_steps.layer.molding` 對應 template program `layer/molding`。Module只操作 kernel state，不讀 API、SQLite 或 fixture files。Ports與parameters由 persisted template定義，不由 Python signature 自動 discover。

Authoring workflow 見 [Process Step Authoring Guide](../../docs/reference/kernel/process-step-authoring.md)，current modules/behavior 見 [Process Step Catalog](../../docs/reference/process-steps/README.md)。

## 驗證

Current real-step integration tests 位於 `packages/kernel-py/tests/test_kernel.py`。新增 module需增加 execution/invalid-input/serialization coverage，並確認 fixture template可被 resolver import。
