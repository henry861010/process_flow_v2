# Process Step 實作

## molding

`molding` 是 `layer` 類別的 process step，用來模擬 molding material
在目前 package process footprint 上的沉積。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `molding` |
| Category | `layer` |
| Program | `layer/molding` |
| Template id | `step_tpl_molding_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 輸入的 `ProcessGeometryState`；geometry kernel 會在 step 執行前 resolve 此 geometry input。 |
| `material` | `materialRef` | `processParameter` | Molding material 名稱或 material DB entity id。 |
| `thickness` | `float` | `processParameter` | 正值 molding 厚度，單位依照 geometry state 的 unit system 解讀。 |

實作行為：

1. 從 kernel context 讀取已 resolve 的 `ProcessGeometryState`。
2. 呼叫 `state.depositLayer({ material, thickness })`。
3. Geometry kernel 使用 state 目前的 process footprint，建立一個從
   `cursorZ()` 到 `cursorZ() + thickness` 的 body。
4. 新 body 透過 `ProcessGeometryState` public API 加入 root scope。
5. `cursorZ` 前進到 `cursorZ + thickness`。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body` 或 raw geometry object。
- 輸入的 geometry state 必須已經有 process footprint。對於從 persisted
  geometry structure restore 的 state，目前 kernel 會明確地從最大的 direct
  root body hydrate 此 footprint。
- `thickness` 必須為正值。若要表達 thinning 語意，應使用 `grindTo` 或其他專門的
  removal step，而不是使用負的 molding thickness。

## RDL layer

`RDL layer` 是 `layer` 類別的 process step，用來模擬 RDL dielectric
build-up，以及每層對應的 metal routing / via density feature。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `RDL layer` |
| Category | `layer` |
| Program | `layer/rdl` |
| Template id | `step_tpl_rdl_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 輸入的 `ProcessGeometryState`；geometry kernel 會在 step 執行前 resolve 此 geometry input。 |
| `layers` | `fieldGroupArray` | `processParameter` | RDL layer stack。每個 item 描述一層 dielectric body 與對應 conductivity feature。 |

`layers` repeater child fields：

| Field id | Value type | Unit | Description |
| --- | --- | --- | --- |
| `Dielectric` | `materialRef` | - | 此層 dielectric / PM material 名稱或 material DB entity id。 |
| `Conductivity` | `materialRef` | - | 此層 conductivity material 名稱或 material DB entity id。 |
| `thk` | `float` | `um` | 此層厚度，必須為正值。 |
| `density` | `float` | - | Conductivity feature density，保存為 0 到 100 的原始比例值，不轉換成 0 到 1。 |

實作行為：

1. 從 kernel context 讀取已 resolve 的 `main_geometry`
   `ProcessGeometryState`。
2. 逐一處理 `layers`，layer number 從 1 開始計算。
3. 每一層都使用 `main_geometry` 目前的 process footprint 作為 full-area
   geometry envelope。
4. 奇數層先呼叫 `state.addCircuitAtCursor({ material: Conductivity,
   density, thickness: thk })`，建立從 `cursorZ()` 到
   `cursorZ() + thk` 的 circuit feature；接著呼叫
   `state.depositLayer({ material: Dielectric, thickness: thk })` 建立
   dielectric body，並將 cursor 推進到該層頂面。
5. 偶數層先呼叫 `state.depositLayer({ material: Dielectric,
   thickness: thk })` 建立 dielectric body 並推進 cursor；接著呼叫
   `state.addViaBelowCursor({ material: Conductivity, density,
   thickness: thk, direction: "-z" })`，建立覆蓋剛沉積 layer 的 downward
   via feature。
6. Body、Circuit、Via 都加入 `main_geometry` root scope。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body`、`Via`、`Circuit` 或 raw
  geometry object。
- Circuit 建立在奇數層 dielectric deposit 之前，使用當下的 `cursorZ()` 作為
  feature bottom Z；這避免新增額外 `ProcessGeometryState` method。
