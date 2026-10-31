---
title: Geometry Preview
status: normative
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
  - reconstruction-agent
last_verified: 2026-10-31
last_verified_commit: 039906db
source_of_truth:
  - docs/architecture/decisions/0012-process-owned-schematic-preview.md
  - docs/conformance.md
  - apps/viewer/components/geometry-preview/geometry-preview-panel.tsx
  - apps/viewer/components/geometry-preview/geometry-preview-client.ts
  - packages/schematic-py
  - apps/api/src/process_flow_api/schematic_builder.py
---

# Geometry Preview

## 目的與 context

`GeometryPreviewPanel` 是 Flow Editor 的 full-page overlay；input 與 step output 都可使用。
以 SVG 剖面顯示 process flow 與採用 recipes 計算後的結構、剩餘層厚與總厚度，協助確認 grinding
是否改變預期堆疊。固定代表顆數與符號不表示實際 PnP placement、bump／via 數量或 density。

```ts
type GeometryPreviewContext = {
  previewId: string;
  sourceLabel: string;
  slotLabel: string;
  sourceKind: "flowInput" | "stepOutput";
  request: GeometryPreviewRequest;
};
```

Draft request 帶 inline `flow: {definition, configuration}`；saved request 帶 `flowId`。
UI 依 target 有效 upstream closure 檢查 readiness；採用 recipe 為零 placement 的 `pnp/pnp`
不追蹤 die input，主流程 input 仍必要。Disabled control 顯示第一個 blocking reason。

## Session 與資料 authority

依 [ADR-0012](../../architecture/decisions/0012-process-owned-schematic-preview.md)，以
`POST /api/preview-sessions` 建立 session。Step target 只執行 upstream closure 一次；manifest
保留所有 upstream snapshots，但 panel 只使用 `initialSnapshotId` 指定的 target。
Target 的 `schematic` 由 step／generator presenters 與共用 composer 產生；viewer 只畫通用圖形，
不依製程名稱或 semantic key 寫專屬分支。

Preview 不建立 WebGL scene、不載入 GLB、不呼叫 exact section。沒有 process timeline、snapshot
切換、旋轉、切面或 density 控制。既有 mesh／section routes、standalone CAD viewer 與 generator
engineering preview 保留；legacy `POST /api/geometry-preview` 不供此 UI 使用。

Document 與 session 僅留在 interaction memory。JSON／STEP／CDB 匯出必須使用同一 target 的原始
`geometryEntityJson`／`structure`，不得使用代表 die 複製、顯示位置、符號或放大厚度。Schematic
失敗仍保留 snapshot 與匯出；`schematicWarnings`／document warnings 顯示為可讀提示。

## Overlay shell

Outer fixed inset、z `50`、padding base `12px`／`sm` `24px`，backdrop `foreground/45`。
Panel fill remaining width/height、radius6、border、viewport shadow、column flex。
Header white、padding x16/md20 y12、bottom border；body flex fill、`min-height:0`；footer white、
padding x16 y12、top border、right aligned、wrap。

Step output 主標題為 `<sourceLabel>`（flow-local step label；未設定沿用 template 名稱），字級
`1.6875rem`、行高 `2.25rem`；次行 `<slotLabel>`（`Result`）。Geometry input 主標題維持
`Geometry Preview`，次行 `<sourceLabel> -> <slotLabel>`。保留 request badge `Loading/Ready/Error`、
source badge 與右側 Close；長標題可換行，Close 不縮小。

Footer actions 順序為 `Export JSON`、`Export STEP`、`Export CDB`。Snapshot ready 後可用，
不依 schematic 是否成功。Backdrop、Close、Escape 關閉；unmount abort session request，
不修改 editor draft、不取消已建立的 export jobs。

### CDB mesh settings 草稿

Export CDB 會在同一網站來源／瀏覽器的 `localStorage` 自動保存最後編輯的 mesh settings，
以 API 提供的完整 `geometryHash` 對應。關閉匯出表單、Cancel、關閉 preview、重新整理或重開
瀏覽器後，相同 hash 恢復原草稿；不同 hash 使用各自紀錄。不同 flow、step
若得到相同 hash，也共用該草稿。最多保留最近使用的 20 個 geometry，超出時移除最久未使用者。

保存內容包含 global element size 原始字串、symmetry、完整 local controls（含 reference、
box／polygon、inactive coordinates）及已套用 set 的原始來源／版本、rule details、customized
狀態。未填完或尚未通過驗證的內容也保存；只有匯出時才執行既有驗證。輸出路徑、展開狀態、
錯誤與進行中的請求不保存。沒有紀錄時維持 `500 / full / 空 controls`。

