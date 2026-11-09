---
title: Process Step 開發指南
status: descriptive
owner: integration.platform
audience:
  - process-step authors
  - backend engineers
last_verified: 2026-11-09
last_verified_commit: 3ca3d46f
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

## 執行快取契約

內建製程宣告 `EXECUTION_CACHE_VERSION = 1`。這表示 `execute(context)` 的輸出及 warnings
只依賴 context，且沒有外部副作用。變更 execution 語意時必須遞增版本；不可讀取時間、未固定種子的
亂數、環境設定、資料庫或網路，亦不可依賴跨 request 的可變 module 狀態。
未宣告版本的 module 仍可執行，但該步驟及其相依下游不使用 execution cache。

共用製程 helper 的語意改變時，須同步遞增所有使用它的 module 版本；kernel 的 snapshot、材料分配
或 provenance 語意改變時，須調整 `application.step_cache.KERNEL_CACHE_VERSION`。

命中時 `execute()` 不會被呼叫，故不能將必要的外部寫入或 logging side effect 放在可快取 module 中。
使用 `context.warn()` 發出與結果相關的警告；cache 保存本步驟 warnings，由 kernel 重建 lineage。
`GeometryArtifact.runtime_snapshot is None` 表示外部 JSON 沒有 runtime cursor/footprint，不可僅憑
geometry top 假定它與 runtime snapshot 相同。需要可變 state 時使用 `artifact.fork_state()`；
需要可修改的 JSON 時使用 `artifact.geometry()`；`artifact.structure/provenance` 為深層唯讀。

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

EXECUTION_CACHE_VERSION = 1


def execute(context: ProcessStepContext) -> ProcessGeometryState:
    material = context.require_string("material")
    thickness = context.require_positive_number("thickness")
    context.state.deposit_layer(material=material, thickness=thickness)
    return context.state
