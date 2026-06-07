# 資料模型

## Geometry

Geometry data 會以 immutable entity 的形式存放在 geometry database 中。
Process flow instance 不會把完整 geometry content 直接內嵌在每個 step field
value 中。所有 geometry 欄位都使用 `valueType: "geometryRef"` 表示，persisted
instance 中的 `FieldValue.value` 保存 geometry database 中 immutable
`GeometryEntity.id`，或保存 `null` 表示此欄位由上游 process step output resolve。

`null` 只允許用在有 incoming edge 且該 edge `source.sourceType` 為 `stepOutput`
的 `geometryRef` 欄位。Initial geometry、沒有 incoming edge 的 geometry 欄位，或
incoming edge 來源不是 step output 的 geometry 欄位，都必須保存明確的 geometry DB id。
Runtime 在執行 process step 前，會將 resolved geometry DB id 對應到
`GeometryEntity.structure` / `GeometryStructure`，再交給 step 使用。Process step
本身處理的是完整 geometry structure，而 persisted instance 保存的是 geometry DB id
或可由 graph resolve 的 `null`。

### Geometry Entity

`GeometryEntity` 是 geometry database 中實際保存的 geometry object 基本結構。它包含
database identity、category、geometry structure payload，以及描述與治理欄位。

| 欄位 | 型別 | 說明 |
|---|---:|---|
| `id` | string | Geometry entity 在 geometry database 中的 immutable id。如果 geometry content 被修改，必須建立新的 geometry entity，並給予新的 `id`。 |
| `category` | string | 階層式 category，用來描述這個 geometry 是什麼，例如 `carrier.wafer.glass`。Category 是給 UI 搜尋、瀏覽與建立 template 時使用的主要分類。 |
| `name` | string  | 人閱讀以及UI顯示 name |
| `version` | string  | 人閱讀以及UI顯示 version |
| `owner` | string  | 負責此 geometry entity 的 owner 或 owning team。 |
| `description` | string  | 用於描述此物件來源用途等資訊，並且提供在UI顯示 |
| `structureFormat` | string  | 用來解讀 `structure` 的 format。目前只定義 `standard`。 |
| `structure` | object  | 依據 `structureFormat` 描述的 geometry structure payload。此 object 的詳細 shape 會在 Geometry Structure 章節另外定義。 |


範例：

```json
{
  "id": "geom_wafer_aaatv_rev_a",
  "category": "carrier.wafer.glass",
  "name": "SKH HBM4",
  "version": "v1.0.0",
  "owner": "integration-team",
  "description": "Incoming glass wafer geometry for aaaTV process flow.",
  "structureFormat": "standard",
  "structure": {
    "schemaVersion": "1.0.0",
    "unitSystem": "um",
    "root": {
      "id": "container:incoming-wafer",
      "key": "incoming-wafer",
      "bodies": [],
      "vias": [],
      "circuits": [],
      "bumps": [],
      "children": []
    }
  }
}
```

### Geometry Structure Format: standard

`structureFormat = "standard"` 時，`structure` 描述一棵以 root container
為入口的 geometry structure tree。這個 structure 只描述 geometry 的資料結構、
座標、材料、feature density 與 container composition 語意；不描述資料如何被
程式產生，也不包含 geometry database 的搜尋、權限、lifecycle 或 indexing 欄位。

`standard` structure 的 top-level 欄位如下：

| 欄位 | 型別 | 說明 |
|---|---:|---|
| `schemaVersion` | string | Geometry structure schema version，例如 `1.0.0`。 |
| `unitSystem` | string | 此 structure 使用的長度單位，例如 `um`。 |
| `root` | Container | Root container。整個 geometry structure 從這個 container 開始遞迴解讀。 |

#### Container

`Container` 是一個語意分組節點。Container 本身不代表材料，也不直接佔有實體
體積；真正有體積的 solid geometry 放在 `bodies` 裡。Child container 透過
`children` 形成 tree structure。

目前 `standard` structure 內的座標都視為 global coordinates。Container 不定義
local transform，也沒有 `translate`、`rotate` 或 `scale` 欄位。序列化後也不保存
parent reference，避免 container tree 出現 cycle。

| 欄位 | 型別 | 說明 |
|---|---:|---|
| `id` | string | Container 在 geometry structure 內的 node id。它不是 geometry database primary key。 |
| `key` | string | Container 的人可讀名稱、語意名稱或 debug key。 |
| `bodies` | Body[] | 直接屬於此 container 的 solid bodies。 |
| `vias` | Via[] | 直接屬於此 container 的 via density features。 |
| `circuits` | Circuit[] | 直接屬於此 container 的 circuit density features。 |
| `bumps` | Bump[] | 直接屬於此 container 的 bump density features。 |
| `children` | Container[] | Child containers。每個 child 都使用同一種 container structure。 |

#### Body

`Body` 代表真正佔有實體體積的材料區域。

| 欄位 | 型別 | 說明 |
|---|---:|---|
| `id` | string | Body 在 geometry structure 內的 node id。 |
| `geometry` | Geometry | Solid body 的 geometry primitive payload。 (Geometry 是 standard geometry structure 的內部資料結構) |
| `material` | string | 此 body 使用的材料名稱或材料 ID。 |

#### FeatureDirection

`FeatureDirection` 用來描述 density-based feature 在 Z axis 上的方向語意。此方向
使用 structure 的 global coordinate system 解讀，只支援下列值：

| 值 | 說明 |
| --- | --- |
| `"+z"` | Feature 從 lower-Z side 指向 higher-Z side。 |
| `"-z"` | Feature 從 higher-Z side 指向 lower-Z side。 |

`direction` 欄位只定義在 Via 與 Bump。`standard` structure 中每個 via 與 bump
都必須提供 `direction`；缺少 `direction` 的 via 或 bump payload 不符合
`standard` structure。Circuit 不保存 `direction`。

`direction` 是 feature 的成長方向、連接方向或 process-normal direction。它不改變
`geometry` 的空間作用範圍，也不改變 geometry primitive 的座標或 `thk` 解讀方式。
所有 geometry primitive 仍依照 Geometry 結構章節定義，以自己的座標與正 `thk`
描述 feature envelope。

