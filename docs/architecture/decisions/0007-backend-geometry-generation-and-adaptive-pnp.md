---
title: ADR-0007：後端 Geometry Generator 與 adaptive PnP
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - geometry、process-step、API 與 viewer 開發者
  - 製程與產品負責人
  - QA 與 coding agent
last_verified: 2026-08-31
last_verified_commit: 283d28057aae3d2cde2a6383740f4c2551cb2a6a
verified_against:
  - apps/api/src/process_flow_api/geometry_generation
  - apps/viewer/components/geometry-generator
  - packages/kernel-py/src/process_flow_kernel/application/geometry_artifact.py
  - packages/process-step-py/src/process_flow_steps/pnp
---

# ADR-0007：後端 Geometry Generator 與 adaptive PnP

## 背景

PnP v3 對 source subtree 中所有 `BoxGeometry` 做相同 additive resize。這對單純 SoC/LSI
仍可維持既有行為，但會使 HBM 中尺寸固定的 core dies 變形，也完全排除 polygon VRM。
此外，HBM/DRAM generator 的工程邏輯與 CAD drawing 若同時存在前端與後端，每新增或修改
一種 generator 都必須同步修改兩處。

## 決策

1. Generator 的 parameter definition、default、validation、derived values、geometry build 與
   preview document 全部由後端 registry 擁有。前端不得以 generator id 實作 HBM/DRAM
   engineering branch。
2. 前端只渲染 versioned generic 2D engineering preview document。Preview 可包含多個 view、
   rectangle、polygon、circle、dimension 與 semantic role；它不是 executable geometry。
3. Preview 成功時後端回傳 opaque `previewToken` 與 geometry hash。Materialize 必須使用該
   token，避免使用者看到的 preview 與最後保存的 geometry 來自不同次計算。
4. `GeometryEntity` 與 `EmbeddedGeometry` 增加 entity-level `adaptationContract`：

   ```json
   {
     "adapterId": "hbm-package",
     "adapterVersion": 1,
     "parameters": {}
   }
   ```

   Contract 選擇 resize policy；不得在 PnP 內依 primitive 或前端 UI 猜測工程語意。
5. PnP v4 的每一筆 `placements[]` 必須同時保存 `targetRegion`、`pose` 與 `anchor`。
   `targetRegion` 可為 positive rectangle，或 finite、non-zero-area、non-self-intersecting
   polygon。`pose` 至少包含 X/Y 與 `rotationZ`。
6. PnP v4 對每筆 placement 先呼叫 source contract 對 target region materialize 一份獨立
   geometry，再做 rigid rotation/placement。不得修改 catalog source。
7. Built-in adapter v1 行為：
   - `legacy-box-stretch`：維持 ADR-0006 的全 subtree Box additive resize；只接受 rectangle。
   - `hbm-package`：改變 package/molding footprint，HBM core children 維持原尺寸，且必須能
     完整容納於 target region。
   - `dram-package`：改變 root package footprint，child core geometry 維持原尺寸。
   - `rigid`：不 resize，允許 Box、Polygon、Cylinder 與 Cone，只套用 pose。
8. Explicit contract 優先。舊資料 migration 依 category backfill：`die.hbm*` 使用
   `hbm-package`、`die.dram*` 使用 `dram-package`、`die.vrm*` 使用 `rigid`；其他未標記資料
   （包括 SoC/LSI）使用 `legacy-box-stretch`。
9. PnP v3 與 `coordinates` 保留為 compatibility contract，不在 migration 中改寫既有 flow。
10. GDS 對 PnP v4 匯入 BOUNDARY 時保留 hierarchy transform 後的 exact polygon；axis-aligned
    rectangle 仍 canonicalize 為 rectangle。PnP v3 GDS import 仍輸出 AABB coordinates。

## 影響

增加 generator 只需要後端註冊新 implementation；只要沿用 preview/parameter contract，前端
不需修改。Resize 規則集中在 versioned adapters，geometry structure 不需要在每個 primitive
散佈 `resize: true/false`。同一 PnP step 可在不同位置使用不同 target size；HBM core 不變形，
polygon VRM 可使用 rigid placement。

Adapter id/version 是 persisted compatibility boundary。修改既有 adapter 的 observable behavior
必須增加 version；未知 id/version 必須明確失敗，不得 silent fallback。

## 驗證

Tests MUST 覆蓋 generator catalog/preview/materialize、preview token、v4→v5 無資料遺失 migration、
legacy recursive resize、同一 HBM source 的多尺寸 placement、fixed core fit rejection、rigid polygon、
rotation、unknown adapter、GDS polygon preservation，以及 source immutability。
