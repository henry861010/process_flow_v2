---
title: Process Flow 文件入口
status: normative
owner: integration.platform
audience:
  - 產品與專案成員
  - 前端與後端開發者
  - process-step 與 geometry 開發者
  - QA 與自動化 agent
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - docs/data-model.md
  - docs/architecture/decisions/
  - docs/conformance.md
---

# Process Flow 文件入口

本目錄是 Process Flow 的正式文件入口。文件描述核准後的 target
behavior；程式碼與測試描述目前實作狀態。兩者尚未一致時，差異必須登錄在
[conformance.md](./conformance.md)，不得在不同文件中各自定義一套規則。

## 權威層級

Target contract 與 current implementation 使用兩條不同的權威鏈：

| 要回答的問題 | 由高至低的權威來源 |
| --- | --- |
| 應該實作什麼？ | Accepted normative ADR → `data-model.md` → domain normative reference |
| 現在實際做什麼？ | Executable tests → source code / fixtures → descriptive architecture / operation 文件 |

[conformance.md](./conformance.md) 負責把兩條權威鏈映射成可追蹤差異。Descriptive 文件若與
tests/code 衝突，以 tests/code 判斷 current behavior，並立刻修正文檔或新增 gap；不得把
stale description 提升成 current authority。

若兩份 normative 文件互相衝突，先停止實作並新增 ADR；不可自行選擇較方便的一份。
`status: proposed`、`historical` 或 `deprecated` 文件不具現行契約效力。

## 建議閱讀路徑

### 第一次了解系統

1. [產品模型](./concepts/product-model.md)
2. [術語表](./concepts/glossary.md)
3. [系統架構](./architecture/system-overview.md)
4. [核心資料模型](./data-model.md)

### UI 開發與重建

1. [UI 文件入口](./ui/README.md)
2. [Design system](./ui/design-system.md)
3. [共用互動模式](./ui/interaction-patterns.md)
4. 對應的 screen 與 component spec
5. [UI acceptance matrix](./ui/acceptance/README.md)

### API 與資料開發

1. [核心資料模型](./data-model.md)
2. [Parameter schema](./reference/parameter-schema.md)
3. [Geometry structure](./reference/geometry-structure.md)
4. [Persistence](./reference/persistence.md)
5. [API README](../apps/api/README.md) 與執行中的 OpenAPI

### Geometry 與 process-step 開發

1. [Geometry 語意](./concepts/geometry-semantics.md)
2. [Process-step authoring](./reference/kernel/process-step-authoring.md)
3. [Kernel runtime API](./reference/kernel/runtime-api.md)
4. [Process-step reference](./reference/process-steps/README.md)

## 文件地圖

| 位置 | 目的 | 契約性 |
| --- | --- | --- |
| `data-model.md` | Process Flow resource、graph、lifecycle 與 compile boundary | Normative |
| `concepts/` | 產品與 geometry 心智模型、術語 | Explanation |
| `architecture/` | 系統邊界、runtime pipeline 與 ADR | Descriptive / Normative ADR |
| `reference/` | Field、schema、kernel 與 process-step reference | Normative 或明確標示 descriptive |
| `ui/` | UI foundations、screens、components 與 acceptance | Normative |
| `operations/` | 安裝、啟動、驗證與部署假設 | How-to |
| `archive/` | 歷史提案與未採用 RFC | Historical / Proposed |

## 文件狀態

| Status | 意義 |
| --- | --- |
| `normative` | 核准的 target contract；新實作必須符合 |
| `descriptive` | 說明目前架構或操作，不另創 business rule |
| `proposed` | 尚未核准或尚未落地，不得作為重建依據 |
| `historical` | 僅供追溯背景，不具現行效力 |
| `deprecated` | 已由其他文件取代，只保留 relocation 資訊 |

## 寫作與維護原則

- 內文使用繁體中文；API、class、field、route 與必要專有名詞保留英文。
- 一個概念只允許一個 normative 定義，其餘文件使用連結，不複製完整 schema。
- 所有 `json` fence 必須是可解析的完整 JSON。跨資源、宣稱可執行的 canonical example
  必須在 heading 標示 `golden example` 並有 executable check；只示意部分欄位時，改用
  `jsonc` / `text` 並明標「節錄」。
- Implementation map 只提供追蹤，不可取代 behavior contract。
- 修改 route、visible copy、default、validation、schema、UI state 或 design token 時，必須同步
  更新對應文件與 acceptance case。
- 文件 metadata 與範本見 [contributing.md](./contributing.md)。

## 驗證

從 repository root 執行：

```bash
venv/bin/python scripts/check_docs.py
venv/bin/python scripts/check_golden_example.py
```

第一項檢查 metadata、Markdown links、repository path references、fenced JSON syntax，
以及 UI reference PNG 的實際格式／檔名尺寸；第二項會從核心資料模型抽出 PnP golden
example，實際通過 Pydantic、graph validator、compiler 與 kernel execution。