當 process operation 只做平移、複製、裁切或厚度調整時，`direction` 保持不變。
當 process operation 反轉 Z axis，例如將 structure 或 container subtree 以某個
XY plane 做 flip 時，所有被 flip 範圍內的 via 與 bump direction 都必須同步反轉：
`"+z"` 變成 `"-z"`，`"-z"` 變成 `"+z"`。

#### Via

`Via` 代表 via 結構

```json
{
  "id": "via:root-container-package-root-via-0:...",
  "geometry": {},
  "material": "copper",
  "density": 0.3,
  "direction": "-z"
}
```

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `string` | Via feature 在 geometry structure 內的 deterministic id。 |
| `geometry` | `Geometry` | 此 via feature 的幾何作用範圍。 |
| `material` | `string` | Via feature 使用的材料名稱或材料 ID。 |
| `density` | `number` | 此幾何範圍內的有效 via density。 |
| `direction` | `FeatureDirection` | 此 via feature 的 Z-axis 方向。`"+z"` 表示由 lower-Z side 指向 higher-Z side；`"-z"` 表示由 higher-Z side 指向 lower-Z side。 |

Via 只作用在持有該 via 的 container scope 內，不會因為幾何座標重疊而自動
向上套用到 parent container，也不會向下套用到 child container。Via 必須保存
`direction`，後續 process step 不得只由 geometry envelope 的 Z 位置推論 via 方向。

#### Circuit

`Circuit` 代表 Circuit 結構

```json
{
  "id": "circuit:root-container-package-root-circuit-0:...",
  "geometry": {},
  "material": "copper",
  "density": 0.5
}
```

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `string` | Circuit feature 在 geometry structure 內的 deterministic id。 |
| `geometry` | `Geometry` | 此 Circuit feature 的幾何作用範圍。 |
| `material` | `string` | Circuit feature 使用的材料名稱或材料 ID。 |
| `density` | `number` | 此幾何範圍內的有效 Circuit density。 |

Circuit 只作用在持有該 circuit 的 container scope 內，不會因為幾何座標重疊而自動向上套用到 parent container，也不會向下套用到 child container。

Circuit 不保存 `direction`。Circuit 的 feature type 表示平面 routing 或 circuit
density；若某個 process 需要描述有方向性的垂直連接，應使用 Via。

#### Bump

`Bump` 代表 bump 結構

```json
{
  "id": "bump:root-container-package-root-bump-0:...",
  "geometry": {},
  "material": "solder",
  "density": 0.8,
  "direction": "-z"
}
```

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `string` | Bump feature 在 geometry structure 內的 deterministic id。 |
| `geometry` | `Geometry` | 此 Bump feature 的幾何作用範圍。 |
| `material` | `string` | Bump feature 使用的材料名稱或材料 ID。 |
| `density` | `number` | 此幾何範圍內的有效 Bump density。 |
| `direction` | `FeatureDirection` | 此 bump feature 的 Z-axis 方向。`"+z"` 表示由 lower-Z side 指向 higher-Z side；`"-z"` 表示由 higher-Z side 指向 lower-Z side。 |

Bump 只作用在持有該 bump 的 container scope 內，不會因為幾何座標重疊而自動
向上套用到 parent container，也不會向下套用到 child container。Bump 必須保存
`direction`，後續 process step 不得只由 geometry envelope 的 Z 位置推論 bump
位於哪一側或往哪個方向連接。

#### Geometry 結構

- 目前提供geometry種類有BoxGeometry、PolygonGeometry、CylinderGeometry、ConeGeometry

- 所有座標點都使用 `[x, y, z]`。目前 primitive 都沿 Z axis 以 `thk` 表示厚度。

- Runtime geometry primitive 提供 XY footprint inset/outset 複製能力，供製程 API
  在不直接修改 primitive 內部欄位的情況下產生 keep out zone 或外張 envelope。
  Box、Cylinder 與 Cone 支援正值 inset 與負值 outset；Polygon 只支援零值 copy，
  不支援非零 XY inset/outset。

##### 5.1 BoxGeometry

JSON 範例：

```json
{
  "type": "BoxGeometry",
  "bottom_left": [0, 0, 0],
  "top_right": [10, 10, 0],
  "thk": 1
}
```

欄位說明：

| Field | Type | Description |
| --- | --- | --- |
| `bottom_left` | `number[3]` | Box footprint 的左下角點。 |
| `top_right` | `number[3]` | Box footprint 的右上角點。 |
| `thk` | `number` | 沿 Z axis 的厚度。 |

`bottom_left[2]` 與 `top_right[2]` 代表 box 的底面 Z 位置，兩者應在同一個
XY plane。Box top Z 可以用 `bottom_z + thk` 取得。

Three.js viewer 可以用：

```text
width  = top_right.x - bottom_left.x
depth  = top_right.y - bottom_left.y
height = thk
center = [
  (bottom_left.x + top_right.x) / 2,
  (bottom_left.y + top_right.y) / 2,
  bottom_left.z + thk / 2
]
```

##### 5.2 PolygonGeometry

JSON 範例：

```json
{
  "type": "PolygonGeometry",
  "polys": [
    [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0]
    ]
  ],
  "thk": 1
}
```

欄位說明：

| Field | Type | Description |
| --- | --- | --- |
| `polys` | `number[][][]` | 一個或多個 polygon footprint。每個 polygon 是一組 `[x, y, z]` 點。 |
| `thk` | `number` | 沿 Z axis 的 extrusion 厚度。 |

目前實作使用第一個 polygon 的第一個點的 Z 作為底面 Z。Viewer 讀取時應把
polygon footprint 沿 Z axis extrude `thk`。

JavaScript `PolygonGeometry` constructor 目前會驗證 polygon loop：所有點必須
在同一個 XY plane、每個 loop 至少需要 3 個 unique points、不能有重複點、
零長度邊、自交、零面積，且不同 loops 不能相交或相切。CAD exporter 會用
odd-even containment 將 loops 分成 outer loop 與 holes，再沿 Z axis extrude。

##### 5.3 CylinderGeometry