```

Module 可以 mutate 並 return `context.state`；`deposit_*`/`initialize_*` 等 method 可能回傳 handle，而不是 state，不可直接把 handle 當 step output。Module return `None` 時 kernel 使用 fallback state。為了清楚與 type checking，建議明確 return `ProcessGeometryState`。

目標式塗佈可使用 `state.coat_targets(target_key="cow", material=material, thickness=thickness,
key="tim")`；它使用每個 matching scope 的原始外接矩形與最高 Z，回傳 handles list。
TIM1／TIM2 modules 固定選取 `cow`／`lid`，不用 temporary cursor 或 process footprint 來切換目標。
需要明確轉換 assembly role 時使用 `set_scope_key`；Saw 在裁切成功後標記 `cow`。

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

## Schematic descriptor 與 presenter companions

Step 的 geometry execution 與 schematic 描述分開註冊。`execute(context)` 繼續只操作實體 geometry；
`process_flow_steps.schematic_layout` 的 `SchematicDescriptorRegistry` 提供全流程預讀使用的
`describe_schematic(context: SchematicDescriptorContext) -> SchematicDelta`。

Descriptor context 提供由 `FlowCompiler.normalize_step_parameters` 正規化後的唯讀 `parameter_values`
（包括 RDL repeatable-group，不是原始 recipe wire 格式）、各 port 的 `SceneState`、`main`、`source(port)`、
`local_id(key)` 與 `physical_ref(key)`。Descriptor 只宣告結構，不呼叫 execute、materialize、geometry
boolean operations，亦不計算全域 X、實際 placement 數或未來精確 Z。新增程序需要註冊 descriptor；
未註冊時只停止該路徑的 layout lookahead，不猜測它是 preserve。

主要契約與使用方式：

| 契約 | Step 的責任 |
| --- | --- |
| `SchematicObject`／`SceneObject` | 宣告物件 identity、role、parent、source reference、symbol、色彩角色及 anchors；`member`／`span`／`distributed`／`boundary` 選擇空間需求 |
| `LayoutRegion`／`SceneRegion` | 用穩定 ID 指出承載面或局部排版範圍；新增覆蓋層可產生新的 symbolic cursor region |
| `SceneRelation` | 指出附著／連接端點、包含區域、排除對象、填充、包圍或覆蓋；不傳任意 layout callback |
| `SchematicDelta` | 宣告 create、完整 object update、remove、reparent，以及 region／relation 的 add、update、remove；`apply_delta` 負責驗證與套用 |
| `SceneDerivation` | 記錄來源、目標 logical object ID 與 input port；clone/crop/transform 保留跨步來源對應 |
| `clone_scene` | 以 step namespace 宣告一份 auxiliary source 子樹，保留原始 physical refs 並新增 derivations |

一次 PnP 的多個實際 placement 只需一份抽象 source 描述，來源 class 與 PnP step 共同決定 cohort。
分開的 PnP step 即使放同一 class 仍有各自 cohort。HBM 等 `structural` composite 保留內部堆疊；
需要在複合組裝內重新排列子物件時使用 `arranged` nesting 與局部 regions。
代表顆數由 schematic kernel 的角色策略決定：`wafer-dmy` 左右各一個，其餘內建角色（包括 LSI）各一個。

可選 `active_ports` selector 讓 registry 在解析 auxiliary geometry 前決定此 recipe 的語意依賴。
例如空的 PnP placements 不需要讀取 die source；selector 同樣只讀參數，不執行幾何。
Saw／grind 等無法僅由抽象結構確認存活物件的 operation 保守保留 reservation，由所選實際 snapshot
決定可見性與量測。不要在 descriptor 另寫一套裁切或磨薄模擬。

Geometry kernel 的 execution provenance 記錄來源 port/node identity 與建立 operation/ordinal。
同一步建立於不同既有 scopes 的物件，snapshot binding 優先依 parent scope 對應 logical owner，
讓多批 placement cohorts 的 coating 各自保持來源；同 owner 的多個新物件才沿用 creation ordinal。
自訂幾何 copy／replace operation 必須維持這份來源資料；透過 `GeometryArtifact.with_structure`
改寫 node IDs 時提供 `node_id_remap`。資料應保存在 execution sidecar，不塞入輸出的 geometry JSON，
也不能依新物件在 children 陣列的位置重建來源。

### 當步局部圖樣

製程專屬圖樣放在同一 step 套件的獨立 companion module，例如 RDL 的
`process_flow_steps.layer.rdl_schematic`。它提供
`present_schematic(context: SchematicContext) -> list[SchematicPart]`；`execute` 與 kernel
不 import companion。`process-flow-schematic` 擁有共用排版與代表策略，不依製程名稱選擇圖樣。

Presenter 讀取最終 snapshot 的唯讀節點與實際 Z 範圍，回傳局部圖形與語意提示；不重新執行 recipe、
不保存 step 當下的圖形、不修改 geometry。後續 grind／flip／debond 的結果直接由最終結構反映。
以 semantic body role 或 feature kind 註冊至 `process_flow_steps.schematic_presenters`，
API composition root 組合 step 與 generator registries。新增註冊或改變圖樣語意時更新 API 的
presentation registry version；自訂 body key 必須先擴充正式 vocabulary，不能以 material 名稱分派。

Presenter tests 覆蓋形狀、零 density、後續 geometry 改變與 input immutability；descriptor tests 另外驗證
不可變輸入、合法 SceneDelta、穩定 identity／來源 lineage、region／relation 及未知後段的停止行為。
一般 step tests 仍驗證 geometry operation。Generator 宣告內部堆疊與元件角色，不決定代表顆數。
完整依賴與 document 契約見 [ADR-0012](../../architecture/decisions/0012-process-owned-schematic-preview.md)。

## 新增 process step

1. 在 `packages/process-step-py/src/process_flow_steps/<category>/` 新增 module。
2. 實作單一 `execute(context)`；geometry manipulation 只使用 kernel public API。
3. 建立或更新 `ProcessStepTemplate` fixture；ports、parameter definitions 與 program 必須與 module assumptions 一致。
4. 在 [process-steps/README.md](../process-steps/README.md) 登錄 operation purpose 與重要 side effects。
5. 新增 kernel execution test，至少涵蓋 valid path、invalid parameter、auxiliary port（若有）與 serialize round trip。
6. 加入 schematic descriptor；有專屬局部圖樣時再加入 presenter，並新增 descriptor／preview regression tests。
7. 執行 kernel/API/schematic tests；確認 template module 可被 resolver import，execution 不依賴 schematic 套件。

## Review checklist

- Operation 是否需要專用 method，而不是直接修改 `Container`/raw JSON？
- Cursor、process footprint 與 scope 在 operation 前後是否明確？
- Density、direction、`koz` 與 units 是否保存？
- Parameter name 是否與 fixture 完全一致？
- Output 是否仍可由 `normalize_geometry_structure` hydrate？
- Descriptor 是否只宣告語意，沒有重算未來 geometry 或分配全域座標？
- Clone／replace／crop 後的 provenance、logical identity 與 cohort 是否保持正確對應？
- 新來源或缺失描述是否保留前段可用 preview，並以明確 notes／warnings 說明限制？
- Consumer limitations 是否已更新在 geometry semantics 或 exporter reference？

## 未決 future considerations（非 contract）

Typed step registry、declared module capabilities 與 automatic operation catalog generation
尚未有 accepted ADR，不是 authoring prerequisite 或 target contract。採用前必須另立 ADR；
歷史方向見
[Geometry Kernel target API RFC 封存](../../archive/rfcs/geometry-kernel-target-api.md)。
