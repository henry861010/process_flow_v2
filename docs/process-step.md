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
4. 奇數層先呼叫 `state.depositLayer({ material: Dielectric,
   thickness: thk })` 建立 dielectric body 並推進 cursor；接著呼叫
   `state.addViaBelowCursor({ material: Conductivity, density,
   thickness: thk, direction: "-z" })`，建立覆蓋剛沉積 layer 的 downward
   via feature。
5. 偶數層先呼叫 `state.addCircuitAtCursor({ material: Conductivity,
   density, thickness: thk })`，建立從 `cursorZ()` 到
   `cursorZ() + thk` 的 circuit feature；接著呼叫
   `state.depositLayer({ material: Dielectric, thickness: thk })` 建立
   dielectric body，並將 cursor 推進到該層頂面。
6. Body、Circuit、Via 都加入 `main_geometry` root scope。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body`、`Via`、`Circuit` 或 raw
  geometry object。
- Via 建立在奇數層 dielectric deposit 之後，使用 `addViaBelowCursor()` 讓 via
  envelope 正好落在剛沉積的 layer 中，方向固定為 `"-z"`。
- Circuit 建立在偶數層 dielectric deposit 之前，使用當下的 `cursorZ()` 作為
  feature bottom Z；這避免新增額外 `ProcessGeometryState` method。
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

## saw

`saw` 是 `saw` 類別的 process step，用來模擬 wafer sawing 後只保留指定
XY 矩形區域的動作。此 step 的裁切範圍會套用到整棵 root geometry tree。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `saw` |
| Category | `saw` |
| Program | `saw/saw` |
| Template id | `step_tpl_saw_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 輸入的 `ProcessGeometryState`；geometry kernel 會在 step 執行前 resolve 此 geometry input。 |
| `bottomLeftX` | `float` | `processParameter` | 切割後要保留的左下角 X 座標。 |
| `bottomLeftY` | `float` | `processParameter` | 切割後要保留的左下角 Y 座標。 |
| `topRightX` | `float` | `processParameter` | 切割後要保留的右上角 X 座標，必須大於 `bottomLeftX`。 |
| `topRightY` | `float` | `processParameter` | 切割後要保留的右上角 Y 座標，必須大於 `bottomLeftY`。 |

實作行為：

1. 從 kernel context 取得已 resolve 的 `main_geometry`
   `ProcessGeometryState`。
2. 驗證 `bottomLeftX`、`bottomLeftY`、`topRightX`、`topRightY` 都是
   finite number，且 retained rectangle 是非空矩形。
3. 呼叫 `main_geometry.sawToBox({ bottomLeftX, bottomLeftY,
   topRightX, topRightY })`。
4. Kernel public API 會遞迴裁切 root scope、child scopes、bodies、vias、
   circuits 與 bumps，只保留位於 retained rectangle 內的 XY 區域。
5. 完全落在 retained rectangle 外的 feature 或 child scope 會被移除。
6. 裁切完成後，runtime process footprint 更新為 retained rectangle，
   後續 molding、RDL 或 bump formation 會沿用切割後的 footprint。
7. `cursorZ` 不會改變，因為 saw 只改變 XY 保留範圍，不代表 Z 方向
   process plane 移動。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body`、`Via`、`Circuit`、`Bump`
  或 raw geometry object。
- Process step 只呼叫 `ProcessGeometryState.sawToBox()`；遞迴 traversal、
  primitive clipping 與 child scope 移除都由 geometry kernel/domain model
  public methods 處理。
- `BoxGeometry` 會被裁切成 retained rectangle 的交集。
- `PolygonGeometry` 支援矩形 clipping，輸出仍保存為 `PolygonGeometry`。
- `CylinderGeometry` 與 `ConeGeometry` 只有完全位於 retained rectangle 內時
  會保留，完全位於外部時會移除；若被 retained rectangle 部分切到，kernel
  會丟出錯誤，避免用目前 primitive 表示不了的幾何交集。
- Via 與 bump 的 `direction` 不會因 saw 改變，因為 saw 不反轉 Z axis。

## Carrier Bond

`Carrier Bond` 是 `carrier` 類別的 process step，用來模擬製程中把 carrier
bond 到目前 wafer/package geometry 最上方的動作。此 step 只複製
`carrier_geometry` root container 直接持有的 bodies，並把它們加入
`main_geometry` 的 root container direct bodies。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `Carrier Bond` |
| Category | `carrier` |
| Program | `carrier/bond` |
| Template id | `step_tpl_carrier_bond_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 接收 carrier bond 結果的主 geometry state。 |
| `carrier_geometry` | `geometryRef` | `inputState` | 要被複製並疊到主 geometry 最上方的 carrier geometry state。 |

實作行為：

1. 從 kernel context 取得已 resolve 的 `main_geometry` 與
   `carrier_geometry` `ProcessGeometryState`。
