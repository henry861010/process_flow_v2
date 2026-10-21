---
title: Home Template 分組與建立 Instance 驗證
status: descriptive
owner: Process Flow UI
audience:
  - product
  - frontend
  - QA
last_verified: 2026-10-21
last_verified_commit: 7d49bf0b
source_of_truth:
  - apps/viewer/app/page.tsx
  - apps/viewer/components/home/home-workspace.tsx
  - apps/viewer/components/home/create-instance-dialog.tsx
  - apps/viewer/components/home/home-workspace.test.tsx
  - apps/viewer/components/home/create-instance-dialog.test.tsx
  - apps/api/tests/test_instance_recipes.py
---

# Home Template 分組與建立 Instance 驗證

依 [Home 規格](../../screens/home.md) 將首頁改為每個 template 一區的 instance 列表，
新增 Create Instance 彈窗與每站 default recipe 初始化，底部資源入口保持原本配置。

## 驗證環境

- 從目前 viewer source 複製到獨立暫存目錄執行 production build，避免覆寫正在運行的 dev cache。
- Static viewer `localhost:3002`、isolated fixture API `127.0.0.1:8002`、test proxy `127.0.0.1:8001`。
- 全新暫存 SQLite 自 packaged fixtures seed；初始 2 templates、3 instances。測試僅在此資料庫
  建立一筆 Home Defaults Trial，未 reset 或修改開發者的工作資料庫。
- Test proxy 模擬 503、延遲、空資料、disabled、空分區、缺失 template 及超長文字。
- Codex in-app browser 實際操作 production export；JPEG screenshot 原圖無縮放轉成 PNG。
- Reduced motion 由 skeleton 的 `motion-safe:animate-pulse` 及 production CSS 驗證；未修改 OS 設定。

## 驗證結果

| Case | 結果與證據 |
| --- | --- |
| `UI-HOME-001` | 所有 templates 各一區。實際模擬 disabled AAA Demo、空 template 及 orphan instance，皆顯示正確；建立選單不含 disabled template。全 disabled 時建立停用，4筆既有instances仍可見。 |
| `UI-HOME-002` | 特殊字元ID、API分區及區內順序、完整metadata由Vitest驗證；實際以Enter重新開啟新建instance，名稱與URL正確。 |
| `UI-HOME-003` | Management、Create Template、home generators及Geometry順序與路由由Vitest驗證；loading與error時靜態入口仍存在。 |
| `UI-HOME-004` | 實際503→Retry→延遲response，Retrying停用且顯示skeleton；完成後恢復列表並清除錯誤。空資料與全disabled各顯示獨立說明；保留已載入內容的refresh failure由Vitest驗證。 |
| `UI-HOME-005` | 1440×900、1024×768、390×844均為單欄；document寬度等於viewport。手機超長template/name/version/owner/generator文字與select不溢出。844×390橫向彈窗form內捲動、footer可見。30 templates／40 instances完整性另由Vitest驗證。 |
| `UI-HOME-006` | 開啟focus在Template；最後按鈕Tab回Close，Close的Shift+Tab回提交。Escape關閉後focus返回頁首Create Instance，body scroll lock解除；Cancel不提交且重開表單重設。提交中Escape不關閉。 |
| `UI-HOME-007` | Template未預選、Version預填V0.0.0；空白字元Version／Owner驗證並聚焦第一個無效欄位。503建立失敗保留全部輸入，focus在alert且可重試。延遲提交時全部controls停用。proxy只收到一次失敗及一次成功請求；DB只新增一筆。成功進入editor，4站皆一組active Initial recipe，geometry為空，metadata已trim，參數與提交defaults逐站相等；molding實際顯示EMC-G700及180。 |

## 自動檢查

- Viewer Vitest：43 files、429 tests passed，包含7項Home分組／狀態測試及2項建立彈窗／預設payload測試。
- Viewer lint：passed，無warnings或errors。
- Production build：passed，含TypeScript與11個static pages。
- API instance recipes：24 tests passed，包含新增的每站default recipe、server ID／時間、active與重新讀取測試。
- API測試以memory設定隔離module-level app；測試個案各自使用temporary SQLite。
- Documentation checker：67 Markdown files passed；`git diff --check` passed。

## 截圖

Ready-state references 固定使用原始 packaged fixture 的2 templates／3 instances；
重新擷取時由 test proxy 排除本輪新增的測試 instance：

- [1440×900](../../assets/reference/home-1440x900.png)
- [1024×768](../../assets/reference/home-1024x768.png)
- [390×844](../../assets/reference/home-390x844.png)

建立流程與狀態：

- [Desktop Create Instance](create-instance-1440x900.png)
- [Mobile Create Instance](create-instance-390x844.png)
- [Create error retains input](create-instance-error.png)
- [Created active default recipe](created-default-recipe.png)
- [Disabled, empty and unavailable template groups](home-groups.png)
- [All templates disabled](home-disabled-390x844.png)
- [Initial API error](home-error.png)
- [Retrying / loading](home-retrying.png)
- [Long names on mobile](home-long-390x844.png)
- [Successful empty state](home-empty-390x844.png)