JSON 範例：

```json
{
  "type": "CylinderGeometry",
  "center": [5, 5, 0],
  "bottom_radius": 1,
  "thk": 2
}
```

欄位說明：

| Field | Type | Description |
| --- | --- | --- |
| `center` | `number[3]` | Cylinder 底面的中心點。 |
| `bottom_radius` | `number` | Cylinder 半徑。 |
| `thk` | `number` | 沿 Z axis 的高度。 |

Cylinder top Z 可以用 `center[2] + thk` 取得。

##### 5.4 ConeGeometry

JSON 範例：

```json
{
  "type": "ConeGeometry",
  "center": [5, 5, 0],
  "bottom_radius": 1,
  "top_radius": 0.5,
  "thk": 2
}
```

欄位說明：

| Field | Type | Description |
| --- | --- | --- |
| `center` | `number[3]` | Cone 或 frustum 底面的中心點。 |
| `bottom_radius` | `number` | 底面半徑。 |
| `top_radius` | `number` | 頂面半徑。 |
| `thk` | `number` | 沿 Z axis 的高度。 |

當 `bottom_radius` 與 `top_radius` 相同時，這個 payload 可被視為 cylinder-like
frustum。Cone top Z 可以用 `center[2] + thk` 取得。

#### Structure Translation and Composition

Reader、viewer 或 geometry engine 解讀 `standard` structure 時，應從
`structure.root` 開始遞迴讀取 container tree：

1. 讀取目前 container 的 `bodies`，建立此 container scope 內的 solid volume。
2. 讀取目前 container 的 `vias`、`circuits`、`bumps`，建立只屬於此 container
   scope 的 density features。
3. 遞迴讀取每個 `children` container。
4. 套用 parent-child composition：child container 的 body 與 parent container
   的 body 發生空間 overlap 時，overlap volume 由 child body 佔據。

這個規則的意思是：parent body 可以代表較粗略的外殼、包覆體或背景體積；
child body 代表更高優先權、更具體的幾何。當 child body 與 parent body 重疊時，
該重疊區域不應被解讀成 parent material 加 child material 兩份體積，而應由
child body 的材料與幾何語意取代 parent body 在該區域的語意。

例如 root container 有一個 mold compound body，而 child container 有一個 die
silicon body。如果 die body 的空間範圍落在 mold body 內，這段 overlap volume
屬於 child die 的 silicon body，不屬於 parent mold compound body。

目前 `standard` structure 只定義 parent-child overlap 的 ownership。若同一個
container 內的 sibling bodies 互相 overlap，structure 只描述它們的位置與材料，
不額外定義哪一個 sibling 擁有 overlap volume；資料建模時應避免依賴 sibling
overlap 的 ownership 語意。

## ProcessStepTemplate

代表站點層級 process step。

必要欄位：

1. `id`：process step template 在 process step template DB 中的唯一 ID
2. `version`：人閱讀以及UI顯示 version
3. `name`：人閱讀以及UI顯示 process name
4. `category`：階層式 category，用來描述這個 process step 是什麼種類，例如 Bounding.TCP。Category 是給 UI 搜尋、瀏覽與建立 template 時使用的主要分類。
5. `program`：runtime process program 的 module path，格式為相對 `src/process/` 的 extensionless path，例如 `assembly/die_attach/step_tpl_die_attach`。
    - `program` 不使用絕對路徑、`..`、空 segment 或 `.js` 副檔名。
    - Path segment 只使用英文字母、數字、`_` 與 `-`。
    - 多個 process step template 可以共用同一個 `program`。
6. `description`：用於描述此物件來源用途等資訊，並且提供在UI顯示。
7. `owner`：負責此 process step 的 owner 或 owning team。
8. `fieldDefinitions`： 用於描述此process step所需要的參數有哪些，每個參數 definition 以 FieldDefinition 結構來描述。 
    - 每個 FieldDefinition 直接內嵌在 `fieldDefinitions[]` 中，不透過 id 間接 reference。

典型 step template 例子：

1. Molding / Encapsulation：描述 mold compound、mold thickness、cure condition。
2. Underfill：描述 underfill material、dispense pattern、cure profile。
3. Die attach：描述 attach material、bondline thickness、placement condition。

Golden Rule:

1. 所有 process step template 必須有一個 `FieldDefinition`，其 `id` 與 `name` 為 `main_geometry`，且 `valueType` 為 `geometryRef`。此欄位是 process step 接收 initial geometry 或前一個 process step output geometry 的主要入口。

ProcessStepTemplate JSON 範本：

<details>
<summary>展開查看 ProcessStepTemplate JSON 範本</summary>

```json
{
  "id": "step_tpl_die_attach",
  "version": "V1.0.0",
  "name": "Die attach",
  "category": "assembly.die_attach",
  "program": "assembly/die_attach/step_tpl_die_attach",
  "description": "Define die attach process parameters and resulting package state.",
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
      "id": "bump_pitch",
      "name": "Bump pitch",
      "description": "Nominal micro bump pitch used by this bonding process.",
      "scope": "processParameter",
      "valueType": "float",
      "controlType": "number",
      "unit": "um",
      "validation": {
        "min": 0
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
      "id": "post_bond_alignment_error",
      "name": "Post-bond alignment error",
      "description": "Measured or expected alignment error after bonding.",
      "scope": "outputState",
      "valueType": "float",
      "controlType": "number",
      "unit": "um",
      "validation": {
        "min": 0
      }
    }
  ]
}
```
</details>

## FieldDefinition

- 用於定義 process step template 中的參數 欄位語意、資料型別、輸入控制、限制、選項與 repeater 行為，
- 不保存任何 TV/Product instance 的實際值。

欄位與行為規則：

1. `id`：欄位在引用他的 process step template 中 ID。
  - 此為一個local ID 只在用其的 process step template 作用