2. 呼叫 `main_geometry.bondCarrierGeometry(carrier_geometry)`。
3. Kernel 以 `main_geometry.geometryZMax()` 作為 carrier bond bottom Z；此
   Z reference 會納入 root direct bodies、vias、circuits、bumps 與 child scopes
   中所有 geometry 的最高點，而不是使用 runtime `cursorZ()`。
4. Kernel 只複製 `carrier_geometry` root direct bodies，不複製 carrier 的
   child scopes、vias、circuits 或 bumps。
5. 若 carrier 有多個 root direct body，kernel 會保留它們彼此的 Z stack 關係，
   將整組 direct-body stack 的 `zMin` 對齊到 main geometry top。
6. 複製後的 carrier bodies 會成為 `main_geometry` root container direct
   bodies，不會成為 child scope。
7. `cursorZ` 更新為 bonded carrier stack 的 top Z。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body` 或 raw geometry object。
- `entityType` 是 `GeometryEntity` metadata，不保存在 `GeometryStructure`
  裡；runtime process step 不檢查 `entityType`。Carrier selection 與
  carrier 不含 child 的治理由 geometry database / UI template 使用
  `entityType: "carrier"` 保證。
- 此 step 不更新 runtime process footprint。Carrier bond 是把既有 carrier
  solid bodies 疊到完整 geometry 最上方，不代表重新定義後續 full-area process
  footprint。
- 若 `carrier_geometry` root container 沒有 direct body，kernel 會丟出錯誤，
  因為沒有可 bond 的 carrier solid body。

## Debond

`Debond` 是 `carrier` 類別的 process step，用來模擬製程中 carrier
debond。此 step 只移除 `main_geometry` root container 直接持有的最上方
body，不會移除 child scope 內的 body。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `Debond` |
| Category | `carrier` |
| Program | `carrier/debond` |
| Template id | `step_tpl_debond_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 輸入的 `ProcessGeometryState`；geometry kernel 會在 step 執行前 resolve 此 geometry input。 |

實作行為：

1. 從 kernel context 取得已 resolve 的 `main_geometry`
   `ProcessGeometryState`。
2. 呼叫 `main_geometry.removeTopRootBodies()`。
3. Kernel public API 只檢查 root container 直接持有的 bodies，找出最高的
   `zMax()`。
4. 若多個 root direct body 有相同最高 `zMax()`，這些 body 會全部移除。
5. 若 root container 沒有 direct body，此 step 為 no-op，不丟出錯誤。
6. 移除後 `cursorZ` 更新為新的 `rootBodyZMax()`；若沒有移除任何 body，
   `cursorZ` 維持不變。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body` 或 raw geometry object。
- Debond 只移除 root container direct bodies；child scopes 內的 bodies
  不受影響。
- Debond 不移除 root direct vias、circuits、bumps，也不移除 child scopes
  內的 vias、circuits、bumps。
- Debond 不清除 runtime process footprint。後續 full-area operation 仍可沿用
  原本 footprint。

## Flip

`Flip` 是 `flip` 類別的 process step，用來把 `main_geometry` 沿 Z axis
做上下翻轉。此 step 會翻轉整棵 geometry tree，包含 root direct geometry、
features 與 child scopes。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `Flip` |
| Category | `flip` |
| Program | `flip/flip` |
| Template id | `step_tpl_flip_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 輸入的 `ProcessGeometryState`；geometry kernel 會在 step 執行前 resolve 此 geometry input。 |

實作行為：

1. 從 kernel context 取得已 resolve 的 `main_geometry`
   `ProcessGeometryState`。
2. 呼叫 `main_geometry.flipAroundZ({ z: 0, normalizeZMinToZero: true,
   updateCursor: false })`。
3. `flipAroundZ()` 會翻轉 bodies、vias、circuits、bumps 與 child scopes，
   並保持所有 geometry primitive 使用正厚度表示。
4. 被翻轉範圍內的 directional features 會同步反轉方向：
   via 與 bump 的 `"+z"` / `"-z"` 會互換。
