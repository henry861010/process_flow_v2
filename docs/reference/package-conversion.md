---
title: Package JSON 轉換為 Process Flow
status: descriptive
owner: integration.platform
audience:
  - package 資料整合工程師
  - backend engineers
  - process flow 建模工程師
last_verified: 2026-11-11
last_verified_commit: b919038b
source_of_truth:
  - apps/api/src/process_flow_api/package_conversion.py
  - apps/api/src/process_flow_api/package_conversion_schema.py
  - apps/api/src/process_flow_api/package_conversion_cli.py
  - apps/api/src/process_flow_api/main.py
  - apps/api/tests/test_package_conversion.py
  - apps/api/tests/test_package_conversion_source.py
  - apps/api/tests/test_package_conversion_cli.py
---

# Package JSON 轉換為 Process Flow

Converter 以人工選定的既有 ProcessFlow 為基準，讀取外部 source profile 與站點綁定，
建立新 flow，執行後驗證來源條件。預覽不寫 DB；匯入透過既有建立 flow 的路徑儲存，
不修改基準、共用 geometry catalog、ProcessFlow schema 或 DB schema。

公司原始 JSON schema 尚未提供。此處的 package 欄位與材料名稱是示意，供第一版整合與
驗收使用；正式接入時更換 profile 的來源路徑與材料對照即可。Die pattern/GDS 的
wafer arrangement 不屬於此 converter 的工作。

## 三層 mapping 與外部設定

| 層次 | 設定 | 責任 |
| --- | --- | --- |
| 公司 JSON → semantic fact | profile 的 `fields` | 明確指定來源路徑、對象、屬性、階段與單位 |
| semantic fact → 製程角色 | profile 的 `rules` | 寫入參數、推導最終厚度、驗證 geometry |
| 製程角色 → 實際 flow | bindings 的 `roles` / `inputs` | 綁定 `stepRefId` 或 `flowInputId` |

同一份 profile 可用於不同 flow，只需調整 bindings。即使有多次 molding 或多組 bump，
角色也必須區分對象與階段，例如 `cow.mold.deposit`、`cow.mold.finish`、`cow.c4.form`。
不依顯示名稱、站序索引或 tech 名稱猜測站點，也不自動推論 flow。

Profile 使用 `schemaVersion: 1`、`id`、`version`、`fields` 與 `rules`；可選
`materialMap` 與 `lengthTolerance`。後者是 geometry 長度比較容差，單位為 µm，預設
`0.00001`，必須大於零。每個 field 包含唯一 `id`、`object`、`property`、`stage`、
`path` 與 `kind`。`path` 與 `unitPath` 使用 RFC 6901 JSON Pointer，含根路徑與陣列索引；
欄位名中的 `~` 與 `/` 分別使用 `~0`、`~1`。未被 profile 指定的來源欄位可以保留。

`kind` 為 `length`、`density` 或 `material`。長度與 density 必須明確提供 `unit` 或
`unitPath`，不能同時提供，不根據數值猜單位。長度支援 `nm`、`um`、`µm`、`mm`，
正規化為 µm；density 支援 `percent`、`fraction`，正規化為百分比。density 指覆蓋比例，
不支援將每平方公釐 bump 數量直接當成比例。材料以名稱字串保存；設定非空
`materialMap` 時，來源材料必須出現在對照表，禁止靜默使用未對照名稱。

每個 rule 的 `fact` 對應一個 field `id`。第一版只提供以下 Python 規則，沒有公式語言：

| `type` | 必要設定 | 行為 |
| --- | --- | --- |
| `parameter` | `role`、`parameter`、`verify` | 修改綁定站點的 selected recipe 參數 |
| `molding_final_thickness` | `moldingRole`、`grindingRole` | 保持 molding recipe，用指定階段 geometry 推導 grinding `thk` |
| `generator_parameter` | `inputRole`、`parameterPath`、`verify` | 修改進料 generator 已存在的參數路徑 |

直接寫入規則必須給 `verify`：`kind` 為 `body`、`bump`、`via` 或 `circuit`，
`property` 為 `material`、`density` 或 `thickness`，可用 `key` 限定 geometry semantic key。
`parameter` 的 `verify.terminal` 預設 false，於該站輸出驗證；設 true 時還要求最終輸出
保留該條件。站點驗證以 producer provenance 限定該站建立的 geometry，再以可選 `key`
篩選；對象必須存在，且每個符合篩選的實體都滿足來源值，才能通過。

`parameter` 只支援 scalar 參數：材料對應 `materialRef`，長度／density 對應數值型別。
長度 target parameter 必須明確宣告 `um` 或 `µm`，density target 必須採百分比。
巢狀 table / group 參數不以直接規則處理。所有輸入與執行輸出的 geometry
`unitSystem` 都必須是 `um`；converter 不會自動縮放 geometry 座標。

`generator_parameter.parameterPath` 為相對 generator `parameters` 的 JSON Pointer，
只能更新既有路徑；其 `verify` 在進料 geometry 驗證。若基準的進料是 catalog binding，
先另建含 generator binding 的基準 flow，不能藉此修改共用 catalog。基準其餘 recipe
參數沿用原設定，report 將其記為基準假設；只修改 selected recipe，未選的 candidates 保留。

## 最終封膠厚度

來源「研磨後剩餘封膠厚度」與 molding 的沉積厚度不同。使用
`molding_final_thickness` 明確指定產生封膠與完成研磨的角色：

```json
{
  "id": "finish_cow_mold",
  "type": "molding_final_thickness",
  "fact": "cow_mold_final_thickness",
  "moldingRole": "cow.mold.deposit",
  "grindingRole": "cow.mold.finish",
  "terminal": true
}
```

