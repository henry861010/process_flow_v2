---
title: Geometry semantic keys
status: normative
owner: integration.platform
audience:
  - geometry producers
  - process-step authors
  - kernel、CAD、viewer 與 API 開發者
last_verified: 2026-08-26
last_verified_commit: 754a4e03
source_of_truth:
  - docs/reference/geometry-structure.md
verified_against:
  - packages/kernel-py/src/process_flow_kernel/domain/semantic_keys.py
---

# Geometry semantic keys

`Container.key` 與 `Body.key` 是 optional industry semantic tags，不是 identity、display
name、material、version 或任意 producer label。唯一 structure-local identity 使用 `id`。
Via、Circuit 與 Bump 不支援 `key`。

GeometryEntity 的 `entityType` 繼續描述外部形態（例如 `panel`、`wafer`、`die`）；組合後的產業
功能與 process interaction role 由 Container／Body key 表達。

Key 不存在表示 producer 未指定 semantic tag。Producer MUST omit 未指定的 `key`；`null` 與空字串
不是合法替代值。相同 key MAY 在同一 structure 中重複。

## Container vocabulary

合法值只有：

- `carrier`
- `carrier.panel`
- `carrier.wafer`
- `hbm`
- `dram`
- `soc`
- `soic`
- `lsi`
- `cpo`

`carrier` family query MAY 匹配 `carrier`、`carrier.panel` 與 `carrier.wafer`；process
operation 預設仍使用 exact matching。未登記的 display label、尺寸、產品世代與 sibling sequence
MUST NOT 放入 key。

## Body vocabulary

合法值只有：

- `carrier`：製程中的 carrier solid。
- `envelope`：代表所屬 Container／Entity 整體外形或幾何近似的 Body。
- `molding`：molding process 建立的實體。
- `daf`：DAF process step 建立的 DAF 實體。

`envelope` 在本版仍是一般 material-owning physical Body；CAD、mesh 與 section consumer 不得
只因 key 是 `envelope` 就忽略、改變 priority 或改變 materialization。未來 operation 可以明確以
它選擇 footprint 或 placement target，但必須自行驗證所需 cardinality。

## Producer rules

- Catalog fixture、DB import 與 generator MAY 明確提供 container/body key。
- HBM 與 DRAM generator 只標記 root container 為 `hbm`／`dram`；內部 containers 與 bodies
  不提供 key。
- Molding、DAF、Carrier Bond 與 Debond 使用 `molding`、`daf`、`carrier` body roles。
- Copy、PnP、move、flip、grind 與 saw MUST 保留既有 key，不得從 material、geometry、位置或
  id 自動推論。
- 新增 vocabulary 必須同步本文件、kernel validation、fixtures/producers 與 contract tests。
