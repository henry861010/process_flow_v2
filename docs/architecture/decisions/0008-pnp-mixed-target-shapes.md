---
title: ADR-0008：PnP 同批混合 target shape
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - geometry、process-step、API 與 viewer 開發者
  - 製程與產品負責人
  - QA 與 coding agent
last_verified: 2026-09-01
last_verified_commit: 80002c4ec18d4fd7d5dbc6491e3223e58c8254f1
verified_against:
  - packages/process-step-py/src/process_flow_steps/pnp/adapters.py
  - packages/process-step-py/src/process_flow_steps/pnp/pnp.py
  - packages/kernel-py/tests/test_adaptive_pnp.py
---

# ADR-0008：PnP 同批混合 target shape

## 背景

[ADR-0007](./0007-backend-geometry-generation-and-adaptive-pnp.md) 將 rectangle 與 polygon
納入同一份 placement data contract，但 `box-rescale@1` 只接受 rectangle target。結果是同一個
Box source 的 `placements[]` 無法同時 materialize rectangle 與 polygon，儘管每筆 placement
已獨立保存自己的 `targetRegion.type`。

`adaptationContract` 描述 source geometry 的 adaptation policy，不應成為整批 placements 的
target-shape selector。Target shape 必須由每筆 placement 各自決定，同一批不得因第一筆 shape
而固定後續 materialization 行為。

## 決策

1. `adaptationContract` 維持 source-level single contract；不在 placement 新增 adapter 欄位，
   也不改為依 target type 儲存 adapter map。
2. PnP 必須依 array order逐筆 normalize、materialize rectangle或polygon target，完整 batch
   成功後才 attach；任何一筆失敗時不得產生 partial result。
3. `box-rescale@1` 對 rectangle target 維持既有行為：Box-only subtree的每個 primitive使用
   相同 additive XY delta，並保留各自 lower-left。
4. `box-rescale@1` 對 polygon target只接受整棵 source tree恰好一個`BoxGeometry`。該 primitive
   轉成`PolygonGeometry`，loop在pose與rotation前必須等於normalized `targetRegion.points`，
   並保留Z、thickness與所屬feature/container metadata。
5. 多個Box primitives的generic source遇到polygon target必須明確失敗，要求呼叫端提供
   specialized adaptation contract；runtime不得猜測envelope，也不得將所有internal primitives
   改成同一polygon。
6. `polygon-rescale@1`、`hbm-package@1`、`dram-package@1`與`rigid@1`既有target-shape行為不變。
   Explicit contract precedence、unknown id/version failure與source immutability也不變。
7. `placements`、API models、TypeScript types與persistence schema不變，不需要資料migration。

## 影響

單一Box footprint與單一single-loop Polygon footprint現在都能在同一PnP batch中交錯使用
rectangle與polygon target。多-primitive generic shape deformation仍未定義；需要resizable
envelope或fixed-core policy時，必須使用HBM／DRAM類型的specialized adapter或新增versioned
contract。

## 驗證

Tests MUST覆蓋default與explicit `box-rescale@1`的rectangle/polygon混合batch、exact polygon
points、child order、Z/thickness與metadata preservation、polygon source混合batch、source
immutability，以及multi-Box polygon rejection的batch atomicity。
