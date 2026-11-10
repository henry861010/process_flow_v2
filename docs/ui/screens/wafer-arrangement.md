---
title: Wafer arrangement
status: normative
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-11-10
last_verified_commit: 6a7c9a7d
source_of_truth:
  - apps/viewer/components/wafer-arrangement
  - packages/geometry_generators/src/process_flow_geometry_generators/wafer_arrangement.py
  - packages/geometry_generators/src/process_flow_geometry_generators/cow_die_layout.py
  - apps/api/src/process_flow_api/wafer_arrangement.py
---

# Wafer arrangement

Route: `/wafer-arrangement`，由 Home 底部 Tools 入口開啟。手動輸入參數後產生
COW／wafer dummy pattern，並可選取單顆 COW 的 die JSON，一併匯出 GDS 至 API host
的指定路徑。此工具不建立 geometry catalog 或 process flow records。

## 參數與操作

所有長度單位為 µm，數值欄位初始留白。Allowable wafer diameter 必須大於 0 且小於
300000；COW size X/Y 大於 0；COW-to-COW space X/Y 大於等於 0。
Arrange type 預設 Center，可切換 Corner、X half、Y half，所有矩形保持輸入方向。

參數依序分為 CoW feature 與 Wafer arrangement 兩區。CoW feature 包含 size X/Y 與
整合在同一區內的 JSON 檔案操作；Wafer arrangement 包含 allowable diameter、
COW-to-COW space、arrange type、dummy layers 及 Generate pattern。
Read JSON 旁提供 Pattern graph 按鈕；未成功讀取 JSON 時停用。

Dummy layers 預設一層，可新增／移除至零層。每層獨立設定 size X/Y 與 minimum
spacing X/Y，皆大於 0。最小間距只限制同一虛擬 COW 格內的 dummy；跨格距離由
邊緣留白與 COW-to-COW space 決定。移除層後，其餘層依目前順序重新編號。

Generate pattern 顯示參數錯誤摘要並聚焦；摘要連至相應欄位，欄位保留 inline error。
產生期間可修改參數，修改會取消舊請求；即使舊請求較晚返回，也不能覆蓋新結果。
輸入變更後保留上一份圖並顯示 Parameters changed，重新產生前不得匯出。

Desktop 採 360px 參數欄與右側預覽；1024px 以上為並排，小螢幕上下排列。頁面負責
捲動，390px 不得出現整頁橫向捲動。

## COW die JSON

瀏覽器選取一份 `.json`，檔案內容傳送至 API，不需要 API host 的 JSON 路徑。
可更換、重新選取相同檔名或移除；未選取時維持 COW／wafer dummy 匯出。
JSON 可在任意深度的物件或陣列內含 `soc`、`hbm`、`lsi`、`soic`、`dmy`。
每個類型讀取 `{type}Info` 中以 die-ID 為 key 的矩形，使用 `bottomLeftX`、
`bottomLeftY`、`upperRightX`、`upperRightY`，單位 µm、原點為單顆 COW 中心。
`{type}Count` 不參與顆數或截斷計算；顆數以實際 die-ID 條目為準。

同類型的不同區塊合併，該類型內重複 die-ID 為錯誤；不同類型可使用相同 ID。
未出現的類型略過；沒有任何 die、Info 格式錯誤、缺少座標、非有限數字、
右上角不大於左下角，或 1 nm 量化後零面積皆為錯誤，訊息指出資料位置／ID。
已辨識類型的 Info 內容不再作為待搜尋區塊，die-ID 可與類型名稱相同。

單顆 COW viewer 預設隱藏，透過 Read JSON 旁的 Pattern graph 按鈕開啟彈窗，
不必先產生 wafer 即可匯入。彈窗可按關閉按鈕、Escape 或背景關閉，關閉後焦點回到
Pattern graph；開啟時焦點限制在彈窗內，背景不捲動。COW 尺寸尚未有效輸入時只
顯示 die 與原點；尺寸有效時顯示量化後 COW 邊界並檢查越界。
顯示各類型顏色、數量及獨立開關，共用 wafer 的鍵盤／縮放／平移操作。
Inspect die IDs and coordinates 可展開查看座標並選取反白，每頁最多 50 筆。
Fit all 包含越界 die，越界矩形以虛線外框及 ID 錯誤清單標示。

