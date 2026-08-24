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

將 standard geometry structure 轉成 2.5D mixed hexahedral／wedge-like mesh，並輸出
repository-defined text CDB format；不宣稱完整支援通用 ANSYS CDB format。

## 安裝

先 checkout 外部 `mesher` repository 包含 `extend_circular_mesh` 的 `main`，並以
editable local path 安裝：

```bash
venv/bin/pip install -e /absolute/path/to/mesher
```

不可使用沒有 local path 的 `pip install mesher`；PyPI 上的同名 distribution 是另一個
project。完成外部 dependency 安裝後，再安裝本 package：

```bash
venv/bin/pip install -e packages/mesher-py
```

若需要 developer desktop visualization：

```bash
venv/bin/pip install -e 'packages/mesher-py[visualization]'
```

Core runtime dependencies 是外部 `mesher`、NumPy 與 Matplotlib；目前 mesher 的
distribution metadata 仍是 `0.1.0`，但舊 tag 不包含所需 extension API，因此必須使用上述
local `main` checkout。PyVista 透過 `visualization` extra 安裝，不會被 API CDB worker
path 載入。

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

- 2.5D：先建立全域 XY rectilinear mesh；一般 circle 使用 imprint。若 circular base 的
  最外層同心 circles 之間沒有 BOX/POLYGON boundary，則從最後一個需要 imprint 的 circle
  向外逐層 extension，再依 Z assignments extrusion。Circle imprint bands 相交、相切或
  底層 topology 無法重建時會整體失敗。
- 2D circle band 可能包含 padded Tri3；extrusion 以固定八欄、重複節點的 wedge-like
  connectivity 表示對應 3D solid。
- `ConeGeometry` 不支援。
- Feature density以 deterministic cell selection materialize。
- `direction` 與 `koz` 目前忽略。
- Public API 位於 `process_flow_mesher`；meshing、translation、exporter implementation 都收斂在同一 namespace 下。

詳細 semantics見 [Geometry Semantics](../../docs/concepts/geometry-semantics.md)，worker/job path見 [Preview and Export Pipeline](../../docs/architecture/preview-export-pipeline.md)。

## 測試

```bash
venv/bin/python -m unittest discover -s /absolute/path/to/mesher/tests -v
venv/bin/python -m unittest discover packages/mesher-py/tests -v
```

測試分為 unit 與 integration；新增 primitive/feature support 必須同時補 translator 與 mesh contract tests。
