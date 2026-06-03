# Geometry Interpretation Context

這份文件整理 geometry kernel 在讀取 geometry structure 時最重要的脈絡概念。
它不描述 JSON 欄位結構，也不作為 schema 文件；重點是說明 container tree
如何被解讀、實體體積如何歸屬，以及 via、circuit、bump 這類 feature 的作用範圍。

## 核心心智模型

Geometry structure 是一棵從 root container 開始的 container tree。Container
本身是語意分組與作用域邊界，不是材料，也不直接佔有實體體積。真正佔有物理
體積的是 container 內的 body。

目前 structure 裡的座標都視為 global coordinates。Container 不提供 local
transform，也不會因為 parent-child 關係自動套用位移、旋轉或縮放。因此 viewer、
geometry engine 與 CAD exporter 在建立幾何時，可以直接使用各 geometry primitive
內的座標；parent-child 關係主要用來表達語意層級與 ownership，而不是座標轉換。

這個 global coordinate 規則描述的是讀取或序列化後的 geometry structure。Runtime
process API 可以在產生 structure 的過程中移動、翻轉或裁切整棵 container subtree，
例如把 die container 放到目前製程高度；這類操作會直接改寫 primitive coordinates。
一旦輸出成 structure，結果仍然只保存絕對座標，不保存 container transform，也不要求
reader 依 parent-child 關係再套一次 transform。

讀取時要把每個 container 視為一個 scope：

- Container 直接持有自己的 bodies、vias、circuits、bumps。
- Child container 是更細、更具體的 geometry scope。
- Parent container 可以代表外殼、背景體積、封裝區、mold 或其他較粗的基底。
- Child container 可以代表 die、局部結構、局部製程結果或更高優先權的幾何描述。

## Ancestor-Descendant Volume Ownership

當 descendant container 內的 body 和 ancestor container 內的 body 在空間上 overlap
時，overlap 區域的 physical volume ownership 屬於 descendant body。這個規則不限於
direct parent-child；只要兩個 container 位在同一條 ancestor-descendant chain 上，
較深層的 body 會取代較上層的 body。

這是 geometry 解讀裡最重要的 composition rule：descendant container 會取代
ancestor container 在重疊區域的語意。也就是說，ancestor body 不應該和 descendant
body 在同一個空間被加總成兩份材料或兩份體積；該區域應由 descendant body 的材料與
幾何語意代表。

典型情境是 ancestor body 表示 mold compound 或 package-level background volume，
而 descendant body 表示 die silicon。若 die body 落在 mold body 內，重疊的那段體積
要被視為 die silicon，而不是 mold compound 加 silicon 疊在一起。

對 viewer 來說，即使第一版只做視覺化、沒有真的執行 boolean subtraction，也必須
保留這個語意：descendant overlap ancestor 的區域屬於 descendant。之後若要做準確
體積計算、材料統計、cross-section、mesh generation 或 CAD export，都應以這個
ownership rule 為準。

這個規則只明確定義 ancestor-descendant chain 上的 overlap。若同一個 container 內
的 sibling bodies 互相 overlap，或不同 child branches 內的 cousin/sibling container
bodies 互相 overlap，structure 本身不定義哪一個 body 擁有該 overlap volume。資料
建模時應避免依賴這類非 ancestor-descendant overlap 的 ownership。CAD exporter 目前
可以在 export-time 對同 container、同材質、互相 overlap 的 sibling bodies 做 union，
並保留 source ids；若同 container 內異材質 sibling bodies 發生實體 overlap，
exporter 會拒絕輸出，避免產生不明確的 CAD 結果。

## Feature Scope

Via、circuit、bump 都是 density-based feature。它們不是像 body 那樣宣告完整的
solid ownership，而是在某個 container scope 裡描述局部製程或結構效果。

這三類 feature 的作用 scope 由「它們放在哪一個 container 的 array 裡」決定，而
不是單純由幾何座標或空間 overlap 決定。Feature 的 geometry 是該 feature 自己的
spatial envelope；density-based 計算若需要有效體積，預設以這個 envelope 的幾何體積
乘上 density 解讀。這個 feature envelope 不會變成 body ownership，也不參與
ancestor-descendant body subtraction。

換句話說，feature.geometry 決定 feature 在空間中描述哪一段局部效果，container
array 決定這段效果屬於哪個 scope。Feature 不會因為 envelope overlap 到 parent、
child 或 sibling container 的 body，就自動套用到那些 container；也不會因為 owner
container 裡剛好有 body，就被隱含裁切成 feature.geometry 與該 body 的交集。若某個
下游 solver 需要採用 body-bounded 的 feature 計算，必須把這當成該 solver 的額外
策略明確宣告，不能反過來改寫 geometry structure 的基本語意。

Via 與 bump 另外保存 `direction`，用來描述 feature 在 global Z axis 上的方向語意。
每個 via 與 bump 都必須提供 `direction`；缺少 `direction` 的 via 或 bump payload
不符合 `standard` structure。`direction` 不改變 feature.geometry 的 spatial
envelope，也不能由 feature.geometry 的 `zMin`、`zMax`、底面或頂面位置反向推論。
Geometry envelope 描述 feature 的空間範圍；`direction` 描述該 feature 往哪個
Z 方向成長、連接或作為 process normal。