JSON 匯入中、解析失敗或 die 越界時禁止匯出；即使彈窗關閉，CoW feature 仍顯示
讀取狀態或越界提示，越界圖形保留供查看；移除 JSON 可回復
無 die 的流程。更換檔案、移除或修改 COW 尺寸會取消過期讀取／驗證，舊回應不得覆蓋
目前檔案。JSON 變更不要求重算 wafer；COW 尺寸變更仍遵守原有 wafer 待更新規則。
匯出期間鎖定檔案與參數編輯，所有顯示開關只影響預覽。

## 排列與精度

令 `Px = cowX + spaceX`、`Py = cowY + spaceY`，wafer 原點為 `(0,0)`，X 向右、Y 向上。

| Arrange type | COW 中心格點，i/j 為整數 |
| --- | --- |
| Center | `(iPx, jPy)` |
| Corner | `((i+0.5)Px, (j+0.5)Py)` |
| X half | `((i+0.5)Px, jPy)` |
| Y half | `(iPx, (j+0.5)Py)` |

填滿此固定格網中四角都位於 allowable circle 內的 COW，含相切者，不搜尋其他平移或
旋轉。與圓內有面積交集但無法容納完整 COW 的虛擬格，用於放 dummy；格尺寸為 COW
本體尺寸，不包含 COW 間距。各層使用相同格內排列，再移除不完整位於圓內的 dummy。

各軸先在兩端保留正的 A，再求最多顆數，不可為了多放一顆而令 A 為零。以 nm 整數
計算，A 至少為一個 GDS 格點（1 nm）；令 `gFit=max(g,3)`，則
`n=max(0,floor((L-2+gFit)/(d+gFit)))`，其中 L 是 COW 格長、d 是 dummy 尺寸、g 是最小間距。
n 至少 2 時，`T=L-nd`，理想 `B=max(g,3T/(3n-1))`、`A=(T-(n-1)B)/2`。
單顆置中，B 顯示不適用；即使只放單顆也必須保留兩側 A。零顆則該層為空並顯示原因。

引擎共用 1 nm 格點：尺寸四捨五入、最小間距及 COW 間距向上取整。格內 A 向下取整，
餘量分配至 B，使各實際 B 相差最多 1 nm，且皆符合最小值與 `B≥3A`。B 有差異時顯示範圍。
單顆或奇數格點的中心對齊可有最多 1 nm 的不對稱。所有實際矩形在量化後重新檢查圓內條件。

候選量上限 100 萬，包括 COW 格與每層邊界格內的 dummy 候選；輸出矩形上限 10 萬。
匯出上限包含所有完整 COW 內複製的 die，先計算總量再展開，超限不寫入 GDS。
超限顯示錯誤，不返回部分結果。無完整 COW 可預覽，但不得匯出。零顆 dummy 顯示警告，
不阻止其他圖層匯出。

## 預覽與匯出

預覽包含 allowable circle、座標軸、COW、虛擬邊界格及每層 dummy。顯示 COW 數、COW
面積除以 allowable circle 面積的百分比、dummy 總數，以及各層數量、每格顆數、A／B。
可單獨切換 COW、虛擬格及各層顯示。切換只影響預覽，GDS 包含全部設定圖層。

初次開啟即顯示 300000 µm wafer reference 圓與座標軸，參數欄維持空白。參考外圈持續
保留，輸入有效的 allowable diameter 時即時顯示對應大小的主色圓與淡色填滿區域，
無須先填其他欄位或呼叫 API。已有 pattern 時也會即時更新 allowable 圓，舊排列保留；
直徑不同時另以虛線標示 Previous pattern 圓與原直徑，仍須 Generate 才能更新排列與
匯出。無效輸入不繪製新圓，已有 pattern 則沿用其直徑；參考圓不代表已有可匯出的排列。

拖曳平移，Ctrl/⌘ + wheel 縮放，一般 wheel 捲動頁面；鍵盤方向鍵平移，+/− 縮放，Home
或 Fit all 顯示完整圖，包括虛擬格。提供有 accessible name 的縮放按鈕。

Output file path 必須是 API host 上的 absolute `.gds` 路徑，資料夾需存在。匯出期間停用
參數及路徑編輯，顯示 Exporting；成功顯示矩形數與可選取的完整路徑。失敗保留輸入供重試。
已存在的檔案在暫存檔寫入、設定既有匯出權限成功後原子替換；任何失敗保留原檔。

| 圖形 | GDS layer:datatype |
| --- | --- |
| COW | `100:100` |
| Dummy layer 1、2、3… | `413:10`、`413:11`、`413:12`… |
| SOC／HBM／LSI／SOIC／DMY die | `888:1`／`888:2`／`888:3`／`888:4`／`888:5` |

