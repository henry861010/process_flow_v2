# Process Step Template Editor UI Design

## Route

`/admin/processStepEditor`

## Purpose

Process Step Template Editor 是給 developer 使用的 admin tool，用於註冊、檢視、複製、刪除 process step template，並透過 guardrail editor 建立合法的 `FieldDefinition` 組合。

此頁面不連接 backend service 或 database。所有 process step templates 儲存在 browser `localStorage`，匯出時直接下載 `ProcessStepTemplate[]` JSON。

## Technology

- React
- TypeScript
- Next.js
- shadcn/ui
- Tailwind CSS
- lucide-react icons

## Data Contract

### Storage

localStorage 儲存值為純 `ProcessStepTemplate[]`，不包額外 metadata。

此頁先假設 `localStorage` 內若存在 `processStepTemplates` key，其 JSON 格式與 schema 都正確；不需要做 malformed localStorage recovery UI。

```ts
const PROCESS_STEP_TEMPLATES_STORAGE_KEY = "processStepTemplates";
```

Export all templates 時，下載內容同樣為 `ProcessStepTemplate[]`。

Export 行為：

- 下載檔名固定為 `processStepTemplates.json`。
- Blob MIME type 使用 `application/json;charset=utf-8`。
- JSON 使用 2-space pretty print：`JSON.stringify(templates, null, 2)`。
- 保留 `fieldDefinitions[]`、`repeatDefinition.itemFieldDefinitions[]` 與 `optionSource.options[]` 的既有排序。
- 即使目前 templates 為空陣列，也可以 export，檔案內容為 `[]`。

### Seed Templates

當 `localStorage` 尚未存在 `processStepTemplates` key 時，由 home page 初始化 sample templates。此頁只讀取與寫入既有 key，不負責 seed。若使用者刪除全部 templates，不自動重新建立 seed data。完整 seed 清單以 `docs/ui/home.md` 與 `apps/viewer/lib/home-local-storage.ts` 為準。

