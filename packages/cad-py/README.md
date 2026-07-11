---
title: process-flow-cad
status: descriptive
owner: integration.platform
audience:
  - CAD developers
  - backend engineers
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - packages/cad-py/src/process_flow_cad/exporter.py
  - packages/cad-py/src/process_flow_cad/worker.py
---

# process-flow-cad

CadQuery/OCP adapter，將 standard geometry structure轉成 GLB 或 STEP AP242 bytes。API以 short-lived subprocess使用此 package，隔離 native CAD memory lifecycle。

## 安裝

```bash
venv/bin/pip install -e packages/kernel-py -e packages/cad-py
```

Dependencies：CadQuery 2.5+（<3）與 `process-flow-kernel`。

## Python API

```python
from process_flow_cad import convert_cad_bodies, export_cad_bytes

glb = export_cad_bytes(structure, format="glb")
step = export_cad_bytes(structure, format="step")
```

Worker interface：

```bash
python -m process_flow_cad.worker <glb|step> <input-json> <output-file>
```

## 現行語意

- 支援 Box、Polygon（odd-even holes）、Cylinder、Cone。
- GLB保留 Process Flow Z-up coordinates，只輸出 body solids。
- STEP使用 structure `unitSystem`，並包含 feature envelope solids。
- Descendant solids從ancestor solids扣除。
- Same-container、same-material overlapping siblings union；cross-material overlap raise `CadExportError`。
- Density/`koz` 不會改變 STEP feature envelope solid；它們只反映在 label/metadata semantics。

Cross-consumer差異見 [Geometry Semantics](../../docs/concepts/geometry-semantics.md)。

## 測試

```bash
venv/bin/python -m unittest apps/api/tests/test_cad_exporter.py
```

Tests目前放在 API suite，但直接驗證 package export behavior。
