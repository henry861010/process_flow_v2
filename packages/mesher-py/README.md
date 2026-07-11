---
title: process-flow-mesher
status: descriptive
owner: integration.platform
audience:
  - mesher developers
  - backend engineers
  - simulation engineers
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - packages/mesher-py/src/process_flow_mesher
  - packages/mesher-py/src/translater/translater_standard_v1.py
  - packages/mesher-py/src/mesher
---

# process-flow-mesher

將 standard geometry structure 轉成 2.5D hexahedral mesh，並輸出 repository-defined text
CDB format；不宣稱完整支援通用 ANSYS CDB format。

## 安裝

```bash
venv/bin/pip install -e packages/mesher-py
```

Declared runtime dependencies是 NumPy與Matplotlib。`mesher.vision` 另需要未宣告的 optional `pyvista`，只供 developer desktop visualization，不是 API CDB worker path。

## Python API

```python
from process_flow_mesher import build_dragger_from_structure, build_mesh_from_structure

mesh = build_mesh_from_structure(structure, element_size=100)
```

`MeshResult`提供 `nodes`、`elements`、`element_comps`、`comps` 與 count properties。`build_dragger_from_structure`回傳 lower-level mutable `Dragger`；通常應優先使用 `MeshResult`。

Worker interface：

```bash
python -m process_flow_mesher.worker <geometry-structure-json> <element-size> <output-cdb>
```

Success 時 stdout最後一行是 JSON metadata（node/element/component counts）；error寫 stderr並以 non-zero exit。

## 現有限制

- 2.5D：先建立全域 XY checkerboard，再依 Z assignments extrusion。
- `ConeGeometry` 不支援。
- `CylinderGeometry` 只支援單一 distinct circular base face；其他 circle placement會被拒絕。
- Feature density以 deterministic cell selection materialize。
- `direction` 與 `koz` 目前忽略。
- `translater`、`mesher` top-level packages是 current implementation internals，命名保留 historical spelling；consumer應從 `process_flow_mesher` import。

詳細 semantics見 [Geometry Semantics](../../docs/concepts/geometry-semantics.md)，worker/job path見 [Preview and Export Pipeline](../../docs/architecture/preview-export-pipeline.md)。

## 測試

```bash
venv/bin/python -m unittest packages/mesher-py/tests/test_dragger_write.py
```

Current standalone test只覆蓋 valid-row CDB write；新增 primitive/feature support必須補 translator+mesh contract tests。
