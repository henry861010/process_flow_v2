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
last_verified_commit: b5da397ad81f5225e6d7e01128d7cb0e58bd5c94
verified_against:
  - packages/process-step-py/src/process_flow_steps/pnp/adapters.py
  - packages/process-step-py/src/process_flow_steps/pnp/pnp.py
  - packages/kernel-py/tests/test_adaptive_pnp.py
---

# ADR-0008：PnP 同批混合 target shape

> Target coordinate、pose與anchor規則已由
> [ADR-0009](./0009-pnp-absolute-target-coordinates.md)取代；mixed-shape adaptation、metadata、
> child preservation與batch atomicity決策仍有效。

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
4. `box-rescale@1` 對 polygon target要求Box-only source的root至少一個direct feature geometry。
   Root direct `bodies`、`vias`、`circuits`與`bumps`全部轉成`PolygonGeometry`，每個loop在pose與
   rotation前都等於normalized `targetRegion.points`，並各自保留Z、thickness與feature metadata。
5. Descendant containers不參與polygon rescale，也不執行target containment validation；children
   保留原primitive、尺寸與local coordinates，只跟整份placement做相同rigid transform。
6. `box-rescale@1` polygon placement的`bottomLeft`與`center` anchor以root target bounds為準，
   不使用可能突出target的child aggregate bounds；`origin`仍使用local origin。
7. `polygon-rescale@1`、`hbm-package@1`、`dram-package@1`與`rigid@1`既有target-shape行為不變。
   Explicit contract precedence、unknown id/version failure與source immutability也不變。
8. `placements`、API models、TypeScript types與persistence schema不變，不需要資料migration。

## 影響

Box-only source與單一single-loop Polygon footprint現在都能在同一PnP batch中交錯使用
rectangle與polygon target。Box source的所有root feature會共享相同polygon XY footprint；
children可能突出target，但不會改變root-target pose alignment。需要child containment、resizable
child或fixed-core policy時，必須使用HBM／DRAM類型的specialized adapter或新增versioned contract。

## 驗證

Tests MUST覆蓋default與explicit `box-rescale@1`的rectangle/polygon混合batch、exact polygon
points、root body/via/circuit/bump metadata preservation、child primitive preservation、突出child的
root-target anchor與rigid rotation、polygon source混合batch、source immutability、缺少root feature
的明確failure，以及batch atomicity。
