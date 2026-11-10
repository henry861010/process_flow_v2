---
title: Wafer arrangement verification evidence
status: descriptive
owner: integration.platform
audience:
  - developers
  - QA
last_verified: 2026-11-10
last_verified_commit: 6a7c9a7d
source_of_truth:
  - apps/viewer/components/wafer-arrangement
  - apps/api/tests/test_wafer_arrangement.py
  - packages/geometry_generators/tests/test_wafer_arrangement_engine.py
  - packages/geometry_generators/tests/test_cow_die_layout.py
---

# Wafer arrangement 驗證紀錄

在隔離的 in-memory API（8002）與 local viewer（3001）檢查
[工具規格](../../screens/wafer-arrangement.md)，不變更原本 API 的資料庫。
圖片為本次實測紀錄，尚未指定為 accepted reference。

| Viewport | 全頁截圖 | 結果 |
| --- | --- | --- |
| 1440×900 | [Desktop](desktop.jpg) | 參數與預覽並排，完整圖形、圖層摘要及匯出成功訊息。 |
| 1024×768 | [Compact](compact.jpg) | 保持並排，無整頁橫向溢出。 |
| 390×844 | [Mobile](mobile.jpg) | 上下排列，scrollWidth 與 viewport 同為 390。 |

輸入 diameter 290000、COW 40000×50000、COW spacing 1000×1000、Center。
Dummy layer 1 為 8000×10000，layer 2 為 5000×6000，兩層最小間距皆為 100×100。
預覽與實際匯出讀回皆為：COW 21、413:10 136 顆、413:11 516 顆，共 673 個矩形；
GDS unit 1e-6 m、precision 1e-9 m。

瀏覽器確認首頁底部入口、產生 pattern、新增不同尺寸圖層、變更後停用匯出、實際 GDS
寫入及成功訊息。鍵盤 + 改變 camera transform，Home 回復原本 Fit all transform；
console 無 error。

## 正 A 留邊與初始圓

[初始畫面](initial-circle.jpg) 在欄位仍為空白時就顯示 300000 µm wafer reference；
輸入 290000 後、尚未 Generate 時，實際 SVG radius 更新為 145000。初次載入的
server-rendered SVG 可直接 hydrate，沒有 console error，也不需要重建 DOM。

[留邊回歸案例](positive-a.jpg) 使用 diameter 50000、COW 10000×10000、spacing 1000×1000，
dummy 3000×3000、最小間距 500×500。每軸原本 3 顆、A=0 的情況改為 2 顆、A=800、B=2400；
實際有 9 顆 COW 與 16 顆 dummy，dummy 皆保留兩側 A。API GDS 讀回也驗證相同留邊。
390px 的 scrollWidth 仍為 390。

## 自動驗證

- Wafer engine 與 COW die layout：16 tests 通過，含正 A、四種排列、量化間距與 die JSON 解析。
- Wafer API：9 tests 通過，含部分寫入失敗、保留原檔、無 DB record 變更，以及 COW／dummy／die 的 GDS round trip。
- Wafer viewer：19 tests 通過，含 Python 匯出 fixture 的 `888:1`～`888:5` 經既有 GDS worker 匯入、初始圓及 SSR hydration。
- `npm run build`：通過，包含 `/wafer-arrangement` 的 static export。
- `scripts/check_docs.py` 與 `git diff --check`：通過。

## COW die JSON 與單顆 viewer

新增功能在隔離 in-memory API（8012）與 production viewer（3012）實測；沒有修改既有
API 的資料庫或程序。使用 [cow-dies.json](../../../../apps/viewer/components/wafer-arrangement/fixtures/cow-dies.json)，
含巢狀物件／陣列內的 SOC 2、HBM 1、LSI 1、SOIC 1、DMY 1，共 6 顆。
沒有任何 wafer 參數時即可選檔顯示單顆 die 配置；填入 COW 3000×4000 後檢查邊界。

| Viewport | 全頁截圖 | 結果 |
| --- | --- | --- |
| 1440×900 | [Desktop](cow-dies-desktop.jpg) | 新增 Choose／Replace JSON、獨立 COW viewer、匯出數量。 |
| 1024×768 | [Compact](cow-dies-compact.jpg) | 並排布局，scrollWidth 為 1024。 |
| 390×844 | [Mobile](cow-dies-mobile.jpg) | 上下布局，scrollWidth 為 390。 |

[單顆 COW viewer](cow-dies-preview.jpg) 驗證五種類型的矩形、中心原點、圖層數量／開關。
實際操作鍵盤 +、方向鍵、Home，確認縮放、平移與 Fit all；可展開每顆 ID 與座標。
[越界畫面](cow-dies-outside.jpg) 將 COW X 改為 2000，圖形保留，列出 SOC-1、SOC-2、
HBM-1、SOIC-1 的錯誤，匯出按鈕停用，長資料位置沒有造成手機橫向溢出。

Wafer 使用 diameter 10000、COW spacing 500×500、Center；wafer dummy 500×1000、
minimum spacing 50×50。隱藏 SOC 後由頁面實際匯出，GDS 讀回仍含 SOC：
`100:100` 1、`413:10` 44、`888:1` 2、`888:2`～`888:5` 各 1，共 51 矩形。
只有 `WAFER_ARRANGEMENT` cell，unit 為 1e-6 m、precision 為 1e-9 m。
更新後的瀏覽器 console 無 error。

完整 geometry generators suite 為 47 tests 通過；另有 9 個 wafer API tests 通過。
獨立 `tsc --noEmit --incremental false` 仍回報既有 schematic inspector 匯出與
flow-editor-source test 型別問題，wafer 相關檔案沒有型別錯誤；production build 通過。

初版驗證的全套 viewer tests 為 511 passed、2 failed；失敗是既有 schematic inspector tests 引用
未匯出的 SchematicInspectorCard。獨立 `tsc --noEmit` 另指出既有 schematic-preview 與
flow-editor-source tests 的型別問題。

全套 API run 的既有失敗為 CDB mesh constraint／缺少 mesher.process_flow.pipeline，
以及 legacy migration execution digests。使用暫存 API 副本、還原本次變更前的 main.py
移除 wafer routes 後，重現相同的 7 個 failure 與 2 個 error；本次未修改這些流程。