- Via 建立在偶數層 dielectric deposit 之後，使用 `addViaBelowCursor()` 讓 via
  envelope 正好落在剛沉積的 layer 中，方向固定為 `"-z"`。
- `density` 必須是 0 到 100 的 finite number。Runtime 保存此數值，不在 process
  step 中做百分比轉換。
- `layers` 至少需要一個 item；每層 `Dielectric` / `Conductivity` 必須是非空字串，
  `thk` 必須為正值。

## Grinding

`Grinding` 是 `grinding` 類別的 process step，用來從目前完整 geometry
最高點向下移除指定厚度。此 step 的參考 top Z 是 `main_geometry`
中整棵 geometry tree 的最高點，不是 runtime `cursorZ()`。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `Grinding` |
| Category | `grinding` |
| Program | `grinding/grinding` |
| Template id | `step_tpl_grinding_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 輸入的 `ProcessGeometryState`；geometry kernel 會在 step 執行前 resolve 此 geometry input。 |
| `thk` | `float` | `processParameter` | 正值 grinding 厚度，單位依照 geometry state 的 unit system 解讀。 |

實作行為：

1. 從 kernel context 取得已 resolve 的 `main_geometry`
   `ProcessGeometryState`。
2. 呼叫 `main_geometry.geometryZMax()` 取得目前完整 geometry tree 的最高 Z。
3. 計算 `targetZ = geometryZMax - thk`。
4. 呼叫 `main_geometry.grindTo({ z: targetZ })`，透過 kernel public API
   遞迴裁切 root scope、child scopes、bodies、vias、circuits 與 bumps。
5. 若 `targetZ` 低於目前 `cursorZ()`，`ProcessGeometryState.grindTo()`
   會同步把 cursor 更新到 `targetZ`。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body`、`Via`、`Circuit`、`Bump`
  或 raw geometry object。
- Grinding 的 top reference 是完整 geometry top，因此 PnP 放上的 child die
  或其他高於 cursor 的 feature 也會納入裁切判斷。
- `thk` 必須為正值。
- 允許 `targetZ` 低於目前 geometry bottom；此時被完全磨掉的 geometry
  會從 structure 中移除。
- Grinding 不清除 runtime process footprint。即使 geometry 被磨平，後續
  full-area operation 仍可沿用原本 footprint。

## Bounding Bump Formation

`Micro Bump`、`BGA Bump` 與 `C4 Bump` 是 `bounding` 類別的 process
steps，用來在 die geometry 下方形成朝 `"-z"` 方向的 bump density feature。
這三個 step 的幾何行為相同，只透過 template id、name 與 program path 區分不同
bump type。這些 step 預期用在 die geometry，不作為 wafer-level bump formation
使用。

Template metadata：

| Name | Category | Program | Template id |
| --- | --- | --- | --- |
| `Micro Bump` | `bounding` | `bump/uBump_formation` | `step_tpl_ubump_formation_1_0_0` |
| `BGA Bump` | `bounding` | `bump/bga_bump_formation` | `step_tpl_bga_bump_formation_1_0_0` |
| `C4 Bump` | `bounding` | `bump/c4_bump_formation` | `step_tpl_c4_bump_formation_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 輸入的 die `ProcessGeometryState`；geometry kernel 會在 step 執行前 resolve 此 geometry input。 |
| `material` | `materialRef` | `processParameter` | Bump material 名稱或 material DB entity id。 |
| `thk` | `float` | `processParameter` | 正值 bump 厚度，單位依照 geometry state 的 unit system 解讀。 |
| `density` | `float` | `processParameter` | Bump density，保存為 0 到 100 的 percentage value。 |
| `koz` | `float` | `processParameter` | Keep out zone，表示 bump footprint 相對 process footprint 的 XY 內縮距離。 |

實作行為：

1. 從 kernel context 取得已 resolve 的 `main_geometry`
   `ProcessGeometryState`。
2. 驗證 `material` 為非空字串、`thk` 為正值、`density` 為 0 到 100 的 finite
   number、`koz` 為非負 finite number。
3. 呼叫 `main_geometry.addBumpBelowLowestBody({ material, density,
   thickness: thk, direction: "-z", footprintSource: "processFootprint",
   xyInset: koz })`。
4. `addBumpBelowLowestBody()` 會 recursive 搜尋 `main_geometry` target scope
   tree 內所有 body，使用最低 body 的 `zMin()` 作為 bump top Z。
5. Bump geometry 使用 `main_geometry` 目前的 process footprint，並依 `koz`
   做 XY 內縮。Bump bottom Z 為 `lowestBody.zMin() - thk`，top Z 為
   `lowestBody.zMin()`。
6. 新增的 bump feature 會加入 `main_geometry` root scope 的 `bumps`。
7. 此 step 不會推進或修改 `main_geometry.cursorZ()`。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body`、`Bump` 或 raw geometry object。
- `koz` 內縮透過 geometry primitive 的 public copy API 執行；Box、Cylinder 與
  Cone footprint 支援此操作。Polygon footprint 不支援非零 `koz`。