2. `name`：人閱讀以及 UI 顯示名稱。
3. `description`：欄位語意說明，應描述這個欄位代表什麼 process state 或 parameter、何時使用、避免哪些誤解。
4. `scope`：欄位在站點中的語意分組。支援值為 `inputState`、`outputState`、`processParameter`。
    - `inputState` 描述進入此站點前，上游已形成且此站點需要知道的狀態，例如進 molding 前的 stack thickness、die placement state、substrate warpage baseline。它不是此站點產生的結果，也不是此站點的 recipe parameter。
    - `outputState` 描述該站點完成後形成的 package/process state。
    - `processParameter` 描述影響該站點結果的 process parameters 或 recipe choices。
5. `valueType`：欄位值的 domain 型別，定義 instance value 可接受的資料形態。支援值為
    1. `string`
    2. `integer`
    3. `float`
    4. `boolean`
    5. `materialRef`：材料名稱、材料代碼或 material DB entity id。雖然名稱帶有 `Ref`，但 persisted value payload 是 string，不是 `ReferenceValue` object。
    6. `geometryRef`：表示此欄位接收 geometry database 中的 immutable geometry entity id。Instance value 可以是 geometry DB id string，或在特定 graph 條件下為 `null`。
        - `geometryRef` value 為 string 時，該 string 必須是 `GeometryEntity.id`。
        - `geometryRef` value 為 `null` 時，表示此欄位使用上游 process step output geometry；此欄位必須有且只能有一條 incoming `flowEdges[]`，且 edge source 必須是 `stepOutput`。
        - Initial geometry 或沒有 incoming `stepOutput` edge 的 `geometryRef` 欄位不可使用 `null`。
        - `geometryRef` 沒有使用者可編輯的 control type，實際來源由 `ProcessFlowTemplate.flowEdges[]` 與 instance value 決定。
    7. `coordinates`：表示一組 2D placement coordinates。Instance value 是 `number[][]`，每個 item 必須是固定長度為 2 的 `[x, y]` number tuple。
        - 每個 `[x, y]` 代表一個 die 在 global coordinate system 中的 bottom-left coordinate；`x` 為 `bottomLeft_x`，`y` 為 `bottomLeft_y`。
        - `coordinates` 欄位可使用 `unit` 表示 canonical unit，例如 `"um"`。Instance value 中保存的數值必須已轉換為該 canonical unit。
        - Coordinate array 的順序沒有語意，process program 不應依賴 item order。
        - 空 array `[]` 是合法 value。
        - 不允許重複 coordinate pair；相同 `[x, y]` 只可保存一次。
        - `coordinates` 只支援 `controlType: "gds"` 或 `controlType: "coordinateList"`。
        - `coordinates` 目前不使用 `validation`；`minItems`、`maxItems`、coordinate range 或其他座標限制不由目前 schema 表達。
    8. `fieldGroupArray`：用來定義一種特殊 valueType。依據現有 fieldDefinition 定義一組 參數組 。
        - 此欄位設計目的主要是用於像 RDL layer，會有好幾層，每層有個別 厚度、材料 與 metal density (或 real pattern)。如果一層一層建 RDL 會帶來兩個問題，一是這讓 engineer感覺很煩，二則是只要有不同 RDL layer 就需要產生不同 process flow template，但往往不同 tech 我們才建立不同 flow template。因此引入此可以讓使用者調整參數組數量的 valueType
        - 此 valueType 必須搭配 `controlType: repeater` 使用
        - 此 valueType 必須搭配 `repeatDefinition` 欄位使用，作為描述每一組 fields 的 FieldDefinition。
        - 此 valueType 參數組不可以再使用 fieldGroupArray，只允許第一層使用 fieldGroupArray
    9. 以及 array value type：`string[]`、`integer[]`、`float[]`、`materialRef[]`。但是 `boolean[]`、`coordinates[]`、`fieldGroupArray[]` 不支援。
6. `controlType`：此欄位在 UI 表現方式。支援值為 `text`、`number`、`checkbox`、`select`、`repeater`、`gds`、`coordinateList`；`geometryRef` 欄位使用 `null` 或省略。
7. `selectionMode`：當 controlType 是選項型欄位 (`checkbox` 與 `select`) 須透過此設定使來決定為 `single` 或 `multiple`；非選項型欄位使用 `null` 或省略。
    - `"single"`：表示只能選一個。必須搭配非 array `valueType`
    - `"multiple"`：可以選擇多個。必須搭配 array `valueType`。
8. `optionSource`：選擇性欄位 (`checkbox` 與 `select`) primitive 選項來源，可為 static options 或外部 primitive option catalog。
9. `unit`：欄位的 canonical unit；`integer`、`float` 或 `coordinates` 欄位若有單位應使用此欄位，無單位欄位使用 `null`，不要使用空字串。
10. `validation`：欄位限制規則，例如 `min`、`max`、`exclusiveMin`、`exclusiveMax`、`regex`、`minLength`、`maxLength`。`coordinates` 目前不使用 `validation` 表達座標數量、範圍或去重規則。
11. `repeatDefinition`：`repeater` 欄位的重複群組定義。用於 RDL build-up 這類需要在單一欄位內建立多組 PM + RDL repeat items 的情境；repeat item 數量由 `fieldGroupArray.value.items.length` 表示。

### Control type behavior：