```json
[
  {
    "id": "step_tpl_bonding_micro_bump",
    "version": "V1.0.0",
    "name": "Micro bump bonding",
    "category": "bonding.micro_bump",
    "description": "Define micro bump bonding process parameters and resulting bonded package state.",
    "owner": "integration.platform",
    "fieldDefinitions": [
      {
        "id": "main_geometry",
        "name": "main_geometry",
        "description": "Complete geometry state consumed by this process step.",
        "scope": "inputState",
        "valueType": "geometryRef",
        "controlType": null,
        "selectionMode": null,
        "unit": null
      },
      {
        "id": "incoming_pad_finish",
        "name": "Incoming pad finish",
        "description": "Pad finish before micro bump bonding starts.",
        "scope": "inputState",
        "valueType": "string",
        "controlType": "select",
        "selectionMode": "single",
        "unit": null,
        "optionSource": {
          "type": "static",
          "options": [
            {
              "value": "cu",
              "name": "Cu"
            },
            {
              "value": "ni_au",
              "name": "Ni/Au"
            }
          ]
        }
      },
      {
        "id": "bonding_profile",
        "name": "Bonding profile",
        "description": "Named bonding recipe or process profile family.",
        "scope": "processParameter",
        "valueType": "string",
        "controlType": "select",
        "selectionMode": "single",
        "unit": null,
        "optionSource": {
          "type": "static",
          "options": [
            {
              "value": "baseline_thermal_compression",
              "name": "Baseline thermal compression"
            },
            {
              "value": "low_temperature",
              "name": "Low temperature"
            }
          ]
        }
      },
      {
        "id": "bump_pitch",
        "name": "Bump pitch",
        "description": "Nominal micro bump pitch used by this bonding process.",
        "scope": "processParameter",
        "valueType": "float",
        "controlType": "number",
        "selectionMode": null,
        "unit": null,
        "validation": {
          "min": 0
        }
      }
    ]
  },
  {
    "id": "step_tpl_molding_encapsulation",
    "version": "V1.0.0",
    "name": "Molding encapsulation",
    "category": "encapsulation.molding",
    "description": "Define mold compound, mold thickness, and cure condition.",
    "owner": "assembly.process",
    "fieldDefinitions": [
      {
        "id": "main_geometry",
        "name": "main_geometry",
        "description": "Complete geometry state consumed by this process step.",
        "scope": "inputState",
        "valueType": "geometryRef",
        "controlType": null,
        "selectionMode": null,
        "unit": null
      },
      {
        "id": "mold_compound",
        "name": "Mold compound",
        "description": "Mold compound material used for encapsulation.",
        "scope": "processParameter",
        "valueType": "materialRef",
        "controlType": "select",
        "selectionMode": "single",
        "unit": null,
        "optionSource": {
          "type": "static",
          "options": [
            {
              "value": "EMC-A",
              "name": "EMC-A"
            },
            {
              "value": "EMC-B",
              "name": "EMC-B"
            }
          ]
        }
      },
      {
        "id": "mold_thickness",
        "name": "Mold thickness",
        "description": "Target encapsulation thickness after molding.",
        "scope": "processParameter",
        "valueType": "float",
        "controlType": "number",
        "selectionMode": null,
        "unit": null,
        "validation": {
          "min": 0
        }
      },
      {
        "id": "cure_required",
        "name": "Cure required",
        "description": "Whether the process requires a dedicated post mold cure step.",
        "scope": "processParameter",
        "valueType": "boolean",
        "controlType": "checkbox",
        "selectionMode": null,
        "unit": null
      }
    ]
  },
  {
    "id": "step_tpl_rdl_build_up",
    "version": "V1.0.0",
    "name": "RDL build up",
    "category": "interconnect.rdl",
    "description": "Define repeatable PM and RDL layer parameters.",
    "owner": "interconnect.integration",
    "fieldDefinitions": [
      {
        "id": "main_geometry",
        "name": "main_geometry",
        "description": "Complete geometry state consumed by this process step.",
        "scope": "inputState",
        "valueType": "geometryRef",
        "controlType": null,
        "selectionMode": null,
        "unit": null
      },
      {
        "id": "rdl_layers",
        "name": "RDL layers",
        "description": "Repeatable PM and RDL layer definitions.",
        "scope": "processParameter",
        "valueType": "fieldGroupArray",
        "controlType": "repeater",
        "selectionMode": null,
        "unit": null,
        "repeatDefinition": {
          "itemNameTemplate": "RDL layer {{index}}",
          "indexBase": 1,
          "minItems": 1,
          "maxItems": 12,
          "itemFieldDefinitions": [
            {
              "id": "pm_material",
              "name": "PM material",
              "description": "Photo-material used before this RDL layer.",
              "scope": "processParameter",
              "valueType": "materialRef",
              "controlType": "select",
              "selectionMode": "single",
              "unit": null,
              "optionSource": {
                "type": "static",
                "options": [
                  {
                    "value": "PM-001",
                    "name": "Baseline photo-material"
                  },
                  {
                    "value": "PM-002",
                    "name": "Low-stress photo-material"
                  }
                ]
              }
            },
            {
              "id": "pm_thickness",
              "name": "PM thickness",
              "description": "Photo-material thickness for this layer.",
              "scope": "processParameter",
              "valueType": "float",
              "controlType": "number",
              "selectionMode": null,
              "unit": null,
              "validation": {
                "min": 0
              }
            },
            {
              "id": "rdl_thickness",
              "name": "RDL thickness",
              "description": "Copper RDL thickness for this layer.",
              "scope": "processParameter",
              "valueType": "float",
              "controlType": "number",
              "selectionMode": null,
              "unit": null,
              "validation": {
                "min": 0
              }
            }
          ]
        }
      }
    ]
  }
]
```

