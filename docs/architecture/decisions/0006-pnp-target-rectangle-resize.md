---
title: ADR-0006：PnP coordinates 使用 target rectangle 與 additive Box resize
status: normative
decision_status: accepted
owner: integration.platform
audience:
  - 製程與產品負責人
  - geometry-kernel、process-step 與 viewer 開發者
  - QA 與 coding agent
last_verified: 2026-07-12
last_verified_commit: 48c7a8d7
verified_against:
  - packages/kernel-py/src/process_flow_kernel/application/flow_compiler.py
  - packages/kernel-py/src/process_flow_kernel/domain
  - packages/process-step-py/src/process_flow_steps/pnp/pnp.py
  - apps/viewer/components/process-flow-fields
---

# ADR-0006：PnP coordinates 使用 target rectangle 與 additive Box resize

## 背景

HBM、DRAM 等公版 geometry 適合保存於 catalog，但 SoC、SoIC 尺寸常隨 TV 改變，同一 TV
也可能需要多種尺寸。若每個 study 尺寸都先建立 catalog geometry，會增加操作成本並產生大量
暫時、重複資料。舊 PnP 的 `coordinates` 只保存每份 clone 的 lower-left `[x,y]`，因此同一步
只能放置同尺寸 die。

## 決策

1. `coordinates` persisted/runtime shape 改為
   `[[[xMin,yMin],[xMax,yMax]], ...]`；不保留舊 `[x,y][]` reader。
2. 每個 rectangle 四值 MUST finite，且 `xMax > xMin`、`yMax > yMin`。四個對應值都在
   absolute tolerance `1e-6 um` 內時視為 duplicate。
3. PnP source size 使用完整 die subtree 的 aggregate XY bounds，包括 body、via、circuit、bump
   與 descendant containers。
4. 對每個 target rectangle clone source，計算
   `deltaX = targetWidth - sourceWidth`、`deltaY = targetHeight - sourceHeight`。
5. Clone 中每個 BoxGeometry 固定 lower-left，upper-right X/Y 分別加上 delta；Z、thickness、
   material、density、direction、koz 與 container hierarchy 不變。
6. Resize 後將 aggregate lower-left 對齊 target lower-left，aggregate bottom Z 對齊 main
   geometry current cursor，並依 coordinates order attach child。
7. 負 delta 合法；任何 BoxGeometry width/height collapse 時整個 placement MUST 在 attach 前失敗。
8. PnP source 出現 PolygonGeometry、CylinderGeometry 或 ConeGeometry 時 MUST 明確失敗。本次
   不定義 proportional scaling、ellipse conversion 或 polygon deformation。
9. GDS import 將 matching BOUNDARY/BOX 所有 hierarchy transforms 套用後，輸出其
   axis-aligned `[[minX,minY],[maxX,maxY]]` bounds。
10. 這是 pre-release breaking upgrade；fixtures 全面改用新 shape，SQLite database schema
    version bump 並 reset existing data。

## 影響

同一個 PnP step 可以由一份 catalog die 產生不同 target sizes，減少 study 階段 geometry catalog
冗餘。Additive resize 保留每個 box 相對 source aggregate 左／下與右／上的 margins，但不是一般
比例縮放；小 internal box 在縮小時可能先 collapse，因此 operation 必須 fail atomically。

非 Box primitive 暫不支援，避免在沒有明確製程需求前引入 ellipse、polygon topology 與 mixed
primitive 規則。未來擴充必須以新 ADR 定義各 primitive 的 deterministic transform。

## 驗證

Tests MUST 覆蓋 rectangle normalization、`1e-6` duplicate、不同尺寸多 placement、internal
Box additive resize、negative delta、collapse atomicity、non-Box rejection、GDS transformed AABB，
以及 source geometry 不被修改。