| `controlType` | UI 行為 | 對應 `valueType` | 必要或常用設定 |
| --- | --- | --- | --- |
| `text` | 文字輸入框，只能輸入文字。 | `string` 或 `materialRef` | 可用 `validation.regex`、`minLength`、`maxLength` 限制格式與長度。 |
| `number` | 數字輸入框。 | `integer` 或 `float` | `integer` 不允許小數；`float` 可允許小數。用 `validation` 控制範圍。 |
| `checkbox` | 單一 yes/no 核取方塊，或多個核取方塊直接展開在畫面上。 | `boolean`、`string`、`string[]`、`integer[]`、`float[]`、`materialRef[]` | 單一 yes/no checkbox 使用 `boolean`；選項型 checkbox 使用 `selectionMode` 與 `optionSource.options`，多選時使用 array `valueType`。 |
| `select` | 下拉選單或 compact list。 | `string`、`integer`、`float`、`materialRef`、`string[]`、`integer[]`、`float[]`、`materialRef[]` | 使用 `selectionMode` 控制單選或多選，選項放在 `optionSource.options` 或由 `externalReference` 指定；多選時使用 array `valueType`。 |
| `repeater` | 在單一欄位中動態新增、縮減或移除多組子欄位。 | `fieldGroupArray` | 必須提供 `repeatDefinition`；`itemFieldDefinitions[]` 定義每個 repeat item 內的 child fields，`minItems` 與 `maxItems` 可限制 `items.length`。 |
| `gds` | 由 GDS 匯入 2D placement coordinates。UI 讓使用者提供 GDS path 並指定 layer / datatype，importer 在 user side 解析 GDS 後只保存座標 array。 | `coordinates` | GDS path、layer 與 datatype 是匯入操作中的暫時輸入，不保存到 `FieldValue.value`。Importer 必須 resolve hierarchy、cell reference 與 transform 成 global coordinates，並對符合 layer/datatype 的 object 取 global bounding box bottom-left。 |
| `coordinateList` | 手動新增、移除與編輯多組 `[x, y]` coordinates。UI 可用 `+` 新增一列 x/y number inputs。 | `coordinates` | Instance value 直接保存 `number[][]`，不使用 `fieldGroupArray` 的 nested `items[].fieldValues[]` 結構。 |
| `null` 或省略 | 不由一般 UI control 直接輸入。 | `geometryRef` | Instance value 為 geometry DB id string 或符合 flow edge 規則的 `null`。 |

### Numeric validation 
使用 `min`、`max`、`exclusiveMin`、`exclusiveMax` 表達大小限制：

| 語意 | `validation` |
| --- | --- |
| `> 0` | `{ "min": 0, "exclusiveMin": true }` |
| `>= 0` | `{ "min": 0 }` |
| `< 0` | `{ "max": 0, "exclusiveMax": true }` |
| `<= 0` | `{ "max": 0 }` |

### Option source 規則：
#### static Type
直接在 option 中定義好有哪些選項：
```json
"type": "static",
"options": [],
```
  - `Option` 的格式為 `{ "value": string | number, "name": string, "description"?: string}`。

#### externalReference Type
選項來自外部 DB 或 catalog 中內容：
```json
"type": "externalReference",
"source": "material-DB",
"category": "wafer.glass"
```
- 使用外部資源中特定 category 以下的 entity 或 primitive catalog item 作為 options。
- `source` 指定外部 DB 或 catalog。
- `category` 指定外部 DB 或 catalog 中要列為選項的分類。

#### 共通 Rule
- `externalReference` 在 `optionSource` 中代表外部 primitive option catalog，不代表 `ReferenceDefinition`，也不保存外部 entity identity object。
- 每個 option 必須有唯一 `value`，並應提供給 UI 顯示的 `name`。
- `option.value` 必須符合 `valueType` 的 primitive 型別；例如 `valueType: "string"`、`valueType: "string[]"`、`valueType: "materialRef"` 或 `valueType: "materialRef[]"` 使用 string option value，`valueType: "integer"` 或 `valueType: "integer[]"` 使用 integer number option value。
- `selectionMode: "single"` 時，`valueType` 必須是非 array 型別，instance `value` 保存單一 option value。
- `selectionMode: "multiple"` 時，`valueType` 必須是 array 型別，instance `value` 保存 option value array。
- Instance value 必須存在於 `optionSource.options[].value`；若使用 `externalReference` 且沒有本地 `options`，則由外部 option catalog 驗證。

### FieldDefinition 與 value 範例：

單選 static select：

```json
{
  "id": "incoming_pad_finish",
  "name": "Incoming pad finish",
  "description": "Pad finish before micro bump bonding starts.",
  "scope": "inputState",
  "valueType": "string",
  "controlType": "select",
  "selectionMode": "single",
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
}
```

- Instance
  ```json
  {
    "fieldId": "incoming_pad_finish",
    "value": "cu"
  }
  ```


多選 checkbox：

```json
{
  "id": "mold_risk_flags",
  "name": "Mold risk flags",
  "description": "Visible checkbox group for risk tags that should be considered during process setup.",
  "scope": "processParameter",
  "valueType": "string[]",
  "controlType": "checkbox",
  "selectionMode": "multiple",
  "optionSource": {
    "type": "static",
    "options": [
      {
        "value": "void_risk",
        "name": "Void risk"
      },
      {
        "value": "cte_mismatch",
        "name": "CTE mismatch"
      }
    ]
  }
}
```
- Instance
  ```json
  {
    "fieldId": "mold_risk_flags",
    "value": ["void_risk", "cte_mismatch"]
  }
  ```

多選 numeric select：

```json
{
  "id": "qualified_reflow_temperatures",
  "name": "Qualified reflow temperatures",
  "description": "Qualified peak reflow temperatures for this process window.",
  "scope": "processParameter",
  "valueType": "integer[]",
  "controlType": "select",
  "selectionMode": "multiple",
  "optionSource": {
    "type": "static",
    "options": [
      {
        "value": 245,
        "name": "245 degC"
      },
      {
        "value": 260,
        "name": "260 degC"
      }
    ]
  }
}
```

- Instance

  ```json
  {
    "fieldId": "qualified_reflow_temperatures",
    "value": [245, 260]
  }
  ```

Geometry input field：

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
- Instance
  ```json
  {
    "fieldId": "main_geometry",
    "value": "geom_wafer_aaatv_rev_a"
  }
  ```

- Instance using upstream step output
  ```json
  {
    "fieldId": "main_geometry",
    "value": null
  }
  ```

Coordinates field using GDS import：

```json
{
  "id": "die_coordinates",
  "name": "Die coordinates",
  "description": "Global bottom-left placement coordinates for dies placed by this PnP step.",
  "scope": "processParameter",
  "valueType": "coordinates",
  "controlType": "gds",
  "selectionMode": null,
  "unit": "um"
}
```

GDS import UI 會要求使用者提供 GDS path、layer 與 datatype。這些值只存在於
匯入操作中，不保存到 `FieldValue.value`。Importer 需在 user side 解析 GDS、
將 GDS DB unit / user unit 轉成 `unit` 指定的 canonical unit、resolve hierarchy /
cell reference / transform 成 global coordinates，並對符合 layer/datatype 的
object 取 global bounding box bottom-left。若 GDS 匯入結果包含重複 coordinates，
importer 應只保留一筆。