### Editor Scope

`data-model.md` 是完整資料模型規格；本頁 editor 實作可離線編輯的 template authoring subset。

本頁支援：

- `optionSource.type: "static"` 的建立與編輯。
- `materialRef` 與 `materialRef[]` 作為語意化 string/string array，使用 text input、static select 或 static checkbox options 編輯。

本頁不提供：

- `optionSource.type: "externalReference"` 的建立或編輯。此頁管理的 templates 使用 static options。
- Material DB 或 external catalog picker。

### Template Immutability

已儲存的 `ProcessStepTemplate` 不可直接編輯。使用者可以：

- Review：檢視完整 template 內容。
- Delete：直接從 localStorage 刪除該 template。
- Duplicate as new：以既有 template 為基礎建立新 draft，再另存為新的 template。

Duplicate as new 會複製原 template 的 `version`、`name`、`category`、`description`、`owner` 與 `fieldDefinitions`，但會清空 template `id`。使用者必須填入新的 unique `id` 後才能 save。

### Required System Field

每個 process step template 必須包含系統建立的 geometry field：

```json
{
  "id": "main_geometry",
  "name": "main_geometry",
  "description": "Complete geometry state consumed by this process step.",
  "scope": "inputState",
  "valueType": "geometryRef",
  "controlType": null,
  "selectionMode": null,
  "unit": null
}
```

`main_geometry` 在 UI 中顯示為 disabled block，不可刪除、不可排序、不可編輯。使用者仍可新增其他 `valueType: "geometryRef"` 的 field。

## Page Layout

### Main Page

主頁是 process step template registry。

Top filter bar:

- Search input：依 `name` 做 case-insensitive substring search。
- Category selector：依現有 templates 的 `category` path 分層列出可往下選的 category segment。
- Clear filters button。
- Export button：下載全部 templates。
- Add button：建立新 draft 並進入 edit overlay。

Result list:

- 一列代表一個 process step template。
- 顯示 `name`、`category`、`version`、`owner`、field count。
- Field count 包含 locked `main_geometry`。
- 點擊 row 開啟 review overlay。
- Filter 條件採交集，search 與 category 同時套用。

Category selector behavior:

- 將 category 以 `.` 切成階層，例如 `interconnect.rdl` 會顯示為 `interconnect` -> `rdl`。
- 第一層 selector 顯示所有 root category segment。
- 選擇某一層後，下一層 selector 只顯示該 path 下可用的 child segments。
- Category filter 使用 path prefix matching；template category 必須符合 `category === selectedPath || category.startsWith(selectedPath + ".")`。例如選到 `interconnect` 會列出 `interconnect.*`，但不會列出 `interconnection.*`；選到 `interconnect.rdl` 則只列出該完整 path 底下的 templates。
- 改選較上層 category segment 時，清空所有下層已選 segment，再依新的 path 重建 child selector。
- Category segment 以字母升冪排序。
- 不提供自由輸入 category filter。

Empty states:

- 沒有任何 template：顯示空列表與 Add button。
- Filter 無結果：顯示 clear filters action。

### Review Overlay

Review overlay 以 shadcn `Sheet` 呈現，桌面寬度約 `80vw`。此 admin tool 只支援桌面版 layout，不需要手機版 layout。主頁背景使用 overlay dim。

Header:

- Template `name`
- `version`
- `category`
- Actions：Duplicate as new、Delete、Close

Body:

- Metadata section：`id`、`owner`、`description`
- Field definitions section：
  - 依 `scope` 分組：`inputState`、`processParameter`、`outputState`
  - 每個 field 顯示 `name`、`id`、`valueType`、`controlType`、`selectionMode`、`unit`
  - `main_geometry` 使用 disabled visual treatment
  - `fieldGroupArray` 顯示 `repeatDefinition` 摘要與 child fields

Delete action 直接刪除該 template 並關閉 overlay，不提供 undo feature。