規則如下：

- Via 只作用在持有該 via 的 container。
- Circuit 只作用在持有該 circuit 的 container。
- Bump 只作用在持有該 bump 的 container。
- 它們不會向上套用到 parent container。
- 它們不會向下套用到 child container。
- 它們不會因為幾何範圍 overlap 到別的 container，就自動變成別的 container 的 feature。
- Via 與 bump 的方向由各自的 `direction` 欄位決定，不由 Z 位置、container 層級或
  material 推論。

例如 root container 有一個 via feature，而 child container 裡有 die body。即使
root via 的幾何範圍和 child die 的空間位置 overlap，該 via 仍然只屬於 root
container scope，不會自動作用到 die。反過來，若 die container 裡有 bump 或
circuit，它們也只屬於 die container，不會自動作用到 package root。

## Via、Circuit、Bump 的語意差異

Via、circuit、bump 的共同點是：它們都有自己的幾何作用範圍、材料與 density，
並且都被限制在所屬 container scope 內。Via 與 bump 也具有 Z-axis direction；
circuit 不保存 direction。

它們的差異在於 feature type：

- Via 表示該 container scope 內的 via density 或垂直互連效果。Via 必須保存
  `direction`，其值為 `"+z"` 或 `"-z"`。
- Circuit 表示該 container scope 內的 circuit/routing density 或平面線路效果。
- Bump 表示該 container scope 內的 bump、solder 或接點類效果。Bump 必須保存
  `direction`，其值為 `"+z"` 或 `"-z"`。

Geometry engine 應由 feature 所在的 collection 判斷類型，而不是只看 material
或 geometry primitive。換句話說，同樣是 copper material，放在 vias、circuits
或 bodies 中代表不同語意。

## Feature Direction and Flip

`direction` 使用 global coordinate system 解讀：

- `"+z"` 表示 feature 從 lower-Z side 指向 higher-Z side。
- `"-z"` 表示 feature 從 higher-Z side 指向 lower-Z side。

`direction` 是獨立於 geometry primitive 的語意欄位。讀取 Via 或 Bump 時，reader
必須同時保留 geometry envelope 與 direction。Geometry envelope 的底面、頂面、
`thk` 或實際 Z 位置只能描述空間範圍，不能替代 direction。

Process operation 對 direction 的影響如下：

- 平移、複製、裁切、厚度調整與不反轉 Z axis 的幾何操作不改變 direction。
- 將整個 structure 或某個 container subtree 以 XY plane 做 flip 時，該 flipped
  scope 內所有 via 與 bump 的 direction 反轉。
- Direction 反轉規則固定為 `"+z"` 變成 `"-z"`，`"-z"` 變成 `"+z"`。
- Body 與 circuit 沒有 direction 欄位，不參與 direction 反轉。

Flip 後的 geometry primitive 仍以標準 Geometry 結構表示，使用正 `thk` 與更新後的
global coordinates。Flip 不透過負厚度表示，也不以保留原 geometry 再附加 transform
表示。輸出後的 structure 仍是沒有 local transform 的 global-coordinate structure。

## 建議讀取流程

讀取 geometry structure 時，可以採用以下順序：

1. 從 root container 開始。
2. 讀取目前 container 的 bodies，建立這個 container scope 的 solid volume。
3. 讀取目前 container 的 vias、circuits、bumps，建立只屬於目前 container scope
   的 density features 或 overlay。
4. 遞迴讀取 child containers。
5. 套用 ancestor-descendant volume ownership：descendant body 和 ancestor body
   overlap 時，overlap volume 由 descendant body 取代 ancestor body。

這個流程的重點是分開兩件事：body 決定 physical volume ownership，via/circuit/bump
決定 local feature effect。Feature scope 不能跨 container 傳播；body overlap
ownership 則只在 ancestor-descendant composition 中有明確規則。

## 實作與資料建模注意事項

- Container 是 scope，不是材料。
- Body 是實體體積與材料 ownership 的主要來源。
- Descendant body overlap ancestor body 時，descendant body 取代 ancestor body。
- Ancestor-descendant overlap 不代表兩份體積相加。
- 非 ancestor-descendant 的 body overlap 沒有通用 ownership 語意，應避免在資料上依賴。
- Via、circuit、bump 只作用在所屬 container。
- Via 與 bump 的 direction 是必要語意，不從 geometry envelope、material 或 container
  位置推論。
- Feature scope 由 array 所在 container 決定，不由空間 overlap 決定。
- Feature 的 density effect 預設以自己的 geometry envelope 表達，不隱含裁切到
  owner container body，也不參與 body ownership subtraction。
- Z-axis flip 會反轉 flipped scope 內所有 via 與 bump direction。
- Viewer 可以先不做 boolean subtraction，但文件解讀與後續計算必須保留 descendant
  ownership rule。
- CAD export 可以有額外的 export-time 保護與合併策略，但不能反過來改寫 geometry
  structure 本身的語意。
