---
title: Process Flow 資料模型
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-10-25
last_verified_commit: 7d49bf0b
source_of_truth:
  - apps/api/src/process_flow_api/models.py
  - packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py
  - apps/viewer/lib/process-flow/types.ts
---

# Process Flow 資料模型

本文件定義 persistence、API、compiler 與 viewer 共用的資料契約。ProcessFlow schema 為 3；FlowDraft schema 為 2；SQLite schema 為 14。這三個版本與使用者填寫的 `version`、防止覆寫的 `revision` 各自獨立。

## 1. 範圍

Flow 自有完整拓樸與 configuration；不再拆成 flow template 和 flow instance。所有 flows 都能更新或另存。此版沒有 flow lifecycle、template/product 分類、啟停狀態或歷史版本還原。ProcessStepTemplate 的既有管理功能保留。

## 2. 主要物件

| 物件 | 擁有內容 | 角色 |
| --- | --- | --- |
| ProcessStepTemplate | Ports、parameter definitions、program | 可重用的製程定義 |
| ProcessFlow | Definition、bindings、所有候選 recipes 與採用選擇 | 正式流程；拓樸合法，設定可未完成 |
| FlowDraft | Metadata、configuration、nodes、edges、viewport、目前編輯候選 | 可保存未完成拓樸與無效的暫存參數 |
| GeometryEntity | Catalog ID、metadata、GeometryStructure | 可由 catalog binding 引用 |
| GeometryDocument | 無 catalog ID 的 geometry 內容 | Generator／preview 的結果內容型別 |

## 3. Ownership

Flow 的 `definition` 與 `configuration` 屬於該 flow。另存會完整複製它們；任何 recipe 值的修改都不會傳播到另一 flow。StepRef 仍引用 ProcessStepTemplate；catalog binding 仍引用 GeometryEntity，並非複製 geometry catalog。

`origin` 是弱來源記錄，不是 runtime 依賴，也不提供來源內容。來源更新或刪除不影響副本。Step program 的既有更新行為不等於 flow 歷史版本管理。

## 4. 基本資料規則

- 所有正式 flows 的 `(name, version)` MUST 唯一。
- Flow ID 由建立 API 產生；fixture／migration 保留給定 ID。
- 建立 `revision = 1`；成功更新加 1。更新和刪除 MUST 比對呼叫端 revision，過期回 409。
- `version` 是使用者標籤，不解析為版本順序。
- JSON 不接受非有限數字、未知欄位、embedded binding 或舊 flow payload。
- `stepRefId`、`flowInputId`、`edgeId` 各自在同一 flow 內唯一；recipeId 只需在同一站內唯一。

## 5. ProcessStepTemplate


`ProcessStepTemplate` 定義一個可執行 process node 的 ports、parameters 與 module path。
在 PnP 範例中，它宣告 primary port `main_geometry`、auxiliary port `die_geometry`、唯一 output
`result_geometry`，以及 parameter `placements`。

| 欄位 | 型別 | 必填條件 | Request 省略時 | 契約 |
| --- | --- | --- | --- | --- |
| `schemaVersion` | integer literal | yes | `2` | MUST equal `2`。 |
| `status` | `enabled \| disabled` | no | create: `enabled`; update: preserve current | Controls new usage; disabled templates retain their references and data。 |
| `id` | identifier | yes | none | Immutable snapshot identity。 |
| `version` | non-empty string | yes | none | Opaque metadata label；內建 fixture 與 editor default 使用 `V0.0.0`，不得 parse、sort 或驅動行為。 |
| `name` | non-empty string | yes | none | Human-facing name。 |
| `category` | non-empty string | yes | none | Dot-delimited category MAY 表達 hierarchy。 |
| `program` | string | yes | none | Extensionless relative module path under `process_flow_steps`；每個 segment MUST match `[A-Za-z0-9_-]+`。 |
| `description` | string | no | `""` | Human-facing description。 |
| `owner` | non-empty string | yes | none | Owning team or domain。 |
| `inputPorts` | `GeometryInputPort[]` | yes | none | MUST 包含 exactly one primary port；陣列順序決定接口與上游分支由上到下的排列。 |
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
- `inputPorts`順序是display/layout metadata，可透過受限PUT重排；完整port definitions仍保持鎖定。
  Primary上游與step同排；宣告在primary之前的auxiliary分支在上方，之後的在下方。
  連線與execution仍依`portId`及`role`解析，不得依陣列位置推斷primary。