### Edit Overlay

Edit overlay 用於新增 template draft 或 duplicate draft。已儲存 template 不進入 edit mode。

Layout:

- Header：Create process step template
- Step metadata form
- Field builder
- Fixed footer action bar

Step metadata fields:

- `id`
- `version`
- `name`
- `category`
- `description`
- `owner`

Footer actions:

- Save：通過所有 guardrail validation 後寫入 localStorage。
- Abort：放棄 draft，不寫入 localStorage。

Draft lifecycle:

- 新增 template 時，edit overlay 開啟一個只含 locked `main_geometry` 的 draft。
- Duplicate as new 時，複製原 template 的 metadata 與 `fieldDefinitions`，清空 template `id`，並開啟 edit overlay。
- Duplicate as new 開啟後，field list 預設選取第一個 user-created field；若沒有 user-created field，則選取 read-only `main_geometry`。
- Save 成功後，寫入 localStorage、關閉 edit overlay、刷新 registry list，並開啟新儲存 template 的 review overlay。
- Abort、點擊 Sheet close `X`、按 Escape、或點擊 backdrop 都視為離開 edit overlay。
- 若 draft 沒有變更，離開 edit overlay 時直接關閉。
- 若 draft 有未儲存變更，離開 edit overlay 前顯示 confirm dialog；確認後放棄 draft，不寫入 localStorage；取消則留在 edit overlay。

## Step Metadata Rules

`id`:

- 必填。
- 必須符合 snake_case：`^[a-z][a-z0-9_]*$`。
- 必須在 localStorage 內所有 templates 中唯一。

`version`:

- 必填。
- 必須符合 `V1.0.0` 格式：`^V\\d+\\.\\d+\\.\\d+$`。

`name`:

- 必填。
- 作為 UI 主要顯示名稱。

`category`:

- 必填。
- 使用者直接輸入完整 path，例如 `category1.category2.category3`。
- UI 不自動拆分儲存；儲存值就是原始 category string。

`description`:

- 可留空；儲存時使用空字串 `""`。

`owner`:

- 必填。
- 純 string。

## Field Builder

Field builder 使用左側 field list 加右側 selected field editor。

Field list:

- `main_geometry` 固定顯示於最上方，disabled，不參與排序。
- User-created fields 可排序，排序結果即為 `fieldDefinitions[]` 順序。
- 每個 field row 顯示 `name`、`id`、`valueType`、`controlType`。
- Add field button 建立新的 user field。
- Delete field button 僅出現在 user-created fields。

New user field default:

```json
{
  "id": "",
  "name": "",
  "description": "",
  "scope": "processParameter",
  "valueType": "string",
  "controlType": "text",
  "selectionMode": null,
  "unit": null
}
```

Selected field editor sections:

- Basic
- Type & Control
- Options
- Validation
- Repeater

### Basic Section

Fields:

- `id`
- `name`
- `description`
- `scope`

Rules:

- `id` 必填，符合 snake_case：`^[a-z][a-z0-9_]*$`。
- `name` 必填。
- `description` 可留空；儲存時使用空字串 `""`。
- `unit` 不提供編輯，所有 field 儲存時固定為 `null`。
- Top-level field id 必須在同一個 template 的 `fieldDefinitions[]` 中唯一。
- Repeater child field id 必須在同一個 `repeatDefinition.itemFieldDefinitions[]` 中唯一。
- `scope` 必須為 `inputState`、`outputState`、`processParameter`。

### Type & Control Section

UI 先選 `valueType`，再依合法組合限制可選的 `controlType` 與 `selectionMode`。

合法組合以 `data-model.md` 的 FieldDefinition 合法組合矩陣為準；本頁只暴露 static options 與 string-like `materialRef` 編輯，不暴露 external option catalog picker。

Auto behavior:

