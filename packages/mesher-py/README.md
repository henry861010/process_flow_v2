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
---

# process-flow-mesher

將 standard geometry structure 轉成 2.5D hexahedral mesh，並輸出 repository-defined text
CDB format；不宣稱完整支援通用 ANSYS CDB format。

## 安裝

```bash
venv/bin/pip install -e packages/mesher-py
```

若需要 developer desktop visualization：

```bash
venv/bin/pip install -e 'packages/mesher-py[visualization]'
```

Core runtime dependencies 是 NumPy 與 Matplotlib；PyVista 透過 `visualization` extra 安裝，不會被 API CDB worker path 載入。

## Python API

```python
from process_flow_mesher import build_mesh_from_structure

mesh = build_mesh_from_structure(structure, element_size=100)
```

`build_mesh_from_structure` 回傳 `Mesh3D`，提供 `nodes`、`elements`、`element_comps`、`comps` 與 count properties。完成態 3D mesh 在 builder、exporter 與 viewer 之間都以這個 dataclass 傳遞。

Optional visualization API：

```python
from process_flow_mesher.visualization import MeshViewer

viewer = MeshViewer(mesh)
viewer.show()
```

Worker interface：

```bash
python -m process_flow_mesher.worker <geometry-structure-json> <element-size> <output-cdb>
```

Success 時 stdout最後一行是 JSON metadata（node/element/component counts）；error寫 stderr並以 non-zero exit。

## 現有限制

- 2.5D：先建立全域 XY checkerboard，再依 Z assignments extrusion。
- `ConeGeometry` 不支援。
- Feature density以 deterministic cell selection materialize。
- `direction` 與 `koz` 目前忽略。
- Public API 位於 `process_flow_mesher`；meshing、translation、exporter implementation 都收斂在同一 namespace 下。

詳細 semantics見 [Geometry Semantics](../../docs/concepts/geometry-semantics.md)，worker/job path見 [Preview and Export Pipeline](../../docs/architecture/preview-export-pipeline.md)。

## 測試

```bash
venv/bin/python -m unittest discover packages/mesher-py/tests -v
```

測試分為 unit 與 integration；新增 primitive/feature support 必須同時補 translator 與 mesh contract tests。
