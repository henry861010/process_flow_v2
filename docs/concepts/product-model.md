---
title: 產品模型
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - docs/data-model.md
---

# 產品模型

一個 ProcessFlow 同時保存製程順序與各站設定。研發人員可以先儲存合法拓樸，再逐步補齊 geometry 與 recipes；如果接線還沒完成，保存 FlowDraft。

每站可以有多個候選 recipe，但同時最多採用一組。查看或編輯其他候選不改變採用。預覽和執行只使用採用方案；未採用方案可以尚未完成。

既有 flow 可以直接更新，也可以另存新 flow。另存複製完整拓樸、bindings、候選與選擇，記錄直接來源 ID/revision；之後互不連動。來源記錄不提供歷史還原。

| 物件 | 用途 |
| --- | --- |
| ProcessStepTemplate | 重用單站 ports、參數定義、program；保留啟停管理 |
| ProcessFlow | 自有 definition 和 configuration，正式拓樸必須有效 |
| FlowDraft | 暫存未完成拓樸、設定與畫布 |
| GeometryEntity | Catalog 中可引用的幾何 |

此版不定義 template/product 分類或 development lifecycle，也沒有 flow 啟停與發布鎖定。`version` 是標籤，`revision` 用來阻止覆寫別人的更新。完整契約見 [資料模型](../data-model.md)。
