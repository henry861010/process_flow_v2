---
title: ADR-0003：Geometry unit 固定為 um，density 使用 0..100
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - 架構負責人
  - geometry-kernel、process-step、CAD、mesher 與 viewer 開發者
  - QA 與 coding agent
last_verified: 2026-07-11
last_verified_commit: b01b1e70
verified_against:
  - packages/kernel-py/src/process_flow_kernel/serialization
  - packages/kernel-py/src/process_flow_kernel/domain
  - apps/viewer
---

# ADR-0003：Geometry unit 固定為 um，density 使用 0..100

## 背景

GeometryStructure有 `unitSystem`，ParameterDefinition另有自由字串 `unit`。現行 compiler
不比較 primary/auxiliary geometries的 unit，也不做 conversion；若 main geometry與 die
geometry使用不同 units，PnP coordinates與 geometry bounds會被直接混用。

Density目前同時出現兩種解讀：

- process-step contracts與 validators接受 inclusive `0..100`；
- fixtures常使用 `0.36`、`0.58` 等值；
- viewer目前把 `<=1` 當 normalized fraction、`>1` 才除以 100。

因此相同 persisted value `0.58` 可被解讀為 `0.58%` 或 `58%`，無法 deterministic
rebuild、render或 mesh。

## 決策

### Geometry unit

1. Canonical GeometryStructure `unitSystem` MUST 明確為 `"um"`。
2. 所有 coordinates、radius、thickness、Z values與 `koz` MUST使用 micrometres。
3. Length ParameterDefinition SHOULD明確保存 `unit: "um"`；compiler不做 implicit
   conversion。
4. Compiler MUST reject used catalog/embedded geometry whose unit is not `um`。
5. Primary、auxiliary與 upstream outputs因 canonical policy必然使用相同 unit。
6. Imported authoring payload 省略 `unitSystem` 時，normalizer MAY 為 authoring convenience
   補 `um`；normalized output/persistence MUST明確保存。
7. Future支援其他 units時，必須以新 ADR定義 explicit conversion boundary、rounding與
   output unit；不得只放寬 string enum。

Temperature 等 non-geometry units（例如 `degC`）屬於 ParameterDefinition metadata，不改變
GeometryStructure unitSystem。Legacy `workingTemp` id 已棄用；新溫度 parameter 必須使用
語意明確的 domain-specific id。

### Density

1. Via、Circuit、Bump `density` MUST是 inclusive `0..100` finite percentage。
2. `0` 表示 0% effective density，`100` 表示 100%。
3. Persisted、compiler、kernel與 exported GeometryStructure MUST保存 percentage value，
   不自動轉成 fraction。
4. Viewer/CAD/mesher consumer需要 normalized fraction時 MUST計算 `density / 100` exactly
   once，然後 clamp/validate `0..1` only as consumer-local representation。
5. Values outside `0..100`、NaN、Infinity MUST reject，不得 silently clamp。
6. `0.58` 在本 contract中明確表示 `0.58%`，不是 `58%`。
7. Producers若意圖表示 58% MUST保存 `58`。

## 影響

Positive：

- 所有 flow inputs可直接組合，無 hidden scale conversion。
- Coordinates parameter與 GeometryStructure使用同一 length unit。
- Density在 persistence、runtime、viewer、CAD與mesh之間意義唯一。
- Schema/fixtures可用簡單 range tests驗證。

Trade-offs：

- Existing `0..1` fixtures 若原意是 fraction，必須一次性乘 100；不能靠 heuristic 猜。
- Import 其他 unit 的 geometry 必須在進入 catalog 前 explicit convert。
- `unitSystem` 欄位目前雖固定，仍保留作為 structure self-description 與 explicit validation。

## 評估過的替代方案

### A. Density 固定為 0..1

Rejected for current target，因現有 process validators 與文字 contracts 已採 `0..100`。
若要改用另一種 representation，必須先建立 ADR 並同步修改所有 producers/consumers；不得
同時接受兩種 representation。

### B. Hybrid heuristic（`<=1` 視為 fraction、`>1` 視為 percentage）

Rejected。`0.58` 本質 ambiguous，round-trip後無法知道 producer intent。

### C. 支援任意 geometry unit，但不轉換

Rejected。跨 input operations會得到數值正確但物理錯誤的 geometry。

### D. Compiler 自動轉換

Deferred。Conversion 需要完整 primitive、parameter、precision 與 output policy；目前先採單一
canonical unit。

## 現行實作差異

唯一狀態與完整 evidence 見 [DM-002 與 DM-003](../../conformance.md)。Existing fixtures 中
`0.36`、`0.42`、`0.58` 等 values 仍需 domain owner 確認原意；不得以 hybrid heuristic
自動猜測。

## 既有資料修正要求

1. Inventory all persisted/fixture feature density與parameter density values。
2. Domain owner 明確判定 existing `0..1` values 的原意，禁止 heuristic bulk correction。
3. Convert intended fractions to percentage values。
4. Make compiler/hydrator reject unit != `um` and density outside `0..100`。
5. Make viewer/mesher normalize exactly once。
6. Add contract tests across API → compiler → kernel → viewer/export consumers。

## 驗證

Tests至少應證明：

- `unitSystem: "um"` accepted；`mm`/missing canonical output rejected or normalized only at
  documented import boundary；
- mixed-unit main/auxiliary flow rejected before execution；
- density `0`、`55`、`100` accepted；negative、`>100`、non-finite rejected；
- density `55` renders/materializes as fraction `0.55`；
- density `0.55` renders/materializes as `0.0055` under target contract；
- no producer/consumer applies conversion twice。