5. 翻轉後會把整體 geometry normalize，使完整 tree 的 `zMin` 成為 `0`。
6. 呼叫 `main_geometry.setCursorZ(main_geometry.rootBodyZMax())`，將
   `cursorZ` 更新為 root container direct bodies 的最高 top Z。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body`、`Via`、`Circuit`、`Bump`
  或 raw geometry object。
- `rootBodyZMax()` 只看 root container 的 direct bodies，不會把 child scopes、
  root vias、root circuits 或 root bumps 納入 cursor 計算。
- `geometryZMax()` 是完整 geometry tree 的最高點；Flip 不使用它更新 cursor，
  避免 PnP child 或翻轉後位於上方的 feature 改變 root process cursor。
- 若 root container 沒有 direct body，`rootBodyZMax()` 依 kernel bounds API
  的空集合慣例回傳 `0`。

## Under Fill

`Under Fill` 是 `UF` 類別的 process step，用來模擬 underfill material
流入 bump 與 die 之間，以及 root scope 下 die-to-die gap 的填充。

Template metadata：

| Field | Value |
| --- | --- |
| Name | `Under Fill` |
| Category | `UF` |
| Program | `uf/under_fill` |
| Template id | `step_tpl_under_fill_1_0_0` |

參數：

| Field id | Value type | Scope | Description |
| --- | --- | --- | --- |
| `main_geometry` | `geometryRef` | `inputState` | 輸入的 `ProcessGeometryState`；geometry kernel 會在 step 執行前 resolve 此 geometry input。 |
| `material` | `materialRef` | `processParameter` | Underfill material 名稱或 material DB entity id。 |
| `thk` | `float` | `processParameter` | Root die-to-die gap fill 的高度，從 `cursorZ()` 到 `cursorZ() + thk`。 |
| `gap` | `float` | `processParameter` | 允許填充的最大 die-to-die XY gap 距離。 |

實作行為：

1. 從 kernel context 取得已 resolve 的 `main_geometry`
   `ProcessGeometryState`。
2. 呼叫 `main_geometry.applyUnderFill({ material, thk, gap })`。
3. Kernel 只檢查 root direct child scopes，並以 child bounds 的 `zMax >
   cursorZ()` 判斷 child 是否位在目前 process plane 以上。
4. 對每個符合條件的 child scope，recursive 搜尋其內部所有 bump feature。
   若 child scope 沒有 bump，該 child 不做 bump-side underfill。
5. 若 child 內已有 body 覆蓋 bump 的完整 Z 區間，且 XY bounds 覆蓋該
   child 的整體 XY bounds，視為已 fill，避免重複新增 underfill body。
6. 若需要補 bump-side underfill，kernel 以 child 整體 XY bounds 建立一個
   underfill body，Z 範圍使用該 child 內所有 bump 的整體
   `min(zMin)` 到 `max(zMax)`。因此當 child 底部不是單一平面或多個 bump
   高度不一致時，underfill body 的厚度會是整體 bump Z range，而不是任一顆
   bump 的單獨厚度。
7. Root die-to-die gap 使用 `src/process/utils/region.js` 中 reusable
   `Region` utility。Kernel 將符合條件的 root child 整體 XY bounds 轉成
   `BOX` faces，呼叫 `Region.setGap(gap, { isRecursive: true })` 找出小於或
   等於 `gap` 的 grid gap cells，再用 `Region.getOutline()` 轉回 polygon
   footprint。
8. 若存在 die-to-die gap polygon，kernel 會在 root scope 下新增一個
   `underfill-gap` child scope，並在該 scope 中新增 underfill polygon body；
   其底面 Z 為 `cursorZ()`，厚度為 `thk`。
9. 此 step 不調整 `main_geometry.cursorZ()`。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body`、`Bump` 或 raw geometry
  object；process module 只呼叫 `ProcessGeometryState.applyUnderFill()`。
- `Region` utility 是從舊 Python `Region` class 的 grid/mask-based
  `set_gap` 流程移植而來，放在 `src/process/utils` 供後續 process steps
  重用。
- 目前 Under Fill 只使用 `set_gap`，尚未啟用舊 Python class 中的
  `set_edge` narrow-edge 補洞流程。
- `gap` 判斷沿用舊 `set_gap` 行為，使用 `<= gap`。

## Bump Formation

`Micro Bump`、`BGA Bump` 與 `C4 Bump` 是 `bump` 類別的 process
steps，用來在 die geometry 目前 process surface 上方形成朝 `"+z"` 方向的
bump density feature。
這三個 step 的幾何行為相同，只透過 template id、name 與 program path 區分不同
bump type。這些 step 預期用在 die geometry，不作為 wafer-level bump formation
使用。

Template metadata：

| Name | Category | Program | Template id |
| --- | --- | --- | --- |
| `Micro Bump` | `bump` | `bump/uBump_formation` | `step_tpl_ubump_formation_1_0_0` |
| `BGA Bump` | `bump` | `bump/bga_bump_formation` | `step_tpl_bga_bump_formation_1_0_0` |
| `C4 Bump` | `bump` | `bump/c4_bump_formation` | `step_tpl_c4_bump_formation_1_0_0` |

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
3. 呼叫 `main_geometry.addBumpAboveCursor({ material, density,
   thickness: thk, direction: "+z", xyInset: koz })`。
4. Bump geometry 使用 `main_geometry` 目前的 process footprint，並依 `koz`
   做 XY 內縮。Bump bottom Z 為 `main_geometry.cursorZ()`，top Z 為
   `main_geometry.cursorZ() + thk`。
5. 新增的 bump feature 會加入 `main_geometry` root scope 的 `bumps`。
6. 此 step 不會推進或修改 `main_geometry.cursorZ()`。

設計要點：

- 此 step 不直接建立或修改 `Container`、`Body`、`Bump` 或 raw geometry object。
- `koz` 內縮透過 geometry primitive 的 public copy API 執行；Box、Cylinder 與
  Cone footprint 支援此操作。Polygon footprint 不支援非零 `koz`。
- Bump direction 固定為 `"+z"`，不由 geometry envelope 的 Z 位置推論。
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
