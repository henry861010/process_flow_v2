---
title: 文件撰寫與審查規範
status: normative
owner: integration.platform
audience:
  - 文件作者
  - Reviewer
  - 自動化 agent
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - docs/README.md
  - scripts/check_docs.py
---

# 文件撰寫與審查規範

## 必要 metadata

每份正式文件開頭必須包含：

```yaml
---
title: 文件標題
status: normative
owner: integration.platform
audience:
  - 主要讀者
last_verified: 2026-07-11
last_verified_commit: <commit>
source_of_truth:
  - path/to/source
verified_against:
  - path/to/current/implementation
---
```

`source_of_truth` 表示上位 normative contract，或 descriptive 文件的 current authority；
`verified_against` 表示用來核對 current implementation 的 code/tests，可能尚未 conform，
不會因此取得 target authority。Accepted ADR 本身就是決策根，可省略 `source_of_truth`，但
應列 `verified_against`。Relocation stub 與 archive 也可省略 `source_of_truth`。

ADR 另加 `decision_status: proposed | accepted | superseded`。Front matter 的 `status` 表示
文件契約性，`decision_status` 表示決策生命週期，兩者不得混用。

## Normative 文件模板

1. Purpose 與 non-goals。
2. Terminology。
3. Contract 或 field matrix。
4. Invariants 與 error behavior。
5. Valid example 與 invalid example。
6. Conformance evidence。
7. Known deviations，或連到 [conformance.md](./conformance.md)。

使用「必須」、「不得」、「應該」、「可以」時，句子必須能對應 validator、test、acceptance
case 或已登錄的 implementation gap。

## UI 畫面文件模板

1. Route、persona、purpose、non-goals。
2. Canonical source files 與資料依賴。
3. Region tree 與精確 layout。
4. Field matrix。
5. State matrix。
6. Action matrix。
7. Responsive、keyboard、focus 與 ARIA。
8. Canonical fixtures。
9. Reference screenshots。
10. Acceptance case ids。

## 範例規則

- `json` fence 必須是合法 JSON，不可包含註解或省略號。
- 不完整 payload 使用 `jsonc` 或 `text` fence，並在前一行標示「節錄」。Field-level 的
  完整小型 object 可使用 `json`；只有宣稱跨資源 canonical／可執行的範例才需要
  `golden example` heading 與 executable check。
- 完整 payload 的所有 identifier 必須前後一致。
- Process-flow golden example 必須包含所有 required ports、bindings 與 parameters。
- UI 文件不得複製大型 fixture；以 fixture id 與檔案路徑引用。

## Review checklist

- 是否誤把目前 implementation deviation 寫成 normative contract？
- 是否在其他文件重複定義既有 schema？
- 是否更新 `last_verified` 與 `last_verified_commit`？
- 新增或移動檔案後，所有 link 與 implementation path 是否有效？
- 可執行範例是否通過 validation？
- UI 變更是否同步更新 screenshot 與 acceptance case？
- Historical / proposed 文件是否清楚隔離？