- Instance
  ```json
  {
    "fieldId": "die_coordinates",
    "value": [
      [100.0, 200.0],
      [300.5, 200.0]
    ]
  }
  ```

Coordinates field using manual coordinate list：

```json
{
  "id": "die_coordinates",
  "name": "Die coordinates",
  "description": "Global bottom-left placement coordinates for dies placed by this PnP step.",
  "scope": "processParameter",
  "valueType": "coordinates",
  "controlType": "coordinateList",
  "selectionMode": null,
  "unit": "um"
}
```

Manual coordinate list UI 可提供 `+` 新增一列 x/y number inputs，但 instance
payload 仍直接保存 `number[][]`，不使用 `fieldGroupArray` 的 nested
`items[].fieldValues[]` 結構。

- Instance with no coordinates
  ```json
  {
    "fieldId": "die_coordinates",
    "value": []
  }
  ```

*** Repeatable field group 規則：
- `repeatDefinition.itemFieldDefinitions[]` 內的 child field 不可以使用 `valueType: "geometryRef"`、`valueType: "coordinates"` 或 `valueType: "fieldGroupArray"`。
- `controlType: "repeater"` 必須搭配 `valueType: "fieldGroupArray"` 與 `repeatDefinition`。
- `repeatDefinition.itemFieldDefinitions[]` 使用完整 `FieldDefinition` shape，描述每一個 repeat item 內會出現的 child fields。
- Repeat item 數量由 `fieldGroupArray.value.items.length` 表示，不另外建立或保存 count `FieldDefinition`。
- Child field id 只需要在同一個 `repeatDefinition.itemFieldDefinitions[]` 內唯一；實際 resolve path 使用 parent field id、item index 與 child field id，例如 `rdl_layers[1].pm_thickness`。
- UI 遇到 `repeater` 欄位時，應在該欄位內提供 repeat count 操作介面，例如 number input、stepper、add item/remove item controls。此 count control 只是操作 `items[]` 的 UI，不輸出為獨立 `FieldValue`。
- 當使用者將 count 設為 `N` 時，UI 應讓 `fieldGroupArray.value.items.length` 等於 `N`，並依 `repeatDefinition.itemFieldDefinitions[]` 建立或移除 repeat items。新增 item 應產生穩定 `itemId`、依 `indexBase` 設定 `index`，並建立對應 child `FieldValue[]`。
- 縮減 item 數量時，UI 應提醒使用者會移除超出新 count 的 child field values。
- `repeatDefinition.minItems` 與 `repeatDefinition.maxItems` 可限制 `fieldGroupArray.value.items.length`。
- Parent `repeater` field 代表整個 repeat group；每個 child field 的 value 仍依 child `FieldDefinition` 驗證。

RDL repeatable field group 範例：

<details>
<summary>展開查看 RDL repeatable field group JSON 範例</summary>

```json
[
  {
    "id": "rdl_layers",
    "name": "RDL layers",
    "description": "Repeatable PM + RDL layer definitions. The number of RDL layers is represented by rdl_layers.value.items.length.",
    "scope": "processParameter",
    "valueType": "fieldGroupArray",
    "controlType": "repeater",
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
          "unit": "um",
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
          "unit": "um",
          "validation": {
            "min": 0
          }
        }
      ]
    }
  }
]
```

</details>

`fieldGroupArray` instance value 範例：

<details>
<summary>展開查看 fieldGroupArray instance value JSON 範例</summary>

```json
{
  "fieldId": "rdl_layers",
  "value": {
    "items": [
      {
        "itemId": "rdl_layer_1",
        "index": 1,
        "name": "RDL layer 1",
        "fieldValues": [
          {
            "fieldId": "pm_material",
            "value": "PM-001",
          },
          {
            "fieldId": "pm_thickness",
            "value": 8.5
          },
          {
            "fieldId": "rdl_thickness",
            "value": 3
          }
        ]
      },
      {
        "itemId": "rdl_layer_2",
        "index": 2,
        "name": "RDL layer 2",
        "fieldValues": [
          {
            "fieldId": "pm_material",
            "value": "PM-002"
          },
          {
            "fieldId": "pm_thickness",
            "value": 7.5
          },
          {
            "fieldId": "rdl_thickness",
            "value": 2.5
          }
        ]
      }
    ]
  }
}
```

</details>

`ValuePayload` 的形狀由 `valueType` 決定；`selectionMode` 只用來描述選項型 UI 的單選或多選行為：

| `valueType` | `selectionMode` | `ValuePayload` |
| --- | --- | --- |
| `string` | N/A 或 `single` | `string`；若提供 `optionSource`，必須存在於 `optionSource.options[].value` 或外部 option catalog。 |
| `string[]` | `multiple` | `string[]`；每個值都必須存在於 `optionSource.options[].value` 或外部 option catalog。 |
| `integer` | N/A 或 `single` | `number`，但不可有小數；若提供 `optionSource`，必須存在於 `optionSource.options[].value` 或外部 option catalog。 |
| `integer[]` | `multiple` | `number[]`，每個值都不可有小數，且必須存在於 `optionSource.options[].value` 或外部 option catalog。 |
| `float` | N/A 或 `single` | `number`，可有小數；若提供 `optionSource`，必須存在於 `optionSource.options[].value` 或外部 option catalog。 |
| `float[]` | `multiple` | `number[]`，每個值都可有小數，且必須存在於 `optionSource.options[].value` 或外部 option catalog。 |
| `boolean` | N/A | `boolean` |
| `materialRef` | N/A 或 `single` | `string`，代表材料名稱、材料代碼或 material DB entity id；若提供 `optionSource`，必須存在於 `optionSource.options[].value` 或外部 option catalog。 |
| `materialRef[]` | `multiple` | `string[]`，每個值都代表材料名稱、材料代碼或 material DB entity id；若提供 `optionSource`，必須存在於 `optionSource.options[].value` 或外部 option catalog。 |
| `geometryRef` | N/A | `string` 或 `null`。`string` 必須是 `GeometryEntity.id`；`null` 只允許用在有 incoming `stepOutput` edge 的 geometry input field。 |
| `coordinates` | N/A | `number[][]`。每個 item 必須是固定長度為 2 的 `[x, y]` number tuple，代表 global bottom-left coordinate；空 array 合法，重複 coordinate pair 不合法，array order 沒有語意。 |
| `fieldGroupArray` | N/A | `RepeatableGroupValue`，包含 `items[]`，每個 item 內保存一組 child `FieldValue[]`。 |