- MUST 有且只能有一個 output，id MUST 是 `result_geometry`。
- 本版所有 ports 的 `dataType` MUST 是 `geometry`。
- Process module 以 `ProcessStepContext.state` 操作 primary geometry，並以
  `require_geometry(portId)` 取得 auxiliary geometry。

### 5.2 Parameter 規則

Geometry MUST NOT 出現在 parameter value union。`controlType` 是 rendering contract，
`valueType` 與 validation 才是 data contract；但 static `optionSource` 另有 enum 語義，
提供時 values MUST 屬於 options。完整規則見
[Parameter Schema](./reference/parameter-schema.md)。

每個 `ParameterDefinition` MAY 提供 `defaultValue`。它使用與 persisted
`parameterValues` 相同的 shape 與 validation，且不得是 `null` 或空字串；省略表示沒有
step-level default。此值只用於初始化 authoring draft，不會由 compiler 隱式套用。


## 6. ProcessFlow

```typescript
type ProcessFlow = {
  schemaVersion: 3;
  id: string;
  name: string;
  version: string;
  owner: string;
  description: string;
  revision: number;
  origin?: { flowId: string; revision: number };
  definition: {
    flowInputs: FlowInputDefinition[];
    stepRefs: StepRef[];
    flowEdges: FlowEdge[];
  };
  configuration: FlowConfiguration;
};
```

`StepRef` 保留 `stepRefId`、`stepLabel`（省略或空白時顯示 step name）、`processStepTemplateId`。不含 `parameterDefaults`。Definition 不保存畫布座標或目前查看的 recipe。

FlowInputDefinition 宣告 `flowInputId`、name、description、dataType=geometry、required 與可選 geometryConstraints。Constraints 支援 entityTypes（完全匹配）、categories（完全或點分隔子分類）、structureFormats（完全匹配）；空或省略清單表示不限制。

FlowEdge 為 `{edgeId, source, target}`；source 是 `{kind: 'flowInput', flowInputId}` 或 `{kind: 'stepOutput', stepRefId, outputPortId}`；target 為 `{stepRefId, inputPortId}`。

正式拓樸至少有一個 input 和一個 step，必須無環、所有引用有效、每個 required port 有唯一來源，且恰好一個 terminal。Optional flow input 仍可連到 required port；是否需要實際 binding 依執行依賴而定。單一 terminal 規則見 [ADR-0002](architecture/decisions/0002-single-terminal-flow.md)。

## 7. FlowConfiguration 與 RecipeCandidate

```typescript
type FlowConfiguration = {
  inputBindings: Record<string, GeometryBinding>;
  stepConfigurations: Record<string, {
    recipeCandidates: {
      recipeId: string;
      name: string;
      description: string;
      parameterValues: Record<string, ParameterValue>;
    }[];
    selectedRecipeId: string | null;
  }>;
};
type GeometryBinding =
  | { kind: 'catalog'; geometryId: string }
  | { kind: 'generator'; generatorId: string; generatorVersion: number;
      parameters: Record<string, unknown> };
```

Map keys MUST 對應 definition 的 input／step。允許未設定 binding、未建立 step configuration、空候選集合及 `selectedRecipeId: null`。非 null 的 selectedRecipeId MUST 指向同站候選，禁止回退第一組。刪除採用候選後設為 null。

