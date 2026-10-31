---
title: Process Step 開發指南
status: descriptive
owner: integration.platform
audience:
  - process-step authors
  - backend engineers
last_verified: 2026-10-31
last_verified_commit: 039906db
source_of_truth:
  - packages/kernel-py/src/process_flow_kernel/application/context.py
  - packages/kernel-py/src/process_flow_kernel/infrastructure/module_resolver.py
  - packages/process-step-py/src/process_flow_steps
  - apps/api/src/process_flow_api/fixtures/process-step-templates.json
---

# Process Step 開發指南

Process step 由 persisted `ProcessStepTemplate` contract 與一個 Python module 共同構成。Template 決定 ports/parameters；module 只實作 geometry operation。

## Resolution 契約

`ProcessStepTemplate.program` 是 `process_flow_steps` 下的 extensionless relative path。例如 `layer/molding` 會解析為 `process_flow_steps.layer.molding`。

Path segment 只接受英數、underscore、hyphen；absolute path、`..`、空 segment 與 `.py`/`.js` extension 會被拒絕。Hyphen 在 import 時轉成 underscore。Resolved module 必須 expose callable `execute(context)`。

目前是 runtime dynamic import；沒有 registration file、entry point discovery 或 sandbox。Step template 只可 reference 已安裝在 API Python environment 的 module。

## 必要 template 結構

Current kernel contract要求：

- exactly one primary geometry input，id 必須是 `main_geometry` 且 required；
- zero or more auxiliary geometry inputs；
- exactly one geometry output，id 必須是 `result_geometry`；
- ports 的 `dataType` 目前只支援 `geometry`；
- parameter ids unique；`geometryRef` 不是 parameter type。

完整 JSON 欄位與 value type 見 [data-model.md](../../data-model.md)。

## `ProcessStepContext`

Module 可使用：

| Member | Meaning |
| --- | --- |
| `state` | `main_geometry` 的 cloned `ProcessGeometryState`；沒有 geometry 時為 empty state |
| `values` | Compiler validated/normalized、material instance 已改寫的 values |
| `raw_parameter_values` | 原始 configuration values |
| `step_ref` / `step_template` / `step_configuration` | Current execution metadata |
| `geometry_inputs` | Serialized geometry inputs |
| `input_geometry` | Main input serialized structure，若無 main 則 first input |
| `get_param` / `require_*` | String、finite number、positive、non-negative、density helpers |
| `get_geometry` / `require_geometry` | 以 port id 取得 cloned `ProcessGeometryState` |

Process modules應優先用 `require_*` 表達 operation-specific precondition，不要直接讀 repository 或 API model。

## 最小 module

```python
from process_flow_kernel import ProcessGeometryState, ProcessStepContext


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    material = context.require_string("material")
    thickness = context.require_positive_number("thickness")
    context.state.deposit_layer(material=material, thickness=thickness)
    return context.state
```

Module 可以 mutate 並 return `context.state`；`deposit_*`/`initialize_*` 等 method 可能回傳 handle，而不是 state，不可直接把 handle 當 step output。Module return `None` 時 kernel 使用 fallback state。為了清楚與 type checking，建議明確 return `ProcessGeometryState`。

## Auxiliary geometry

Auxiliary input 必須透過 declared port 取得：

```python
component = context.require_geometry("die_geometry")
context.state.place_geometry_state(component, x=10, y=20)
return context.state
```

Kernel 會 clone upstream output，再交給 downstream step；module 不應假設自己可修改其他 branch 的 state。

## Material 規則

Kernel 在 module 執行前：

1. Strip external primary geometry 的 terminal `_dup<number>` suffix。
2. 計算 current primary geometry material usage。
3. 為 auxiliary geometry 與 `materialRef` values 配置 step-local instance names。
4. 清除 rewritten feature ids，讓 normalization 依新 payload 重新產生。

Module 使用收到的 material string，不自行 append `_dup<number>`。

## Schematic presenter companion

製程專屬圖樣放在同一 step 套件的獨立 companion module，例如 RDL 的
`process_flow_steps.layer.rdl_schematic`。它提供
`present_schematic(context: SchematicContext) -> list[SchematicPart]`；`execute` 與 kernel
不 import companion。`process-flow-schematic` 只提供共用契約、圖形與 composer，不收納製程規則。

Presenter 讀取最終 snapshot 的唯讀節點與實際 Z 範圍，回傳一般圖形與排列提示；不重新執行 recipe、
不保存 step 當下的圖形、不修改 geometry。後續 grind／flip／debond 的結果直接由最終結構反映。
以 semantic body role 或 feature kind 註冊至 `process_flow_steps.schematic_presenters`，
API composition root 組合 step 與 generator registries。新增註冊或改變圖樣語意時更新 API 的
presentation registry version；自訂 body key 必須先擴充正式 vocabulary，不能以 material 名稱分派。

Presenter tests 覆蓋形狀、零 density、後續 geometry 改變與 input immutability；一般 step tests
仍只驗證 geometry operation。Generator 的內部堆疊與代表顆數由 generator presenter 擁有。
完整依賴與 document 契約見 [ADR-0012](../../architecture/decisions/0012-process-owned-schematic-preview.md)。

## 新增 process step

1. 在 `packages/process-step-py/src/process_flow_steps/<category>/` 新增 module。
2. 實作單一 `execute(context)`；geometry manipulation 只使用 kernel public API。
3. 建立或更新 `ProcessStepTemplate` fixture；ports、parameter definitions 與 program 必須與 module assumptions 一致。
4. 在 [process-steps/README.md](../process-steps/README.md) 登錄 operation purpose 與重要 side effects。
5. 新增 kernel execution test，至少涵蓋 valid path、invalid parameter、auxiliary port（若有）與 serialize round trip。
6. 執行 kernel/API tests；確認 template module 可被 resolver import。

## Review checklist

- Operation 是否需要專用 method，而不是直接修改 `Container`/raw JSON？
- Cursor、process footprint 與 scope 在 operation 前後是否明確？
- Density、direction、`koz` 與 units 是否保存？
- Parameter name 是否與 fixture 完全一致？
- Output 是否仍可由 `normalize_geometry_structure` hydrate？
- Consumer limitations 是否已更新在 geometry semantics 或 exporter reference？

## 未決 future considerations（非 contract）

Typed step registry、declared module capabilities 與 automatic operation catalog generation
尚未有 accepted ADR，不是 authoring prerequisite 或 target contract。採用前必須另立 ADR；
歷史方向見
[Geometry Kernel target API RFC 封存](../../archive/rfcs/geometry-kernel-target-api.md)。