單一頂層 cell 為 `WAFER_ARRANGEMENT`，包含扁平矩形 boundary，user unit 為 1 µm、
precision 為 1 nm。圓周、座標軸及虛擬格不匯出。
die 僅複製至完整 COW，不放入邊界虛擬格。die 先量化至 1 nm，再以 COW 中心整體平移；
中心在半格點時固定朝 +X／+Y 對齊，最多偏移 0.5 nm，保持矩形尺寸。邊界檢查使用相同
中心規則與最終座標，貼齊邊界可接受，越界拒絕匯出。die-ID 不另輸出為 GDS 文字。

## API

`POST /api/wafer-arrangement/preview` 接收以下 JSON，回傳 normalizedParameters、
cowRectangles、boundaryCells、dummyLayers、cowCount、cowAreaUtilization、
totalRectangles 及 warnings。矩形格式為 `[xmin,ymin,xmax,ymax]`，單位 µm。

```json
{
  "allowableDiameter": 290000,
  "cowSize": {"x": 40000, "y": 50000},
  "cowSpacing": {"x": 1000, "y": 1000},
  "arrangeType": "center",
  "dummyLayers": [
    {"size": {"x": 8000, "y": 10000}, "minSpacing": {"x": 100, "y": 100}}
  ]
}
```

`arrangeType` 為 `center`、`corner`、`x_half`、`y_half`。每層結果包含 layer、datatype、
rectangles、count，以及 x/y 的 count、a、b、bMax；不適用的間距是 null。
`POST /api/wafer-arrangement/preview-dies` 接收必要的 `dieJson`（原始 JSON 物件或陣列）
與可選 `cowSize`，共用匯出端的解析與邊界檢查。回傳 `dieLayers`、`totalDies`、
`cowRectangle`、`outOfBounds`、`warnings`。每個 die layer 含 type、layer、datatype、
count 與 dies；每顆 die 含 id、path、rectangle。未提供尺寸時 cowRectangle 為 null。
越界仍回傳 200 與圖形，outOfBounds 每筆含 type、id、path、message；格式錯誤為 422。

`POST /api/wafer-arrangement/export-gds` 接收 wafer 參數加 `outputPath` 與可選 `dieJson`，
由相同引擎重算。回傳 outputPath、cowCount、dummyCounts、dieCounts、totalRectangles
及 warnings。dieCounts 包含五種類型在整份 wafer 的數量，未提供 JSON 時皆為 0；
totalRectangles 包含 die。wafer preview 的 totalRectangles 仍只計算 COW 與 wafer dummy。
參數、預算、越界與路徑錯誤為 422；檔案 I/O 失敗為 500。所有 endpoint 皆為同步請求。

## 驗收

實測紀錄與 responsive screenshots 見 [驗證紀錄](../evidence/wafer-arrangement/README.md)。

- `UI-WAFER-001`：首頁入口與直接路由皆可開啟；空值、預設與鍵盤操作符合上述規格。
- `UI-WAFER-002`：四種排列符合格點公式，圓內完整 COW 全數納入，dummy 只出現在邊界格。
- `UI-WAFER-003`：新增／移除不同尺寸層，數量、A／B 與 datatype 保持對應。
- `UI-WAFER-004`：舊回應不覆蓋新結果；變更後禁止匯出；隱藏圖層仍全部匯出。
- `UI-WAFER-005`：GDS 可由現有 placement importer 匯入，數量、單位與座標一致；寫入失敗保留原檔。
- `UI-WAFER-006`：1440×900、1024×768、390×844 無整頁橫向溢出；圖形可縮放、平移及 Fit all。
- `UI-WAFER-007`：參考外圈持續顯示；有效 diameter 即時更新 allowable 圓，已有排列時保留圖形並標示舊直徑，更新前禁止匯出。
- `UI-WAFER-008`：緊密尺寸組合也保留正的 A；必要時減少顆數，預覽與 GDS 皆不貼齊虛擬格邊緣。
- `UI-WAFER-009`：任意深度與五種類型的 JSON 可匯入；實際 ID 數量優先於 Count，單顆 viewer 可獨立操作。
- `UI-WAFER-010`：JSON 更換、尺寸變更與過期回應正確處理；錯誤／越界禁止匯出，移除可恢復。
- `UI-WAFER-011`：五種 die 圖層按每顆完整 COW 中心平移，半格中心維持尺寸、總預算與原檔保護。
- `UI-WAFER-012`：CoW feature 與 Wafer arrangement 分區；CoW graph 預設隱藏，可由 Read JSON 旁開啟彈窗並以鍵盤關閉、恢復焦點。
