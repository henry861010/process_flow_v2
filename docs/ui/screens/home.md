---
title: Home / Process Flow
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - apps/viewer/app/page.tsx
---

# Home / Process Flow

Route: `/`。Bootstrap 的 processFlows 以單一列表顯示；所有 flows 都可開啟編輯，不依 status 或 template/product 分類。

每個 card 顯示 name、version、owner 和 revision，連至 `/flow-editor?flowId=<id>`。Create Flow 開啟空編輯器。既有 geometry generator、Geometry、Management、Dashboard 入口保留。Loading、Retry、空列表與 responsive card grid 沿用既有視覺。

右側常駐全域 [Export Jobs](../components/export-jobs.md) 入口，初次載入收合。顯示目前browser的全部
進行中工作及最近20筆終態紀錄；切換至Flow Editor或其他頁面持續更新。點清單外部自動收回，原點擊操作仍生效。

驗收：cards 與 counts 符合 processFlows；鍵盤可開啟；Create Flow 進入空畫布；390px 無整頁橫向捲動；API 錯誤仍保留建立 geometry 入口；直接進入Home與跨頁切換都只有一份Export Jobs清單。