- Bump direction 固定為 `"-z"`，不由 geometry envelope 的 Z 位置推論。
- Recursive lowest-body 搜尋會把 child scopes 內的 body 納入 Z placement 參考，
  避免 sub geometry 的最低結構低於 root direct body 時 bump 放置錯誤。
- Feature scope 仍由 root `bumps` array 決定；bump 不會自動向 child container
  或 parent container 傳播。

## PnP

`PnP` 是 `PnP` 類別的 process step，用來模擬 die pick and place。此 step
會把 `die_geometry` 複製成多個 die child scopes，並放到 `main_geometry`
的 root scope 下。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `PnP` |
| Category | `PnP` |
| Program | `pnp/pnp` |
| Template id | `step_tpl_pnp_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 接收 die placement 結果的主 geometry state。 |
| `die_geometry` | `geometryRef` | `inputState` | 要被複製並放置到 `main_geometry` 上的 die geometry state。 |
| `coordinates` | `fieldGroupArray` | `processParameter` | Die placement 座標清單。每個 item 使用 `bottemLeftX`、`bottemLeftY` 表示 die copy 的左下角目標 XY 座標。 |

`coordinates` repeater child fields：

| Field id | Value type | Unit | Description |
| --- | --- | --- | --- |
| `bottemLeftX` | `float` | `um` | Die copy 左下角目標 X 座標。 |
| `bottemLeftY` | `float` | `um` | Die copy 左下角目標 Y 座標。 |

實作行為：

1. 從 kernel context 取得已 resolve 的 `main_geometry` 與 `die_geometry`
   `ProcessGeometryState`。
2. 讀取 `main_geometry.cursorZ()` 作為所有 die copy 的 placement bottom Z。
3. 對 `coordinates` 中每一組座標呼叫
   `main_geometry.placeGeometryState(die_geometry, { x, y, bottomZ, anchor: "bottomLeft" })`。
4. `placeGeometryState()` 會預設複製 `die_geometry`，並以 die subtree 的完整
   bounds `zMin` 對齊 `bottomZ`。因此若 die 已有 bump、via、circuit 或其他
   body，die 最底部會一起被納入 placement 對齊。
5. 每個 die copy 會成為 `main_geometry` root scope 的 child scope。
6. 此 step 不會推進或修改 `main_geometry.cursorZ()`。

設計要點：

- Process module 不直接讀寫 `Container.children`，也不直接建立或修改
  `Container`、`Body`、`Via`、`Circuit`、`Bump`。
- 多顆 die 使用同一份 `die_geometry` input，透過 `placeGeometryState()` 的
  default clone 行為避免重複 placement 時互相污染。
- `coordinates` 欄位 id 依目前需求使用 `bottemLeftX` / `bottemLeftY` 拼法；
  runtime module 也接受 `bottomLeftX` / `bottomLeftY` 作為相容 fallback。
- Geometry kernel 在單次 flow execution 期間保留 upstream step output 的
  runtime `ProcessGeometryState`，最後回傳 API/result 時才序列化成
  `GeometryStructure`。這讓 PnP 後的 downstream step 可以看到 PnP 未改變的
  `cursorZ`。