- `boolean` 自動使用 `controlType: "checkbox"`，`selectionMode: null`。
- `geometryRef` 自動使用 `controlType: null`，`selectionMode: null`。
- `fieldGroupArray` 自動使用 `controlType: "repeater"`，`selectionMode: null`。
- `materialRef` 可使用 string-like controls；`materialRef[]` 可使用 multiple option controls。
- Array value type 自動使用 `selectionMode: "multiple"`。
- Non-array option field 使用 `selectionMode: "single"`。
- `text` 與 `number` 不使用 `optionSource`。
- User-created field 切換到另一個 `valueType` 時，editor 以欄位相容性遷移既有內容：
  - 保留 field 在 list 中的位置。
  - 保留通用 authoring 欄位：`id`、`name`、`description`、`scope`。
  - `unit` 仍固定為 `null`。
  - 將 `valueType` 設為新選取的 value type。
  - 若目前 `controlType` 仍屬於新 `valueType` 的合法 control，保留目前 `controlType`；若不合法，改用新 `valueType` 的預設 control。
  - `selectionMode` 依新的 `valueType` 與 `controlType` 重新計算：array option field 為 `"multiple"`，non-array option field 為 `"single"`，非 option control 為 `null`。
  - `optionSource` 只在新的 `controlType` 是 `select` 或選項型 `checkbox` 時保留。既有 `optionSource.options[]` 的 `value` 型別必須符合新 `valueType` 的 option value 型別；符合時保留 options 的排序與內容，不符合時建立空的 static options。
  - String-like validation (`regex`、`minLength`、`maxLength`) 只在新舊 `valueType` 同屬 `string` / `materialRef` 時保留。
  - Numeric validation (`min`、`max`、`exclusiveMin`、`exclusiveMax`) 只在新舊 `valueType` 同屬 numeric value type 時保留。切換到 integer value type 時，帶小數的 numeric bound 不保留。
  - `repeatDefinition` 只在新的 `valueType` 為 `fieldGroupArray` 時保留；切換到其他 `valueType` 時移除。切換進 `fieldGroupArray` 且原本沒有 `repeatDefinition` 時，建立預設 repeat definition。
  - 新 `valueType` 不支援的專屬欄位會被捨去，不寫入 draft。
- `main_geometry` 不允許切換 `valueType`。

### Options Section

Options section 只在以下 control 出現：

- `select`
- 選項型 `checkbox`

Rules:

- 只支援 `optionSource.type: "static"`。
- Option shape 為 `{ "value": string | number, "name": string, "description"?: string }`。
- Options 可排序，儲存時保留目前顯示順序。
- 使用者可以刪除任何已加入的 option；若選項型 field 沒有任何 option，Save validation 會阻擋。
- `option.value` 型別必須符合 `valueType`。`string`、`string[]`、`materialRef`、`materialRef[]` 使用 text input 且 value 為 string；`integer`、`integer[]`、`float`、`float[]` 使用 number input 且 value 為 number。Array value type 的 option value 使用其 element type，例如 `integer[]` 的單一 option value 是 integer number。
- `option.value` 不可為空字串。
- `option.value` 在同一個 field 中必須唯一。
- `option.name` 必填。
- `controlType: "checkbox"` 的選項型 field 在 instance UI 中仍呈現 checkbox-style option rows；若 `selectionMode: "single"`，一次只能勾選一個 option。

### Validation Section

Validation section 依 `valueType` 顯示可用欄位。

String-like fields:

- `regex`
- `minLength`
- `maxLength`

Applies to:

- `string`
- `materialRef`

Integer and float fields:

- `min`
- `max`
- `exclusiveMin`
- `exclusiveMax`

Integer fields 額外驗證：

- number input 不允許小數。
- static options 的 numeric value 不允許小數。

Boolean, geometryRef, and fieldGroupArray 不顯示一般 validation section。

### Repeater Section

Repeater section 只在 `valueType: "fieldGroupArray"` 出現。