`materialRef` 的 payload 是 string，不是 reference object。若需要透過 UI 選取 material，可使用 `optionSource` 提供 static options 或 external option catalog。

### FieldDefinition 合法組合矩陣

FieldDefinition editor 與資料驗證應只允許下列 `valueType`、`controlType` 與 `selectionMode` 組合：

矩陣中需要 `optionSource` 的欄位可使用 `type: "static"` 或 `type: "externalReference"`。

| `valueType` | 合法 `controlType` | `selectionMode` | 必要或可用設定 |
| --- | --- | --- | --- |
| `string` | `text` | `null` 或省略 | 可使用 `validation.regex`、`validation.minLength`、`validation.maxLength`。 |
| `string` | `select` | `single` | 必須提供 `optionSource`；所有 `option.value` 必須為 string。 |
| `string` | `checkbox` | `single` | 必須提供 `optionSource`；所有 `option.value` 必須為 string。 |
| `string[]` | `select` | `multiple` | 必須提供 `optionSource`；所有 `option.value` 必須為 string。 |
| `string[]` | `checkbox` | `multiple` | 必須提供 `optionSource`；所有 `option.value` 必須為 string。 |
| `integer` | `number` | `null` 或省略 | 可使用 `validation.min`、`validation.max`、`validation.exclusiveMin`、`validation.exclusiveMax`；instance value 不可有小數。 |
| `integer` | `select` | `single` | 必須提供 `optionSource`；所有 `option.value` 必須為 integer number。 |
| `integer[]` | `select` | `multiple` | 必須提供 `optionSource`；所有 `option.value` 必須為 integer number。 |
| `integer[]` | `checkbox` | `multiple` | 必須提供 `optionSource`；所有 `option.value` 必須為 integer number。 |
| `float` | `number` | `null` 或省略 | 可使用 `validation.min`、`validation.max`、`validation.exclusiveMin`、`validation.exclusiveMax`。 |
| `float` | `select` | `single` | 必須提供 `optionSource`；所有 `option.value` 必須為 number。 |
| `float[]` | `select` | `multiple` | 必須提供 `optionSource`；所有 `option.value` 必須為 number。 |
| `float[]` | `checkbox` | `multiple` | 必須提供 `optionSource`；所有 `option.value` 必須為 number。 |
| `boolean` | `checkbox` | `null` 或省略 | 不使用 `optionSource`；instance value 為 boolean。 |
| `materialRef` | `text` | `null` 或省略 | Payload 為 string，可使用 `validation.regex`、`validation.minLength`、`validation.maxLength`。 |
| `materialRef` | `select` | `single` | 必須提供 `optionSource`；所有 `option.value` 必須為 string。 |
| `materialRef[]` | `select` | `multiple` | 必須提供 `optionSource`；所有 `option.value` 必須為 string。 |
| `materialRef[]` | `checkbox` | `multiple` | 必須提供 `optionSource`；所有 `option.value` 必須為 string。 |
| `geometryRef` | `null` 或省略 | `null` 或省略 | 不使用 `optionSource`、`validation` 或 `unit`；instance value 為 geometry DB id string 或符合 flow edge 規則的 `null`。 |
| `coordinates` | `gds` | `null` 或省略 | 不使用 `optionSource` 或 `validation`；可使用 `unit`。GDS path、layer 與 datatype 只作為 import UI 的暫時輸入，instance value 只保存 `number[][]`。 |
| `coordinates` | `coordinateList` | `null` 或省略 | 不使用 `optionSource` 或 `validation`；可使用 `unit`。Manual UI 可新增多列 x/y inputs，instance value 只保存 `number[][]`。 |
| `fieldGroupArray` | `repeater` | `null` 或省略 | 必須提供 `repeatDefinition`；child field 不可使用 `geometryRef`、`coordinates` 或 `fieldGroupArray`。 |

不支援的組合不可存入 process step template。特別是 `boolean[]`、`coordinates[]`、`fieldGroupArray[]`、`referenceSelect` 與巢狀 `fieldGroupArray` 均不屬於目前 FieldDefinition schema。


## ProcessFlowTemplate

代表封裝技術平台的標準 process graph。Process flow template 不儲存 TV/Product 實際 value，也不直接定義欄位；它定義 geometry input slots、引用 global step template，並用 directed edges 表示 process steps 之間的連接關係。

同時也可以把他視為 geometry 物件的資料流。所有 process 都會有對應的幾何輸入以及幾何輸出

必要欄位：

- `id`：此 process flow template 在 DB 中 ID。是系統識別碼、DB key 或不可變 reference key。
      - 例如 `XXX-Tech`。每個 published flow template version 應有自己的 `id`，讓 instance 的 `processFlowTemplateId` 可直接鎖定到單一不可變 snapshot。
- `name`：人可讀的 package technology name，人閱讀以及UI顯示 name
- `version`：人閱讀以及UI顯示 version
- `description`：描述此process flow technology用途，並且提供在UI顯示
- `owner`：負責此 process flow template 的 owner 或 owning team
- `stepRefs`：`stepRefs` 代表 process flow template 對 global step template 的引用清單。每一筆 `stepRefs[]` item 包含：
  - `stepRefId`：此 process step 在此 process flow template 中的 ID (local) 
      - 是 flow 內穩定 reference，用於 flow edge、instance value set、diff 與 UI anchor。
      - 為什麼process step 引用不直接用 global id ? 因為同一個 process step template 可能被在同一個 process flow template 被引用多次，如果想同，在instance就會造成同時有兩個指向相同 process step 卻用不同 value。因此 `flowEdges[]` 必須使用 `stepRefId` 連接 nodes，不可使用 global 
      - array order 不代表 process flow 順序。真正的 flow topology 由 `flowEdges[]` 表示
  - `processStepTemplateId`：引用 process step template 的 global ID
