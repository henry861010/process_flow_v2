---
title: Geometry Generator Framework
status: normative
owner: Process Flow UI
last_verified: 2026-07-13
last_verified_commit: b838db68cf0ec0ed
audience:
  - frontend
  - API
  - QA
  - generator developers
source_of_truth:
  - apps/viewer/components/geometry-generator/geometry-generator-registry.tsx
  - apps/viewer/components/geometry-generator/geometry-generator-types.ts
  - apps/viewer/components/geometry-generator/geometry-generator-save-dialog.tsx
---

# Geometry Generator Framework

所有geometry generators透過單一registry對Home與Flow Template Editor公開。Flow editor不得以
generator id寫HBM/DRAM條件分支；新增generator只需提供registry adapter、parameter editor與
geometry builder。

每個adapter負責generator id、label/icon、default parameters、validation、structure builder、
download filename與geometry envelope defaults。共用層負責modal lifecycle、catalog metadata
save UI、兩種action mode與Define result contract：

| Mode | Actions | Persistence |
| --- | --- | --- |
| `catalog` | Generate JSON、Save to DB | Save明確建立immutable GeometryEntity。 |
| `flowInput` | Define | 只回傳EmbeddedGeometry；呼叫端建立binding，不寫DB。 |

Define result必須包含suggested flow input name、完整EmbeddedGeometry與`generation` metadata。
重新編輯時呼叫端只在resolved geometry的generator id與選擇的adapter一致時傳入saved
parameters；adapter仍須validate輸入，malformed或unsupported parameter payload回退defaults。

Catalog geometry immutable。即使參數來自catalog record，Define也必須產生新的embedded draft，
不得更新原record。後續instance save由通用materialization transaction負責建立新catalog
snapshot。