Parent field:

- `valueType` 必須為 `fieldGroupArray`。
- `controlType` 必須為 `repeater`。
- 必須提供 `repeatDefinition`。

`repeatDefinition` fields:

- `itemNameTemplate`
- `indexBase`
- `minItems`
- `maxItems`
- `itemFieldDefinitions[]`

Rules:

- `indexBase` 預設為 `1`。
- `itemNameTemplate` 必填，且必須包含 `{{index}}`。
- `indexBase` 必須為正整數。
- `minItems` 與 `maxItems` 可為空；若有值，必須為正整數；若兩者都有值，`minItems <= maxItems`。
- Add child field 不建立 default child field；使用者需在 child field editor 中填完 required fields 後才加入 `itemFieldDefinitions[]`。
- Child fields 可排序，排序結果即為 `repeatDefinition.itemFieldDefinitions[]` 順序。
- Child field 使用同一套 field editor，但不能選 `valueType: "geometryRef"` 或 `valueType: "fieldGroupArray"`。
- Child field 不直接出現在 top-level `fieldDefinitions[]`。
- Template editor 只定義 repeat item schema，不建立 instance `items[]` value。

## Guardrail Validation Before Save

Save 前必須驗證：

- Step metadata 中 `id`、`version`、`name`、`category`、`owner` 必填；`description` 可留空並儲存為 `""`。
- Step `id` 符合 snake_case 且全域唯一。
- `version` 符合 `Vx.y.z` 格式。
- 必須包含 locked `main_geometry` field。
- 所有 field id 符合 snake_case。
- 所有 field name 必填。
- 所有 field description 可留空並儲存為 `""`。
- 所有 field unit 必須為 `null`。
- Top-level field id 不重複。
- Child field id 在同一個 repeater 內不重複。
- 所有 field 都符合合法 `valueType`、`controlType`、`selectionMode` 組合。
- `select` 與選項型 `checkbox` 必須有 `optionSource.type: "static"`。
- `select` 與選項型 `checkbox` 至少需要一個 static option。
- Static option values 不重複、不可為空字串，且型別符合 field `valueType`。
- `materialRef` 與 `materialRef[]` 的 value 與 static option value 必須為 string。
- `fieldGroupArray` 必須有 `repeatDefinition.itemFieldDefinitions[]`。
- `fieldGroupArray.repeatDefinition.itemNameTemplate` 必填且包含 `{{index}}`。
- `fieldGroupArray.repeatDefinition.indexBase` 必須為正整數。
- `fieldGroupArray.repeatDefinition.minItems` 與 `maxItems` 若有值必須為正整數，且 `minItems <= maxItems`。
- Repeater child fields 不使用 `geometryRef` 或 `fieldGroupArray`。

Validation error 顯示在對應欄位旁邊，Save button 在有 blocking error 時 disabled。

## Component Guidance

Use shadcn/ui components:

- `Input` for text fields.
- `Textarea` for descriptions.
- `Select` for enum choices.
- `Checkbox` for boolean and checkbox option rows.
- `Button` for actions.
- `Sheet` for review and edit overlays.
- `Tabs` or grouped sections for field editor details.
- `ScrollArea` for long field lists and overlay body.
- `Badge` for `valueType`, `controlType`, `scope`.
- `Tooltip` for icon-only actions.

Use lucide-react icons:

- `Plus` for add.
- `Trash2` for delete.
- `Copy` for duplicate.
- `Download` for export.
- `X` for close or abort.
- `GripVertical` for drag handle.

## Visual Behavior

- This page should feel like a compact developer tool, not a marketing page.
- This page only needs to support desktop layout.
- Use dense but readable spacing.
- Keep repeated rows stable in height.
- Disabled system fields use lower contrast and no pointer affordance.
- Overlay body scrolls independently from footer action bar.
- Footer action bar remains visible while editing long field definitions.
