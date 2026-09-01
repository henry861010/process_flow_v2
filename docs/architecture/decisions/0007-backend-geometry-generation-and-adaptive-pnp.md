---
title: ADR-0007：後端 Geometry Generator 與 unified PnP
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - geometry、process-step、API 與 viewer 開發者
  - 製程與產品負責人
  - QA 與 coding agent
last_verified: 2026-08-31
last_verified_commit: 79a37fb7651eb2e0b1e2b46152ee0af28766fa43
verified_against:
  - apps/api/src/process_flow_api/geometry_generation
  - apps/viewer/components/geometry-generator
  - packages/kernel-py/src/process_flow_kernel/application/geometry_artifact.py
  - packages/process-step-py/src/process_flow_steps/pnp
---

# ADR-0007：後端 Geometry Generator 與 unified PnP

> `box-rescale@1` 的 polygon-target extension 與同批 mixed-shape policy 由
> [ADR-0008](./0008-pnp-mixed-target-shapes.md) 補充。
>
> Placement coordinate與hidden transform contract已由
> [ADR-0009](./0009-pnp-absolute-target-coordinates.md)取代；adapter selection與geometry
> generation決策仍有效。

## 背景

PnP 原本只接受 rectangle coordinates，且只會對 BoxGeometry subtree 做 additive resize。
未來 VRM 使用 PolygonGeometry；target shape、pose、rotation 與 anchor 也必須在同一筆資料中
被完整保存。舊 PnP 尚未正式發行，因此本次直接替換，不保留 dual runtime contract。

## 決策

1. Generator 的 parameter definition、validation、geometry build與engineering preview由後端
   registry擁有；前端只渲染versioned generic preview document。
2. `GeometryEntity`與`EmbeddedGeometry`可明確保存versioned `adaptationContract`。Explicit
   contract永遠優先，未知id/version必須失敗。
3. 唯一 PnP program locator是`pnp/pnp`，唯一parameter是`placements`；`coordinates`、
   `coordinateList`與`pnp/pnp_v2`不存在於current contract。
4. 每筆placement必須包含：
   - rectangle或simple polygon `targetRegion`；
   - finite `pose.x/y/rotationZ`；
   - `bottomLeft`、`center`或`origin` anchor。
5. Target region使用local XY。Materialize後以selected anchor為pivot旋轉，再將anchor平移至
   pose，Z bottom對齊main cursorZ。Array order是execution與serialized child order。
6. Missing adaptation contract由runtime依primitive選擇：
   - non-empty、BoxGeometry-only subtree使用`box-rescale@1`；
   - exactly one、single-loop PolygonGeometry使用`polygon-rescale@1`；
   - mixed、empty、multiple-loop、Cylinder或Cone要求explicit contract。
7. Built-in contracts：
   - `box-rescale@1`：rectangle target對Box-only subtree套用相同additive XY delta；polygon
     target依ADR-0008替換所有root direct Box features並保留children；
   - `polygon-rescale@1`：以target polygon或rectangle四角直接替換唯一polygon loop，保留
     Z、thickness與feature/container metadata；
   - `hbm-package@1`、`dram-package@1`：只改變package envelope，fixed children必須能容納；
   - `rigid@1`：explicit-only，不rescale，只套pose。
8. HBM／DRAM generator與seed geometry必須明確保存specialized contract；repository不得依
   category backfill missing contract。
9. PnP先materialize完整placement batch，再attach任何child；任一筆失敗不得產生partial result。
10. GDS import保留完整hierarchy transform。Axis-aligned rectangle canonicalize為rectangle；
    其他BOUNDARY保存exact polygon，再拆成local points與bottom-left pose。
11. Database schema v6是destructive boundary。任何較舊marker或無marker資料會清空並重新seed；
    未知或未來marker明確失敗。

## 影響

Box、HBM、DRAM與polygon VRM共用同一placement contract。Polygon deformation v1刻意只支援
單一outer loop，不定義holes、multi-body mapping或general mesh warp；需要此類語意時必須增加
新的versioned adapter，而非擴張`polygon-rescale@1`既有observable behavior。

## 驗證

Tests MUST覆蓋rectangle/polygon validation、primitive inference、explicit precedence、exact
polygon replacement、anchor-pivot rotation、HBM/DRAM fixed-child policy、source immutability、
batch atomicity、GDS exact shape與v6 destructive reset。
