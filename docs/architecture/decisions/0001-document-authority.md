---
title: ADR-0001 文件權威與實作差異
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - 所有開發者
  - 文件作者
  - 自動化 agent
last_verified: 2026-07-11
last_verified_commit: b01b1e70
verified_against:
  - docs/README.md
  - docs/conformance.md
---

# ADR-0001：文件權威與實作差異

## 狀態

Accepted。

## 背景

舊文件同時混合 current implementation、target design 與 historical proposal，且多份文件
各自宣稱為正式 contract。這會讓人與 agent 在重建時選到不同規則。

## 決策

1. `status: normative` 文件描述核准的 target behavior。
2. 原始碼、fixtures 與 tests 描述目前 implementation conformance。
3. Target 與 current 不一致時，必須登錄在 [conformance.md](../../conformance.md)。
4. 不得為了讓文件「看起來正確」而隱藏 implementation gap，也不得未經決策就把 bug
   寫成正式 contract。
5. Historical 與 proposed 文件必須移入 `archive/`，並在首頁明示不具現行效力。
6. 文件以繁體中文撰寫，API、code identifiers 與必要專有名詞保留英文。

## 影響

- 文件可以先定義經核准的單一 terminal、`um`、density `0..100` 等 target contract，並清楚
  列出現行程式尚未符合之處。
- 實作修正與文件重整可以分開 review，但 conformance ledger 不可長期無 owner。
- 自動化 agent 必須先讀 `docs/README.md` 與文件 metadata，不得將 archive 當作需求。