還原不重新呼叫 apply-set API，set 清單載入或更新也不得覆蓋草稿；已移除或更新的 set 仍顯示
保存的來源與版本。只有使用者主動選擇 set 才重新套用。JSON 匯出不讀寫 mesh settings 草稿。
儲存版本不支援或資料損壞時忽略該紀錄；瀏覽器儲存不可用／容量不足時顯示非阻擋提示，
仍可編輯與匯出。多分頁以最後寫入為準，不做即時同步；不跨裝置同步或跨 geometry 對應 references。

### Overlay review contract

Geometry Preview 可以承載 Export form。當 Export form 開啟時，Preview 必須保持 mounted，且
最上層 form 的 `Close`、`Cancel`、idle `Escape` 與 backdrop 只關閉 form；submitting 時不可關閉。
這是 target behavior，與 [Interaction Patterns](../interaction-patterns.md) 的 modal stack contract
一致。Preview、Export 與 Flow Node Editor 共用 topmost dialog stack，實測見
[Unified editor evidence](../evidence/unified-flow-editor/README.md)。

## 狀態與版面

```text
open/context change -> session loading -> target snapshot ready
                          \------------> error
close/context change -> abort session request
```

| State | Body | Header | Export |
| --- | --- | --- | --- |
| Loading | spinner 與生成提示 | Loading | disabled |
| Request error | API error 與 retry 提示 | Error | disabled |
| Snapshot ready | SVG 剖面與厚度明細 | Ready | enabled |
| Snapshot ready、schematic unavailable | 明確提示與可用的 snapshot 匯出 | Ready | enabled |

桌面剖面在左、厚度明細在右；窄螢幕先圖後明細，body 可捲動，footer 保持可達。
SVG 依 `viewBox` 顯示；不以原始 XY／實際 wafer 寬度縮小到無法閱讀。圖與明細選取互相醒目提示，
明細保留 keyboard button 操作、可讀材料、實際 Z 區間及厚度。

## Schematic 行為

- 每組 `wafer-dmy` 兩顆置於最左與最右；LSI 三顆；DRAM、SoC、SoIC 與其他類型各一顆。
  相同結構合併，厚度、放置高度或內部堆疊不同則分組保留，子層不當成額外 die。
- RDL 使用固定少量短柱、landing 與錯開水平線；bump 使用圓形。正 density 的符號數固定，
  零 density 不畫符號。Joined bump 接合區不重複畫。
- 只有 target 實際存在 UF body 才顯示 UF，依其 Z 區間畫在 scope 內有 bump 的 die 下方，
  及相鄰合格代表 die 間。不依 dummy key 排除、不穿越未入選 die。
- 厚度使用最終 snapshot 的實際 Z 區間，包含磨薄、整層移除與翻轉。零厚度不畫成有厚度實體。
  薄層可放大，但所有部件共用 Z 顯示轉換，保持同高度邊界對齊。
- 明示「示意圖，不等比例」；明細與總厚度維持實際值。總厚度取最高與最低 Z 的差，
  不累加並排 die。此次不提供 grinding 前後比較或自動過磨判定。

完整 producer、分派與 fallback 契約以 ADR-0012 與 schematic package 為準。

## Accessibility 與驗收

Overlay 使用共用 dialog stack／focus lifecycle；nested Export 的 Escape／backdrop 只影響最上層。
剖面有可讀 title／description，選取狀態與明細對應；提示不能只依顏色表達。

既有 `UI-PREVIEW-004..006`、`010..021` 的 3D／density／section 案例由本 ADR 取代；
`UI-PREVIEW-001..003`、`007..009` 的開啟、取消、modal 與 target-only 行為繼續有效，
其中 009 現在要求完全不載入 mesh／section。新增案例：

| ID | Given / When | Then |
| --- | --- | --- |
| `UI-SCHEMATIC-001` | Ready input／step target | 只顯示 target schematic，無 WebGL、mesh 或 section 請求。 |
| `UI-SCHEMATIC-002` | 相同結構改變 PnP 顆數與正 density | 代表 die 與符號密度維持固定。 |
| `UI-SCHEMATIC-003` | Grind 削薄／整層移除／flip | 圖、實際層厚與總厚度吻合 target snapshot。 |
| `UI-SCHEMATIC-004` | 多 die 類型、極薄 RDL | 代表顆數與左右位置正確，薄層可辨識、同高度對齊。 |
| `UI-SCHEMATIC-005` | 選取圖形或明細 | 對應內容互相醒目，明細可用 keyboard 選取。 |
| `UI-SCHEMATIC-006` | 缺 presenter／presenter 失敗 | 通用 fallback 與提示可讀；原始匯出仍可用。 |
| `UI-SCHEMATIC-007` | 390px 與桌面 viewport | 圖、明細與 footer 可達，無標籤嚴重重疊。 |

自動測試與 browser 驗收進度只記錄於 [conformance](../../conformance.md)，不以此規格宣稱已完成。