正式儲存驗證每一組候選已提供值的名稱、型別與 validation，包括非採用候選；可以缺少 required 參數。缺值以省略 key 表達；數值欄位的空字串或 null 不是合法數值。草稿允許這些暫時無效值。字串空值與執行完整度依 [Parameter Schema](reference/parameter-schema.md)。

新增站點建立並採用 `Recipe 1`，完整複製該 step 目前明確宣告的 defaults。新增候選也複製 defaults，但不改變採用；複製候選則深拷貝目前查看的全部值並產生新 recipe ID。後續讀取、儲存與 compile MUST NOT 再補 defaults。

Generator binding 保存原 parameters，儲存不生成 geometry、不重新正規化或套入 defaults。Generator identity/version 必須存在；必要設定於預覽或執行時檢查。

## 8. FlowDraft

FlowDraft 使用 schemaVersion 2：`id, user, name, revision, createdAt, updatedAt, state`，可選 `target`、`origin`。Revision 自 1 遞增；更新和刪除使用 CAS。列表跨 flows，無 template scope。

`state` 包含 `metadata`（name/version/owner/description）、完整 configuration、nodes、edges、viewport 及 `editingRecipeIds`。Node 保存 position，flowInput node 保存 definition，processStep node 保存 stepRef。Edge 保存畫布 source/target/handles。Viewport 為 x/y/zoom。

編輯既有 flow 時，`target: {flowId, revision}` 保存載入時版本；此 revision 不會因草稿更新自動追上伺服器。`editingRecipeIds` 只決定面板查看內容，不改變採用。草稿格式合法即可保存，不要求拓樸或參數完整。

## 9. 更新與另存

更新保留原 id、origin，拓樸與 configuration 可修改。另存送出完整新 flow 內容，origin 記錄直接來源的 ID 及載入時 revision；新副本 revision 為 1。未提供 origin 的全新 flow 沒有來源。Origin 不設外鍵，也不追溯祖先鏈。

## 10. 版本與移除欄位

Runtime MUST NOT 接受 ProcessFlowTemplate／ProcessFlowInstance、flow status、StepRef.parameterDefaults、embedded binding 或 embeddedGeometries。舊格式只允許在 SQLite migration 邊界讀取。GeometryDocument 是內容型別，不是新的 flow-local geometry store。

## 11. 驗證時機

| 操作 | 拓樸 | Recipe | Geometry |
| --- | --- | --- | --- |
| Draft save | 格式驗證，允許未完成 | 格式、ID／選擇一致性；值可暫時無效 | 兩種 binding 格式 |
| Flow save | 完整合法拓樸 | 全部候選已提供值合法；可缺 required | 引用存在；不生成、不執行 |
| Full execute | 完整合法拓樸 | 實際依賴站點的採用候選完整 | 實際依賴 inputs 完整 |
| Step preview | 完整合法拓樸 | 目標與上游依賴完整 | 該 closure 所需 inputs |
| Input preview | 指定 input 可解析 | 無關站點不要求完整 | 只解析該 input |

停用 step 禁止新增引用（含另存的新 flow）。既有 flow 仍可讀取、執行及更新；更新僅保留的同 stepRefId/stepTemplateId 配對可繼續使用停用 step。

## 12. 草稿 commit transaction

`POST /api/process-flow-drafts/{id}/commit` 接受草稿 revision、完整正式 flow create payload 與可選 target。先執行 authoring validation；在同一 transaction 重新檢查 draft revision、建立或 CAS 更新 flow、刪除草稿。任何失敗都保留草稿與原正式資料。另存 commit 不傳 target。

## 13. Compile、preview 與 export

先依 selectedRecipeId 取得有效參數，再分析 dependencies、檢查完整度並 compile。PnP 的 `placements: []` 只依採用 recipe 裁剪 auxiliary 依賴。非採用候選不參與運算。Kernel 只接收已解析 ExecutionPlan，不讀 repository 或候選集合。