- `flowEdges`：代表 process graph 的 directed acyclic edges。
  - `flowEdges[]` 中每個 item 包含參數：
    - `edgeId`：edge 在 flowEdges 中的 ID。
    - `source`：edge 的 geometry 來源，可以是 geometry DB 或 step output。
      1. geometryRef：表示來源為 geometry DB。
        ```json
        {
          "sourceType": "geometryRef",
        }
        ```
      2. stepOutput：表示來源為某個 process step 完成後產生的 output geometry。

        ```json
        { "sourceType": "stepOutput", "stepRefId": "micro_bump_formation"}
        ```
        - `stepRefId`：來源 step 在 process flow template 的 local id
    - `target`：edge 的目標，永遠是某個 process step input slot。使用以下 shape：
      ```json
      {
        "stepRefId": "pnp",
        "targetFieldId": "soic_geometry"
      }
      ```
      - `stepRefId`：輸入 step 在 process flow template 的 local id
      - `targetFieldId: string` 表示來源 geometry 被導入到 target step 的哪個 field (field ID)
        - stepRefId 中對應 targetFieldId 的參數 valueType 必須是 ```geometryRef```

  - Flow graph 只描述真實幾何物件在 process steps 之間的加工順序與匯入關係。厚度、warpage、process state 或 recipe parameter 這類非 geometryRef 欄位不由 graph edge 傳遞；它們保存在 `FieldValue.value`，由使用者在 step form 中填寫，或由 computed field 在同一個 step value set 內計算。

  - Geometry resolve 規則：
     - 若 target `geometryRef` 的 `FieldValue.value` 是 string，runtime 使用該 geometry DB id。
     - 若 target `geometryRef` 的 `FieldValue.value` 是 `null`，target 必須有且只能有一條 incoming edge，且該 edge source 必須是 `stepOutput`。
     - `geometryRef` source 代表 instance 必須在 target `geometryRef` field value 中提供明確 geometry DB id；此情況不可使用 `null`。
     - 若 source step 尚未產生 output geometry DB id，依賴該 output 且 value 為 `null` 的 target field 不算 complete。

  - Flow graph 規則：
     - 每個 process flow 是一個 directed acyclic graph，不能有 cycle。
     - 每個 target `geometryRef` field 必定只能有一條 incoming edge。
     - 每個 process step 可以有多個 `geoemetryRef` field
     - process step incoming edge 數量等於 `geoemetryRef` field 數量
     - 若某個 `geometryRef` field 在 instance 中使用 `null`，該 field 必須有一條 incoming `stepOutput` edge。
     - Process step 只能也必定只有一條 outgoing edge。

## ProcessFlowInstance

代表特定 TV/Product 的 process flow。

必要欄位：

- `id`
- `name`
- `processFlowTemplateId`：指向此 instance 所引用的 process flow template ID
- `stepValueSets`

必要設計：

- Instance 建立後鎖定 `processFlowTemplateId`，任何後續 edit、import、save 或 API update 都不得修改此欄位。
- Process flow template 更新不會、也不得改變既有 instance 的 binding。
- Published template 不可直接修改；若同一 TV/Product 需要使用新版 template，必須建立新的 `ProcessFlowInstance`，不可在既有 instance 上切換 `processFlowTemplateId`。
- UI 可以提供「由舊 instance 建立新版 instance」的複製流程，但輸出的資料會是 template 用與舊相同 id 但是 instance 為新 id

### StepValueSet and FieldValue

`StepValueSet` 代表某個 step ref 在 instance 中的實際填值集合。Step value set 只屬於某個 `ProcessFlowInstance`，不回寫 global step template 或 process flow template。

每個 `StepValueSet` 包含：

- `stepRefId`：用此 value set 的 process step 在 process flow template 中的 local id。 
    - 必須對應到 instance 綁定的 `ProcessFlowTemplate.stepRefs[].stepRefId`。
- `processStepTemplateId`：用此 value set 的 process step 所參照 process step template 的 global id。 
    - 是 export/debug 用的 denormalized snapshot，必須與 `stepRefId` resolve 結果一致。
- `fieldValues`：每個 field 實際值
    - 每個 `FieldValue` 包含：
        - `fieldId`：該 field 在 process step template 中的 local id
            - `fieldId` 必須對應到該 step template version 中存在的 `FieldDefinition.id`
            - repeat item child `fieldId` 必須對應到 parent `repeatDefinition.itemFieldDefinitions[].id`。
        - `value`
          - `value` 必須符合對應 `FieldDefinition` 的 `valueType`、`controlType`、`unit`、`validation`、`optionSource` 與 `repeatDefinition` 規則。
          - `valueType: "geometryRef"` 時，`value` 必須是 geometry DB id string，或符合 flow edge resolve 規則的 `null`。
          - `valueType: "coordinates"` 時，`value` 必須是 `number[][]`；每個 item 必須是固定長度為 2 的 `[x, y]`，代表 global bottom-left coordinate，且不可包含重複 coordinate pair。

Field completion 規則：

- 若某個 `FieldDefinition` 出現在 process step template 中，UI 需讓使用者填寫或選取對應 value。
- `FieldValue.value` 需符合對應 `FieldDefinition` 的 value type 與 validation rule，才算 complete。`coordinates` 目前不使用 `validation`；空 array 合法，符合 `number[][]` shape 且沒有重複 coordinate pair 即可視為 complete。
- `computed` 欄位需由前端依 `derivedRule` 計算出 value，才算 complete。
- `repeater` 欄位需符合 `repeatDefinition.minItems` / `maxItems`，且每個 repeat item 的 child fields 都需 complete。
- geometryRef payload 規則如下：`string`：geometry database 中的 `GeometryEntity.id`。`null`：不在此欄位手動指定 geometry DB id，runtime 必須依`ProcessFlowTemplate.flowEdges[]` 從上游 process step output 取得 geometry DB id。
