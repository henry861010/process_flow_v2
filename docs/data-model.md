---
title: Process Flow 資料模型
status: normative
owner: integration.platform
audience:
  - Process Flow 維護者
  - API、kernel 與 viewer 開發者
  - QA 與 coding agent
last_verified: 2026-07-11
last_verified_commit: b01b1e70
source_of_truth:
  - docs/architecture/decisions/0002-single-terminal-flow.md
  - docs/architecture/decisions/0003-geometry-units-and-density.md
verified_against:
  - apps/api/src/process_flow_api/models.py
  - apps/api/src/process_flow_api/repository.py
  - apps/api/src/process_flow_api/workspace_service.py
  - packages/kernel-py/src/process_flow_kernel/application
---

# Process Flow 資料模型

本文件是 Process Flow 的頂層 normative data contract，定義 persistence、API、compiler、
kernel 與 viewer 共用的 resource、reference、lifecycle 與 validation 語義。各 domain 的
詳細規則委派給本文件連結的 normative reference，不在多處重複定義。

若說明文件、fixture 或現行程式碼與本文件衝突，以本文件定義的 target contract 為準；
尚未對齊的行為列在[已知實作差異](#15-已知實作差異)。

本文使用下列規範詞：

- **MUST / MUST NOT**：符合本 contract 的實作必須遵守。
- **SHOULD / SHOULD NOT**：除非有記錄明確理由，否則應遵守。
- **MAY**：可選行為。

## 1. 如何閱讀本文件

第一次接觸 Process Flow 時，先閱讀[五分鐘理解資料模型](#2-五分鐘理解資料模型)，再依工作
內容進入對應章節；不需要依序讀完整份文件。

| 想回答的問題 | 建議閱讀 |
| --- | --- |
| 系統有哪些主要資料物件？ | [五分鐘理解資料模型](#2-五分鐘理解資料模型) |
| Step 能接收什麼、執行什麼？ | [`ProcessStepTemplate`](#5-processsteptemplate) |
| Flow 如何連接多個 Step？ | [`ProcessFlowTemplate`](#6-processflowtemplate) |
| Geometry 與 parameter values 存在哪裡？ | [`FlowConfiguration`](#7-共用-flowconfiguration) |
| 草稿如何保存、更新及 commit？ | [`ProcessFlowWorkspace`](#8-processflowworkspace) 與 [commit transaction](#12-workspace-commit-transaction) |
| 什麼操作會執行哪些驗證？ | [驗證時機](#11-驗證時機) |
| 查 identifier、default、`null` 或版本標記 | [共用欄位與格式規則](#10-共用欄位與格式規則) |
| 查看完整可執行 payload | [PnP golden example](#14-可完整執行的-pnp-golden-example) |

名詞不熟悉時先查[術語表](./concepts/glossary.md)；若只需要產品層級說明，閱讀
[產品模型](./concepts/product-model.md)。

詳細子規範：

- [Parameter Schema](./reference/parameter-schema.md)
- [Geometry Entity and Structure](./reference/geometry-structure.md)
- [Persistence](./reference/persistence.md)
- [ADR-0002：Single-terminal Flow](./architecture/decisions/0002-single-terminal-flow.md)
- [ADR-0003：Geometry Units and Density](./architecture/decisions/0003-geometry-units-and-density.md)

### 1.1 範圍與非目標

本文件只定義目前採用的資料模型，不定義舊草案的轉換路徑。未採用與已棄用欄位集中列在
[Legacy 與禁止欄位](#105-legacy-與禁止欄位)。

本文件不定義：

- 個別 process program 的幾何演算法；
- CAD、STEP、GLB 或 CDB 格式；
- UI layout、visual token 或 interaction；
- material catalog。`materialRef` 是 opaque material key，不表示系統已存在
  material database。

## 2. 五分鐘理解資料模型

實際使用時，製程工程師會選用 PnP、molding、RDL 與 C4 等 `ProcessStepTemplate` 建立
`ProcessFlowTemplate`；這份 flow template 代表一項封裝技術的完整製程拓撲，例如 CoWoS-L 的
flow inputs、steps 與 geometry routing，但不包含特定產品的 geometry 或製程參數。當同一項
技術套用到 HBM4 Alpha、HBM4 Beta 等不同產品時，工程師會在 `ProcessFlowWorkspace` 中
選擇 panel 種類或 HBM 種類，並分別設定 placement coordinates、molding thickness、RDL
layers 等 step parameters。設定完整並 commit 後，系統建立 immutable
`ProcessFlowInstance`，保存該產品可重現、可執行的完整製程設定。

| Resource | 主要用途 | 半導體封裝範例 | 可變性 |
| --- | --- | --- | --- |
| `ProcessStepTemplate` | 定義可重用的單一製程步驟，包括 geometry ports、parameter definitions 與執行程式。 | PnP step 宣告 panel primary input、HBM auxiliary input 與 `coordinates` parameter。 | Immutable snapshot |
| `ProcessFlowTemplate` | 定義一項封裝技術的完整 topology，包括 flow inputs、step references 與 edges。 | CoWoS-L flow 將 PnP、molding、RDL 與 C4 依製程順序連接。 | Immutable snapshot |
| `ProcessFlowWorkspace` | 保存特定產品仍在調整中的 `FlowConfiguration`。 | HBM4 Alpha 開發過程中調整 geometry bindings、placement coordinates、材料與厚度。 | 只有 `draft` 可修改 |
| `ProcessFlowInstance` | 保存已完成並通過完整驗證的產品製程設定。 | HBM4 Alpha Build 的完整 geometry bindings 與各 step parameter values。 | Immutable snapshot |
| `GeometryEntity` | 保存可被 flow input 引用的 catalog geometry snapshot。 | `panel_v1_0_0` panel 與 `hbm_v1_3_1` HBM die。 | Immutable snapshot |

```mermaid
flowchart LR
  StepTemplate["ProcessStepTemplate<br/>定義單一步驟"] --> FlowTemplate["ProcessFlowTemplate<br/>組成可重用流程"]
  FlowTemplate --> Workspace["ProcessFlowWorkspace<br/>可修改的研究草稿"]
  Catalog["Geometry catalog"] --> Workspace
  Workspace -->|"atomic commit"| Instance["ProcessFlowInstance<br/>不可修改的完整設定"]
  FlowTemplate --> Instance
  Catalog --> Instance
```

Geometry 與 parameter values 使用不同路徑：

- Geometry 經由 flow inputs、typed ports、`flowEdges` 與 `inputBindings` 傳遞。
- Parameter definitions 位於 `ProcessStepTemplate`；實際 parameter values 位於
  `stepConfigurations`。
- Compiler 將 template、configuration 與 catalog resources 解析成 `ExecutionPlan`。
- Kernel 只執行 `ExecutionPlan`，不查 repository 或 database id。

### 2.1 本文使用的 PnP 範例

後續章節都以同一個 PnP flow 說明欄位之間的關係：panel 是 primary geometry，die 是
auxiliary geometry，`coordinates` 則是 PnP 的 parameter value。

```mermaid
flowchart LR
  Panel["incoming_panel<br/>catalog: panel_v1_0_0"] --> Main["pnp.main_geometry"]
  Die["incoming_die<br/>catalog: hbm_v1_3_1"] --> Aux["pnp.die_geometry"]
  Main --> PnP["pnp<br/>coordinates: [[-760,-520],[760,-520]]"]
  Aux --> PnP
  PnP --> Result["pnp.result_geometry<br/>唯一 terminal output"]
```

這個例子的三份完整 JSON 位於 [PnP golden example](#14-可完整執行的-pnp-golden-example)，
並由 repository script 實際通過 schema、graph、compiler 與 kernel 驗證。

## 3. 核心設計原則

1. Geometry dataflow 與 process parameter values MUST 分開保存與傳遞。
2. `ProcessFlowTemplate` 定義 topology；`ProcessFlowWorkspace` 保存可修改的研究設定；
   `ProcessFlowInstance` 保存完整且不可修改的產品設定。
3. Geometry 只經由 typed ports 與 `inputBindings` 傳遞，不屬於 parameter value union。
4. Template、instance 與 catalog geometry 都是 immutable snapshots。Immutable 表示不得
   in-place update；是否允許 delete 由 persistence policy 另行規定。
5. Compiler 負責解析跨 resource references、驗證 graph 與 configuration，並建立
   `ExecutionPlan`；kernel 不查 repository。
6. Resource reference MUST 使用穩定的 persisted id。空字串、id prefix 或 sentinel value
   MUST NOT 表示 source type；union MUST 使用明確 discriminator。
7. 每個合法 flow MUST 有且只能有一個 terminal step。
8. Canonical geometry unit MUST 是 `um`；feature density MUST 落在包含端點的 `0..100`。

## 4. Resource 關係與 ownership

```mermaid
flowchart TB
  StepTemplate["ProcessStepTemplate"] -->|"StepRef 引用"| FlowTemplate["ProcessFlowTemplate"]
  FlowTemplate -->|"定義 flowInputId 與 stepRefId"| Configuration["FlowConfiguration"]
  Configuration --> Workspace["ProcessFlowWorkspace"]
  Configuration --> Instance["ProcessFlowInstance"]
  Workspace -->|"擁有 draft-local data"| Embedded["EmbeddedGeometry"]
  Catalog["GeometryEntity catalog"] -->|"catalog binding"| Configuration
  Workspace -->|"commit 並 materialize embedded geometry"| Instance
```

| Model | 擁有 | 不擁有 | 可變性 |
| --- | --- | --- | --- |
| `ProcessStepTemplate` | Geometry ports、parameter definitions、process program 位置 | Parameter values、geometry records、flow topology | Immutable snapshot |
| `ProcessFlowTemplate` | Flow inputs、step refs、edges | 產品設定值、geometry bindings | Immutable snapshot |
| `ProcessFlowWorkspace` | Bindings、parameter values、embedded geometries、commit state | Topology | 只有 `draft` 可修改 |
| `ProcessFlowInstance` | 完整產品設定 | Embedded geometries、topology、instance lineage | Immutable snapshot |
| `GeometryEntity` | Catalog metadata 與完整 `GeometryStructure` | Flow-specific role | Immutable snapshot |
| `ExecutionPlan` | 已解析 structures、排序後 steps、明確 input routing | Repository handle 或尚待解析的 repository id | 僅存在於 runtime；nested mappings MUST 視為 read-only |

每個 template id 代表一份 immutable snapshot；需要另一份 snapshot 時 MUST 使用新的
`id`。`version` label、identifier 與未採用欄位的完整規則見
[共用欄位與格式規則](#10-共用欄位與格式規則)。

## 5. ProcessStepTemplate

`ProcessStepTemplate` 定義一個可執行 process node 的 ports、parameters 與 module path。
在 PnP 範例中，它宣告 primary port `main_geometry`、auxiliary port `die_geometry`、唯一 output
`result_geometry`，以及 parameter `coordinates`。

| 欄位 | 型別 | 必填條件 | Request 省略時 | 契約 |
| --- | --- | --- | --- | --- |
| `schemaVersion` | integer literal | yes | `2` | MUST equal `2`。 |
| `id` | identifier | yes | none | Immutable snapshot identity。 |
| `version` | non-empty string | yes | none | Opaque metadata label；未正式發行前 MUST 是 `current`，不得 parse、sort 或驅動行為。 |
| `name` | non-empty string | yes | none | Human-facing name。 |
| `category` | non-empty string | yes | none | Dot-delimited category MAY 表達 hierarchy。 |
| `program` | string | yes | none | Extensionless relative module path under `process_flow_steps`；每個 segment MUST match `[A-Za-z0-9_-]+`。 |
| `description` | string | no | `""` | Human-facing description。 |
| `owner` | non-empty string | yes | none | Owning team or domain。 |
| `inputPorts` | `GeometryInputPort[]` | yes | none | MUST 包含 exactly one primary port。 |
| `outputPorts` | `GeometryOutputPort[]` | yes | none | MUST 是 exactly one `result_geometry`。 |
| `parameterDefinitions` | `ParameterDefinition[]` | yes | none | 詳見 Parameter Schema。 |

### 5.1 Port 規則

| 欄位 | Input port | Output port |
| --- | --- | --- |
| Identity | `portId` | `portId` |
| Data type | literal `"geometry"` | literal `"geometry"` |
| Display | non-empty `name`、optional `description` | non-empty `name`、optional `description` |
| Requiredness | `required`, default `true` | not applicable |
| Role | `primary` or `auxiliary` | not applicable |

Port invariants：

- MUST 有且只能有一個 `role: "primary"` 的 input，且其 id MUST 是
  `main_geometry`、`required` MUST 是 `true`。
- 其他 input ports MUST 使用 `role: "auxiliary"`。
- MUST 有且只能有一個 output，id MUST 是 `result_geometry`。
- 本版所有 ports 的 `dataType` MUST 是 `geometry`。
- Process module 以 `ProcessStepContext.state` 操作 primary geometry，並以
  `require_geometry(portId)` 取得 auxiliary geometry。

### 5.2 Parameter 規則

Geometry MUST NOT 出現在 parameter value union。`controlType` 是 rendering contract，
`valueType` 與 validation 才是 data contract；但 static `optionSource` 另有 enum 語義，
提供時 values MUST 屬於 options。完整規則見
[Parameter Schema](./reference/parameter-schema.md)。

`workingTemp` 等 legacy 欄位的禁止規則集中在
[Legacy 與禁止欄位](#105-legacy-與禁止欄位)。

## 6. ProcessFlowTemplate

`ProcessFlowTemplate` 是可重用的製程 topology，不保存 geometry selection 或 parameter
values。在 PnP 範例中，它以兩條 edges 將 `incoming_panel` 與 `incoming_die` 分別接到 PnP
的 primary 與 auxiliary ports。

| 欄位 | 型別 | 必填條件 | Request 省略時 | 契約 |
| --- | --- | --- | --- | --- |
| `schemaVersion` | integer literal | yes | `2` | MUST equal `2`。 |
| `id` | identifier | persisted: yes; preview draft: no | draft `""` | Persisted template id MUST non-empty。 |
| `name` | non-empty string | yes | none | Human-facing name。 |
| `version` | non-empty string | yes | none | Opaque metadata label；未正式發行前 MUST 是 `current`，不得 parse、sort 或驅動行為。 |
| `description` | string | no | `""` | Description。 |
| `owner` | non-empty string | persisted: yes | draft MAY be `""` | Owning team。 |
| `flowInputs` | `FlowInputDefinition[]` | yes | none | MUST 至少一個。 |
| `stepRefs` | `StepRef[]` | yes | none | MUST 至少一個。 |
| `flowEdges` | `FlowEdge[]` | yes | none | Typed routing。 |

### 6.1 FlowInputDefinition

| 欄位 | 型別 | 必填條件 | Request 省略時 | 契約 |
| --- | --- | --- | --- | --- |
| `flowInputId` | identifier | yes | none | Template-local identity。 |
| `name` | non-empty string | yes | none | Display name。 |
| `description` | string | no | `""` | Description。 |
| `dataType` | literal `"geometry"` | yes | `"geometry"` | Must match target port。 |
| `required` | boolean | yes | `true` | See composite requiredness below。 |
| `geometryConstraints` | object | no | none | Optional entity/category/format filters。 |

`GeometryConstraints` fields：

| 欄位 | 型別 | 必填條件 | Request 省略時 | 契約 |
| --- | --- | --- | --- | --- |
| `entityTypes` | non-empty string array | no | omitted | Exact case-sensitive envelope types；empty array 等同不限制。 |
| `categories` | non-empty string array | no | omitted | Exact 或 dot-delimited descendant categories；empty array 等同不限制。 |
| `structureFormats` | non-empty string array | no | omitted | Exact case-sensitive formats；目前唯一 supported value 是 `standard`。 |

Geometry constraint matching：

- `entityTypes`：case-sensitive exact match。
- `categories`：case-sensitive exact match，或 dot-delimited descendant match；例如
  `die` 接受 `die.hbm`，但不接受 `dielectric`。
- `structureFormats`：case-sensitive exact match。
- Empty or omitted constraint list 表示不限制該維度。

### 6.2 StepRef 與 FlowEdge

`StepRef`：

| 欄位 | 型別 | 必填條件 | Request 省略時 | 契約 |
| --- | --- | --- | --- | --- |
| `stepRefId` | identifier | yes | none | Flow-local identity。 |
| `stepLabel` | string or `null` | no | omitted | Optional display override；empty/`null` 都表示使用 step-template name。 |
| `processStepTemplateId` | identifier | yes | none | Existing immutable step-template reference。 |

`FlowEdge`：

| 欄位 | 型別 | 必填條件 | Request 省略時 | 契約 |
| --- | --- | --- | --- | --- |
| `edgeId` | identifier | yes | none | Flow-local identity。 |
| `source` | `FlowInputEdgeSource \| StepOutputEdgeSource` | yes | none | Discriminator 是 `kind`。 |
| `target` | `FlowEdgeTarget` | yes | none | Exactly one target step input。 |

| Object | 欄位 | 契約 |
| --- | --- | --- |
| `FlowInputEdgeSource` | `kind: "flowInput"`、required `flowInputId` | References one declared flow input。 |
| `StepOutputEdgeSource` | `kind: "stepOutput"`、required `stepRefId`、required `outputPortId` | `outputPortId` MUST 是 `result_geometry`。 |
| `FlowEdgeTarget` | required `stepRefId`、required `inputPortId` | References one declared target port。 |

```json
{
  "stepRefId": "pnp",
  "stepLabel": "PnP",
  "processStepTemplateId": "step_tpl_pnp"
}
```

Edge source 是 discriminated union：

```json
{ "kind": "flowInput", "flowInputId": "incoming_panel" }
```

```json
{
  "kind": "stepOutput",
  "stepRefId": "pnp",
  "outputPortId": "result_geometry"
}
```

Edge target：

```json
{ "stepRefId": "pnp", "inputPortId": "main_geometry" }
```

### 6.3 Topology 不變條件

- 每個 declared flow input MUST 至少有一條 outgoing edge。
- 每個 required step input port MUST 剛好有一條 incoming edge。
- Optional input port MAY 有零或一條 incoming edge。
- Edge source 與 target `dataType` MUST 相同。
- Step output MUST NOT 連回同一 step，graph MUST acyclic。
- 每個 step output port 最多一個 consumer；flow input MAY fan-out。
- 所有 `stepRefs` MUST 位於同一個 connected execution graph，且 MUST 收斂至 exactly
  one terminal step。Terminal step 是其 `result_geometry` 沒有 outgoing edge 的 step。
- Flow-level execution output MUST 是唯一 terminal step 的 `result_geometry`。Array order
  MUST NOT 用來選 output。

完整決策見 [ADR-0002](./architecture/decisions/0002-single-terminal-flow.md)。

### 6.4 Optional flow input 規則

Binding requirement 是 flow input 與其實際 consumers 的 composite rule：

- `FlowInputDefinition.required: true`：binding MUST 存在。
- `required: false` 且所有相關 target ports 都 optional：binding MAY 省略。
- 任一相關 target port required：binding MUST 存在。
- Partial preview 只計算 target upstream closure 內的 consumers。
- 若 optional binding 有提供，它仍 MUST resolve 並符合 constraints。

### 6.5 未儲存的 preview draft

Inline preview MAY 使用 `ProcessFlowTemplateDraft`，其 `id` MAY 是空字串；所有
flow input、step、port 與 edge ids 仍 MUST 合法。Persisted create MUST 使用非空唯一 id。

## 7. 共用 `FlowConfiguration`

Workspace、preview 與 compiler input 共用 `FlowConfiguration`：
在 PnP 範例中，`inputBindings` 選擇 panel 與 die，`stepConfigurations.pnp` 則提供
`coordinates`。這也顯示 geometry binding 與 parameter values 是兩組不同資料。

| 欄位 | 型別 | 必填條件 | Request 省略時 | 契約 |
| --- | --- | --- | --- | --- |
| `inputBindings` | map of `flowInputId -> GeometryBinding` | canonical yes | `{}` | Unknown flow-input key MUST reject。 |
| `stepConfigurations` | map of `stepRefId -> StepConfiguration` | canonical yes | `{}` | Unknown step key MUST reject。 |
| `embeddedGeometries` | map of `localId -> EmbeddedGeometry` | configuration canonical yes | `{}` | Instance MUST NOT persist this field。 |

Geometry binding：

```json
{ "kind": "catalog", "geometryId": "panel_v1_0_0" }
```

```json
{ "kind": "embedded", "localId": "draft_panel_1" }
```

| Binding kind | 必填欄位 | 禁止欄位 |
| --- | --- | --- |
| `catalog` | `kind: "catalog"`、non-empty `geometryId` | `localId` |
| `embedded` | `kind: "embedded"`、non-empty `localId` | `geometryId` |

`StepConfiguration` 只有一個 canonical field：`parameterValues` 是 parameter-id keyed object，
request MAY 省略並 default 為 `{}`。Unknown top-level fields 與 unknown parameter ids MUST
reject；value shape 由對應 `ParameterDefinition` 決定。

`stepConfigurations` 以 `stepRefId` keyed，MUST NOT 重複
`processStepTemplateId`；template owns 該 binding。

```json
{
  "pnp": {
    "parameterValues": {
      "coordinates": [[0, 0]]
    }
  }
}
```

## 8. ProcessFlowWorkspace

每個 Workspace 只引用一個 immutable Flow Template，並保存可以尚未完整的研究設定。
它適合反覆 Save Draft；只有 commit 時才要求整份 configuration 完整。

| 欄位 | 型別 | 必填條件 | 契約 |
| --- | --- | --- | --- |
| `schemaVersion` | integer literal `2` | persisted yes | Process resource schema。 |
| `id` | identifier | yes | Server-generated immutable id。 |
| `name` | non-empty string | yes | Mutable while draft。 |
| `processFlowTemplateId` | identifier | yes | Immutable reference。 |
| `revision` | integer `>= 1` | yes | Optimistic concurrency token。 |
| `status` | `draft \| committed` | yes | Lifecycle state。 |
| `committedInstanceId` | identifier | committed only | First successful commit result。 |
| `createdAt` | RFC 3339 UTC string | yes | Immutable timestamp。 |
| `updatedAt` | RFC 3339 UTC string | yes | Update/commit timestamp。 |
| FlowConfiguration fields | objects | yes | Mutable only while draft。 |

Draft MAY 缺少 required binding/parameter，或保存 incomplete repeat item；但已提供的
key、union shape、non-empty parameter type、max/range constraints 與 local references MUST
合法。Catalog existence、geometry constraints 與 full completeness MAY 延後至 preview 或
commit，詳見 validation matrix。

Workspace update 使用 full-replacement `PUT` semantics：request MUST 帶目前
`revision` 與完整 desired `inputBindings`、`stepConfigurations`、
`embeddedGeometries`；省略 map 等同清空。成功後 revision 加一；stale update MUST 回
`409 Conflict`。Committed workspace read-only。

### 8.1 生命週期

```mermaid
flowchart LR
  Start([Start]) -->|create| DraftR1[Draft revision 1]
  DraftR1 -->|PUT current revision| DraftRN[Draft revision N]
  DraftRN -->|failed validation or rollback| DraftRN
  DraftRN -->|commit / revision + 1| Committed[Committed]
  Committed -->|retry returns first instance| Committed
```

Commit retry 以 workspace 的 committed state 為準。一旦 commit 成功，後續 retry MUST
回傳第一次建立的 workspace/instance，即使 retry request 提供不同 revision、instance id
或 name；不得建立第二份 instance。

## 9. ProcessFlowInstance

Instance 是完整、immutable，而且只包含 catalog bindings 的產品設定。
PnP golden example 的 instance 綁定兩個 catalog geometries，並保存完整的 `coordinates`。

| 欄位 | 型別 | 必填條件 | 契約 |
| --- | --- | --- | --- |
| `schemaVersion` | integer literal `2` | yes | Process resource schema。 |
| `id` | identifier | yes | Client-selected immutable identity，table-local unique。 |
| `name` | non-empty string | yes | Immutable display name。 |
| `processFlowTemplateId` | identifier | yes | Existing immutable template。 |
| `inputBindings` | map of catalog bindings | yes | Embedded binding MUST NOT appear；optional inputs MAY be absent。 |
| `stepConfigurations` | map | yes | Required values complete；steps without values MAY be absent。 |

API MUST NOT provide in-place instance update。新產品、study result 或 recipe change MUST
建立新的 instance id。目前模型不保存 instance lineage、source workspace、created timestamp 或
revision；`committedInstanceId` 是 workspace retry pointer，不是 lineage relation。

## 10. 共用欄位與格式規則

本節集中定義所有 resource 共用的 payload 規則。閱讀單一 resource 時，可以先跳過本節；
實作 validator、serializer 或 persistence mapping 時則必須套用。

### 10.1 如何閱讀 field table

同一個欄位在 create request、draft 與 canonical response 中可能有不同 requiredness。本文的
field table 依下列方式解讀：

| 想確認的問題 | 查看位置 |
| --- | --- |
| Canonical persisted／response payload 是否必須包含欄位？ | `必填條件` |
| Create 或 draft request 省略後會發生什麼？ | `Request 省略時` 與該 resource 的 request variant 說明 |
| 欄位能否傳 `null`？ | `型別`；只有明列 `null` 才可以 |
| Save、preview、commit 或 execute 是否要求完整？ | [驗證時機](#11-驗證時機) |

除非表格明確標示 request variant，`必填條件: yes` 表示 canonical persisted／response
payload MUST 包含該欄。若 `Request 省略時` 有 default，create 或 draft request MAY 省略，
validator 必須補上 default；canonical payload 仍 MUST 明確輸出。省略時沒有 default 且
`必填條件: yes` 表示 request 必須提供。

Optional 與 nullable 是不同概念。Optional 表示 object key 可以省略；nullable 表示 value
可以是 `null`。

### 10.2 格式標記與 resource metadata

下列欄位分別是 wire-format marker、internal storage marker、resource label 或 concurrency
token，**都不是產品正式版號**。目前只支援本文件描述的一種 contract，不提供 version
negotiation 或依版號切換行為。

| 用途 | 欄位 | 型別 | 目前值 | 意義 |
| --- | --- | --- | --- | --- |
| Process resource wire marker | `schemaVersion` | integer | `2` | Implementation-reserved fixed literal；不代表第二個產品版本。 |
| Geometry structure format marker | `GeometryEntity.structure.schemaVersion` | string | `"1.0.0"` | Container tree 與 geometry primitives 的固定格式識別。 |
| SQLite internal schema marker | `schema_metadata.databaseSchemaVersion` | string | `"2"` | Startup 用來確認目前 physical tables 的內部值，不是 public release。 |
| Resource metadata label | `version` | string | 新 resource 使用 `"current"` | Opaque display/source label；不得解析、排序或推導行為差異。 |
| Workspace concurrency token | `revision` | integer | `>= 1` | Optimistic concurrency token；不代表 template 或產品版本。 |

`GeometryEntity` 外層不是 Process resource schema，因此不包含 numeric
`schemaVersion: 2`；其 nested `structure` MUST 包含 geometry format marker。正式發行策略
確立前，新 resource 的 `version` MUST 是 `current`。Consumer MUST NOT 從 `version` 或 id
prefix 推導 model kind、release generation 或 runtime behavior。

### 10.3 Identifier 格式與唯一範圍

下列 Process Flow identifiers MUST 符合：

```text
^[A-Za-z][A-Za-z0-9_.-]*$
```

適用範圍：resource `id`、`portId`、`ParameterDefinition.id`、`flowInputId`、
`stepRefId`、`edgeId`、embedded `localId` 與 repeat `itemId`。GeometryStructure 內部
衍生的 `container:*` / `body:*` ids 屬於另一個 namespace，不受此 regex 限制。

| Identifier | 唯一性範圍 |
| --- | --- |
| Resource `id` | 同一 resource table 內唯一；不同 resource families 不保證 global uniqueness。 |
| `portId` | `inputPorts` 或 `outputPorts` collection 內唯一。 |
| `ParameterDefinition.id` | 同一 parameter collection 內唯一；nested repeat collection 重新計算 scope。 |
| `flowInputId`、`stepRefId`、`edgeId` | 同一 `ProcessFlowTemplate` 內各自唯一。 |
| Embedded `localId` | 同一 `FlowConfiguration.embeddedGeometries` map 內唯一。 |
| Repeat `itemId` | 同一 repeat group value 內唯一。 |

### 10.4 Map reference 與 canonical JSON

- `inputBindings` 的 key MUST 是該 template 的 `flowInputId`。
- `stepConfigurations` 的 key MUST 是該 template 的 `stepRefId`。
- Embedded binding 的 `localId` MUST 對應同一 configuration 的
  `embeddedGeometries` key。
- Catalog binding 的 `geometryId` MUST 對應 persisted `GeometryEntity.id`。
- Unknown keys MUST 被拒絕；未被任何 binding reference 的 embedded geometry MAY 存在於
  draft，但 commit MUST 丟棄，不得 materialize。

Canonical persisted JSON SHOULD 省略 optional `null` 欄位；空字串不是 `null` 的替代。
若 API response 的用途是下載未保存 preview，`GeometryEntity.id` 等欄位 MAY 明確為
`null`。Consumers MUST NOT 依賴 object key order。

### 10.5 Legacy 與禁止欄位

`geometryRef`、`StepValueSet`、`fieldDefinitions` 與 `templateFamilyId` 是未採用的早期草案
欄位，MUST NOT 出現在 request 或 persisted resource。系統不提供這些欄位的轉換路徑，也
沒有 `ProcessFlowTemplateRevision` model。需要另一份 template snapshot 時，建立新的
resource id。

`workingTemp` 已棄用。新建 template MUST NOT 宣告此 parameter，UI 與 compiler 也 MUST NOT
自動補入。若 process program 確實需要溫度，必須定義語意明確的 domain-specific parameter，
例如 `bondingTemperature`，不得沿用 `workingTemp` id。

## 11. 驗證時機

先以操作理解驗證強度：

- **Save draft**：設定可以不完整，但所有已提供的 key、value shape 與 local reference
  必須合法。
- **Preview**：只要求指定輸出所需的 upstream closure 完整；未參與 preview 的 steps MAY
  不完整。
- **Create instance／commit**：整份 flow 必須完整，所有使用中的 resources 必須可以解析，
  geometry 必須可以 hydrate。
- **Execute**：重新驗證 stored resources，載入 process modules，然後執行完整 plan。

下列兩張表共同定義各 boundary 的精確要求。第一張回答 payload、graph 與 parameter 是否
完整；第二張回答何時解析外部 resource、深入驗證 geometry 及載入 process module。

| 操作邊界 | Shape / extra fields | Graph | Parameter values |
| --- | --- | --- | --- |
| Step template create | complete | port invariants | definition schema + option enum definition |
| Flow template create | complete | complete，含 exactly one terminal | definitions resolved |
| Workspace create / update | complete | referenced template already valid | missing/empty required allowed；provided values validate |
| Flow-input preview | complete | full template valid | unrelated steps MAY be incomplete |
| Step-output preview | complete | full template valid | target upstream closure MUST complete |
| Instance create | complete | referenced template valid | full flow MUST complete |
| Workspace commit | complete | referenced template valid | full flow MUST complete |
| Execute | stored resource is revalidated | complete | complete |
| Seed/import | MUST pass same validators as create | required | required by resource type |

| 操作邊界 | Resource existence / constraints | Geometry deep validity | Process module load |
| --- | --- | --- | --- |
| Step template create | n/a | n/a | SHOULD validate program locator |
| Flow template create | step templates MUST exist | n/a | not executed |
| Workspace create / update | Catalog existence MAY defer；embedded local ref MUST exist | MAY defer | not executed |
| Flow-input preview | target binding MUST resolve/match | target geometry MUST hydrate | not executed |
| Step-output preview | closure bindings MUST resolve/match | closure geometries MUST hydrate | closure modules MUST load/execute |
| Instance create | all supplied bindings MUST resolve/match | all used geometries MUST hydrate | SHOULD be loadable；execution errors remain possible only for domain behavior |
| Workspace commit | all used bindings MUST resolve/match | all used geometries MUST hydrate | SHOULD be loadable before persistence |
| Execute | resolve again | required | required and executed |
| Seed/import | required where applicable | required | SHOULD verify program locator |

「Complete」只表示本表中對應 boundary 的所有 required checks 已通過，不應以單一模糊
boolean 取代 validation stage 或 error details。

## 12. Workspace commit transaction

Commit 可以先讀取 workspace snapshot 並在 transaction 外做 complete compile，避免把
昂貴的 resource resolution 與 geometry hydration 放進長 transaction；所有 persistence
writes 則 MUST 位於同一個 SQLite transaction。Write transaction 必須：

1. Re-read workspace；若已 committed，直接回傳第一次建立的 result。
2. 重新驗證 request revision、`status: draft`，並確認被 compile 的 snapshot 仍是同一
   revision。
3. 只 materialize 被 binding reference 的 embedded geometries；同一 `localId` 被多次
   reference 時只建立一個 catalog entity。
4. 將 embedded bindings 改寫成 catalog bindings。
5. Insert new immutable `ProcessFlowInstance`。
6. 將 workspace 標記 `committed`、revision 加一、保存 `committedInstanceId`，改寫
   bindings 並清空 `embeddedGeometries`。

任何 transaction 內的 duplicate id 或 persistence failure MUST rollback geometry、instance
與 workspace update。Transaction 外的 validation、resolution 或 compile failure MUST 在
任何 write 前結束。Retry after failure MAY 使用同一 request 再試。

## 13. Compile 與 execute 邊界

```mermaid
flowchart LR
  JSON["Template + FlowConfiguration JSON"] --> Shape["Shape validation"]
  Shape --> Graph["Graph + completeness validation"]
  Repo["Step templates + Geometry catalog"] --> Resolve["Resource resolution"]
  Graph --> Resolve
  Resolve --> Normalize["Parameter + Geometry normalization"]
  Normalize --> Plan["ExecutionPlan"]
  Plan --> Kernel["GeometryKernel"]
  Kernel --> Result["ExecutionResult"]
```

Compiler MUST：

- resolve step templates；
- validate topology、exactly one terminal 與 target closure；
- validate bindings、parameter types、enum options 與 completeness；
- resolve catalog/embedded geometries，確認 `unitSystem: "um"` 與 constraints；
- hydrate/normalize external structures；
- normalize persisted parameter values into runtime values；
- produce ordered `PlannedStep[]` 與 explicit geometry-input sources。

Kernel MUST：

- receive only `ExecutionPlan`，never repository；
- never resolve DB ids；
- clone upstream state before mutation；
- apply material-instance rewriting to normalized `materialRef` values；
- execute process modules in topological order；
- return all step outputs plus the unique terminal output。

`ExecutionPlan` MAY retain resolved template metadata ids for diagnostics/context；「沒有 DB id」
表示沒有仍需 repository lookup 的 id。

## 14. 可完整執行的 PnP golden example

以下三個 documents 是同一個完整 target-contract example。它使用現有 catalog fixtures
`panel_v1_0_0` 與 `hbm_v1_3_1`；若 catalog records 存在，即可 compile 並執行
`pnp/pnp`。`workingTemp` 刻意不出現，因為該 id 已棄用，且 PnP 不需要溫度 input。
這些既有 fixture id 是 opaque identity；其中的數字尾碼不表示產品版本，也不能用來
選擇 schema 或切換行為。

### 14.1 ProcessStepTemplate

```json
{
  "schemaVersion": 2,
  "id": "step_tpl_pnp_golden",
  "version": "current",
  "name": "PnP",
  "category": "assembly.pnp",
  "program": "pnp/pnp",
  "description": "Places copies of an auxiliary die geometry on the primary geometry.",
  "owner": "integration.platform",
  "inputPorts": [
    {
      "portId": "main_geometry",
      "name": "Main geometry",
      "dataType": "geometry",
      "role": "primary",
      "required": true
    },
    {
      "portId": "die_geometry",
      "name": "Die geometry",
      "dataType": "geometry",
      "role": "auxiliary",
      "required": true
    }
  ],
  "outputPorts": [
    {
      "portId": "result_geometry",
      "name": "Result geometry",
      "dataType": "geometry"
    }
  ],
  "parameterDefinitions": [
    {
      "id": "coordinates",
      "name": "Coordinates",
      "description": "Bottom-left placement coordinates for each die copy.",
      "valueType": "coordinates",
      "controlType": "coordinateList",
      "required": true,
      "unit": "um"
    }
  ]
}
```

### 14.2 ProcessFlowTemplate

```json
{
  "schemaVersion": 2,
  "id": "flow_tpl_pnp_golden",
  "name": "PnP Golden Flow",
  "version": "current",
  "description": "Single-terminal PnP reference flow.",
  "owner": "integration.platform",
  "flowInputs": [
    {
      "flowInputId": "incoming_panel",
      "name": "Incoming panel",
      "dataType": "geometry",
      "required": true,
      "geometryConstraints": {
        "entityTypes": ["panel"],
        "categories": ["carrier.panel"],
        "structureFormats": ["standard"]
      }
    },
    {
      "flowInputId": "incoming_die",
      "name": "Incoming die",
      "dataType": "geometry",
      "required": true,
      "geometryConstraints": {
        "entityTypes": ["die"],
        "categories": ["die.hbm"],
        "structureFormats": ["standard"]
      }
    }
  ],
  "stepRefs": [
    {
      "stepRefId": "pnp",
      "stepLabel": "Place HBM",
      "processStepTemplateId": "step_tpl_pnp_golden"
    }
  ],
  "flowEdges": [
    {
      "edgeId": "edge_panel_to_pnp_main",
      "source": {
        "kind": "flowInput",
        "flowInputId": "incoming_panel"
      },
      "target": {
        "stepRefId": "pnp",
        "inputPortId": "main_geometry"
      }
    },
    {
      "edgeId": "edge_die_to_pnp_aux",
      "source": {
        "kind": "flowInput",
        "flowInputId": "incoming_die"
      },
      "target": {
        "stepRefId": "pnp",
        "inputPortId": "die_geometry"
      }
    }
  ]
}
```

### 14.3 ProcessFlowInstance

```json
{
  "schemaVersion": 2,
  "id": "flow_inst_pnp_golden",
  "name": "PnP Golden Instance",
  "processFlowTemplateId": "flow_tpl_pnp_golden",
  "inputBindings": {
    "incoming_panel": {
      "kind": "catalog",
      "geometryId": "panel_v1_0_0"
    },
    "incoming_die": {
      "kind": "catalog",
      "geometryId": "hbm_v1_3_1"
    }
  },
  "stepConfigurations": {
    "pnp": {
      "parameterValues": {
        "coordinates": [
          [-760, -520],
          [760, -520]
        ]
      }
    }
  }
}
```

此 graph 的唯一 terminal 是 `pnp.result_geometry`；兩個 required ports 各有 exactly one
source；兩個 required bindings 與 `coordinates` 都完整。

## 15. 已知實作差異

所有 current/target/status 只在 [Target contract 實作對照](./conformance.md) 維護；核心
範圍是 `DM-001` 至 `DM-020`。本節不複製 table，避免同一 gap 在多處產生不同狀態。

任何修改 target contract 的提案 MUST 先新增或更新 ADR，再同步本文件、reference、
conformance ledger、machine-readable schema（建立後）與 contract tests。