Preview request 只接受完整 inline `flow: {definition, configuration}` 或 `flowId`，兩者擇一。快取 identity 包含 definition、configuration、step definitions、catalog geometry 與 target；切換採用、改值、改線或 binding 不能命中舊結果。JSON／STEP／CDB 匯出使用相同解析脈絡。

API 詳見 [Process Flow API](reference/process-flow-api.md)，SQLite 升級詳見 [Persistence](reference/persistence.md)。

## 14. 可完整執行的 PnP golden example

下列兩份文件搭配內建 geometry catalog 可直接執行。`scripts/check_golden_example.py` 逐層驗證 Pydantic、拓樸、compiler 與 kernel，結果恰有兩個 placed children。

### 14.1 ProcessStepTemplate

```json
{
  "schemaVersion": 2,
  "id": "step_tpl_pnp_golden",
  "version": "V0.0.0",
  "name": "PnP",
  "category": "assembly.pnp",
  "program": "pnp/pnp",
  "description": "Adapts and places auxiliary die copies on rectangle or polygon target regions.",
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
      "id": "placements",
      "name": "Placements",
      "description": "Absolute target region with fixed hidden transform for each placed die copy.",
      "valueType": "placements",
      "controlType": "placementList",
      "required": true,
      "unit": "um"
    }
  ]
}
```

### 14.2 ProcessFlow

```json
{
  "id": "flow_pnp_golden",
  "name": "PnP Golden Flow",
  "version": "V0.0.0",
  "owner": "integration.platform",
  "description": "Golden PnP process configuration.",
  "schemaVersion": 3,
  "revision": 1,
  "definition": {
    "flowInputs": [
      {
        "flowInputId": "incoming_panel",
        "name": "Incoming panel",
        "dataType": "geometry",
        "required": true,
        "geometryConstraints": {
          "entityTypes": [
            "panel"
          ],
          "categories": [
            "carrier.panel"
          ],
          "structureFormats": [
            "standard"
          ]
        }
      },
      {
        "flowInputId": "incoming_die",
        "name": "Incoming die",
        "dataType": "geometry",
        "required": true,
        "geometryConstraints": {
          "entityTypes": [
            "die"
          ],
          "categories": [
            "die.hbm"
          ],
          "structureFormats": [
            "standard"
          ]
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
  },
  "configuration": {
    "inputBindings": {
      "incoming_panel": {
        "kind": "catalog",
        "geometryId": "panel_plp_310x310mm_glass"
      },
      "incoming_die": {
        "kind": "catalog",
        "geometryId": "hbm3_8hi"
      }
    },
    "stepConfigurations": {
      "pnp": {
        "recipeCandidates": [
          {
            "recipeId": "recipe_1",
            "name": "Recipe 1",
            "description": "",
            "parameterValues": {
              "placements": [
                {
                  "targetRegion": {
                    "type": "rectangle",
                    "bottomLeftX": -760,
                    "bottomLeftY": -520,
                    "topRightX": 640,
                    "topRightY": 480
                  },
                  "pose": {
                    "x": 0,
                    "y": 0,
                    "rotationZ": 0
                  },
                  "anchor": "center"
                },
                {
                  "targetRegion": {
                    "type": "rectangle",
                    "bottomLeftX": 760,
                    "bottomLeftY": -520,
                    "topRightX": 2160,
                    "topRightY": 480
                  },
                  "pose": {
                    "x": 0,
                    "y": 0,
                    "rotationZ": 0
                  },
                  "anchor": "center"
                }
              ]
            }
          }
        ],
        "selectedRecipeId": "recipe_1"
      }
    }
  }
}
```

## 15. Conformance

實作證據及仍存在的限制記錄於 [Conformance](conformance.md)。舊 UI evidence 是歷史資料，不是新資料契約或驗收結果。
