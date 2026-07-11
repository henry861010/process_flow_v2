---
title: Geometry Kernel target API RFC 封存
status: historical
owner: integration.platform
audience:
  - kernel 維護者
  - 架構負責人
last_verified: 2026-07-11
last_verified_commit: b01b1e70
---

# Geometry Kernel target API RFC 封存

> Non-normative archive：本頁保存早期 Geometry Kernel 文件中帶有 target/aspirational
> 性質的 API 方向。Current callable surface 見
> [runtime-api.md](../../reference/kernel/runtime-api.md)，current internals 見
> [internals.md](../../reference/kernel/internals.md)。

## 歷史目標

舊設計希望 kernel 同時具備：

- process-oriented façade，而不是讓 step 直接組 raw geometry JSON；
- deterministic serialization、stable ids 與 clone-safe tree ownership；
- shared geometry semantics across viewer、CAD、mesh 與 future FEM preprocessing；
- typed compile/execute boundary，不讓 kernel 查 repository；
- 足以涵蓋 initialize、deposit、feature、transform、removal、placement、scope inspection 的 cohesive API。

這些原則多數已反映在 current implementation，但「API 已穩定」、「所有 consumer semantics 相同」與「machine-readable schema 完整 enforce」仍不成立。

## 歷史 target surface

早期 RFC 將 `ProcessGeometryState` 規劃為主要 authoring object，分為：

1. Lifecycle：create、restore、serialize、clone。
2. Cursor/bounds：read/set/advance cursor 與 geometry bounds。
3. Process footprint：box/cylinder/polygon footprint 與 derive strategy。
4. Initialization/deposit：generic 與 primitive-specific helpers。
5. Features：via、circuit、bump，保存 density、direction、`koz`。
6. Transform/removal：move、flip、grind、saw、remove top bodies。
7. Placement：place one/many、carrier bond。
8. Scope/query：root ref、find、summary、inspect。

Current code 已實作大部分名稱，但 signature 與 corner-case behavior 應以 runtime reference/code 為準。

## 未實作或未完成的 target

- 明確的 kernel public API stability policy。
- Dedicated exception hierarchy。
- Machine-readable geometry schema used by every consumer。
- CAD/CDB/overlay 對 feature density、direction、`koz` 的一致 materialization。
- Explicit step capability metadata、typed registry 與 safe module isolation。
- First-class lineage/provenance across compiled plans and outputs。
- Performance/scale contract for large geometry trees and meshes。

## 判讀規則

Archive 中的 target 不得直接用來重建或驗收 current product。若要採納任一 target，先建立 ADR/issue、更新 product code/tests，再把 verified behavior 寫入 current docs。
