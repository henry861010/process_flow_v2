---
title: ADR-0009：PnP absolute target coordinates
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - geometry、process-step、API 與 viewer 開發者
  - 製程與產品負責人
  - QA 與 coding agent
last_verified: 2026-09-01
last_verified_commit: ece354a54acd18929fd9337a5398c42a3de39eba
verified_against:
  - packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py
  - packages/process-step-py/src/process_flow_steps/pnp/pnp.py
  - apps/viewer/components/process-flow-fields/placement-list-control.tsx
  - packages/kernel-py/tests/test_adaptive_pnp.py
---

# ADR-0009：PnP absolute target coordinates

## 背景

舊PnP placement要求使用者同時理解local target、pose、rotation與anchor。實際編輯需求是直接以
global XY描述die target，額外transform不應成為UI或payload中的自由度。

## 決策

1. Rectangle target保存finite `bottomLeftX/Y`與`topRightX/Y` absolute coordinates，且每一軸
   top-right必須大於bottom-left。Polygon `points`同樣使用global absolute XY，既有simple-polygon
   validation不變。
2. `pose`與`anchor`為required compatibility fields，但固定為
   `{"x": 0, "y": 0, "rotationZ": 0}`與`"center"`；compiler與runtime都拒絕其他值。
3. Runtime由absolute bounds計算target center。Rectangle以width/height、polygon以subtract
   bounds lower-left的方式進入既有adapter-local frame；adapt完成後以center anchor rebase，再放回
   absolute target center。Descendant geometry因此保留原relative rigid translation。
4. Viewer只呈現absolute rectangle corners或polygon points；pose、rotation與anchor不顯示。
   Rectangle/polygon互轉與GDS import不得localize coordinates。
5. PnP template維持`step_tpl_pnp_4_0_0`／`V4.0.0`。Database schema marker升為7並清除舊
   placement資料後由canonical fixtures重建，不提供舊contract migration。

## 驗證

Compiler與runtime tests MUST覆蓋合法absolute rectangle/polygon、反向或空bounds、legacy
`width/height` rejection、fixed hidden transform、negative coordinates、mixed target batch、所有
built-in adapters、source immutability、metadata preservation與batch atomicity。Viewer production
build MUST驗證absolute editor與GDS import的TypeScript contract。
