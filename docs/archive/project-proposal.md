---
title: Process Flow 共通語言 PoC 早期計畫書
status: historical
owner: integration.platform
audience:
  - 歷史文件讀者
  - 產品負責人
last_verified: 2026-07-11
last_verified_commit: b01b1e70
---

# Process Flow 共通語言 PoC 早期計畫書

> Historical record：本文件保存早期 proposal 的問題陳述與方向，不是現行 product、
> schema 或 UI contract。`geometryRef`、`templateFamilyId` 等概念未必存在於現行實作。

## 專案摘要

原始 PoC 目標是建立以 process flow 為核心的共通描述語言，讓 simulation team 以
station-level 描述封裝製程狀態，並讓 integration team 對輸入、輸出、參數與 geometry
reference 建立一致理解。

早期範圍不追求自動模擬真實製程或直接產出 FEM-ready geometry，而是先建立可追溯的
process-state workflow。

## 背景

以 final package geometry 作為唯一建模入口，容易在產品與製程尚未定案時造成
simulation、integration、module teams 對同一結構的不同解讀。早期 proposal 因此主張用
一連串 process stations 表達 geometry state 如何形成。

## 原始解法方向

- Process flow template 描述封裝技術平台的標準流程。
- TV/Product 由 template 建立 instance，再填入 product-specific geometry references 與
  station values。
- Common station definitions 應跨技術重用，以降低命名與欄位語意漂移。
- Template 建立後視為 immutable snapshot。

原 proposal 曾建議以 `templateFamilyId` 串接 template snapshots；現行資料模型沒有此欄位，
strict API model 也會拒絕它。

## 原始使用情境

1. 新封裝技術由既有 station library 組合 flow，不足時共同定義新 station。
2. 既有技術的新 TV/Product 重用 template，只提供 product-specific values。

## 原始成功指標

- 工程師可快速由 template 建立 product flow skeleton。
- 任一 station 可查 input/output geometry、port mapping 與 parameter values。
- 不同技術可重用語意一致的 common station。
- Saved instance 可追溯當時引用的 flow 與 step definition snapshots。
- 完成至少一條 representative flow 與兩個 product instances 的 end-to-end demo。

## 現行替代文件

Current product ownership 與 lifecycle 見 [product-model.md](../concepts/product-model.md)，
canonical fields/invariants 見 [data-model.md](../data-model.md)。