上例為單一規則的完整 JSON 示意；仍需 profile 中的同名 length fact，以及 bindings 中
兩個角色，且基準包含 `layer/molding` 與 `grinding/grinding`。計算使用研磨前狀態：

```text
targetSurface = moldBottom_before + finalThickness
Grinding.thk = zMax_before - targetSurface
```

例如研磨前最高點 1000 µm、封膠底面 200 µm、要求剩餘厚度 600 µm，移除量為
200 µm。規則按實際 graph 依賴順序處理，驗證研磨後封膠厚度；`terminal` 預設 true，
另於最終輸出確認此條件。只有最終厚度不足以決定 molding 與 grinding 兩個自由度，
因此固定基準 molding 沉積設定，只計算 grinding 移除量。

第一版只處理正向 z 軸研磨；封膠 producer 必須位於目標 grinding 的 primary geometry
鏈，相關路徑含 flip、無法唯一定位封膠、移除量小於等於零或結果超出容差都失敗，
不任意補值或更換站點。需依錯誤訊息調整基準 recipe 或綁定後再轉換。

## CLI 與 API（golden example）

從 repository root 啟動 API 後，使用三個示例檔預覽：

```bash
venv/bin/python -m process_flow_api.package_conversion_cli \
  --source docs/examples/package-conversion/package.json \
  --profile docs/examples/package-conversion/profile.json \
  --bindings docs/examples/package-conversion/bindings.json \
  --base-flow flow_inst_aaa_demo_hbm4_alpha --base-revision 1 \
  --name 'Package conversion example' --version V1 --owner package.team \
  --output-dir /tmp/package-conversion-preview
```

示例資料對應 packaged seed flow，將 `EMC` 轉為 `EMC-G700`、0.18 mm 沉積厚度轉為
180 µm、fraction 0.58 轉為 58%。這是沉積厚度的直接 mapping，並非最終研磨厚度範例；
seed flow 沒有 grinding。DB 中若已調整基準，先查詢實際 revision 並更新 CLI 參數與綁定。
API acceptance test 會讀取這三份檔案並在原始 seed flow 上實際執行與驗證。
三個設定檔見 [package.json](../examples/package-conversion/package.json)、
[profile.json](../examples/package-conversion/profile.json)、
[bindings.json](../examples/package-conversion/bindings.json)。

CLI 預設呼叫 `POST /api/package-conversions/preview`；加入 `--import` 才改呼叫
`POST /api/package-conversions/import` 並建立一筆新 flow。兩者都會執行驗證。
`--api-url` 預設 `http://127.0.0.1:8000`，不含 `/api`；`--description` 可選。
CLI 只送出一次請求，不自動重試匯入。若連線中斷，先查 DB 是否已建立，避免重複匯入。

API request 的共同外形如下，`source`、`profile`、`bindings` 分別放入完整設定：

```jsonc
// Request 外形示意
{
  "source": { /* 公司 JSON */ },
  "profile": { /* source fields 與 rules */ },
  "bindings": { "roles": {}, "inputs": {} },
  "baseFlowId": "flow_inst_aaa_demo_hbm4_alpha",
  "baseRevision": 1,
  "metadata": {
    "name": "Package conversion example",
    "version": "V1",
    "owner": "package.team",
    "description": ""
  }
}
```

成功回應為 `{flow, report}`，report `status` 為 `validated` 或 `imported`。CLI 將其寫入
指定資料夾的 `flow.json`、`report.json`，每個檔案採暫存檔加原子替換；兩檔並非單一
交易，建議每次指定新的輸出目錄。失敗會以非零 exit code 結束，API 若提供 report
仍保存 `report.json`，不寫入新的 flow；原輸出目錄中的舊 flow 不會自動刪除。

Report 保留 source pointers、對象／屬性／階段、原值與正規化值、基準值、寫入目標、
推導依據、驗證結果及基準假設，另有來源、profile、基準 flow、step templates 與 catalog
geometries 的 SHA-256 指紋。Report 是外部追溯檔，不新增 DB 欄位；匯入後須一併
保留 `report.json`，才能區分來源資料、推導結果與沿用基準的假設。

轉換完成時會重新檢查基準與相依資源；匯入時再由儲存交易原子比對基準、step templates
與 catalog geometries，確定仍是此次驗證使用的版本後才建立新 flow。相依資源於驗證
期間遭修改時回傳 conflict，不能把舊的驗證結果保存成新資料。

| 狀態碼 | 意義 |
| --- | --- |
| `400` | 來源路徑／值（含動態單位）、材料、角色綁定、推導或執行驗證失敗；conversion failure 附 report |
| `404` | 找不到基準 flow |
| `409` | 基準 revision／相依資源已變更，或既有建立流程回報重複資源；重新檢查後再轉換 |
| `422` | request / profile 結構或固定單位設定不合法 |

基準內容不完整、recipe 未選定、輸入無法解析或完整執行失敗時，不建立新 flow。
預覽與匯入分別重新執行，不使用前次預覽的暫存結果。

## 驗證

```bash
PROCESS_FLOW_API_DB_PATH=:memory: PROCESS_FLOW_API_ANALYTICS_DB_PATH=:memory: \
  venv/bin/python -m pytest apps/api/tests/test_package_conversion_cli.py
venv/bin/python scripts/check_docs.py
```

CLI tests 以 mock HTTP 驗證預設預覽、明確匯入、成功輸出、HTTP failure report、
傳輸失敗不重試、來源格式錯誤與避免輸出覆寫來源；核心轉換驗證由 API tests 覆蓋。
